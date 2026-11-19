// The Chat view's roster: agents grouped as Holding · you / Working / Landed. Pure; no herdr imports.
import { liveIssues, issueNote, minutesSince, projectOf } from "./present.js";
import { STAGE_LABEL } from "./stage.js";

/** @typedef {import("./store.js").Issue} Issue */
/** @typedef {{ key: string, name: string, stage: string, note: string, since: number|null, project: string|null }} RosterRow */

export const LANDED_SHOWN = 5;

/** @param {Issue} i @param {string} stage @param {number|null} since */
const row = (i, stage, since) => ({ key: i.key, name: i.id, stage, note: issueNote(i), since, project: projectOf(i) });

/**
 * Holding (longest waiting first; `stage` is the minutes held), Working (everything
 * in flight, idle agents included), Landed (the 5 newest). Empty groups are left out.
 * @param {Issue[]} issues @param {number} now
 * @returns {{ id: "holding"|"working"|"landed", title: string, rows: RosterRow[] }[]}
 */
export function rosterGroups(issues, now) {
  const live = liveIssues(issues);
  const holding = live
    .filter((i) => i.stage === "holding")
    .sort((a, b) => (a.holdingSince ?? 0) - (b.holdingSince ?? 0))
    .map((i) => row(i, `${minutesSince(i.holdingSince, now)}m`, i.holdingSince ?? null));
  const working = live.filter((i) => i.stage !== "holding" && i.stage !== "landed").map((i) => row(i, STAGE_LABEL[i.stage] ?? i.stage, null));
  const landed = live
    .filter((i) => i.stage === "landed")
    .sort((a, b) => (b.landedAt ?? 0) - (a.landedAt ?? 0))
    .slice(0, LANDED_SHOWN)
    .map((i) => row(i, STAGE_LABEL.landed, null));
  return [
    { id: /** @type {const} */ ("holding"), title: "Holding · you", rows: holding },
    { id: /** @type {const} */ ("working"), title: "Working", rows: working },
    { id: /** @type {const} */ ("landed"), title: "Landed", rows: landed },
  ].filter((g) => g.rows.length);
}
