// Board operations queued by the chat agent (~/.local/bin/herdr-board) for the
// deck to apply: move, dismiss, delete, discard, restore, edit, start, resume. The CLI
// appends one JSON line per request to BOARD_OPS; the deck applies each one
// once, through the same actions as its own buttons, and appends the outcome
// to BOARD_RESULTS for the CLI to report. Pure; no herdr imports.
import { PIN_COLUMNS, STAGE_LABEL } from "./stage.js";
import { asReview } from "./review.js";
import { resumePlan } from "./agentsession.js";

export const BOARD_OPS = "~/.local/state/herdr-deck/board.jsonl";
export const BOARD_RESULTS = "~/.local/state/herdr-deck/board-results.jsonl";

/** A request older than this is never applied (the deck was closed when it was made). */
export const OP_MAX_AGE = 10 * 60 * 1000;

export const OPS = ["move", "dismiss", "delete", "discard", "restore", "edit", "start", "resume", "goal-new", "goal", "review"];
/** Ops on agent cards, and on backlog cards. */
const ISSUE_OPS = new Set(["move", "dismiss", "delete", "resume"]);
const BACKLOG_OPS = new Set(["discard", "restore", "start"]);

/**
 * goal-new: `ref` is the new goal's title. goal: `ref` is the card, `goal` a G-n or "none".
 * review: `ref` is the card (any kind), `review` "needs-me" or "unattended".
 * @typedef {{ id: string, t: number, op: string, ref: string, from: string|null, column?: string, title?: string, brief?: string,
 *   goal?: string, review?: string, project?: string, start?: string, doneWhen?: string, days?: number }} BoardOp
 */

/**
 * The well-formed requests in `text` (JSON lines), first of a duplicate id
 * winning. Bad or partial lines are skipped.
 * @param {string|null|undefined} text @returns {BoardOp[]}
 */
export function parseOps(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    if (typeof o.id !== "string" || !o.id || seen.has(o.id)) continue;
    if (!OPS.includes(o.op) || typeof o.ref !== "string" || !o.ref.trim()) continue;
    if (typeof o.t !== "number" || !Number.isFinite(o.t)) continue;
    seen.add(o.id);
    const op = { id: o.id, t: o.t, op: o.op, ref: o.ref.trim(), from: typeof o.from === "string" && o.from ? o.from : null };
    if (typeof o.column === "string") op.column = o.column;
    if (typeof o.title === "string") op.title = o.title;
    if (typeof o.brief === "string") op.brief = o.brief;
    for (const k of ["goal", "review", "project", "start", "doneWhen"]) if (typeof o[k] === "string") op[k] = o[k];
    if (typeof o.days === "number" && Number.isFinite(o.days)) op.days = o.days;
    out.push(op);
  }
  return out;
}

/**
 * The requests still to apply: not done yet, not older than OP_MAX_AGE (nor
 * from the future by more than a minute), oldest first.
 * @param {BoardOp[]} ops @param {Record<string, number>} done op id -> when applied @param {number} now
 */
export function pendingOps(ops, done, now) {
  return ops
    .filter((o) => !(o.id in (done ?? {})) && now - o.t <= OP_MAX_AGE && o.t - now <= 60_000)
    .sort((a, b) => a.t - b.t);
}

/** `done` without entries older than OP_MAX_AGE (their requests can never apply again). */
export function pruneDone(done, now) {
  const out = {};
  for (const [id, at] of Object.entries(done ?? {})) if (now - at <= OP_MAX_AGE) out[id] = at;
  return out;
}

/**
 * The card a request names: its visible id (TF-8, B-3; any case) or its store
 * key. A dismissed agent card still counts (delete removes it for good).
 * @param {any[]} issues @param {string} ref
 */
export function resolveRef(issues, ref) {
  const r = String(ref ?? "").trim();
  if (!r) return null;
  const up = r.toUpperCase();
  return issues.find((i) => i?.key === r) ?? issues.find((i) => typeof i?.id === "string" && i.id.toUpperCase() === up) ?? null;
}

/**
 * A board column from what the agent typed: a column key (survey, build,
 * verify, landed), its label (Started, Build, Verify, Landed) or "done", any case. null when cards cannot be put there.
 * @param {unknown} name
 */
export function columnFor(name) {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return null;
  if (PIN_COLUMNS.includes(n)) return n;
  if (n === "done") return "landed";
  return PIN_COLUMNS.find((c) => String(STAGE_LABEL[c] ?? "").toLowerCase() === n) ?? null;
}

const COLUMN_NAMES = () => PIN_COLUMNS.map((c) => String(STAGE_LABEL[c] ?? c).toLowerCase()).join(", ");

/**
 * What applying `op` means, decided against the store before anything is
 * touched: { error } when it cannot apply, else { issue, column?, edit? }.
 * `from` must be the chat agent's terminal address (`chat`): other agents
 * cannot change the board.
 * @param {BoardOp} op @param {any[]} issues @param {string|null} chat
 */
export function planOp(op, issues, chat) {
  if (!chat || op.from !== chat) return { error: "only the deck chat agent can change the board" };
  // Goal values (days, start) are checked where the goal is made (lib/goals.js newGoal).
  if (op.op === "goal-new") {
    return { goalNew: { title: op.ref, days: op.days, project: op.project ?? null, start: op.start ?? null, doneWhen: op.doneWhen ?? null } };
  }
  const issue = resolveRef(issues, op.ref);
  if (!issue) return { error: `no card ${op.ref} on the board` };
  const backlog = issue.kind === "backlog";
  if (ISSUE_OPS.has(op.op) && backlog) return { error: `${issue.id} is a backlog card: use discard or start` };
  if (BACKLOG_OPS.has(op.op) && !backlog) return { error: `${issue.id} is not a backlog card` };
  if (op.op === "restore" && !issue.discarded) return { error: `${issue.id} is not discarded` };
  if ((op.op === "discard" || op.op === "start") && issue.discarded) return { error: `${issue.id} is discarded: restore it first` };
  if (op.op === "move") {
    const column = columnFor(op.column);
    if (!column) return { error: `cannot move to "${op.column ?? ""}": use one of ${COLUMN_NAMES()}` };
    return { issue, column };
  }
  if (op.op === "edit") {
    const r = planEdit(op);
    return "error" in r ? r : { issue, edit: r.edit };
  }
  if (op.op === "review") {
    const review = asReview(op.review);
    if (!review) return { error: "review needs needs-me or unattended" };
    if (issue.discarded) return { error: `${issue.id} is discarded: restore it first` };
    return { issue, review };
  }
  if (op.op === "resume") {
    const r = resumePlan(issue);
    return r.error ? { error: r.error } : { issue };
  }
  if (op.op === "goal") {
    if (!op.goal || !op.goal.trim()) return { error: "goal needs a goal: a G-n, or none" };
    if (issue.discarded && op.goal.trim().toLowerCase() !== "none") return { error: `${issue.id} is discarded: restore it first` };
    return { issue, goal: op.goal.trim() };
  }
  return { issue };
}

/**
 * A title and/or brief edit, checked: { edit } or { error }. Shared by
 * `herdr-board edit` (planOp) and Deck's in-place editors (data.js editCard).
 * @param {{title?: unknown, brief?: unknown}} fields
 * @returns {{edit: {title?: string, brief?: string}}|{error: string}}
 */
export function planEdit(fields) {
  const edit = {};
  if (typeof fields?.title === "string") {
    if (!fields.title.trim()) return { error: "the title cannot be empty" };
    edit.title = fields.title.trim();
  }
  if (typeof fields?.brief === "string") edit.brief = fields.brief;
  if (!("title" in edit) && !("brief" in edit)) return { error: "edit needs --title or --brief" };
  return { edit };
}

/** The result line the CLI waits for. @param {string} id @param {boolean} ok @param {string} message @param {number} now */
export function resultLine(id, ok, message, now) {
  return JSON.stringify({ id, ok, message, t: now });
}
