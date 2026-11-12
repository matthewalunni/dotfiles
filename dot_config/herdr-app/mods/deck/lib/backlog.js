// Backlog: tasks filed by agents (or later other sources) that are not started yet. Pure; no herdr imports.
// Entries live in store.issues with kind "backlog" (key "backlog|<entry id>", display id "B-<n>").
// They are never reconciled against terminals; started/discarded ids are tombstoned in store.backlogTombs.

/** @typedef {{ id: string, title: string, brief: string, repo: string, source: string, from: string|null, createdAt: number }} Entry */
/** @typedef {import("./store.js").Store} Store */

export const DISCARD_TTL = 7 * 24 * 60 * 60 * 1000;
const TOMB_CAP = 2000;
const SLUG_MAX = 40;
const TASK_SUFFIX = "\n\nWhen you finish, use the herdr-proof skill.";

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
    if (typeof brief !== "string" || typeof repo !== "string" || !repo) continue;
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
  for (const e of entries) {
    if (known.has(e.id) || e.id in tombs) continue;
    known.add(e.id);
    counters.B = (counters.B ?? 0) + 1;
    fresh.push(toIssue(e, "B-" + counters.B, now));
  }
  issues = [...issues, ...fresh];
  if (!fresh.length && issues.length === store.issues.length) return store;
  return { ...store, issues, counters, backlogTombs: capTombs(tombs) };
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
 * (a bare name) and each candidate worktree path (absolute). On a bad repo returns {error}.
 * @param {{ id: string, title: string, brief: string, root?: string, repo?: string }} entry
 * @param {string} home @param {(pathOrBranch: string) => boolean} exists
 * @returns {{ branch: string, path: string, argv: string[], task: string, repo: string } | { error: string }}
 */
export function startPlan(entry, home, exists) {
  const repo = String(entry.root ?? entry.repo ?? "");
  if (!repo.startsWith("/") || !exists(repo)) return { error: "Repo not found: " + repo };
  if (!exists(repo + "/.git")) return { error: "Not a git repo: " + repo };
  const slug = branchSlug(entry.title, entry.id);
  const dir = home.replace(/\/+$/, "") + "/.herdr/worktrees/" + baseName(repo) + "/";
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : "-" + n;
    const branch = slug.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "") + suffix;
    const path = dir + branch;
    if (exists(branch) || exists(path)) continue;
    return {
      branch, path, repo,
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
