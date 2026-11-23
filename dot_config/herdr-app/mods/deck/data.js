// Deck's collector and actions. Herdr-bound: polls agents, git, gh, proof files,
// screens and Claude history into the issue store in shared state, and performs
// the user's actions (reply, press an option, merge, ...).
//
// Actions are async; call them from a view inside `cx.spawn(async (cx) => ...)`.
// Nothing here runs on its own except the collector, which the bar starts.

import { agents, terminals, panes, spaces, exec, home, shared, setShared, run, notify } from "herdr";
import { GIT_CMDS, PR_FIELDS, parseGitState, parsePr, headCheck } from "./lib/github.js";
import { parseProofFile, buildClaims, mergeState, evidenceOpenArgs } from "./lib/proof.js";
import { parsePrompt, samePrompt } from "./lib/prompt.js";
import { findBrief } from "./lib/brief.js";
import { parseBacklog, mergeBacklog, inboxTail, runStart, discardBacklog, restoreBacklog, markStarted, setPendingWorktree, issueAt } from "./lib/backlog.js";
import { emptyStore, reconcile, dismiss as dismissIn, markReplied, updatePr, markReviewed, pinColumn, removeIssue, editIssue } from "./lib/store.js";
import { STAGE_LABEL } from "./lib/stage.js";
import { BOARD_OPS, BOARD_RESULTS, parseOps, pendingOps, pruneDone, planOp, resultLine } from "./lib/boardops.js";
import { findChatTerminal } from "./lib/chatsource.js";
import { parseMachines } from "./lib/machines.js";
import { submitTask, backlogExec, startTask } from "./lib/newtask.js";
import { CLOSED_LOG, expandHome } from "./lib/chatpaths.js";
import { closedRecord, appendExec, noteDue } from "./lib/chatarchive.js";
import { createSharedMemo } from "./lib/sharedmemo.js";
import { GOALS_KEY, asGoals, newGoal, linkCard, linkStarted, syncGoals, shortDay } from "./lib/goals.js";

/** @typedef {import("./lib/store.js").Issue} Issue */
/** @typedef {import("./lib/store.js").Store} Store */
/** @typedef {import("./lib/store.js").Observation} Observation */
/** @typedef {import("./lib/prompt.js").PromptOption} PromptOption */

export const STORE_KEY = "deck.store";
export const SEL_KEY = "deck.selected";
export const TAB_KEY = "deck.issueTab";
/** Issues view mode: "list" (default) or "board". */
export const MODE_KEY = "deck.issuesMode";
export const VIEW_KEY = "deck.view";
/** Where the issue page was opened from: "board" | "list" | "chat" | "terminal" (esc goes back there). */
export const ISSUE_FROM_KEY = "deck.issueFrom";
/** Shared list of other machines: {name, online, agents}[] from `hc machine ls --json`. */
export const MACHINES_KEY = "deck.machines";
/** The last failed backlog start: {key, error} (the card shows it), or null. */
export const START_ERR_KEY = "deck.startError";

const SLOW_MS = 45_000;
const FAST_MS = 10_000;
const TICK_MS = 2_000;
const MACHINES_MS = 60_000;
// A collector whose heartbeat is older than this is gone (e.g. its build was reloaded).
const STALE_MS = 15_000;
// Rewrite the store at least this often even if only lastSeen moved (expiry uses it).
const HEARTBEAT_WRITE_MS = 10 * 60_000;
const T_GIT = 5_000;
const T_HC = 5_000;
const T_GH = 15_000;
const T_MERGE = 60_000;
// git worktree add checks out the whole tree.
const T_WORKTREE = 60_000;
// A cycle still running after this is abandoned; its result is discarded.
const CYCLE_DEADLINE_MS = 60_000;
// The backlog inbox is read with tail -c: its newest MiB.
const INBOX_MAX = 1024 * 1024;
// herdr-backlog (node + git) filing one task.
const T_BACKLOG = 15_000;
// readTextFile stops at 1 MiB and history.jsonl is larger; the newest 4 MiB is plenty.
const HISTORY_TAIL = String(4 * 1024 * 1024);

// One memo for every copy of the mod (they share this runtime, like the collector guard).
const memo = (globalThis.__deckSharedMemo ??= createSharedMemo((k) => shared(k)));

/**
 * shared(key) with the issue store read at most once per synchronous job
 * (lib/sharedmemo.js); other keys (some herdr writes itself) are read as is.
 * Treat what it returns as read-only.
 */
export const sharedOnce = (key) => (key === STORE_KEY ? memo.get(key) : shared(key));

/** @returns {Store} */
export function currentStore() {
  const s = /** @type {Store|null} */ (sharedOnce(STORE_KEY));
  return s && Array.isArray(s.issues) ? s : emptyStore();
}

/** The store's latest copy of an issue (actions get one captured at render time). */
function latest(issue) {
  return currentStore().issues.find((i) => i.key === issue.key) ?? issue;
}

const FAILED = (e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e ?? "failed") });

/** exec that never rejects. A rejection (timeout, or it could not start) is marked `rejected`. */
export async function sh(cmd, args, opts) {
  try {
    const r = await exec(cmd, args, opts);
    return r ?? FAILED("no result");
  } catch (e) {
    return { ...FAILED(e), rejected: true };
  }
}

/** Read-only hc calls, time-limited through exec. A failure (or timeout) is no data. */
function hcRead(args) {
  return sh("hc", args, { timeout: T_HC });
}

const okText = (r) => (r.code === 0 ? String(r.stdout ?? "").trim() : "");

// hc send / hc keys wait while the agent's composer holds an unfinished draft.
const DRAFT = "Agent has a draft — not sent";

/** hc send / hc keys, time-limited. A timeout means the agent's draft blocked it. */
export async function hcAct(args, failed) {
  const r = await sh("hc", args, { timeout: T_HC });
  if (r.code === 0) return { ok: true, error: null };
  if (r.rejected) return { ok: false, error: DRAFT };
  return { ok: false, error: String(r.stderr || r.stdout || failed).trim() };
}

// ---------------------------------------------------------------- collector

/** terminal -> created_ms (never changes for a terminal). */
const createdCache = new Map();

async function createdMs(t) {
  if (createdCache.has(t)) return createdCache.get(t);
  const r = await hcRead(["get", t, "--json"]);
  if (r.code !== 0) return null;
  try {
    const ms = Number(JSON.parse(r.stdout).created_ms);
    if (!Number.isFinite(ms)) return null;
    createdCache.set(t, ms);
    return ms;
  } catch {
    return null;
  }
}

async function gitState(cwd) {
  const git = (cmd) => sh("git", ["-C", cwd, ...cmd], { timeout: T_GIT });
  const [cTop, cBranch, cBase, cAhead, cStatus, cCommon] = GIT_CMDS;
  const toplevel = await git(cTop);
  if (toplevel.code !== 0) return parseGitState({ toplevel, branch: toplevel, base: toplevel, ahead: null });
  const [branch, base, status, common] = await Promise.all([git(cBranch), git(cBase), git(cStatus), git(cCommon)]);
  // Count against the remote's default branch when known (origin/main), else local "main".
  const baseRef = okText(base) || "main";
  const ahead = await git(cAhead.map((a) => a.replace("<base>", baseRef)));
  return parseGitState({ toplevel, branch, base, ahead, status, common });
}

async function prState(root, branch, base) {
  if (!root || !branch || branch === "HEAD" || branch === base) return { pr: null, error: null };
  const r = await sh("gh", ["pr", "view", branch, "--json", PR_FIELDS], { cwd: root, timeout: T_GH });
  return parsePr(r);
}

/** Agent proof claims with `exists` built from realpath-inside-root + regular file. */
async function proofClaims(root) {
  if (!root) return { agentClaims: [], exists: Object.create(null) };
  // Timed and size-capped: a FIFO or huge file at that path can't stall the cycle.
  const read = await sh("head", ["-c", "65536", root + "/.herdr/proof.json"], { timeout: T_GIT });
  const agentClaims = parseProofFile(read.code === 0 ? String(read.stdout ?? "") : null);
  const exists = Object.create(null);
  const paths = [...new Set(agentClaims.map((c) => c.path).filter((p) => typeof p === "string"))];
  if (!paths.length) return { agentClaims, exists };
  const realRoot = okText(await sh("realpath", ["--", root], { timeout: T_GIT }));
  if (!realRoot) return { agentClaims, exists };
  await Promise.all(paths.map(async (p) => {
    const resolved = okText(await sh("realpath", ["--", p], { cwd: root, timeout: T_GIT }));
    if (!resolved || !resolved.startsWith(realRoot + "/")) return;
    // A regular file that is not empty (-s alone passes a directory; an empty file is NO DATA).
    const f = await sh("test", ["-f", resolved, "-a", "-s", resolved], { timeout: T_GIT });
    if (f.code === 0) exists[p] = true;
  }));
  return { agentClaims, exists };
}

/** Whether the repo has CI workflows (.github/workflows/*.yml|*.yaml). */
async function hasWorkflows(root) {
  if (!root) return false;
  const r = await sh(
    "find", [root + "/.github/workflows", "-maxdepth", "1", "-type", "f", "(", "-name", "*.yml", "-o", "-name", "*.yaml", ")"],
    { timeout: T_GIT },
  );
  return okText(r) !== "";
}

/** The bottom of terminal `t`'s screen (no history), or null when it cannot be read. */
export async function readScreenText(t) {
  const r = await hcRead(["read", t, "--lines", "0"]);
  return r.code === 0 ? String(r.stdout ?? "") : null;
}

export async function readScreen(t, status) {
  const r = await hcRead(["read", t, "--lines", "60"]);
  return r.code === 0 ? parsePrompt(String(r.stdout ?? ""), status) : null;
}

/** @returns {Promise<Observation>} */
async function observe(a, history, paneByTerminal, termByAddr) {
  const t = a.address;
  const status = a.status;
  const pane = paneByTerminal.get(t);
  const term = termByAddr.get(t);
  const cwd = pane?.cwd || term?.foreground?.cwd || term?.cwd || "";
  /** @type {Observation} */
  const o = {
    terminal: t, session: null, space: a.space_name || null, status, title: a.title ?? "", cwd, repo: null, root: null, branch: null,
    commitsAhead: null, dirty: false, pr: null, ghError: null, claims: [], prompt: null, brief: null, replied: false,
  };
  try {
    const [git, prompt, after] = await Promise.all([
      cwd ? gitState(cwd) : Promise.resolve(null),
      status !== "working" ? readScreen(t, status) : Promise.resolve({ kind: "none", text: "", options: [] }),
      createdMs(t),
    ]);
    o.prompt = prompt;
    o.session = after == null ? null : String(after);
    if (git) {
      o.repo = git.repo;
      o.root = git.root;
      o.branch = git.branch;
      o.commitsAhead = git.commitsAhead;
      o.dirty = git.dirty;
    }
    if (history && cwd) {
      try {
        o.brief = findBrief(history, { cwd, root: o.root, after });
      } catch {
        o.brief = null;
      }
    }
    if (o.root) {
      const [pr, proof, wf] = await Promise.all([prState(o.root, o.branch, git.base), proofClaims(o.root), hasWorkflows(o.root)]);
      o.pr = pr.pr;
      o.ghError = pr.error;
      o.claims = buildClaims(o.pr?.checks ?? [], proof.agentClaims, proof.exists, wf && o.pr != null);
    }
  } catch {
    // Keep what is known; the next cycle tries again.
  }
  return o;
}

/** Store without the fields that move every cycle, to skip no-op writes (each write redraws). */
function fingerprint(store) {
  return JSON.stringify(store, (k, v) => {
    if (k === "lastSeen") return undefined;
    if (k === "retired" && v && typeof v === "object") return Object.keys(v).sort();
    return v;
  });
}

let lastWrite = 0;

// ---------------------------------------------------------------- machines

let lastMachines = 0;
let machinesBusy = false;

/** Refresh MACHINES_KEY from a timed `hc machine ls --json`; a failure keeps the previous list. */
async function machinesCycle() {
  machinesBusy = true;
  try {
    const r = await hcRead(["machine", "ls", "--json"]);
    // A failed or timed-out poll keeps the last good list; only a clean run replaces it.
    if (!r || r.code !== 0) return;
    const list = parseMachines(String(r.stdout ?? ""), r.code);
    const prev = shared(MACHINES_KEY);
    if (JSON.stringify(prev ?? null) !== JSON.stringify(list)) setShared(MACHINES_KEY, list);
  } catch (e) {
    console.error("deck machines:", e);
  } finally {
    machinesBusy = false;
  }
}

/**
 * The inbox: a missing or unreadable file is empty (entries already merged stay).
 * Its newest MiB (append-only, so the newest entries win); a cut-off first line is dropped.
 */
async function readInbox() {
  const ib = await sh("tail", ["-c", String(INBOX_MAX), home() + "/.local/state/herdr-deck/backlog.jsonl"], { timeout: T_GIT });
  return ib.code === 0 ? parseBacklog(inboxTail(String(ib.stdout ?? ""), INBOX_MAX)) : [];
}

/** @param {number} id the cycle's id; a result from an abandoned cycle is dropped */
async function cycle(id) {
  const list = agents() ?? [];
  const terms = terminals() ?? [];
  const termByAddr = new Map(terms.map((x) => [x.address, x]));
  const paneByTerminal = new Map((panes() ?? []).filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const mine = list.filter((a) => !termByAddr.get(a.address)?.parent);

  let history = null;
  if (mine.length) {
    const r = await sh("tail", ["-c", HISTORY_TAIL, home() + "/.claude/history.jsonl"], { timeout: T_GIT });
    history = r.code === 0 ? String(r.stdout ?? "") : null;
  }
  const obs = await Promise.all(mine.map((a) => observe(a, history, paneByTerminal, termByAddr)));

  const inbox = await readInbox();

  // Read the store only now, after every await, so actions taken meanwhile are kept.
  const now = Date.now();
  if (id !== cycleId) return;
  const prev = currentStore();
  const next = mergeBacklog(reconcile(prev, obs, now), inbox, now);
  if (fingerprint(next) !== fingerprint(prev) || now - lastWrite > HEARTBEAT_WRITE_MS) {
    setShared(STORE_KEY, next);
    memo.clear();
    lastWrite = now;
  }
  syncGoalsNow(next, now);
}

// ---------------------------------------------------------------- goals

/** The goals (lib/goals.js); Deck is their only writer. */
export function currentGoals() {
  return asGoals(shared(GOALS_KEY));
}

/** Goals brought up to date with the board (landings, started backlog cards); written only when changed. @param {Store} store */
function syncGoalsNow(store, now) {
  const g = currentGoals();
  const next = syncGoals(g, store.issues, now, store.backlogTombs ?? {});
  if (next !== g) setShared(GOALS_KEY, next);
}

/**
 * Fast refresh of the selected issue: only its PR, checks and workflows; its
 * agent claims are kept from the last full cycle.
 * @param {number} id @param {string} key
 */
async function selectedCycle(id, key) {
  const it = currentStore().issues.find((i) => i.key === key);
  if (!it?.root || !it.branch) return;
  const [pr, wf] = await Promise.all([prState(it.root, it.branch, it.pr?.base || null), hasWorkflows(it.root)]);
  if (id !== cycleId) return;
  const now = Date.now();
  const prev = currentStore();
  const cur = prev.issues.find((i) => i.key === key);
  if (!cur) return;
  const shownPr = pr.pr ?? (pr.error ? cur.pr : null);
  const agentClaims = (cur.claims ?? []).filter((c) => c.source === "agent");
  const claims = [...buildClaims(shownPr?.checks ?? [], [], {}, wf && shownPr != null), ...agentClaims];
  const next = updatePr(prev, key, { pr: pr.pr, ghError: pr.error, claims }, now);
  if (fingerprint(next) !== fingerprint(prev)) {
    setShared(STORE_KEY, next);
    memo.clear();
  }
}

let running = null;
let cycleId = 0;
let cycleStarted = 0;
// When the last full cycle started, or 0 to run one at the next tick (refresh()).
let lastStart = 0;
// When the last fast (selected-issue) refresh started.
let lastFast = 0;

/** @param {string|null} [fastKey] refresh only this issue's PR instead of a full cycle */
function startCycle(fastKey = null) {
  if (running && Date.now() - cycleStarted > CYCLE_DEADLINE_MS) running = null; // hung: abandon it
  if (running) return running;
  const id = ++cycleId;
  cycleStarted = Date.now();
  if (fastKey) lastFast = cycleStarted;
  else lastStart = lastFast = cycleStarted;
  const p = (async () => {
    try {
      if (fastKey) await selectedCycle(id, fastKey);
      else await cycle(id);
    } catch (e) {
      console.error("deck collector:", e);
    } finally {
      if (running === p) running = null;
    }
  })();
  running = p;
  return p;
}

/**
 * The issue to refresh every FAST_MS: the selected one, only while the deck
 * layout shows the Issues view or the issue page (VIEW_KEY, set by showView). Otherwise null and
 * only the full SLOW_MS cycle runs.
 * @returns {string|null}
 */
function fastKey() {
  if (!String(shared("layout") ?? "").startsWith("deck")) return null;
  const view = shared(VIEW_KEY);
  if (view !== "deck-issues" && view !== "deck-issue") return null;
  const sel = shared(SEL_KEY);
  if (!sel) return null;
  const it = currentStore().issues.find((i) => i.key === sel);
  if (!it?.root || !it.branch || it.observed === false || it.pr?.state === "MERGED") return null;
  return sel;
}

/**
 * Called from the bar's init. One collector per app: while another copy's
 * collector is alive (heartbeat within STALE_MS) this one only watches, and
 * takes over once that one goes quiet (its copy closed, or its build was
 * reloaded without close()). Returns the guard to hand to stopCollector.
 * @param {any} cx
 */
export function startCollector(cx) {
  const guard = { beat: 0 };
  const claim = () => {
    const g = globalThis.__deckCollector;
    if (g === guard) return true;
    if (g && Date.now() - g.beat < STALE_MS) return false;
    globalThis.__deckCollector = guard;
    lastStart = 0;
    lastMachines = 0;
    return true;
  };
  const tick = (cx) => {
    if (!claim()) return;
    guard.beat = Date.now();
    // Machines: its own 60 s poll, independent of the issue cycle.
    if (!machinesBusy && Date.now() - lastMachines >= MACHINES_MS) {
      lastMachines = Date.now();
      cx.spawn(async () => {
        await machinesCycle();
      });
    }
    // The chat agent's board requests (herdr-board): their own loop, so a slow
    // issue cycle or a start never holds them up for long.
    if (!opsBusy) {
      cx.spawn(async () => {
        await boardOpsCycle();
      });
    }
    const hung = running && Date.now() - cycleStarted > CYCLE_DEADLINE_MS;
    if (running && !hung) return;
    const now = Date.now();
    if (now - lastStart >= SLOW_MS) {
      cx.spawn(async () => {
        await startCycle();
      });
      return;
    }
    const fast = now - lastFast >= FAST_MS ? fastKey() : null;
    if (fast) {
      cx.spawn(async () => {
        await startCycle(fast);
      });
    }
  };
  tick(cx);
  cx.timer.every(TICK_MS, tick);
  return guard;
}

/** From the bar's close(): release the guard so another copy can collect. */
export function stopCollector(guard) {
  if (guard && globalThis.__deckCollector === guard) globalThis.__deckCollector = null;
}

/** Run a cycle soon (within a tick), e.g. after an action. */
export function refresh() {
  lastStart = 0;
}

// ---------------------------------------------------------------- actions

/** @param {Store} s */
function save(s) {
  setShared(STORE_KEY, s);
  memo.clear();
}

/**
 * Type text into the agent and press Enter (hc send; no --force, so a blocked
 * agent's dialog is never answered by accident).
 * @param {Issue} issue @param {string} text
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function reply(issue, text) {
  if (!issue?.terminal || typeof text !== "string" || !text.trim()) return { ok: false, error: "nothing to send" };
  if (text.includes("\0")) return { ok: false, error: "reply contains a NUL character" };
  // "--" ends hc's options, so a reply starting with "-" is text, not a flag.
  const r = await hcAct(["send", issue.terminal, "--", text], "send failed");
  if (!r.ok) return r;
  save(markReplied(currentStore(), issue.key, Date.now()));
  refresh();
  return { ok: true, error: null };
}

/**
 * Answer a prompt option, only if a fresh read of the screen still shows the
 * same prompt; then the fresh option is used. Reply options (an idle agent's
 * numbered list) are typed; key options are pressed.
 * @param {Issue} issue @param {PromptOption} option
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function pressOption(issue, option) {
  if (!issue?.terminal || !option) return { ok: false, error: "no option" };
  const t = issue.terminal;
  const status = (agents() ?? []).find((a) => a.address === t)?.status ?? issue.status;
  const isReply = typeof option.reply === "string" && option.reply !== "";
  if (isReply && status === "working") {
    // An end-of-turn choice: only while the agent is still waiting, not mid-turn.
    notify({ title: "The agent is working again — refreshed", level: "info" });
    refresh();
    return { ok: false, error: "agent is working" };
  }
  const fresh = status !== "working" ? await readScreen(t, status) : null;
  const old = issue.prompt;
  const match = fresh && old && samePrompt(old, fresh)
    ? fresh.options.find((o) => o.label === option.label)
    : null;
  const usable = isReply
    ? typeof match?.reply === "string" && match.reply !== ""
    : Array.isArray(match?.keys) && match.keys.length > 0;
  if (!usable) {
    notify({ title: "The question changed — refreshed", level: "info" });
    refresh();
    return { ok: false, error: "prompt changed" };
  }
  if (isReply) return reply(issue, match.reply);
  const r = await hcAct(["keys", t, ...match.keys], "keys failed");
  if (!r.ok) return r;
  save(markReplied(currentStore(), issue.key, Date.now()));
  refresh();
  return { ok: true, error: null };
}

/** Keys with a merge in flight: one press, one merge. */
const merging = new Set();

const notMerged = (error) => {
  notify({ title: "Checks changed — not merged", level: "warning" });
  refresh();
  return { ok: false, error };
};

/**
 * Squash-merge PR `n`, pinned to `sha`, the head the person saw (gh refuses if
 * the head moved). `recheck`: first re-read the PR and proof from GitHub and the
 * repo; refuse if GitHub's head is not `sha` or the lock is closed on that data.
 */
async function doMerge(issue, sha, recheck) {
  const n = issue.pr?.number;
  const root = issue.root;
  if (!Number.isInteger(n) || !root) return { ok: false, error: "no pull request" };
  if (merging.has(issue.key)) return { ok: false, error: "merge already running" };
  merging.add(issue.key);
  try {
    if (recheck) {
      const { pr, error } = parsePr(await sh("gh", ["pr", "view", String(n), "--json", PR_FIELDS], { cwd: root, timeout: T_GH }));
      if (!pr || pr.number !== n || !pr.headSha) return notMerged(error ?? "pull request unavailable");
      const head = headCheck(sha, pr.headSha);
      if (!head.ok) return { ok: false, error: head.error };
      const [proof, wf] = await Promise.all([proofClaims(root), hasWorkflows(root)]);
      const claims = buildClaims(pr.checks, proof.agentClaims, proof.exists, wf);
      if (!mergeState(pr, error, claims).canMerge) return notMerged("proof incomplete");
    }
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) return { ok: false, error: "unknown head commit" };
    const r = await sh("gh", ["pr", "merge", String(n), "--squash", "--match-head-commit", sha], { cwd: root, timeout: T_MERGE });
    if (r.code !== 0) return { ok: false, error: String(r.stderr || r.stdout || "merge failed").trim() };
    return { ok: true, error: null };
  } finally {
    merging.delete(issue.key);
    refresh();
  }
}

/**
 * Merge only when the lock is open (open PR, every claim PASS), both on the
 * store's copy and on a fresh read right before merging, and only the head
 * shown on screen (`shownSha`, the issue's pr.headSha the view drew; required).
 * @param {Issue} issue @param {string|null} shownSha
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function merge(issue, shownSha) {
  const it = latest(issue);
  // Only the head the screen showed; no fallback to the store's.
  if (!shownSha) return { ok: false, error: "Branch moved — review again" };
  const shown = shownSha;
  const head = headCheck(shown, it.pr?.headSha ?? null);
  if (!head.ok) return { ok: false, error: head.error };
  if (!mergeState(it.pr, it.ghError, it.claims ?? []).canMerge) return { ok: false, error: "proof incomplete" };
  return doMerge(it, shown, true);
}

/**
 * The confirm dialog's "Merge anyway", after the person confirmed. Pinned to
 * `headSha`, the head the dialog showed (issue.pr.headSha when it opened), so a
 * push since then makes gh refuse. Still needs an open PR GitHub reports.
 * @param {Issue} issue @param {string} headSha
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function mergeAnyway(issue, headSha) {
  const it = latest(issue);
  const m = mergeState(it.pr, it.ghError, it.claims ?? []);
  if (!m.canMerge && !m.showAnyway) return { ok: false, error: "no open pull request" };
  const head = headCheck(headSha, it.pr?.headSha ?? null);
  if (!head.ok) return { ok: false, error: head.error };
  return doMerge(it, headSha, false);
}

/**
 * Merge (same lock and shown head as merge) and, only if it succeeded, tell the agent to ship.
 * @param {Issue} issue @param {string|null} shownSha
 */
export async function mergeAndShip(issue, shownSha) {
  const m = await merge(issue, shownSha);
  if (!m.ok) return m;
  const r = await reply(issue, "merged — ship it");
  return r.ok ? m : { ok: true, error: "merged, but the message failed: " + r.error };
}

/**
 * Ask the agent for the evidence its NO DATA claims lack.
 * @param {Issue} issue
 */
export async function requestProof(issue) {
  const it = latest(issue);
  const missing = (it.claims ?? []).filter((c) => c.source === "agent" && c.verdict === "NO DATA").map((c) => c.claim);
  const text = missing.length
    ? "Proof needed. These claims have no evidence yet: " + missing.join("; ") +
      ". Save evidence files in the repo and list them in .herdr/proof.json."
    : "Proof needed. List each claim with an evidence file path in .herdr/proof.json.";
  return reply(it, text);
}

/**
 * The PR tab drew the diff for head `sha`: record it (the review soft gate).
 * @param {Issue} issue @param {string} sha
 */
export function markDiffReviewed(issue, sha) {
  if (!issue?.key) return;
  const prev = currentStore();
  const next = markReviewed(prev, issue.key, sha);
  if (next !== prev) save(next);
}

/** @param {Issue} issue */
export function dismiss(issue) {
  if (!issue?.key || issue.kind === "backlog") return;
  save(dismissIn(currentStore(), issue.key, Date.now()));
}

/** Failure key -> when its "Could not write the log" notice was last shown (lib/chatarchive.js noteDue). */
let logNotes = new Map();

/** The failure notice, at most once per distinct failure (path + error) a minute. */
function logFailed(path, error) {
  const d = noteDue(logNotes, `${path}\n${error}`, Date.now());
  logNotes = d.seen;
  if (!d.due) return;
  const n = { title: "Could not write the log", level: "warning" };
  try { notify(error ? { ...n, body: error } : n); } catch {}
}

/**
 * Appends one line to a log file through /bin/sh (lib/chatarchive.js
 * appendExec). Never throws: a failed write only notifies (throttled), so it
 * can never stop the action it records.
 * @param {string} path @param {string} line
 */
export async function appendLog(path, line) {
  try {
    const ex = appendExec(path, line);
    const r = await sh(ex.cmd, ex.args, { timeout: T_GIT });
    if (r.code !== 0) logFailed(path, String(r.stderr ?? "").trim());
  } catch (e) {
    logFailed(path, String(e?.message ?? e ?? ""));
  }
}

/**
 * Records a removed card in the closed-issue log; not awaited by the caller.
 * Never throws (even building the record or path), so it cannot fail the action.
 */
function logClosed(issue, how, now) {
  try {
    void appendLog(expandHome(CLOSED_LOG, home()), JSON.stringify(closedRecord(issue, how, now)));
  } catch {
    try { notify({ title: "Could not write the log", level: "warning" }); } catch {}
  }
}

/**
 * Delete: the card goes and this agent session is never tracked again.
 * Deck's record only: the terminal, branch and PR are untouched.
 * @param {Issue} issue
 */
export function deleteIssue(issue, by = "you") {
  if (!issue?.key || issue.kind === "backlog") return;
  const prev = currentStore();
  const now = Date.now();
  const gone = latest(issue);
  const next = removeIssue(prev, issue.key, now, by);
  if (next !== prev) {
    save(next);
    logClosed(gone, "deleted", now);
  }
}

/**
 * The person put a card in a board column (drag or ⇧H/⇧L): it stays there
 * until a PR opens or merges.
 * @param {Issue} issue @param {string} column @param {string} [by] who moved it, for the log
 */
export function moveCard(issue, column, by = "you") {
  if (!issue?.key || issue.kind === "backlog") return;
  const prev = currentStore();
  const next = pinColumn(prev, issue.key, column, Date.now(), by);
  if (next !== prev) save(next);
}

/** Opens a web link in the default browser (http/https only). */
export async function openUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return { ok: false, error: "not a web link" };
  const r = await sh("open", [url], { timeout: T_GIT });
  return r.code === 0 ? { ok: true, error: null } : { ok: false, error: String(r.stderr).trim() };
}

/**
 * Opens an agent claim's evidence file. Checked again at click time: the file's
 * realpath must be a regular file strictly inside the repo root's realpath, and
 * its type (from the resolved name) picks a named viewer; anything else is only
 * revealed in Finder. The file's default handler is never used.
 * @param {Issue} issue @param {string} path repo-relative, from the proof file
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function openEvidence(issue, path) {
  const root = latest(issue).root;
  if (!root || typeof path !== "string" || !path || path.startsWith("/") || /[\0\r\n]/.test(path)) {
    return { ok: false, error: "no evidence file" };
  }
  const realRoot = okText(await sh("realpath", ["--", root], { timeout: T_GIT }));
  const resolved = okText(await sh("realpath", ["--", path], { cwd: root, timeout: T_GIT }));
  const args = evidenceOpenArgs(resolved || null, realRoot || null);
  if (!args) return { ok: false, error: "evidence is outside the repo" };
  const f = await sh("test", ["-f", resolved, "-a", "-s", resolved], { timeout: T_GIT });
  if (f.code !== 0) return { ok: false, error: "evidence file is missing or empty" };
  const r = await sh("open", args, { timeout: T_GIT });
  return r.code === 0 ? { ok: true, error: null } : { ok: false, error: String(r.stderr || "open failed").trim() };
}

/** Show a child of the deck-main stack and remember it for the bar. */
export function showView(child) {
  // A show request the view's copy acts on at its next draw (views/focus.js
  // focusOnShow): a hidden stack child may not have drawn since it went away.
  globalThis.__deckShown = { child, at: Date.now() };
  setShared(VIEW_KEY, child);
  run("layout.select", { stack: "deck-main", child });
}

/** @param {Issue} issue */
export function focusTerminal(issue) {
  if (!issue?.terminal) return;
  showView("deck-terminal");
  run("agent.focus", { terminal: issue.terminal });
}

// ---------------------------------------------------------------- backlog

/** The store's live (not discarded) backlog entry for `entry`, or null. */
function liveBacklog(entry) {
  return currentStore().issues.find((i) => i.kind === "backlog" && i.key === entry?.key && !i.discarded) ?? null;
}

/**
 * `exists` for startPlan, timed: a bare branch name is checked with
 * `git show-ref --verify --quiet refs/heads/<branch>` in the repo, an absolute
 * path with `test -e`. A timeout or a git error is thrown (no guessing).
 * @param {string} repo
 */
function backlogExists(repo) {
  return async (name) => {
    if (name.startsWith("/")) {
      const r = await sh("test", ["-e", name], { timeout: T_GIT });
      if (r.rejected) throw new Error(r.stderr || "timed out");
      return r.code === 0;
    }
    const r = await sh("git", ["-C", repo, "show-ref", "--verify", "--quiet", "refs/heads/" + name], { timeout: T_GIT });
    if (r.rejected) throw new Error(r.stderr || "timed out");
    if (r.code !== 0 && r.code !== 1) throw new Error(String(r.stderr || "git show-ref failed").trim());
    return r.code === 0;
  };
}

/** `git rev-parse --show-toplevel` of the repo, timed; null when it is not a work tree. */
async function repoToplevel(repo) {
  const r = await sh("git", ["-C", repo, "rev-parse", "--show-toplevel"], { timeout: T_GIT });
  if (r.rejected) throw new Error(r.stderr || "timed out");
  return r.code === 0 ? String(r.stdout ?? "").trim() : null;
}

/** After space.new: for up to ~3 s, wait for a space or terminal at `folder` to show up. */
async function folderAppeared(folder) {
  const at = (p) => typeof p === "string" && (p === folder || p.startsWith(folder + "/"));
  for (let n = 0; n < 6; n++) {
    if ((spaces() ?? []).some((s) => at(s.folder)) || (terminals() ?? []).some((t) => at(t.cwd) || at(t.folder))) return true;
    await sh("sleep", ["0.5"], { timeout: T_GIT });
  }
  return false;
}

/** Keys with a start in flight: one confirm, one start. */
const starting = new Set();

/**
 * The start confirm's second S: `git worktree add -b` (timed, argv only), then
 * space.new running claude with the brief, then the entry is marked started
 * and leaves the Backlog. On failure nothing is marked; the error is returned.
 * @param {Issue} entry
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function startBacklog(entry) {
  const it = liveBacklog(entry);
  if (!it) return { ok: false, error: "This task is no longer in the Backlog" };
  if (starting.has(it.key)) return { ok: false, error: "Already starting" };
  starting.add(it.key);
  try {
    const r = await runStart(it, home(), {
      exists: backlogExists(it.root),
      pending: (plan) => save(setPendingWorktree(currentStore(), it.key, plan)),
      toplevel: repoToplevel,
      appeared: folderAppeared,
      git: (argv) => sh(argv[0], argv.slice(1), { timeout: T_WORKTREE }),
      spaceNew: (args) => run("space.new", { ...args, machine: "" }),
      done: () => save(markStarted(currentStore(), it.key, Date.now())),
    });
    // A backlog card on a goal stays on it: its agent's card takes its place (syncGoals).
    if (r.ok && r.plan?.path) {
      const g = currentGoals();
      const next = linkStarted(g, it.key, r.plan.path);
      if (next !== g) setShared(GOALS_KEY, next);
    }
    return { ok: r.ok, error: r.error, path: r.plan?.path ?? null };
  } finally {
    starting.delete(it.key);
    refresh();
  }
}

/**
 * After a start: waits (up to `ms`) for the collector to turn the new agent in
 * worktree `path` into an issue, and returns it (null if it did not show up).
 * @param {string|null} path @param {number} [ms]
 */
export async function waitForIssueAt(path, ms = 20_000) {
  if (!path) return null;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const it = issueAt(currentStore().issues, path);
    if (it) return it;
    refresh();
    await sh("sleep", ["0.5"], { timeout: T_GIT });
  }
  return null;
}

/** X: the entry moves to the Discarded filter (kept 7 days). @param {Issue} entry */
export function discardEntry(entry) {
  const live = liveBacklog(entry);
  if (!live) return;
  const now = Date.now();
  save(discardBacklog(currentStore(), entry.key, now));
  logClosed(live, "discarded", now);
}

/** Restore (Discarded filter): back into the Backlog. @param {Issue} entry */
export function restoreEntry(entry) {
  if (entry?.kind !== "backlog") return;
  save(restoreBacklog(currentStore(), entry.key));
}

/**
 * The New task dialog's ⌘↵: runs ~/.local/bin/herdr-backlog through a login
 * shell (lib/newtask.js backlogExec: a fixed shell string, the text only as
 * positional arguments), timed, source "you".
 * On success the inbox is re-read and merged at once and the new card is
 * selected. Returns the dialog's next state (lib/newtask.js submitTask): done,
 * or the script's error with the text kept.
 * @param {{title: string, brief: string, root: string|null}} form
 */
export function fileTask(form) {
  return submitTask(form, {
    run: (argv) => {
      const ex = backlogExec(argv);
      return sh(ex.cmd, ex.args, { timeout: T_BACKLOG });
    },
    reread: async () => {
      const inbox = await readInbox();
      const prev = currentStore();
      const next = mergeBacklog(prev, inbox, Date.now());
      if (next !== prev) save(next);
      return inbox;
    },
    select: (entryId) => {
      setShared(SEL_KEY, "backlog|" + entryId);
      setShared(TAB_KEY, "overview");
    },
  }, Date.now());
}

/**
 * The New task dialog's ⌘↵ Start now (lib/newtask.js startTask): the backlog
 * Start's path (safe repo, toplevel, git worktree add -b, space.new on this
 * computer, the agent appeared) for the dialog's entry-like form, then
 * space.select to the new space. Nothing goes to the store: the new agent shows
 * up as an issue on the next cycle. One start per dialog press is the
 * dialog's busy guard (oneAtATime).
 * @param {{id: string, title: string, brief: string, root: string|null, terminal?: boolean, pendingWorktree?: {path: string, branch: string}|null}} form
 */
export async function startNow(form) {
  const root = typeof form?.root === "string" ? form.root : "";
  try {
    return await startTask(form, home(), {
      exists: backlogExists(root),
      toplevel: repoToplevel,
      appeared: folderAppeared,
      git: (argv) => sh(argv[0], argv.slice(1), { timeout: T_WORKTREE }),
      spaceNew: (args) => run("space.new", { ...args, machine: "" }),
      select: (plan) => {
        const at = (p) => typeof p === "string" && (p === plan.path || p.startsWith(plan.path + "/"));
        // Best effort: the agent has started; a failed switch must not read as a failed start.
        try {
          const sp = (spaces() ?? []).find((s) => at(s.folder));
          if (sp) run("space.select", { id: sp.id });
        } catch {
          // stay where we are
        }
      },
    });
  } finally {
    refresh();
  }
}

// ---------------------------------------------------------------- board requests

/** Shared key: board request id -> when it was applied (each applies once). */
const OPS_DONE_KEY = "deck.boardOpsDone";
const OPS_MAX = 256 * 1024;
let opsBusy = false;

/**
 * Applies the chat agent's queued board requests (lib/boardops.js), oldest
 * first, and writes each outcome for herdr-board to report. A request is
 * marked done before it runs, so a reload mid-way never applies it twice.
 */
async function boardOpsCycle() {
  if (opsBusy) return;
  opsBusy = true;
  try {
    const h = home();
    const r = await sh("tail", ["-c", String(OPS_MAX), expandHome(BOARD_OPS, h)], { timeout: T_GIT });
    if (r.code !== 0) return; // no requests yet
    const now = Date.now();
    const known = shared(OPS_DONE_KEY) ?? {};
    const done = pruneDone(known, now);
    const todo = pendingOps(parseOps(inboxTail(String(r.stdout ?? ""), OPS_MAX)), done, now);
    if (!todo.length) {
      if (Object.keys(done).length !== Object.keys(known).length) setShared(OPS_DONE_KEY, done);
      return;
    }
    for (const op of todo) {
      done[op.id] = Date.now();
      setShared(OPS_DONE_KEY, { ...done });
      let res;
      try {
        res = await applyBoardOp(op, findChatTerminal(terminals()));
      } catch (e) {
        res = { ok: false, message: String(e?.message ?? e ?? "failed") };
      }
      await appendLog(expandHome(BOARD_RESULTS, h), resultLine(op.id, res.ok, res.message, Date.now()));
    }
  } finally {
    opsBusy = false;
  }
}

/**
 * One request, through the same actions as the deck's own buttons.
 * @param {import("./lib/boardops.js").BoardOp} op @param {string|null} chat the chat agent's terminal address
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function applyBoardOp(op, chat) {
  const plan = planOp(op, currentStore().issues, chat);
  if (plan.error) return { ok: false, message: plan.error };
  const it = plan.issue;
  const ok = (message) => ({ ok: true, message });
  if (op.op === "goal-new") {
    const r = newGoal(currentGoals(), plan.goalNew, Date.now());
    if ("error" in r) return { ok: false, message: r.error };
    setShared(GOALS_KEY, r.goals);
    return ok(`${r.goal.id} "${r.goal.title}" created: ${shortDay(r.goal.start)} → ${shortDay(r.goal.end)}`);
  }
  if (op.op === "goal") {
    const r = linkCard(currentGoals(), plan.goal, it, Date.now());
    if ("error" in r) return { ok: false, message: r.error };
    setShared(GOALS_KEY, r.goals);
    return ok(r.goal ? `${it.id} is on ${r.goal.id} "${r.goal.title}"` : `${it.id} is on no goal`);
  }
  switch (op.op) {
    case "move":
      moveCard(it, plan.column, "chat");
      return ok(`${it.id} moved to ${STAGE_LABEL[plan.column] ?? plan.column}`);
    case "dismiss":
      dismiss(it);
      return ok(`${it.id} dismissed (it moves to Landed and stops counting as waiting)`);
    case "delete":
      deleteIssue(it, "chat");
      return ok(`${it.id} deleted from the board (its terminal, branch and PR are untouched)`);
    case "discard":
      discardEntry(it);
      return ok(`${it.id} discarded (restorable for 7 days)`);
    case "restore":
      restoreEntry(it);
      return ok(`${it.id} restored to the Backlog`);
    case "edit": {
      const prev = currentStore();
      const next = editIssue(prev, it.key, plan.edit, Date.now(), "chat");
      if (next === prev) return ok(`${it.id} unchanged (same text)`);
      save(next);
      return ok(`${it.id} edited`);
    }
    case "start": {
      const r = await startBacklog(it);
      return r.ok ? ok(`${it.id} started${r.path ? " in " + r.path : ""}`) : { ok: false, message: r.error || "start failed" };
    }
    default:
      return { ok: false, message: `unknown request: ${op.op}` };
  }
}
