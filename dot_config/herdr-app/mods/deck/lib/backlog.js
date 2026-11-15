// Backlog: tasks filed by agents (or later other sources) that are not started yet. Pure; no herdr imports.
// Entries live in store.issues with kind "backlog" (key "backlog|<entry id>", display id "B-<n>").
// They are never reconciled against terminals; started/discarded ids are tombstoned in store.backlogTombs.

/** @typedef {{ id: string, title: string, brief: string, repo: string, source: string, from: string|null, createdAt: number }} Entry */
/** @typedef {import("./store.js").Store} Store */

export const DISCARD_TTL = 7 * 24 * 60 * 60 * 1000;
const TOMB_CAP = 20000;
const SLUG_MAX = 40;
const TASK_SUFFIX = "\n\nWhen you finish, use the herdr-proof skill.";

/**
 * A repo path that is safe to derive a worktree folder from: absolute, no empty, "." or ".." segment,
 * and a real basename. @param {unknown} repo @returns {boolean}
 */
export function safeRepo(repo) {
  if (typeof repo !== "string" || !repo.startsWith("/")) return false;
  const segs = repo.replace(/\/+$/, "").split("/").slice(1);
  if (!segs.length) return false;
  return segs.every((s) => s !== "" && s !== "." && s !== "..");
}

/** @param {string|null|undefined} text JSON lines. Bad or partial lines are skipped; the first of a duplicate id wins. @returns {Entry[]} */
export function parseBacklog(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const { id, title, brief, repo } = o;
    if (typeof id !== "string" || !id || typeof title !== "string" || !title.trim()) continue;
    if (typeof brief !== "string" || typeof repo !== "string" || !safeRepo(repo)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id, title, brief, repo,
      source: typeof o.source === "string" && o.source ? o.source : "agent",
      from: typeof o.from === "string" && o.from ? o.from : null,
      createdAt: typeof o.createdAt === "number" && Number.isFinite(o.createdAt) ? o.createdAt : 0,
    });
  }
  return out;
}

const baseName = (p) => String(p).replace(/\/+$/, "").split("/").pop() || "repo";
const isBacklog = (i) => i.kind === "backlog";
const find = (store, ref) => store.issues.find((i) => isBacklog(i) && (i.key === ref || i.id === ref));

/** @param {Entry} e @param {string} id @param {number} now */
function toIssue(e, id, now) {
  return {
    kind: "backlog", key: "backlog|" + e.id, entryId: e.id, id, stage: "backlog",
    title: e.title, brief: e.brief, repo: baseName(e.repo), root: e.repo,
    source: e.source, from: e.from, createdAt: e.createdAt || now,
    discarded: false, discardedAt: null, dismissed: false,
    status: "idle", terminal: null, branch: null, cwd: e.repo, commitsAhead: null, pr: null, ghError: null,
    claims: [], prompt: null, holdingSince: null, observed: false, lastSeen: now,
  };
}

/**
 * Add inbox entries not yet known (by id) and not tombstoned; drop discarded entries older than 7 days.
 * @param {Store} store @param {Entry[]} entries @param {number} now @returns {Store}
 */
export function mergeBacklog(store, entries, now) {
  const tombs = { ...(store.backlogTombs ?? {}) };
  const counters = { ...store.counters };
  const known = new Set(store.issues.filter(isBacklog).map((i) => i.entryId));
  let issues = store.issues.filter((i) => !(isBacklog(i) && i.discarded && i.discardedAt != null && now - i.discardedAt > DISCARD_TTL));
  const fresh = [];
  // Once the cap is reached the oldest tombs are gone, so an entry older than the oldest kept tomb could come back.
  const kept = capTombs(tombs);
  const keptAts = Object.values(kept).map((t) => t.at);
  const floor = keptAts.length >= TOMB_CAP ? Math.min(...keptAts) : null;
  for (const e of entries) {
    if (known.has(e.id) || e.id in tombs) continue;
    if (floor != null && e.createdAt < floor) continue;
    known.add(e.id);
    counters.B = (counters.B ?? 0) + 1;
    fresh.push(toIssue(e, "B-" + counters.B, now));
  }
  issues = [...issues, ...fresh];
  if (!fresh.length && issues.length === store.issues.length) return store;
  return { ...store, issues, counters, backlogTombs: kept };
}

function capTombs(tombs) {
  const keys = Object.keys(tombs);
  if (keys.length <= TOMB_CAP) return tombs;
  const out = { ...tombs };
  keys.sort((a, b) => out[a].at - out[b].at);
  for (const k of keys.slice(0, keys.length - TOMB_CAP)) delete out[k];
  return out;
}

/** Lowercase a-z0-9 and "-", at most 40 chars; "task-<id>" when the title leaves nothing. @param {string} title @param {string} id */
export function branchSlug(title, id) {
  const slug = String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX).replace(/-+$/, "");
  if (slug) return slug;
  return "task-" + (String(id ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x");
}

/**
 * Plan a start. `exists(p)` is asked about the repo, its ".git", each candidate branch name
 * (a bare name) and each candidate worktree path (absolute). A candidate is reused (argv null) only when its path
 * exists and path and branch equal entry.pendingWorktree (left by a start that failed after the worktree was made);
 * every other collision gets -2, -3, ... On a bad repo returns {error}.
 * @param {{ id: string, title: string, brief: string, root?: string, repo?: string, pendingWorktree?: {path: string, branch: string}|null }} entry
 * @param {string} home @param {(pathOrBranch: string) => boolean} exists
 * @returns {{ branch: string, path: string, argv: string[]|null, reuse: boolean, task: string, repo: string } | { error: string }}
 */
export function startPlan(entry, home, exists) {
  const repo = String(entry.root ?? entry.repo ?? "");
  if (!safeRepo(repo)) return { error: "Bad repo path: " + repo };
  if (!exists(repo)) return { error: "Repo not found: " + repo };
  if (!exists(repo + "/.git")) return { error: "Not a git repo: " + repo };
  const slug = branchSlug(entry.title, entry.id);
  const dir = home.replace(/\/+$/, "") + "/.herdr/worktrees/" + baseName(repo) + "/";
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : "-" + n;
    const branch = slug.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "") + suffix;
    const path = dir + branch;
    if (!path.startsWith(dir) || path.slice(dir.length).includes("/")) return { error: "Worktree path leaves " + dir };
    const pw = entry.pendingWorktree;
    if (pw && pw.path === path && pw.branch === branch && exists(path)) {
      return { branch, path, repo, argv: null, reuse: true, task: entry.brief + TASK_SUFFIX };
    }
    if (exists(branch) || exists(path)) continue;
    return {
      branch, path, repo, reuse: false,
      argv: ["git", "-C", repo, "worktree", "add", "-b", branch, path, "HEAD"],
      task: entry.brief + TASK_SUFFIX,
    };
  }
}

const tomb = (store, entryId, state, now) => ({ ...(store.backlogTombs ?? {}), [entryId]: { state, at: now } });

/** @param {Store} store @param {string} ref key or B-n @param {number} now @returns {Store} */
export function discardBacklog(store, ref, now) {
  const prev = find(store, ref);
  if (!prev) return store;
  const next = { ...prev, discarded: true, discardedAt: now };
  return {
    ...store, issues: store.issues.map((i) => (i === prev ? next : i)),
    backlogTombs: capTombs(tomb(store, prev.entryId, "discarded", now)),
  };
}

/** Remember the worktree a failed start left, so a retry reuses it. @param {Store} store @param {string} ref @param {{path: string, branch: string}} wt @returns {Store} */
export function setPendingWorktree(store, ref, wt) {
  const prev = find(store, ref);
  if (!prev) return store;
  const next = { ...prev, pendingWorktree: { path: wt.path, branch: wt.branch } };
  return { ...store, issues: store.issues.map((i) => (i === prev ? next : i)) };
}

/** @param {Store} store @param {string} ref key or B-n @returns {Store} */
export function restoreBacklog(store, ref) {
  const prev = find(store, ref);
  if (!prev || !prev.discarded) return store;
  const tombs = { ...(store.backlogTombs ?? {}) };
  delete tombs[prev.entryId];
  return { ...store, issues: store.issues.map((i) => (i === prev ? { ...prev, discarded: false, discardedAt: null } : i)), backlogTombs: tombs };
}

/** The entry started: it leaves the Backlog for good. @param {Store} store @param {string} ref key or B-n @param {number} now @returns {Store} */
export function markStarted(store, ref, now) {
  const prev = find(store, ref);
  if (!prev) return store;
  return {
    ...store, issues: store.issues.filter((i) => i !== prev),
    backlogTombs: capTombs(tomb(store, prev.entryId, "started", now)),
  };
}

// ---------------------------------------------------------------- start flow

const MAX_LOOKUPS = 64;
const ASK = Symbol("ask");
const errText = (e) => String(e?.message ?? e ?? "failed");

/**
 * startPlan with an async `exists` (a timed shell check). Each name is asked
 * once; a rejecting `exists` is an error, never a guess.
 * @param {{ id: string, title: string, brief: string, root?: string, repo?: string }} entry
 * @param {string} home @param {(name: string) => Promise<boolean>} exists
 * @returns {Promise<ReturnType<typeof startPlan>>}
 */
export async function resolvePlan(entry, home, exists) {
  const known = new Map();
  for (let n = 0; n <= MAX_LOOKUPS; n++) {
    let need = null;
    try {
      return startPlan(entry, home, (p) => {
        if (known.has(p)) return known.get(p);
        need = p;
        throw ASK;
      });
    } catch (e) {
      if (e !== ASK) throw e;
    }
    try {
      known.set(need, Boolean(await exists(need)));
    } catch (e) {
      return { error: "Could not check " + need + ": " + errText(e) };
    }
  }
  return { error: "Too many branches or worktrees named like " + branchSlug(entry.title, entry.id) };
}

/**
 * Start an agent on a backlog entry: `git worktree add -b` (argv only), then
 * space.new with claude and the task, then `done(plan)` (mark it started).
 * Any failure is returned as {ok:false, error} and the later steps never run.
 * The New task dialog's Start now passes an entry-like `{kind: "new", id, title,
 * brief, root, terminal?, pendingWorktree?}`: with `terminal` the space gets the
 * default shell (no argv, no task). `again` is how the lost-start error says to retry.
 * @param {any} entry the store's backlog issue, or the dialog's entry-like object
 * @param {string} home
 * @param {{ exists: (name: string) => Promise<boolean>,
 *   toplevel: (repo: string) => Promise<string|null>,
 *   pending?: (plan: any) => void,
 *   appeared: (folder: string) => Promise<boolean>,
 *   git: (argv: string[]) => Promise<{code: number, stdout?: string, stderr?: string}>,
 *   spaceNew: (args: {folder: string, argv?: string[], task?: string}) => unknown,
 *   done: (plan: any) => void, again?: string }} io
 * @returns {Promise<{ok: boolean, error: string|null, plan?: any}>}
 */
export async function runStart(entry, home, io) {
  if (!entry || (entry.kind !== "backlog" && entry.kind !== "new") || entry.discarded) return { ok: false, error: "Not in the Backlog" };
  let plan;
  try {
    plan = await resolvePlan(entry, home, io.exists);
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
  if ("error" in plan) return { ok: false, error: plan.error };
  let top;
  try {
    top = await io.toplevel(plan.repo);
  } catch (e) {
    return { ok: false, error: "Could not check " + plan.repo + ": " + errText(e) };
  }
  if (top !== plan.repo) return { ok: false, error: "Not a repo's main folder: " + plan.repo };
  if (plan.argv) {
    const g = await io.git(plan.argv);
    if (!g || g.code !== 0) {
      return { ok: false, error: "git worktree add failed: " + String(g?.stderr || g?.stdout || "unknown error").trim() };
    }
  }
  // Only the New task dialog sets terminal: true; a store issue's terminal id never counts.
  const shell = entry.terminal === true;
  const what = shell ? "terminal" : "agent";
  const lost = "Worktree created at " + plan.path + ", but the " + what + " didn't start — open it from Herdr or " + (io.again ?? "press S again");
  try {
    await io.spaceNew(spaceNewArgs(plan, shell));
  } catch (e) {
    io.pending?.(plan);
    return { ok: false, error: lost + " (" + errText(e) + ")" };
  }
  let up = false;
  try { up = await io.appeared(plan.path); } catch { up = false; }
  if (!up) {
    io.pending?.(plan);
    return { ok: false, error: lost };
  }
  io.done(plan);
  return { ok: true, error: null, plan };
}

/**
 * space.new's arguments for a planned start: claude with the task, or with
 * `terminal` ("Just a terminal") only the folder: the default shell, no task.
 * @param {{path: string, task: string}} plan @param {boolean} terminal
 */
export function spaceNewArgs(plan, terminal) {
  return terminal ? { folder: plan.path } : { folder: plan.path, argv: ["claude"], task: plan.task };
}

/** What the card shows under "When you start it": the first-choice branch and path (a start may add -2, -3…). */
export function previewPlan(entry, home) {
  const root = String(entry?.root ?? "");
  return startPlan(entry, home, (p) => p === root || p === root + "/.git");
}

/** The issue whose terminal filed `entry`, or null. @param {any} entry @param {any[]} issues */
export function backlogFiler(entry, issues) {
  if (!entry?.from) return null;
  return (issues ?? []).find((i) => i.kind !== "backlog" && i.terminal === entry.from) ?? null;
}

/** UTF-8 length of a string. */
function utf8Bytes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * The text of `tail -c max`: when the read filled the cap the file was cut, so
 * its first (partial) line is dropped. A few bytes of slack cover a multi-byte
 * character split at the cut.
 * @param {string|null|undefined} text @param {number} max
 */
export function inboxTail(text, max) {
  const s = String(text ?? "");
  if (utf8Bytes(s) < max - 3) return s;
  const nl = s.indexOf("\n");
  return nl < 0 ? "" : s.slice(nl + 1);
}

/**
 * The live agent issue working in `path` (a started worktree): its root is
 * the path, or its folder is inside it. The newest when there are several.
 * @param {any[]|null|undefined} issues @param {string} path @returns {any|null}
 */
export function issueAt(issues, path) {
  const p = String(path ?? "").replace(/\/+$/, "");
  if (!p) return null;
  const inside = (x) => typeof x === "string" && (x === p || x.startsWith(p + "/"));
  const hits = (issues ?? []).filter((i) => i.kind !== "backlog" && i.observed !== false && (i.root === p || inside(i.cwd)));
  return hits.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0] ?? null;
}
