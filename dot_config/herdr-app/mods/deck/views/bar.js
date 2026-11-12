// The top bar: brand, Command / Issues nav, clock and the "need you" chip.
// The collector runs in this copy; main.js starts and stops it (close() only
// reaches the root view).
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, theme } from "herdr";
import { deckTokens } from "../lib/tokens.js";
import { showView, currentStore, VIEW_KEY } from "../data.js";

const BARLOW = "Barlow Condensed";
const MONO = "JetBrains Mono";
const NAV = [
  { label: "COMMAND", child: "deck-command" },
  { label: "ISSUES", child: "deck-issues" },
];
// macOS draws the traffic lights over the bar's left edge.
const LEFT_ROOM = 84;

/** Letter-spaced uppercase: a hair space between letters (no tracking in gpui). */
const spaced = (s) => [...s.toUpperCase()].join(" ");

const pad2 = (n) => String(n).padStart(2, "0");

/** A press on a control inside the window_drag bar belongs to the control. */
const own = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

export default class BarView extends View {
  init(_p, cx) {
    // Redraw on the minute, then every minute.
    const now = new Date();
    const toMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50;
    cx.timer.after(toMinute, (cx) => {
      cx.notify();
      cx.timer.every(60_000, (cx) => cx.notify());
    });
  }

  render(cx) {
    const k = deckTokens(theme());
    const active = shared(VIEW_KEY) ?? "deck-command";
    const holding = currentStore().issues.filter((i) => i.stage === "holding").length;
    const now = new Date();
    const clock = pad2(now.getHours()) + ":" + pad2(now.getMinutes());

    const nav = NAV.map(({ label, child }) => {
      const on = active === child;
      return own(
        div()
          .id("deck-nav-" + child)
          .h_full()
          .flex()
          .items_center()
          .px(10)
          .border_b(2)
          .border_color(on ? k.brand : k.chrome)
          .cursor_pointer()
          .font_family(BARLOW)
          .font_weight(600)
          .text_size(14)
          .text_color(on ? k.strong : k.muted)
          .hover((s) => s.text_color(k.strong))
          .on_click(() => showView(child))
          .child(spaced(label)),
      );
    });

    const right = h_flex()
      .items_center()
      .gap(12)
      .when(holding > 0, (el) =>
        el.child(
          div()
            .px(8)
            .py(2)
            .rounded(4)
            .border_1()
            .border_color(k.hold)
            .bg(k.holdBg)
            .font_family(MONO)
            .text_size(11)
            .font_weight(600)
            .text_color(k.hold)
            .child(`${holding} NEED YOU`),
        ),
      )
      .child(div().font_family(MONO).text_size(12).text_color(k.muted).child(clock));

    return h_flex()
      .size_full()
      .bg(k.chrome)
      .border_b(1)
      .border_color(k.line)
      .pl(LEFT_ROOM)
      .pr(16)
      .items_center()
      .justify_between()
      .child(
        h_flex()
          .h_full()
          .items_center()
          .gap(22)
          .child(
            div()
              .font_family(BARLOW)
              .font_weight(700)
              .text_size(16)
              .text_color(k.brand)
              .child(spaced("HERDR // DECK")),
          )
          .child(h_flex().h_full().items_center().gap(4).children(nav)),
      )
      .child(right);
  }
}
