// Merge controls shared by the Command Center band, the issue detail and the PR tab.
// Merge / Merge + ship only when the lock is open; otherwise "Merge anyway",
// which opens the confirm dialog pinned to the head the store shows now.
// Every merge is pinned to the head shown on screen (issue.pr.headSha).
import { openOverlay } from "herdr";
import { mergeState } from "../lib/proof.js";
import { needsReviewGate } from "../lib/github.js";
import { mergeDialogAllowed } from "../lib/dialogkeys.js";
import { merge, mergeAndShip } from "../data.js";
import { button, act } from "./ui.js";

// issue key -> { id, beat } for its open merge dialog (globalThis: every copy).
// Herdr has no overlay list, and Esc or a click beside a dialog closes it
// without telling us, so an open dialog proves itself with a heartbeat
// (dialogBeat, every second from its own timer, which stops when it closes).
const dialogs = () => (globalThis.__deckMergeDialogs ??= new Map());
const BEAT_STALE_MS = 2500;

/** Records the dialog `id` opened for `issue` (merge dialogs here; the backlog start confirm too). */
export function remember(issue, id) {
  if (typeof id === "string" && id) dialogs().set(issue.key, { id, beat: Date.now() });
}

/** From confirm.js / review.js: init and every second while open. */
export function dialogBeat(key, id) {
  const d = dialogs().get(key);
  if (d && d.id === id) d.beat = Date.now();
}

/** From confirm.js / review.js when they close themselves. */
export function forgetDialog(key, id) {
  if (dialogs().get(key)?.id === id) dialogs().delete(key);
}

/** Whether a dialog for `issue` is still open (its heartbeat is fresh). */
export function dialogOpen(issue) {
  const d = dialogs().get(issue.key);
  if (!d) return false;
  if (Date.now() - d.beat < BEAT_STALE_MS) return true;
  dialogs().delete(issue.key);
  return false;
}

/** Whether any Deck dialog (a merge confirm, the review gate, the start confirm, New task) is open. */
export function anyDialogOpen() {
  for (const [key, d] of dialogs()) {
    if (Date.now() - d.beat < BEAT_STALE_MS) return true;
    dialogs().delete(key);
  }
  return false;
}

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
  if (!mergeDialogAllowed(issue)) return; // never for a backlog entry
  remember(issue, openOverlay({
    mod: "deck",
    props: { view: "confirm", key: issue.key, headSha, next },
    kind: "dialog",
    width: 460,
  }));
}

/** Review soft gate (views/review.js), then `next` if the person goes on. */
function openReviewGate(issue, next) {
  if (!mergeDialogAllowed(issue)) return; // never for a backlog entry
  remember(issue, openOverlay({
    mod: "deck",
    props: { view: "review", key: issue.key, headSha: issue.pr?.headSha ?? null, next },
    kind: "dialog",
    width: 460,
  }));
}

/**
 * Buttons for `issue`. `host` is the view: `host.busy` (a key while an action
 * runs) disables them. `ship` adds Merge + ship (needs a live terminal).
 * @returns {any[]}
 */
export function mergeButtons(host, issue, idPrefix, { ship = true } = {}) {
  if (issue?.kind === "backlog") return [];
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
 * the key opens the confirm first; the same key again confirms (lib/dialogkeys.js). Only offers what a button on screen offers
 * (⇧M needs Merge + ship). Returns whether a dialog opened.
 * @param {any} host @param {any} issue @param {boolean} ship
 */
export function mergeKey(host, issue, ship) {
  if (!mergeDialogAllowed(issue) || host.busy) return false;
  // One merge dialog per issue: a second M while one is up does nothing.
  if (dialogOpen(issue)) return false;
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
