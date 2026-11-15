// Stage rules and the "holding for you" flag. Pure; no herdr imports.

/** @typedef {"working"|"blocked"|"done"|"idle"} Status */
/** @typedef {"survey"|"build"|"verify"|"holding"|"landed"} Stage */
/** @typedef {{ name: string, status: "pass"|"fail"|"pending", detail: string }} Check */
/** @typedef {{ number: number, title: string, state: "OPEN"|"MERGED"|"CLOSED", checks: Check[] }} Pr */
/** @typedef {{ key: string, holdingSince: number|null, pr: Pr|null }} Issue */

/**
 * Holding is Deck's own flag: set when the agent becomes blocked/done, kept
 * through idle, cleared when the user replied or the agent is working again.
 * @param {number|null} prevSince
 * @param {Status} status
 * @param {number} now
 * @param {boolean} replied
 * @returns {number|null}
 */
export function nextHolding(prevSince, status, now, replied) {
  if (replied || status === "working") return null;
  if (status === "blocked" || status === "done") return prevSince ?? now;
  return prevSince;
}

/** Display names for stages (ids stay as-is; "survey" is shown as "Started"). */
export const STAGE_LABEL = { backlog: "Backlog", survey: "Started", build: "Build", verify: "Verify", holding: "Holding", landed: "Landed" };

/**
 * Precedence: holding > landed (merged or dismissed) > verify (open PR) > build (commits ahead or uncommitted edits) > survey.
 * A CLOSED (unmerged) PR counts as no PR.
 * @param {{ holdingSince: number|null, dismissed: boolean, pr: Pr|null, commitsAhead: number|null, dirty?: boolean, status: Status }} f
 * @returns {Stage}
 */
export function deriveStage(f) {
  if (f.holdingSince != null) return "holding";
  if (f.dismissed || f.pr?.state === "MERGED") return "landed";
  if (f.pr?.state === "OPEN") return "verify";
  if ((f.commitsAhead ?? 0) > 0 || f.dirty) return "build";
  return "survey";
}

/** Columns a card can be dragged to. */
export const PIN_COLUMNS = ["survey", "build", "verify", "landed"];

/**
 * Whether a board pin still holds: it is a real column and no PR opened or
 * merged since it was set (a closed PR is no event).
 * @param {{ column: string, prState: string|null, at: number }|null|undefined} pin @param {Pr|null|undefined} pr
 */
export function pinHolds(pin, pr) {
  if (!pin || !PIN_COLUMNS.includes(pin.column)) return false;
  const state = pr?.state ?? null;
  return !((state === "OPEN" || state === "MERGED") && state !== (pin.prState ?? null));
}

/**
 * A card's board column: where it was dragged (while the pin holds), else its
 * work stage. Waiting on you is a badge, not a column, so holding maps to the
 * stage underneath.
 * @param {any} issue
 */
export function boardColumn(issue) {
  if (issue.kind === "backlog") return issue.stage;
  if (pinHolds(issue.pin, issue.pr)) return issue.pin.column;
  return issue.stage === "holding" ? deriveStage({ ...issue, holdingSince: null }) : issue.stage;
}

/**
 * The holding issue waiting longest; ties prefer the one with a PR.
 * @param {Issue[]} issues
 * @returns {Issue|null}
 */
export function pickDecision(issues) {
  let best = null;
  for (const it of issues) {
    if (it.holdingSince == null) continue;
    if (
      !best ||
      it.holdingSince < best.holdingSince ||
      (it.holdingSince === best.holdingSince && it.pr && !best.pr)
    ) best = it;
  }
  return best;
}
