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
