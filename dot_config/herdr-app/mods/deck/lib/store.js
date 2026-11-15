// The issue store: turns each poll's observations into stable issues. Pure; no herdr imports.
import { deriveStage, nextHolding, pinHolds, PIN_COLUMNS, STAGE_LABEL } from "./stage.js";
import { samePrompt } from "./prompt.js";

/** @typedef {"working"|"blocked"|"done"|"idle"} Status */
/** @typedef {"survey"|"build"|"verify"|"holding"|"landed"} Stage */
/** @typedef {{ name: string, status: "pass"|"fail"|"pending", detail: string }} Check */
/** @typedef {{ number: number, title: string, state: "OPEN"|"MERGED"|"CLOSED", checks: Check[] }} Pr */
/** @typedef {{ claim: string, verdict: "PASS"|"FAIL"|"NO DATA", source: "ci"|"agent", path: string|null, detail: string|null }} Claim */
/** @typedef {{ kind: "permission"|"menu"|"question"|"none", text: string, options: Array<{ label: string, keys: string[], reply?: string }> }} Prompt */

/**
 * @typedef {{
 *   key: string, id: string, terminal: string, session?: string|null, space?: string|null, project?: string|null,
 *   status: Status, title: string,
 *   cwd: string, repo: string|null, root: string|null, branch: string|null,
 *   commitsAhead: number|null, dirty?: boolean, pr: Pr|null, ghError: string|null,
 *   claims: Claim[], prompt: Prompt|null, brief: any,
 *   stage: Stage, holdingSince: number|null, awaitingAck: boolean,
 *   answered: Prompt|null, repliedAt: number|null, reviewedSha: string|null,
 *   quiet: boolean, quietPrompt: Prompt|null, quietAt: number|null,
 *   dismissed: boolean, createdAt: number, landedAt: number|null,
 *   observed: boolean, lastSeen: number,
 *   pin?: { column: string, prState: string|null, at: number }|null
 * }} Issue
 */
/** @typedef {{ t: number, key: string, id: string, what: string, tone: "work"|"ok"|"warn"|"hold" }} LogEvent */
/** @typedef {{ issues: Issue[], counters: Record<string, number>, prefixes: Record<string, string>, retired: Record<string, number>, backlogTombs?: Record<string, { state: "started"|"discarded", at: number }>, log: LogEvent[] }} Store */
/**
 * @typedef {{
 *   terminal: string, session?: string|null, space?: string|null, status: Status, title: string, cwd: string, repo: string|null,
 *   root: string|null, branch: string|null, commitsAhead: number|null, dirty?: boolean, pr: Pr|null,
 *   ghError: string|null, claims: Claim[], prompt: Prompt|null, brief: any, replied: boolean
 * }} Observation
 */

const LANDED_TTL = 7 * 24 * 60 * 60 * 1000;
// An ended session's card (not landed) clears itself after a day.
const ENDED_TTL = 24 * 60 * 60 * 1000;
const LOG_CAP = 200;
const RETIRED_TTL = 30 * 24 * 60 * 60 * 1000;
const RETIRED_CAP = 500;
const NO_PROMPT = { kind: "none", text: "", options: [] };
// After a Deck reply, a still-blocked/done screen is ignored for at most this long.
const ACK_MS = 15_000;

/** @returns {Store} */
export function emptyStore() {
  return { issues: [], counters: {}, prefixes: {}, retired: {}, backlogTombs: {}, log: [] };
}

/** @param {string|null} branch */
const cleanBranch = (branch) => (branch && branch !== "HEAD" ? branch : null);

/**
 * A session: one agent run in one terminal, told apart from a reused terminal ID
 * by the terminal's creation time (`session`, null when unknown).
 * @param {string} terminal @param {string|null} session
 */
export function sessionTag(terminal, session) {
  return terminal + "|" + (session ?? "-");
}

const RETIRED_TAG = "s:";
/** Unknown on either side (an issue from before sessions, or a failed lookup) matches. */
const compatible = (a, b) => a == null || b == null || a === b;

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

/** Backlog entries are a separate kind: reconcile and the mutators below (dismiss, markReplied, updatePr, markReviewed) never touch them. */
const isBacklog = (i) => i.kind === "backlog";

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
    else if (prev) ev("moved to " + (STAGE_LABEL[next.stage] ?? cap(next.stage)), "work");
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
  const backlogItems = store.issues.filter(isBacklog);
  let issues = store.issues.filter((i) => !isBacklog(i)).map((i) => ({ ...i }));
  const log = [...store.log];
  const retired = { ...(store.retired ?? {}) };
  const seen = new Set();
  const liveTags = new Set();
  const drop = new Set();

  for (const o of obs) {
    const branch = cleanBranch(o.branch);
    const tag = RETIRED_TAG + sessionTag(o.terminal, o.session ?? null);
    liveTags.add(tag);
    if (tag in retired) {
      retired[tag] = now; // the retired session is still running: keep it retired
      continue;
    }
    const project = o.repo ?? o.space ?? null;
    // One session, one issue: the issue this terminal's agent had at the last
    // poll, whatever its branch or folder is now. The same terminal (same
    // created time) coming back after a gap keeps its issue; a reused terminal
    // ID (a different created time) is a new session.
    const sameSession = (i) => i.session != null && o.session != null && i.session === o.session;
    const same = issues
      .filter((i) => i.terminal === o.terminal && !seen.has(i.key) && !drop.has(i.key))
      .filter((i) => (i.observed !== false && compatible(i.session, o.session)) || sameSession(i))
      .sort((a, b) => Number(b.observed !== false) - Number(a.observed !== false)
        || Number((b.project ?? b.repo ?? null) === project) - Number((a.project ?? a.repo ?? null) === project)
        || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
    const prev = same[0] ?? null;
    // Extra issues of this same session (left by a polling gap) fold into it.
    for (const i of same.slice(1)) if (sameSession(i) && !i.pr && i.stage !== "landed") drop.add(i.key);
    // Issues from before sessions (no `session` field) were one per branch:
    // the extra ones for this terminal are duplicates of this session.
    if (prev) {
      for (const i of issues) {
        if (i === prev || i.terminal !== o.terminal || "session" in i || seen.has(i.key)) continue;
        if (!i.pr && i.stage !== "landed") drop.add(i.key);
      }
    }
    let id = prev?.id ?? null;
    if (!id || (id.startsWith("XX-") && project)) {
      const prefix = prefixFor(project, prefixes);
      if (project) prefixes[project] = prefix;
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      id = prefix + "-" + counters[prefix];
    }
    const key = prev?.key ?? sessionTag(o.terminal, o.session ?? null) + "|" + now;
    seen.add(key);
    const wasLanded = prev?.stage === "landed";
    // A failed gh call keeps the last known PR rather than dropping it.
    const pr = o.pr ?? (o.ghError ? prev?.pr ?? null : null);
    // Landing quiets holding. A merge seen now quiets only the done screen that
    // was showing then (see quietEnds); a dismiss lasts until the agent works.
    const mergedNow = pr?.state === "MERGED" && prev?.pr?.state !== "MERGED";
    const prevQuiet = prev ? prev.quiet ?? wasLanded : false;
    const quietHeld = prevQuiet && o.status !== "working" && !quietEnds(prev, o, now);
    const sticky = wasLanded && quietHeld;
    const dismissed = wasLanded && !sticky ? false : prev?.dismissed ?? false;
    const landing = sticky || dismissed || mergedNow;
    const stillAck = ackHeld(prev, o, now);
    const holdingSince = landing
      ? null
      : nextHolding(prev?.holdingSince ?? null, o.status, now, o.replied || stillAck);
    const next = {
      key, id, terminal: o.terminal, session: o.session ?? prev?.session ?? null, space: o.space ?? null, project,
      status: o.status, title: o.title, cwd: o.cwd,
      repo: o.repo, root: o.root, branch, commitsAhead: o.commitsAhead, dirty: o.dirty ?? false, pr,
      ghError: o.ghError, claims: o.claims, prompt: o.prompt, brief: o.brief,
      holdingSince, awaitingAck: stillAck, dismissed, quiet: mergedNow || quietHeld,
      quietPrompt: mergedNow ? o.prompt ?? null : quietHeld ? prev?.quietPrompt ?? null : null,
      quietAt: mergedNow ? now : quietHeld ? prev?.quietAt ?? null : null,
      answered: stillAck ? prev?.answered ?? null : null, repliedAt: stillAck ? prev?.repliedAt ?? null : null,
      createdAt: prev?.createdAt ?? now, landedAt: prev?.landedAt ?? null,
      reviewedSha: prev?.reviewedSha ?? null,
      pin: pinHolds(prev?.pin, pr) ? prev.pin : null,
      observed: true, lastSeen: now,
      stage: /** @type {Stage} */ ("survey"),
    };
    next.stage = sticky ? "landed" : deriveStage(next);
    if (next.stage === "landed" && next.landedAt == null) next.landedAt = now;
    if (next.stage !== "landed") next.landedAt = null;
    log.push(...diffEvents(prev, next, now));
    if (prev) issues[issues.indexOf(prev)] = next;
    else issues.push(next);
  }
  if (drop.size) issues = issues.filter((i) => !drop.has(i.key));
  // A retired session that stopped running is forgotten: a new agent there is a new issue.
  for (const k of Object.keys(retired)) if (k.startsWith(RETIRED_TAG) && !liveTags.has(k)) delete retired[k];

  // Sessions no longer observed have ended: not holding, no live prompt, stage otherwise frozen.
  for (let n = 0; n < issues.length; n++) {
    const i = issues[n];
    if (seen.has(i.key)) continue;
    const next = {
      ...i, observed: false, holdingSince: null, awaitingAck: false, answered: null, repliedAt: null, prompt: NO_PROMPT,
    };
    if (i.stage === "holding") next.stage = deriveStage(next);
    issues[n] = next;
  }

  return finish({ issues: [...backlogItems, ...issues], counters, prefixes, retired, backlogTombs: store.backlogTombs ?? {}, log }, now);
}

/**
 * Whether a Deck reply still masks blocked/done: until a poll sees working or
 * idle, a prompt other than the one answered, or ACK_MS has passed.
 * @param {Issue|null} prev @param {Observation} o @param {number} now
 */
function ackHeld(prev, o, now) {
  if (!prev?.awaitingAck) return false;
  if (o.status === "working" || o.status === "idle") return false;
  if (typeof prev.repliedAt === "number" && now - prev.repliedAt >= ACK_MS) return false;
  if (o.prompt && !samePrompt(prev.answered ?? NO_PROMPT, o.prompt)) return false;
  return true;
}

/**
 * Whether a merge's quiet ends now: the agent is blocked, shows a prompt other
 * than the one showing at merge time, or ACK_MS has passed since the merge.
 * A dismiss's quiet (no quietAt) never ends here.
 * @param {Issue|null} prev @param {Observation} o @param {number} now
 */
function quietEnds(prev, o, now) {
  if (typeof prev?.quietAt !== "number") return false;
  if (o.status === "blocked") return true;
  if (now - prev.quietAt >= ACK_MS) return true;
  return Boolean(o.prompt && !samePrompt(prev.quietPrompt ?? NO_PROMPT, o.prompt));
}

/**
 * Drop expired issues (landed 7 days ago, ended a day ago, or unseen for 7 days);
 * retire a still-running session so the next poll does not resurrect it; prune retired.
 * Log events stay; the log is capped.
 */
function finish(store, now) {
  const retired = { ...(store.retired ?? {}) };
  const issues = store.issues.filter((i) => {
    if (isBacklog(i)) return true; // backlog entries expire in mergeBacklog
    const pinnedLanded = i.pin?.column === "landed" && pinHolds(i.pin, i.pr);
    const expired = pinnedLanded
      ? i.pin.at < now - LANDED_TTL
      : i.stage === "landed"
      ? i.landedAt != null && i.landedAt < now - LANDED_TTL
      : i.lastSeen != null && i.lastSeen < now - (i.observed === false ? ENDED_TTL : LANDED_TTL);
    // A still-running session's issue is retired so the next poll does not bring it back.
    if (expired && i.observed !== false) retired[RETIRED_TAG + sessionTag(i.terminal, i.session ?? null)] = now;
    return !expired;
  });
  for (const k of Object.keys(retired)) if (retired[k] < now - RETIRED_TTL) delete retired[k];
  const keys = Object.keys(retired);
  if (keys.length > RETIRED_CAP) {
    keys.sort((x, y) => retired[x] - retired[y]);
    for (const k of keys.slice(0, keys.length - RETIRED_CAP)) delete retired[k];
  }
  return { issues, counters: store.counters, prefixes: store.prefixes, retired, backlogTombs: store.backlogTombs ?? {}, log: store.log.slice(-LOG_CAP) };
}

/**
 * @param {Store} store @param {string} key @param {number} now
 * @returns {Store}
 */
export function dismiss(store, key, now) {
  const prev = store.issues.find((i) => i.key === key);
  if (!prev || isBacklog(prev)) return store;
  const next = { ...prev, dismissed: true, quiet: true, quietPrompt: null, quietAt: null, holdingSince: null, awaitingAck: false, answered: null, repliedAt: null };
  next.stage = deriveStage(next);
  if (next.stage === "landed" && next.landedAt == null) next.landedAt = now;
  const log = [...store.log, ...diffEvents(prev, next, now)];
  return finish({ ...store, issues: store.issues.map((i) => (i === prev ? next : i)), log }, now);
}

/**
 * The user replied at `now`: clear holding and ignore the answered prompt
 * (see ackHeld) until the agent moves on.
 * @param {Store} store @param {string} key @param {number} now
 * @returns {Store}
 */
export function markReplied(store, key, now) {
  const prev = store.issues.find((i) => i.key === key);
  if (!prev || isBacklog(prev)) return store;
  const next = {
    ...prev, holdingSince: null, awaitingAck: true,
    answered: prev.prompt ?? null, repliedAt: typeof now === "number" ? now : null,
  };
  next.stage = deriveStage(next);
  return { ...store, issues: store.issues.map((i) => (i === prev ? next : i)) };
}

/**
 * Fast refresh of one issue's PR, checks and claims (the selected issue while
 * the Issues view is open), between full collection cycles.
 * @param {Store} store @param {string} key
 * @param {{ pr: Pr|null, ghError: string|null, claims: Claim[] }} fresh
 * @param {number} now
 * @returns {Store}
 */
export function updatePr(store, key, fresh, now) {
  const prev = store.issues.find((i) => i.key === key);
  if (!prev || isBacklog(prev)) return store;
  const pr = fresh.pr ?? (fresh.ghError ? prev.pr ?? null : null);
  const mergedNow = pr?.state === "MERGED" && prev.pr?.state !== "MERGED";
  const next = { ...prev, pr, ghError: fresh.ghError, claims: fresh.claims, pin: pinHolds(prev.pin, pr) ? prev.pin : null };
  if (mergedNow) Object.assign(next, { holdingSince: null, quiet: true, quietPrompt: prev.prompt ?? null, quietAt: now });
  const sticky = prev.stage === "landed" && (prev.quiet ?? true);
  next.stage = sticky ? "landed" : deriveStage(next);
  if (next.stage === "landed" && next.landedAt == null) next.landedAt = now;
  if (next.stage !== "landed") next.landedAt = null;
  const log = [...store.log, ...diffEvents(prev, next, now)];
  return finish({ ...store, issues: store.issues.map((i) => (i === prev ? next : i)), log }, now);
}

/**
 * The person deleted an issue: drop its card and retire its session, so the
 * same agent run never makes a card again (a new session in that terminal
 * does). Unchanged store for a backlog entry or an unknown key.
 * @param {Store} store @param {string} key @param {number} now
 * @returns {Store}
 */
export function removeIssue(store, key, now) {
  const prev = store.issues.find((i) => i.key === key);
  if (!prev || isBacklog(prev)) return store;
  const retired = { ...(store.retired ?? {}) };
  if (prev.observed !== false) retired[RETIRED_TAG + sessionTag(prev.terminal, prev.session ?? null)] = now;
  const log = [...store.log, { t: now, key, id: prev.id, what: "deleted by you", tone: "warn" }];
  return { ...store, issues: store.issues.filter((i) => i !== prev), retired, log };
}

/**
 * The person dragged a card to a board column: it stays there until a PR opens
 * or merges (see pinHolds). Unchanged store for a backlog entry, an unknown
 * key or a column cards cannot be dragged to.
 * @param {Store} store @param {string} key @param {string} column @param {number} now
 * @returns {Store}
 */
export function pinColumn(store, key, column, now) {
  if (!PIN_COLUMNS.includes(column)) return store;
  const prev = store.issues.find((i) => i.key === key);
  if (!prev || isBacklog(prev)) return store;
  const next = { ...prev, pin: { column, prState: prev.pr?.state ?? null, at: now } };
  const log = [...store.log, { t: now, key, id: prev.id, what: "moved to " + (STAGE_LABEL[column] ?? cap(column)) + " by you", tone: "work" }];
  return { ...store, issues: store.issues.map((i) => (i === prev ? next : i)), log };
}

/**
 * The person saw the PR diff for head `sha` (the Changes view drew it).
 * Unchanged store when already recorded or `sha` is not a full SHA.
 * @param {Store} store @param {string} key @param {string} sha
 * @returns {Store}
 */
export function markReviewed(store, key, sha) {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) return store;
  const prev = store.issues.find((i) => i.key === key);
  if (!prev || isBacklog(prev) || prev.reviewedSha === sha) return store;
  const next = { ...prev, reviewedSha: sha };
  return { ...store, issues: store.issues.map((i) => (i === prev ? next : i)) };
}
