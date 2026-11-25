// Terminal view sidebar footer: the keys that move between agents and views.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { tokens } from "./ui.js";

// Three short lines: the 268 px sidebar truncates anything longer.
const LINES = [
  "⌘1–9 ⌘[ ⌘] agent · ⌘⇧J holding",
  "⌘⇧I this issue · ⌥⌘1–4 views",
  "⌘⇧L main layout",
];

export default class TermHintsView extends View {
  init() {}

  render() {
    const k = tokens();
    return v_flex()
      .size_full()
      .bg(k.chrome)
      .border_t(1)
      .border_color(k.line)
      .px(16)
      .justify_center()
      .text_size(10.5)
      .line_height(1.3)
      .text_color(k.muted)
      .children(LINES.map((l) => div().truncate().child(l)));
  }
}
