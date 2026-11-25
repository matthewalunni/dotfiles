// Board columns and navigation. Pure.

import { STAGE_LABEL, boardColumn } from "./stage.js";
import { backlogFiler } from "./backlog.js";
import { projectOf, projectOrder } from "./present.js";
import { reviewOrder } from "./review.js";
import { RESUME_MS } from "./store.js";

/** @typedef {import("./store.js").Issue} Issue */

// No Holding column: waiting on you is a badge on the card.
const COLS = ["backlog", "survey", "build", "verify", "landed"].map((s) => [s, STAGE_LABEL[s]]);
const recency = (i) => i.holdingSince ?? i.lastSeen ?? 0;

/**
 * Board columns (see boardColumn: a dragged card sits where it was put). Each column's cards are in project order (see boardLanes),
 * newest first within a project, so j/k walks a column lane by lane.
 * `byReview`: within a project, unattended cards first.
 * @param {Issue[]} issues @param {boolean} [byReview]
 */
export function boardColumns(issues, byReview = false) {
  const live = (issues ?? []).filter((i) => !i.dismissed && !i.discarded);
  const order = (a, b) => projectOrder(projectOf(a), projectOf(b)) || (byReview ? reviewOrder(a, b) : 0) || recency(b) - recency(a);
  return COLS.map(([stage, label]) => ({
    stage, label,
    items: live.filter((i) => boardColumn(i) === stage).sort(order),
  }));
}

/**
 * One lane per project that has a card, in project order (no project last):
 * `cells[c]` is column c's cards for that project.
 * @param {{ items: Issue[] }[]} cols
 * @returns {{ project: string|null, count: number, cells: Issue[][] }[]}
 */
export function boardLanes(cols) {
  const projects = [...new Set(cols.flatMap((c) => c.items.map(projectOf)))].sort(projectOrder);
  return projects.map((project) => {
    const cells = cols.map((c) => c.items.filter((i) => projectOf(i) === project));
    return { project, count: cells.reduce((n, x) => n + x.length, 0), cells };
  });
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * @param {{items: any[]}[]} cols @param {{col:number,row:number}} sel @param {{dx?:number,dy?:number}} act
 */
export function moveBoard(cols, sel, act) {
  let col = clamp(sel?.col ?? 0, 0, Math.max(0, cols.length - 1));
  let row = sel?.row ?? 0;
  const dx = act?.dx ?? 0;
  if (dx) {
    let c = col + dx;
    while (c >= 0 && c < cols.length && cols[c].items.length === 0) c += dx;
    if (c >= 0 && c < cols.length) col = c; // clamp at the edges: stay put
  }
  const len = cols[col]?.items.length ?? 0;
  row = len === 0 ? 0 : clamp(row + (act?.dy ?? 0), 0, len - 1);
  return { col, row };
}

/** @param {Issue[]} issues @param {string|null} currentKey @returns {Issue|null} */
export function nextHolding(issues, currentKey) {
  const h = (issues ?? []).filter((i) => i.stage === "holding" && !i.dismissed)
    .sort((a, b) => (a.holdingSince ?? 0) - (b.holdingSince ?? 0));
  if (!h.length) return null;
  const at = h.findIndex((i) => i.key === currentKey);
  return h[(at + 1) % h.length];
}

/** A stable colour per repo name from `palette` (deckTokens().repo): same name, same colour. */
export function repoColor(name, palette) {
  let h = 0;
  for (const ch of String(name ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

/**
 * A card's one status line: {text, tone} with tone "hold"|"work"|"fail"|"ok"|"muted".
 * A backlog card says who filed it: "from <issue ID> · agent" when the filing
 * terminal is a known issue (in `issues`), else just its source; one Matt filed
 * from Deck (source "you") says "you".
 * @param {Issue} issue @param {Issue[]} [issues]
 */
export function boardNote(issue, issues, now = Date.now()) {
  if (issue.kind === "backlog") {
    if (issue.source === "you") return { text: "you", tone: "muted" };
    const by = backlogFiler(issue, issues);
    const src = issue.source || "agent";
    return { text: by ? `from ${by.id} · ${src}` : src, tone: "muted" };
  }
  if (issue.stage === "holding") {
    const q = String(issue.prompt?.text ?? "").split("\n").map((l) => l.trim()).find(Boolean);
    return { text: q || "Waiting on you", tone: "hold" };
  }
  if (boardColumn(issue) === "landed") return { text: issue.pr?.state === "MERGED" || issue.stage === "landed" ? "Merged" : "Done", tone: "ok" };
  if (issue.observed === false) {
    if (resuming(issue, now)) return { text: "Resuming…", tone: "work" };
    const last = lastSummary(issue);
    if (last) return { text: last.question ? "Asked: " + last.question : last.done, tone: "muted" };
    return { text: "Session ended", tone: "muted" };
  }
  const failing = (issue.pr?.checks ?? []).filter((c) => c.status === "fail").length;
  if (failing) return { text: `${failing} check${failing === 1 ? "" : "s"} failing`, tone: "fail" };
  if (issue.status === "working") return { text: "Working…", tone: "work" };
  return { text: STAGE_LABEL[issue.stage] ?? issue.stage, tone: "muted" };
}

/** The newest summary of an ended run, or null. @param {Issue} issue */
export function lastSummary(issue) {
  const s = issue?.summaries;
  return Array.isArray(s) && s.length ? s[s.length - 1] : null;
}

/** A Resume was started under RESUME_MS ago and its agent has not shown up yet. */
export function resuming(issue, now = Date.now()) {
  return issue?.observed === false && typeof issue.resumedAt === "number" && now - issue.resumedAt < RESUME_MS;
}

/** Whether the card shows Resume: an agent card whose agent ended, with a Claude session to go back to. */
export function canResume(issue, now = Date.now()) {
  return Boolean(issue && issue.kind !== "backlog" && issue.observed === false && issue.agent?.id && !resuming(issue, now));
}

// A Resume click reads "Resuming…" for at most this long, answered or not.
export const CLICK_MS = 25_000;

/**
 * What a card's Resume button shows: null (no button), "pending"
 * ("Resuming…", disabled) or "ready" (Resume; `error` is why the last try
 * failed, shown beside it). `clicks` is the shared card key -> click time map:
 * a click counts as pending for CLICK_MS at most, so a click nobody answers
 * (its task dropped by a reload) cannot keep the button busy.
 * @param {any} issue @param {Record<string, number>|null|undefined} clicks @param {number} [now]
 * @returns {{kind: "pending"}|{kind: "ready", error: string|null}|null}
 */
export function resumeState(issue, clicks, now = Date.now()) {
  if (!issue || issue.kind === "backlog" || issue.observed !== false || !issue.agent?.id) return null;
  const at = clicks?.[issue.key];
  if ((typeof at === "number" && now - at < CLICK_MS) || resuming(issue, now)) return { kind: "pending" };
  return { kind: "ready", error: issue.resumeError ?? null };
}

/** `clicks` without the ones past CLICK_MS; the same object when none are. */
export function pruneClicks(clicks, now = Date.now()) {
  const c = clicks && typeof clicks === "object" ? clicks : {};
  const keep = Object.entries(c).filter(([, at]) => typeof at === "number" && now - at < CLICK_MS);
  return keep.length === Object.keys(c).length && clicks ? clicks : Object.fromEntries(keep);
}
