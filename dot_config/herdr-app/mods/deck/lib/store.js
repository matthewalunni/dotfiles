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
 *   dismissed: boolean, createdAt: number, landedAt: number|null
 * }} Issue
 */
/** @typedef {{ t: number, key: string, id: string, what: string, tone: "work"|"ok"|"warn"|"hold" }} LogEvent */
/** @typedef {{ issues: Issue[], counters: Record<string, number>, log: LogEvent[] }} Store */
/**
 * @typedef {{
 *   terminal: string, status: Status, title: string, cwd: string, repo: string|null,
 *   root: string|null, branch: string|null, commitsAhead: number|null, pr: Pr|null,
 *   ghError: string|null, claims: Claim[], prompt: Prompt|null, brief: any, replied: boolean
 * }} Observation
 */

const LANDED_TTL = 7 * 24 * 60 * 60 * 1000;
const LOG_CAP = 200;

/** @returns {Store} */
export function emptyStore() {
  return { issues: [], counters: {}, log: [] };
}

/** @param {string|null} branch */
const cleanBranch = (branch) => (branch && branch !== "HEAD" ? branch : null);

/** @param {string} terminal @param {string|null} branch */
export function issueKey(terminal, branch) {
  return terminal + "|" + (cleanBranch(branch) ?? "-");
}

/** @param {string|null} repo */
function prefixOf(repo) {
  const p = (repo ?? "").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  return p.length === 2 ? p : "XX";
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
  const issues = store.issues.map((i) => ({ ...i }));
  const log = [...store.log];
  const byKey = new Map(issues.map((i) => [i.key, i]));

  for (const o of obs) {
    const branch = cleanBranch(o.branch);
    const key = issueKey(o.terminal, branch);
    const prev = byKey.get(key) ?? null;
    let id;
    if (prev) id = prev.id;
    else {
      const prefix = prefixOf(o.repo);
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      id = prefix + "-" + counters[prefix];
    }
    const dismissed = prev?.dismissed ?? false;
    // A failed gh call keeps the last known PR rather than dropping it.
    const pr = o.pr ?? (o.ghError ? prev?.pr ?? null : null);
    const awaitingAck = prev?.awaitingAck ?? false;
    const landing = dismissed || pr?.state === "MERGED";
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
      stage: /** @type {Stage} */ ("survey"),
    };
    next.stage = deriveStage(next);
    if (next.stage === "landed" && next.landedAt == null) next.landedAt = now;
    log.push(...diffEvents(prev, next, now));
    if (prev) issues[issues.indexOf(prev)] = next;
    else issues.push(next);
    byKey.set(key, next);
  }

  return finish({ issues, counters, log }, now);
}

/** Drop expired landed issues (their log events stay) and cap the log. */
function finish(store, now) {
  const issues = store.issues.filter(
    (i) => !(i.stage === "landed" && i.landedAt != null && i.landedAt < now - LANDED_TTL),
  );
  return { issues, counters: store.counters, log: store.log.slice(-LOG_CAP) };
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
