// What the views show, derived from the store. Pure; no herdr imports.
// Colors are tone names ("work", "ok", "fail", "nodata", "hold", "muted", "off");
// the views map them onto deckTokens.

import { reviewOf, reviewOrder } from "./review.js";

/** @typedef {import("./store.js").Issue} Issue */
/** @typedef {import("./store.js").Stage} Stage */
/** @typedef {{ kind: "view"|"repo", value: string|null }|null} Filter */

/** Pipeline order (counters, telemetry). */
export const STAGES = /** @type {Stage[]} */ (["survey", "build", "verify", "holding", "landed"]);
/** Issues list order: the Backlog first, then what needs Matt. */
export const LIST_ORDER = /** @type {Stage[]} */ (["backlog", "holding", "verify", "build", "survey", "landed"]);

const PCT = { survey: 15, build: 50, verify: 75, holding: 100, landed: 100 };

/** @param {string} stage */
export function stagePct(stage) {
  return PCT[stage] ?? 0;
}

/**
 * Quick replies for a free-text question: a / b / c when the text offers them as choices.
 * @param {string|null} text
 * @returns {string[]}
 */
export function quickReplies(text) {
  const s = String(text ?? "");
  const offered = (l) =>
    new RegExp(`(^|\\s)${l}[).:](\\s|$)|\\(${l}\\)`, "im").test(s) || new RegExp(`(^|\\s)${l}\\s*/|/\\s*${l}([\\s?.!,]|$)`, "im").test(s);
  const letters = ["a", "b", "c"].filter(offered);
  return letters.length >= 2 ? letters : [];
}

/** The project an issue is filed under: its repo, else its Herdr space (see reconcile). @param {Issue} i */
export function projectOf(i) {
  return i?.project ?? i?.repo ?? null;
}

/** Project order: by name, ignoring case; no project last. */
export function projectOrder(a, b) {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.toLowerCase().localeCompare(b.toLowerCase()) || (a < b ? -1 : 1);
}

const hasFailingCheck = (i) => (i.pr?.checks ?? []).some((c) => c.status === "fail");
const hasNoData = (i) => (i.claims ?? []).some((c) => c.verdict === "NO DATA");

const isBacklog = (i) => i.kind === "backlog";

/** The agents' issues, without backlog entries (telemetry). @param {Issue[]} issues */
export function liveIssues(issues) {
  return (issues ?? []).filter((i) => !isBacklog(i));
}

/**
 * A discarded backlog entry shows only under the "discarded" view.
 * @param {Issue} issue @param {Filter} filter
 */
export function matchesView(issue, filter) {
  const discarded = isBacklog(issue) && Boolean(issue.discarded);
  if (filter?.kind === "view" && filter.value === "discarded") return discarded;
  if (discarded) return false;
  if (!filter) return true;
  if (filter.kind === "repo") return projectOf(issue) === filter.value;
  switch (filter.value) {
    case "holding": return issue.stage === "holding";
    case "failing": return hasFailingCheck(issue);
    case "nodata": return hasNoData(issue);
    case "landed": return issue.stage === "landed";
    // What can run without Matt: not yet landed, and safe unattended.
    case "unattended": return issue.stage !== "landed" && reviewOf(issue) === "unattended";
    default: return true;
  }
}

/**
 * `byReview`: within each stage, unattended cards first (then by project).
 * @param {Issue[]} issues @param {Filter} filter @param {boolean} [byReview]
 * @returns {{ stage: Stage, items: Issue[] }[]}
 */
export function groupIssues(issues, filter, byReview = false) {
  const shown = issues.filter((i) => matchesView(i, filter));
  const byProject = (a, b) => (byReview ? reviewOrder(a, b) : 0) || projectOrder(projectOf(a), projectOf(b));
  return LIST_ORDER.map((stage) => ({ stage, items: shown.filter((i) => i.stage === stage).sort(byProject) })).filter((g) => g.items.length);
}

const URGENCY = ["holding", "verify", "build", "survey", "landed"];
const WORD = { holding: "HOLDING", verify: "VERIFYING", build: "BUILDING", survey: "STARTED", landed: "LANDED" };

/**
 * One row per repo (first-seen order): its most urgent stage and a 5-segment progress bar.
 * @param {Issue[]} issues
 * @returns {{ repo: string|null, state: Stage, word: string, segments: string[] }[]}
 */
export function repoTelemetry(issues) {
  /** @type {Map<string|null, Stage[]>} */
  const by = new Map();
  for (const i of liveIssues(issues)) {
    const r = projectOf(i);
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(i.stage);
  }
  const out = [];
  for (const [repo, stages] of by) {
    const state = /** @type {Stage} */ (URGENCY.find((s) => stages.includes(s)) ?? "survey");
    let segments;
    if (state === "landed") segments = ["ok", "ok", "ok", "ok", "ok"];
    else if (state === "survey") segments = ["muted", "off", "off", "off", "off"];
    else {
      const upto = state === "build" ? 2 : 3;
      segments = STAGES.map((_, n) => (n < upto ? "work" : "off"));
      if (state === "holding") segments[3] = "hold";
    }
    out.push({ repo, state, word: WORD[state], segments });
  }
  return out;
}

/**
 * @param {{ status: string }[]} checks
 * @returns {{ pass: number, fail: number, pending: number, total: number, tone: string }}
 */
export function checkTally(checks) {
  const list = checks ?? [];
  const pass = list.filter((c) => c.status === "pass").length;
  const fail = list.filter((c) => c.status === "fail").length;
  const pending = list.length - pass - fail;
  const tone = !list.length ? "off" : fail ? "fail" : pending ? "nodata" : "ok";
  return { pass, fail, pending, total: list.length, tone };
}

/** The list row's PR chip: "#n" with a check-colored dot, "merged", or "—". */
export function prChip(issue) {
  const p = issue.pr;
  if (!p || p.state === "CLOSED") return { text: "—", tone: "off" };
  if (p.state === "MERGED") return { text: "merged", tone: "ok" };
  return { text: "#" + p.number, tone: checkTally(p.checks).tone };
}

const firstLine = (s) => String(s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";

/** A short line of what the issue is doing, for list rows. */
export function issueNote(issue) {
  if (issue.stage === "holding") return firstLine(issue.prompt?.text) || "waiting on you";
  if (issue.stage === "landed") return issue.pr?.state === "MERGED" ? "merged" : "dismissed";
  if (issue.observed === false) return "session ended";
  if (issue.pr?.state === "OPEN") {
    const t = checkTally(issue.pr.checks);
    return t.total ? `PR #${issue.pr.number} · checks ${t.pass}/${t.total}` : `PR #${issue.pr.number}`;
  }
  const n = issue.commitsAhead ?? 0;
  if (issue.stage === "build" && n > 0) return `${n} commit${n === 1 ? "" : "s"}`;
  return issue.status ?? "";
}

/** Whole minutes from `since` to `now` (0 when unknown or in the future). */
export function minutesSince(since, now) {
  if (since == null || !(now > since)) return 0;
  return Math.floor((now - since) / 60_000);
}

const pad2 = (n) => String(n).padStart(2, "0");

/** Local HH:MM. */
export function hhmm(t) {
  const d = new Date(t);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd(s.length - 1 - ((s.length - 1) % 4) + 4));

const CODE_MAX = 400;
// A minified line can be huge; the row truncates anyway.
const clipCode = (s) => (s.length <= CODE_MAX ? s : s.slice(0, CODE_MAX - 1) + "…");

export const ROW_H = { file: 32, hunk: 22, line: 20, truncated: 32 };

/**
 * Flattens parseDiff output into rows for a virtual list, stopping after `cap` code lines.
 * `fileRow[i]` is the row of file i's header, or -1 when it was cut off.
 * @param {ReturnType<typeof import("./github.js").parseDiff>} files @param {number} cap
 */
export function diffRows(files, cap) {
  const rows = [];
  const fileRow = files.map(() => -1);
  let lines = 0;
  let truncated = false;
  outer: for (const [n, f] of files.entries()) {
    if (lines >= cap) {
      truncated = true;
      break;
    }
    fileRow[n] = rows.length;
    rows.push({ kind: "file", path: f.path, add: f.add, del: f.del });
    for (const h of f.hunks) {
      if (lines >= cap) {
        truncated = true;
        break outer;
      }
      rows.push({ kind: "hunk", text: h.header });
      for (const l of h.lines) {
        if (lines >= cap) {
          truncated = true;
          break outer;
        }
        rows.push({ kind: "line", a: l.a, b: l.b, sign: l.sign, code: clipCode(untab(l.code)) });
        lines++;
      }
    }
  }
  if (truncated) rows.push({ kind: "truncated" });
  return { rows, sizes: rows.map((r) => ROW_H[r.kind]), fileRow, truncated };
}
