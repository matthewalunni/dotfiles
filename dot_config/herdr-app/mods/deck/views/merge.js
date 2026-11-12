// Merge controls shared by the Command Center band, the issue detail and the PR tab.
// Merge / Merge + ship only when the lock is open; otherwise "Merge anyway",
// which opens the confirm dialog pinned to the head the store shows now.
// Every merge is pinned to the head shown on screen (issue.pr.headSha).
import { openOverlay } from "herdr";
import { mergeState } from "../lib/proof.js";
import { needsReviewGate } from "../lib/github.js";
import { merge, mergeAndShip } from "../data.js";
import { button, act } from "./ui.js";

/** @param {any} issue */
export function lockOf(issue) {
  return mergeState(issue?.pr ?? null, issue?.ghError ?? null, issue?.claims ?? []);
}

/**
 * The dialog lists what is missing from the live lock state when it draws.
 * `next` "anyway" (default) is Merge anyway; "merge" / "ship" is the plain
 * confirm the M / ⇧M keys open (a key never merges on its own).
 * @param {any} issue @param {string|null} [headSha] the head shown (default: issue.pr.headSha)
 * @param {"anyway"|"merge"|"ship"} [next]
 */
export function openConfirm(issue, headSha = issue.pr?.headSha ?? null, next = "anyway") {
  openOverlay({
    mod: "deck",
    props: { view: "confirm", key: issue.key, headSha, next },
    kind: "dialog",
    width: 460,
  });
}

/** Review soft gate (views/review.js), then `next` if the person goes on. */
function openReviewGate(issue, next) {
  openOverlay({
    mod: "deck",
    props: { view: "review", key: issue.key, headSha: issue.pr?.headSha ?? null, next },
    kind: "dialog",
    width: 460,
  });
}

/**
 * Buttons for `issue`. `host` is the view: `host.busy` (a key while an action
 * runs) disables them. `ship` adds Merge + ship (needs a live terminal).
 * @returns {any[]}
 */
export function mergeButtons(host, issue, idPrefix, { ship = true } = {}) {
  const m = lockOf(issue);
  const shown = issue.pr?.headSha ?? null;
  const busy = Boolean(host.busy);
  const gated = needsReviewGate(issue);
  const run = (what, fn, failTitle) => (_e, cx) => {
    if (host.busy) return;
    if (gated) {
      openReviewGate(issue, what);
      return;
    }
    host.busy = what + ":" + issue.key;
    cx.notify();
    act(cx, fn, failTitle, (_r, cx) => {
      host.busy = null;
      cx.notify();
    });
  };
  const out = [];
  if (m.canMerge) {
    out.push(button(idPrefix + "-merge", busy ? "Working…" : "Merge", ship ? "ghost" : "primary", run("merge", () => merge(issue, shown), "Merge failed"), busy, "M"));
    if (ship && issue.observed !== false) {
      out.push(button(idPrefix + "-ship", "Merge + ship", "primary", run("ship", () => mergeAndShip(issue, shown), "Merge + ship failed"), busy, "⇧M"));
    }
  } else if (m.showAnyway) {
    out.push(button(idPrefix + "-anyway", "Merge anyway", "danger", () => (gated ? openReviewGate(issue, "anyway") : openConfirm(issue)), busy || !issue.pr?.headSha, "M"));
  }
  return out;
}

/**
 * M / ⇧M: the buttons' path, except that where a click would merge at once
 * the key opens the confirm first. Only offers what a button on screen offers
 * (⇧M needs Merge + ship). Returns whether a dialog opened.
 * @param {any} host @param {any} issue @param {boolean} ship
 */
export function mergeKey(host, issue, ship) {
  if (!issue?.pr || host.busy) return false;
  const m = lockOf(issue);
  const gated = needsReviewGate(issue);
  if (m.canMerge) {
    if (ship && issue.observed === false) return false;
    const next = ship ? "ship" : "merge";
    if (gated) openReviewGate(issue, next);
    else openConfirm(issue, issue.pr.headSha ?? null, next);
    return true;
  }
  if (ship || !m.showAnyway || !issue.pr.headSha) return false;
  if (gated) openReviewGate(issue, "anyway");
  else openConfirm(issue);
  return true;
}
