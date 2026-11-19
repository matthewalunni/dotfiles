// The "?" keyboard map, opened as a dialog with props { view: "keys" }:
// three columns (Anywhere / Issues & Command / Pull request), the safety
// note and what stays mouse-only, as on the canvas Keyboard map board. Esc closes it (confirm.js pattern).
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, openOverlay, closeOverlay } from "herdr";
import { BARLOW, MONO, tokens, spaced } from "./ui.js";

const COLS = [
  { title: "Anywhere", tone: "brand", rows: [
    ["⌥⌘1", "Command Center"], ["⌥⌘2", "Issues"], ["⌥⌘3", "Terminal"], ["⌥⌘4", "Chat"],
    ["⌘⇧J", "Next agent holding for you"], ["⌘⇧I", "Issue for this agent"], ["⌘esc", "Back from an issue (also from its thread)"],
    ["⌘[  ⌘]", "Previous / next agent"], ["⌘⇧L", "Switch to main layout"],
  ] },
  { title: "Issues & Command", tone: "hold", rows: [
    ["j  k", "Move down / up"], ["h  l", "Board: column left / right"], ["⇧H ⇧L", "Board: move the card a column"], ["↵", "Open issue"],
    ["/", "Next view filter"], ["V", "List / board"], ["1 – 9", "Answer the agent"],
    ["R", "Type a reply"], ["T", "Open its terminal"], ["esc", "Back / leave reply"],
    ["S", "Backlog: start agent (S again)"], ["X", "Backlog: discard"], ["D", "Remove: dismiss (D) or delete (X)"], ["N", "New task"],
  ] },
  { title: "Pull request", tone: "work", rows: [
    ["⇧1 ⇧2", "Overview / Pull request"], ["n  p", "Next / previous file"],
    ["P", "Request proof (⇧P on the PR tab)"], ["M", "Merge (gate + confirm, M again)"], ["⇧M", "Merge + ship"],
    ["O", "Open on GitHub"],
  ] },
];

const NOTE =
  "Letter keys only work when Deck has focus. In the Terminal view, typing goes to the agent, " +
  "so only ⌘ shortcuts work there. Merge keys open the review gate and confirm; press the same key " +
  "again to go on (↵ in the gate reviews the diff). A key never merges on its own. S on a Backlog card " +
  "opens the start confirm; only a second S starts an agent.";
const MOUSE_ONLY = "Restore and sidebar filters: mouse only. Drag a card to move it on the board.";

/** Opens the keyboard map over the window. */
export function openKeys() {
  openOverlay({ mod: "deck", props: { view: "keys" }, kind: "dialog", width: 1000, height: 600 });
}

export default class KeysView extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  shut() {
    const id = (props() ?? {}).overlay;
    if (id) closeOverlay(id);
  }

  render(_cx) {
    const k = tokens();
    const color = { brand: k.brand, hold: k.hold, work: k.work };
    const column = (c) =>
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(9)
        .child(
          div()
            .pb(6)
            .border_b(1)
            .border_color(k.line)
            .font_family(BARLOW)
            .font_weight(600)
            .text_size(13)
            .text_color(color[c.tone])
            .child(spaced(c.title)),
        )
        .children(
          c.rows.map(([key, what]) =>
            h_flex()
              .items_center()
              .gap(12)
              .child(div().flex_none().min_w(74).px(7).py(2).border_1().border_color(k.line).bg(k.bg).text_color(k.strong).text_center().whitespace_nowrap().child(key))
              .child(div().flex_1().min_w(0).truncate().child(what)),
          ),
        );
    return v_flex()
      .id("deck-keys")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape" && e.key !== "?" && e.key_char !== "?") return;
        cx.stop_propagation();
        this.shut();
      })
      .size_full()
      .min_h(0)
      .px(30)
      .py(26)
      .gap(22)
      .bg(k.panel)
      .font_family(MONO)
      .text_size(12)
      .text_color(k.text)
      .child(
        h_flex()
          .items_baseline()
          .gap(14)
          .child(div().font_family(BARLOW).font_weight(700).text_size(26).text_color(k.strong).child(spaced("Keyboard")))
          .child(div().text_color(k.muted).child("Press ? anywhere in Deck · esc closes")),
      )
      .child(h_flex().flex_none().items_start().gap(26).children(COLS.map(column)))
      .child(div().flex_1())
      .child(
        v_flex()
          .pt(14)
          .gap(6)
          .border_t(1)
          .border_color(k.line)
          .text_color(k.muted)
          .line_height(1.6)
          .child(div().child(NOTE))
          .child(div().child(MOUSE_ONLY)),
      );
  }
}
