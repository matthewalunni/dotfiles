// In-place title and brief editors (lib/inlineedit.js decides; this draws).
// A host view calls initInlineEdit in init, then editable(...) where it draws
// the text: shown as plain text with a hover hint (text cursor, underline)
// until clicked (or double-clicked on a board card), then as an input with the
// cursor at its end. Enter / ⌘↵ / click-away save through data.js editCard;
// esc puts the old text back.
import { div } from "gpui-kit";
import { InputState, Input, TextareaState, Textarea } from "gpui-base";
import { notify } from "herdr";
import { beginEdit, editKey, finishEdit } from "../lib/inlineedit.js";
import { editCard, currentStore } from "../data.js";
import { keyOf } from "./ui.js";

/** Sets up `host` to edit in place. `onTyping(bool)` says when an editor has the keyboard. */
export function initInlineEdit(host, onTyping) {
  host.inline = null; // EditState while an editor is open
  host.inlineTitle = InputState.new({ placeholder: "Title" });
  host.inlineBrief = TextareaState.new({ placeholder: "What the agent should do", rows: 4 });
  host.inlineBrief.set_soft_wrap(true);
  host.inlineBrief.set_auto_grow(3, 14);
  host.inlineTyping = onTyping ?? (() => {});
  for (const [state, field] of [[host.inlineTitle, "title"], [host.inlineBrief, "brief"]]) {
    // Enter (title) or ⌘↵ (brief) reaching the input.
    state.on("submit", (e, cx) => {
      if (host.inline?.field !== field) return;
      if (field === "brief" && !e?.secondary) return;
      endInlineEdit(host, "save", cx);
    });
    state.on("focus", () => host.inlineTyping(true));
    // Clicking away saves.
    state.on("blur", (_e, cx) => {
      host.inlineTyping(false);
      if (host.inline?.field === field) endInlineEdit(host, "blur", cx);
    });
  }
}

const stateFor = (host, field) => (field === "title" ? host.inlineTitle : host.inlineBrief);

/** Opens the editor on `field` of `issue`, its text in place and the cursor at its end. */
export function startInlineEdit(host, issue, field, cx) {
  if (host.inline) endInlineEdit(host, "blur", cx);
  const st = beginEdit(issue, field);
  if (!st) return;
  host.inline = st;
  const input = stateFor(host, field);
  input.set_value(st.original);
  const end = st.original.length;
  input.set_selected_range({ start: end, end });
  input.focus();
  cx?.notify?.();
}

/**
 * Closes the open editor: "save" / "blur" store the text (when it changed),
 * "cancel" drops it. Runs once: the blur that follows esc finds nothing open.
 */
export function endInlineEdit(host, how, cx) {
  const st = host.inline;
  if (!st) return;
  host.inline = null;
  const input = stateFor(host, st.field);
  const r = finishEdit(st, how, input.value());
  if (r.restore != null) input.set_value(r.restore);
  if (r.edit) {
    const issue = currentStore().issues.find((i) => i.key === st.key);
    const res = issue ? editCard(issue, r.edit, "you") : { ok: false, message: "the card is no longer on the board" };
    if (!res.ok) notify({ title: "Could not save: " + res.message, level: "warning" });
  }
  host.onInlineDone?.(cx);
  cx?.notify?.();
}

/** Whether `host` is editing `field` of `issue` right now. */
export const editingNow = (host, issue, field) => host.inline?.key === issue?.key && host.inline?.field === field;

/**
 * The editor while it is open, else `shown` (the text as drawn) with the hover
 * hint and the gesture that opens it ("click", or "dblclick" on a board card).
 * `style(el)` styles the open editor's frame.
 */
export function editable(host, issue, field, shown, k, opts = {}) {
  if (editingNow(host, issue, field)) {
    const input = stateFor(host, field);
    const el = field === "title" ? Input.new(input) : Textarea.new(input);
    return div()
      .id(`edit-${field}-${issue.key}`)
      .w_full()
      .px(field === "title" ? 8 : 12)
      .py(field === "title" ? 4 : 10)
      .rounded(8)
      .border_1()
      .border_color(k.brand)
      .bg(k.bg)
      .cursor_text()
      // Keys the editor names stop here; every other key is text, never a Deck shortcut.
      .on_key_down((e, cx) => {
        cx.stop_propagation();
        const a = editKey(keyOf(e), field);
        if (a) endInlineEdit(host, a, cx);
      })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.stop_propagation())
      .child((opts.style ? opts.style(el) : el).w_full());
  }
  const open = (cx) => startInlineEdit(host, issue, field, cx);
  let el = shown.id(`editable-${field}-${issue.key}`).cursor_text().hover((s) => s.underline());
  if (opts.gesture === "dblclick") {
    // A single click still opens the card; the second click of a double-click edits.
    return el.on_mouse_down("left", (e, cx) => {
      if (e.click_count === 2) {
        cx.stop_propagation();
        open(cx);
      }
    });
  }
  return el.on_click((_e, cx) => {
    cx.stop_propagation();
    open(cx);
  });
}
