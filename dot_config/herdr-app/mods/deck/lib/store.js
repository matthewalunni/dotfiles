// The issue store: turns each poll's observations into stable issues. Pure; no herdr imports.
import { deriveStage, nextHolding } from "./stage.js";

/** @typedef {"working"|"blocked"|"done"|"idle"} Status */
/** @typedef {"survey"|"build"|"verify"|"holding"|"landed"} Stage */
/** @typedef {{ name: string, status: "pass"|"fail"|"pending", detail: string }} Check */
/** @typedef {{ number: number, title: string, state: "OPEN"|"MERGED"|"CLOSED", checks: Check[] }} Pr */
/** @typedef {{ claim: string, verdict: "PASS"|"FAIL"|"NO DATA", source: "ci"|"agent", path: string|null, detail: string|null }} Claim */
/** @typedef {{ kind: "permission"|"menu"|"question"|"none", text: string, options: Array<{ label: string, keys: string[], reply?: string }> }} Prompt */

/**
 * @typedef {{
 *   key: string, id: string, terminal: string, status: Status, title: string,
 *   cwd: string, repo: string|null, root: string|null, branch: string|null,
 *   commitsAhead: number|null, pr: Pr|null, ghError: string|null,
 *   claims: Claim[], prompt: Prompt|null, brief: any,
 *   stage: Stage, holdingSince: number|null, awaitingAck: boolean,
 *   dismissed: boolean, createdAt: number, landedAt: number|null,
 *   observed: boolean, lastSeen: number
 * }} Issue
 */
/** @typedef {{ t: number, key: string, id: string, what: string, tone: "work"|"ok"|"warn"|"hold" }} LogEvent */
/** @typedef {{ issues: Issue[], counters: Record<string, number>, prefixes: Record<string, string>, retired: Record<string, number>, log: LogEvent[] }} Store */
/**
 * @typedef {{
 *   terminal: string, status: Status, title: string, cwd: string, repo: string|null,
 *   root: string|null, branch: string|null, commitsAhead: number|null, pr: Pr|null,
 *   ghError: string|null, claims: Claim[], prompt: Prompt|null, brief: any, replied: boolean
 * }} Observation
 */

const LANDED_TTL = 7 * 24 * 60 * 60 * 1000;
const LOG_CAP = 200;
const RETIRED_TTL = 30 * 24 * 60 * 60 * 1000;
const RETIRED_CAP = 500;
const NO_PROMPT = { kind: "none", text: "", options: [] };

/** @returns {Store} */
export function emptyStore() {
  return { issues: [], counters: {}, prefixes: {}, retired: {}, log: [] };
}

/** @param {string|null} branch */
const cleanBranch = (branch) => (branch && branch !== "HEAD" ? branch : null);

/** @param {string} terminal @param {string|null} branch */
export function issueKey(terminal, branch) {
  return terminal + "|" + (cleanBranch(branch) ?? "-");
}

const SUFFIXES = ["flow", "vault", "code", "kit", "app", "ai", "iq", "hub", "lab"];

/** @param {string} repo @returns {string[]} */
function repoParts(repo) {
  const out = [];
  for (const chunk of repo.split(/[-_.\s]+/)) {
    const words = chunk.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [];
    out.push(...words);
  }
  const parts = out.filter(Boolean);
  if (parts.length === 1) {
    const w = parts[0].toLowerCase();
    const suf = SUFFIXES.find((x) => w.length > x.length && w.endsWith(x));
    if (suf) return [w.slice(0, -suf.length), suf];
  }
  return parts;
}

/**
 * Issue-ID prefix for a repo. `taken` maps repo -> prefix for repos already seen.
 * @param {string|null} repo @param {Record<string, string>} taken
 * @returns {string}
 */
export function prefixFor(repo, taken) {
  if (!repo) return "XX";
  if (taken[repo]) return taken[repo];
  const parts = repoParts(repo);
  const letters = repo.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!letters) return "XX";
  const base = parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : letters.slice(0, 2).padEnd(2, "X");
  const used = new Set(Object.values(taken));
  if (!used.has(base)) return base;
  for (const c of letters.slice(1)) {
    const cand = letters[0] + c;
    if (!used.has(cand)) return cand;
  }
  for (let n = 1; ; n++) if (!used.has(letters[0] + n)) return letters[0] + n;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Log events for the transition prev -> next. prev is null for a new issue.
 * @param {Issue|null} prev @param {Issue} next @param {number} now
 * @returns {LogEvent[]}
 */
function diffEvents(prev, next, now) {
  const out = [];
  const ev = (what, tone) => out.push({ t: now, key: next.key, id: next.id, what, tone });
  const prevStage = prev?.stage ?? null;
  if (next.stage !== prevStage) {
    if (next.stage === "holding") ev("is waiting on you", "hold");
    else if (next.stage === "landed") ev("landed", "ok");
    else if (prev) ev("moved to " + cap(next.stage), "work");
  }
  if (next.pr && next.pr.number !== prev?.pr?.number) ev("opened PR #" + next.pr.number, "work");
  if (next.pr && prev?.pr && prev.pr.number === next.pr.number) {
    const before = new Map(prev.pr.checks.map((c) => [c.name, c.status]));
    for (const c of next.pr.checks) {
      if (c.status === "fail" && before.get(c.name) !== "fail") ev(c.name + " failed", "warn");
    }
    const wasPending = prev.pr.checks.some((c) => c.status === "pending");
    const allPass = next.pr.checks.length > 0 && next.pr.checks.every((c) => c.status === "pass");
    if (wasPending && allPass) ev("checks passed", "ok");
  }
  return out;
}

/**
 * @param {Store} store @param {Observation[]} obs @param {number} now
 * @returns {Store}
 */
export function reconcile(store, obs, now) {
  const counters = { ...store.counters };
  const prefixes = { ...(store.prefixes ?? {}) };
  const issues = store.issues.map((i) => ({ ...i }));
  const log = [...store.log];
  const retired = { ...(store.retired ?? {}) };
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const seen = new Set();

  for (const o of obs) {
    const branch = cleanBranch(o.branch);
    const key = issueKey(o.terminal, branch);
    if (key in retired) {
      retired[key] = now; // still observed: keep it retired
      continue;
    }
    seen.add(key);
    const prev = byKey.get(key) ?? null;
    let id;
    if (prev) id = prev.id;
    else {
      const prefix = prefixFor(o.repo, prefixes);
      if (o.repo) prefixes[o.repo] = prefix;
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      id = prefix + "-" + counters[prefix];
    }
    const wasLanded = prev?.stage === "landed";
    const sticky = wasLanded && o.status !== "working";
    const dismissed = wasLanded && !sticky ? false : prev?.dismissed ?? false;
    // A failed gh call keeps the last known PR rather than dropping it.
    const pr = o.pr ?? (o.ghError ? prev?.pr ?? null : null);
    const awaitingAck = prev?.awaitingAck ?? false;
    const landing = sticky || dismissed || pr?.state === "MERGED";
    const holdingSince = landing
      ? null
      : nextHolding(prev?.holdingSince ?? null, o.status, now, o.replied || awaitingAck);
    const stillAck = awaitingAck && o.status !== "working" && o.status !== "idle";
    const next = {
      key, id, terminal: o.terminal, status: o.status, title: o.title, cwd: o.cwd,
      repo: o.repo, root: o.root, branch, commitsAhead: o.commitsAhead, pr,
      ghError: o.ghError, claims: o.claims, prompt: o.prompt, brief: o.brief,
      holdingSince, awaitingAck: stillAck, dismissed,
      createdAt: prev?.createdAt ?? now, landedAt: prev?.landedAt ?? null,
      observed: true, lastSeen: now,
      stage: /** @type {Stage} */ ("survey"),
    };
    next.stage = sticky ? "landed" : deriveStage(next);
    if (next.stage === "landed" && next.landedAt == null) next.landedAt = now;
    if (next.stage !== "landed") next.landedAt = null;
    log.push(...diffEvents(prev, next, now));
    if (prev) issues[issues.indexOf(prev)] = next;
    else issues.push(next);
    byKey.set(key, next);
  }

  // Terminals no longer observed: not holding, no live prompt, stage otherwise frozen.
  for (let n = 0; n < issues.length; n++) {
    const i = issues[n];
    if (seen.has(i.key)) continue;
    const next = { ...i, observed: false, holdingSince: null, awaitingAck: false, prompt: NO_PROMPT };
    if (i.stage === "holding") next.stage = deriveStage(next);
    issues[n] = next;
  }

  return finish({ issues, counters, prefixes, retired, log }, now);
}

/**
 * Drop expired issues (landed 7 days ago, or unobserved for 7 days) and retire
 * their keys so a still-open terminal does not resurrect them; prune retired.
 * Log events stay; the log is capped.
 */
function finish(store, now) {
  const retired = { ...(store.retired ?? {}) };
  const issues = store.issues.filter((i) => {
    const expired = i.stage === "landed"
      ? i.landedAt != null && i.landedAt < now - LANDED_TTL
      : i.lastSeen != null && i.lastSeen < now - LANDED_TTL;
    if (expired) retired[i.key] = now;
    return !expired;
  });
  for (const k of Object.keys(retired)) if (retired[k] < now - RETIRED_TTL) delete retired[k];
  const keys = Object.keys(retired);
  if (keys.length > RETIRED_CAP) {
    keys.sort((x, y) => retired[x] - retired[y]);
    for (const k of keys.slice(0, keys.length - RETIRED_CAP)) delete retired[k];
  }
  return { issues, counters: store.counters, prefixes: store.prefixes, retired, log: store.log.slice(-LOG_CAP) };
}

/**
 * @param {Store} store @param {string} key @param {number} now
 * @returns {Store}
 */
export function dismiss(store, key, now) {
  const prev = store.issues.find((i) => i.key === key);
  if (!prev) return store;
  const next = { ...prev, dismissed: true, holdingSince: null, awaitingAck: false };
  next.stage = deriveStage(next);
  if (next.stage === "landed" && next.landedAt == null) next.landedAt = now;
  const log = [...store.log, ...diffEvents(prev, next, now)];
  return finish({ ...store, issues: store.issues.map((i) => (i === prev ? next : i)), log }, now);
}

/**
 * The user replied: clear holding and ignore stale blocked/done until the
 * agent shows working or idle.
 * @param {Store} store @param {string} key
 * @returns {Store}
 */
export function markReplied(store, key) {
  const prev = store.issues.find((i) => i.key === key);
  if (!prev) return store;
  const next = { ...prev, holdingSince: null, awaitingAck: true };
  next.stage = deriveStage(next);
  return { ...store, issues: store.issues.map((i) => (i === prev ? next : i)) };
}
