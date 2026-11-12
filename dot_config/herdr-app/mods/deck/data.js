// Deck's collector and actions. Herdr-bound: polls agents, git, gh, proof files,
// screens and Claude history into the issue store in shared state, and performs
// the user's actions (reply, press an option, merge, ...).
//
// Actions are async; call them from a view inside `cx.spawn(async (cx) => ...)`.
// Nothing here runs on its own except the collector, which the bar starts.

import { agents, terminals, panes, exec, hc, home, readTextFile, shared, setShared, run, notify } from "herdr";
import { GIT_CMDS, PR_FIELDS, parseGitState, parsePr } from "./lib/github.js";
import { parseProofFile, buildClaims, mergeState } from "./lib/proof.js";
import { parsePrompt, samePrompt } from "./lib/prompt.js";
import { findBrief } from "./lib/brief.js";
import { emptyStore, reconcile, dismiss as dismissIn, markReplied } from "./lib/store.js";

/** @typedef {import("./lib/store.js").Issue} Issue */
/** @typedef {import("./lib/store.js").Store} Store */
/** @typedef {import("./lib/store.js").Observation} Observation */
/** @typedef {import("./lib/prompt.js").PromptOption} PromptOption */

export const STORE_KEY = "deck.store";
export const SEL_KEY = "deck.selected";
export const TAB_KEY = "deck.issueTab";
export const VIEW_KEY = "deck.view";

const SLOW_MS = 45_000;
const FAST_MS = 10_000;
const TICK_MS = 2_000;
// A collector whose heartbeat is older than this is gone (e.g. its build was reloaded).
const STALE_MS = 15_000;
// Rewrite the store at least this often even if only lastSeen moved (expiry uses it).
const HEARTBEAT_WRITE_MS = 10 * 60_000;
const T_GIT = 5_000;
const T_HC = 5_000;
const T_GH = 15_000;
const T_MERGE = 60_000;
// readTextFile stops at 1 MiB and history.jsonl is larger; the newest 4 MiB is plenty.
const HISTORY_TAIL = String(4 * 1024 * 1024);

/** @returns {Store} */
export function currentStore() {
  const s = /** @type {Store|null} */ (shared(STORE_KEY));
  return s && Array.isArray(s.issues) ? s : emptyStore();
}

/** The store's latest copy of an issue (actions get one captured at render time). */
function latest(issue) {
  return currentStore().issues.find((i) => i.key === issue.key) ?? issue;
}

const FAILED = (e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e ?? "failed") });

/** exec that never rejects. */
async function sh(cmd, args, opts) {
  try {
    const r = await exec(cmd, args, opts);
    return r ?? FAILED("no result");
  } catch (e) {
    return FAILED(e);
  }
}

/** Read-only hc calls, time-limited through exec; falls back to the host's hc(). */
async function hcRead(args) {
  const r = await sh("hc", args, { timeout: T_HC });
  if (r.code !== -1) return r;
  try {
    return (await hc(args)) ?? FAILED("no result");
  } catch (e) {
    return FAILED(e);
  }
}

const okText = (r) => (r.code === 0 ? String(r.stdout ?? "").trim() : "");

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
  const [cTop, cBranch, cBase, cAhead] = GIT_CMDS;
  const toplevel = await git(cTop);
  if (toplevel.code !== 0) return parseGitState({ toplevel, branch: toplevel, base: toplevel, ahead: null });
  const [branch, base] = await Promise.all([git(cBranch), git(cBase)]);
  // Count against the remote's default branch when known (origin/main), else local "main".
  const baseRef = okText(base) || "main";
  const ahead = await git(cAhead.map((a) => a.replace("<base>", baseRef)));
  return parseGitState({ toplevel, branch, base, ahead });
}

async function prState(root, branch, base) {
  if (!root || !branch || branch === "HEAD" || branch === base) return { pr: null, error: null };
  const r = await sh("gh", ["pr", "view", branch, "--json", PR_FIELDS], { cwd: root, timeout: T_GH });
  return parsePr(r);
}

/** Agent proof claims with `exists` built from realpath-inside-root + regular file. */
async function proofClaims(root) {
  if (!root) return { agentClaims: [], exists: Object.create(null) };
  let text = null;
  try {
    text = await readTextFile(root + "/.herdr/proof.json");
  } catch {
    text = null;
  }
  const agentClaims = parseProofFile(text);
  const exists = Object.create(null);
  const paths = [...new Set(agentClaims.map((c) => c.path).filter((p) => typeof p === "string"))];
  if (!paths.length) return { agentClaims, exists };
  const realRoot = okText(await sh("realpath", [root], { timeout: T_GIT }));
  if (!realRoot) return { agentClaims, exists };
  await Promise.all(paths.map(async (p) => {
    const resolved = okText(await sh("realpath", [p], { cwd: root, timeout: T_GIT }));
    if (!resolved || !resolved.startsWith(realRoot + "/")) return;
    const f = await sh("test", ["-f", resolved], { timeout: T_GIT });
    if (f.code === 0) exists[p] = true;
  }));
  return { agentClaims, exists };
}

async function readScreen(t, status) {
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
    terminal: t, status, title: a.title ?? "", cwd, repo: null, root: null, branch: null,
    commitsAhead: null, pr: null, ghError: null, claims: [], prompt: null, brief: null, replied: false,
  };
  try {
    const [git, prompt, after] = await Promise.all([
      cwd ? gitState(cwd) : Promise.resolve(null),
      status !== "working" ? readScreen(t, status) : Promise.resolve({ kind: "none", text: "", options: [] }),
      createdMs(t),
    ]);
    o.prompt = prompt;
    if (git) {
      o.repo = git.repo;
      o.root = git.root;
      o.branch = git.branch;
      o.commitsAhead = git.commitsAhead;
    }
    if (history && cwd) {
      try {
        o.brief = findBrief(history, { cwd, root: o.root, after });
      } catch {
        o.brief = null;
      }
    }
    if (o.root) {
      const [pr, proof] = await Promise.all([prState(o.root, o.branch, git.base), proofClaims(o.root)]);
      o.pr = pr.pr;
      o.ghError = pr.error;
      o.claims = buildClaims(o.pr?.checks ?? [], proof.agentClaims, proof.exists);
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

let lastPrint = null;
let lastWrite = 0;

async function cycle() {
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

  // Read the store only now, after every await, so actions taken meanwhile are kept.
  const now = Date.now();
  const next = reconcile(currentStore(), obs, now);
  const print = fingerprint(next);
  if (print !== lastPrint || now - lastWrite > HEARTBEAT_WRITE_MS) {
    setShared(STORE_KEY, next);
    lastPrint = print;
    lastWrite = now;
  }
}

let running = null;
let lastStart = 0;

function startCycle() {
  if (running) return running;
  lastStart = Date.now();
  running = (async () => {
    try {
      await cycle();
    } catch (e) {
      console.error("deck collector:", e);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Poll interval: fast while the selected issue's PR has a pending check. */
function interval() {
  const sel = shared(SEL_KEY);
  if (!sel) return SLOW_MS;
  const it = currentStore().issues.find((i) => i.key === sel);
  return it?.pr?.checks?.some((c) => c.status === "pending") ? FAST_MS : SLOW_MS;
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
    return true;
  };
  const tick = (cx) => {
    if (!claim()) return;
    guard.beat = Date.now();
    if (running || Date.now() - lastStart < interval()) return;
    cx.spawn(async () => {
      await startCycle();
    });
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
}

/**
 * Type text into the agent and press Enter (hc send; no --force, so a blocked
 * agent's dialog is never answered by accident).
 * @param {Issue} issue @param {string} text
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function reply(issue, text) {
  if (!issue?.terminal || typeof text !== "string" || !text.trim()) return { ok: false, error: "nothing to send" };
  let r;
  try {
    r = await hc(["send", issue.terminal, text]);
  } catch (e) {
    r = FAILED(e);
  }
  if (r.code !== 0) return { ok: false, error: String(r.stderr || r.stdout || "send failed").trim() };
  save(markReplied(currentStore(), issue.key));
  refresh();
  return { ok: true, error: null };
}

/**
 * Answer a prompt option. Reply options (an idle agent's numbered list) are typed;
 * key options are pressed only if a fresh read of the screen still shows the same
 * prompt, and then the fresh option's keys are pressed.
 * @param {Issue} issue @param {PromptOption} option
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function pressOption(issue, option) {
  if (!issue?.terminal || !option) return { ok: false, error: "no option" };
  if (typeof option.reply === "string" && option.reply) return reply(issue, option.reply);
  const t = issue.terminal;
  const status = (agents() ?? []).find((a) => a.address === t)?.status ?? issue.status;
  const fresh = status !== "working" ? await readScreen(t, status) : null;
  const old = issue.prompt;
  const match = fresh && old && samePrompt(old, fresh)
    ? fresh.options.find((o) => o.label === option.label)
    : null;
  if (!match || !Array.isArray(match.keys) || !match.keys.length) {
    notify({ title: "The question changed — refreshed", level: "info" });
    refresh();
    return { ok: false, error: "prompt changed" };
  }
  let r;
  try {
    r = await hc(["keys", t, ...match.keys]);
  } catch (e) {
    r = FAILED(e);
  }
  if (r.code !== 0) return { ok: false, error: String(r.stderr || r.stdout || "keys failed").trim() };
  save(markReplied(currentStore(), issue.key));
  refresh();
  return { ok: true, error: null };
}

/** Keys with a merge in flight: one press, one merge. */
const merging = new Set();

async function doMerge(issue) {
  const n = issue.pr?.number;
  const cwd = issue.root || issue.cwd;
  if (!Number.isInteger(n) || !cwd) return { ok: false, error: "no pull request" };
  if (merging.has(issue.key)) return { ok: false, error: "merge already running" };
  merging.add(issue.key);
  try {
    const r = await sh("gh", ["pr", "merge", String(n), "--squash"], { cwd, timeout: T_MERGE });
    if (r.code !== 0) return { ok: false, error: String(r.stderr || r.stdout || "merge failed").trim() };
    return { ok: true, error: null };
  } finally {
    merging.delete(issue.key);
    refresh();
  }
}

/**
 * Merge only when the lock is open (open PR, every claim PASS).
 * @param {Issue} issue
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function merge(issue) {
  const it = latest(issue);
  if (!mergeState(it.pr, it.ghError, it.claims ?? []).canMerge) return { ok: false, error: "proof incomplete" };
  return doMerge(it);
}

/**
 * The confirm dialog's "Merge anyway", after the person confirmed. Still needs an
 * open PR that GitHub currently reports (mergeState offers "anyway" for it).
 * @param {Issue} issue
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function mergeAnyway(issue) {
  const it = latest(issue);
  const m = mergeState(it.pr, it.ghError, it.claims ?? []);
  if (!m.canMerge && !m.showAnyway) return { ok: false, error: "no open pull request" };
  return doMerge(it);
}

/**
 * Merge (same lock as merge) and, only if it succeeded, tell the agent to ship.
 * @param {Issue} issue
 */
export async function mergeAndShip(issue) {
  const m = await merge(issue);
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
  const missing = (it.claims ?? []).filter((c) => c.verdict === "NO DATA").map((c) => c.claim);
  const text = missing.length
    ? "Proof needed. These claims have no evidence yet: " + missing.join("; ") +
      ". Save evidence files in the repo and list them in .herdr/proof.json."
    : "Proof needed. List each claim with an evidence file path in .herdr/proof.json.";
  return reply(it, text);
}

/** @param {Issue} issue */
export function dismiss(issue) {
  if (!issue?.key) return;
  save(dismissIn(currentStore(), issue.key, Date.now()));
}

/** Opens a web link in the default browser (http/https only). */
export async function openUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return { ok: false, error: "not a web link" };
  const r = await sh("open", [url], { timeout: T_GIT });
  return r.code === 0 ? { ok: true, error: null } : { ok: false, error: String(r.stderr).trim() };
}

/** Show a child of the deck-main stack and remember it for the bar. */
export function showView(child) {
  setShared(VIEW_KEY, child);
  run("layout.select", { stack: "deck-main", child });
}

/** @param {Issue} issue */
export function focusTerminal(issue) {
  if (!issue?.terminal) return;
  showView("deck-work");
  run("agent.focus", { terminal: issue.terminal });
}
