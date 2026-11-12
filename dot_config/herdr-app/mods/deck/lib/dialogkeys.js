// Which key does what in the merge dialogs. Pure; no herdr imports.
// A dialog is finished by pressing the key that opened it again (M, or ⇧M for
// Merge + ship), so one stray letter never merges. A held (repeating) key never
// counts. Enter does nothing in a confirm; in the review gate it is Review diff.
// The backlog start confirm ({kind: "start"}) is the same pattern: S again starts.

/**
 * @param {{key: string, shift: boolean, cmd: boolean, held?: boolean}} ev
 * @param {{kind: "confirm"|"review"|"start", next?: "merge"|"ship"|"anyway"}|null} dialog
 * @returns {"confirm"|"review"|"proceed"|"cancel"|null}
 */
export function dialogKey(ev, dialog) {
  if (!dialog || ev?.cmd || ev?.held) return null;
  const k = String(ev?.key ?? "").toLowerCase();
  if (k === "escape") return dialog.kind === "confirm" || dialog.kind === "review" || dialog.kind === "start" ? "cancel" : null;
  if (dialog.kind === "start") return k === "s" ? "confirm" : null;
  const ship = (dialog.next ?? "anyway") === "ship";
  const same = k === "m" && Boolean(ev.shift) === ship;
  if (dialog.kind === "confirm") return same ? "confirm" : null;
  if (dialog.kind === "review") {
    if (k === "enter") return "review";
    return same ? "proceed" : null;
  }
  return null;
}

/** The key chip for the button that finishes a dialog opened for `next`. */
export const confirmKeyLabel = (next) => (next === "ship" ? "⇧M" : "M");

/** Whether a merge dialog (review gate or confirm) may open for `issue`: never for a backlog entry. */
export function mergeDialogAllowed(issue) {
  return Boolean(issue && issue.kind !== "backlog" && issue.pr);
}
