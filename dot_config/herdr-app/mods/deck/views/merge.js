// Merge controls shared by the Command Center band, the issue detail and the PR tab.
// Merge / Merge + ship only when the lock is open; otherwise "Merge anyway",
// which opens the confirm dialog pinned to the head the store shows now.
import { openOverlay } from "herdr";
import { mergeState } from "../lib/proof.js";
import { merge, mergeAndShip } from "../data.js";
import { button, act } from "./ui.js";

/** @param {any} issue */
export function lockOf(issue) {
  return mergeState(issue?.pr ?? null, issue?.ghError ?? null, issue?.claims ?? []);
}

/** @param {any} issue @param {string[]} reasons */
export function openConfirm(issue, reasons) {
  openOverlay({
    mod: "deck",
    props: { view: "confirm", key: issue.key, headSha: issue.pr?.headSha ?? null, reasons },
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
  const busy = Boolean(host.busy);
  const run = (what, fn, failTitle) => (_e, cx) => {
    if (host.busy) return;
    host.busy = what + ":" + issue.key;
    cx.notify();
    act(cx, fn, failTitle, (_r, cx) => {
      host.busy = null;
      cx.notify();
    });
  };
  const out = [];
  if (m.canMerge) {
    out.push(button(idPrefix + "-merge", busy ? "Working…" : "Merge", ship ? "ghost" : "primary", run("merge", () => merge(issue), "Merge failed"), busy));
    if (ship && issue.observed !== false) {
      out.push(button(idPrefix + "-ship", "Merge + ship", "primary", run("ship", () => mergeAndShip(issue), "Merge + ship failed"), busy));
    }
  } else if (m.showAnyway) {
    out.push(button(idPrefix + "-anyway", "Merge anyway", "danger", () => openConfirm(issue, m.reasons), busy || !issue.pr?.headSha));
  }
  return out;
}
