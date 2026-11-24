// Editing a card's title or brief in place (the issue page, a board card's
// double-click). Click the text and it becomes an input; Enter (title) or
// ⌘↵ (brief) saves, so does clicking away (blur); esc cancels and puts the old
// text back. Saving goes through the same edit as `herdr-board edit`
// (boardops.js planEdit, then store.js editIssue). Pure; no herdr imports.
//
// A started card's brief: editing it does NOT tell the running agent. The
// brief on the card is Deck's record of the task (what the board, the page
// and `herdr-board` show); the agent got its brief when it started and may be
// mid-step, so typing into its terminal unasked could land in the middle of a
// prompt or a tool call. To tell the agent, reply (R) or type into its thread
// (T). The page says so under the brief while it is being edited.

/** @typedef {"title"|"brief"} EditField */
/** @typedef {{ key: string, field: EditField, original: string }} EditState */

/**
 * Starts editing `field` of `issue`: what to remember so esc can put it back.
 * null when there is no card or the field is not one we edit.
 * @param {any} issue @param {string} field @returns {EditState|null}
 */
export function beginEdit(issue, field) {
  if (!issue?.key || (field !== "title" && field !== "brief")) return null;
  const original = String((field === "title" ? issue.title : issue.brief) ?? "");
  return { key: issue.key, field, original };
}

/**
 * What a key does inside the editor: "save", "cancel" or null (text for the
 * input). Title: Enter saves. Brief: ⌘↵ saves, a plain Enter is a newline.
 * A held (repeating) key never saves.
 * @param {{key: string, shift?: boolean, mod?: boolean, cmd?: boolean, held?: boolean}} ev @param {EditField} field
 * @returns {"save"|"cancel"|null}
 */
export function editKey(ev, field) {
  const k = String(ev?.key ?? "").toLowerCase();
  if (k === "escape") return "cancel";
  if (k !== "enter" || ev?.held) return null;
  if (field === "title") return ev?.shift ? null : "save";
  return ev?.mod ? "save" : null;
}

/**
 * Ends an edit. `how` is "save" (Enter / ⌘↵), "blur" (clicked away: saves
 * too) or "cancel" (esc). Returns the edit to apply (the same shape as
 * `herdr-board edit`: {title} or {brief}), or null when nothing changes, and
 * `restore`: the text the field shows again (the original on cancel, an empty
 * title, or no change).
 * @param {EditState|null} state @param {"save"|"blur"|"cancel"} how @param {string} text
 * @returns {{ edit: {title?: string, brief?: string}|null, restore: string|null }}
 */
export function finishEdit(state, how, text) {
  if (!state) return { edit: null, restore: null };
  if (how === "cancel") return { edit: null, restore: state.original };
  const value = String(text ?? "");
  if (state.field === "title") {
    const t = value.trim();
    // An empty title is never saved (planEdit refuses it too): the old one comes back.
    if (!t || t === state.original.trim()) return { edit: null, restore: state.original };
    return { edit: { title: t }, restore: null };
  }
  if (value === state.original) return { edit: null, restore: state.original };
  return { edit: { brief: value }, restore: null };
}
