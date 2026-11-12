// The top bar: brand, Command / Issues / Terminal nav, the holding chip and the clock.
// The collector runs in this copy; main.js starts and stops it (close() only
// reaches the root view).
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, theme, agents } from "herdr";
import { deckTokens } from "../lib/tokens.js";
import { showView, focusTerminal, currentStore, VIEW_KEY } from "../data.js";
import { nextHolding } from "../lib/board.js";

const BARLOW = "Barlow Condensed";
const MONO = "JetBrains Mono";
const NAV = [
  { label: "COMMAND", key: "⌥⌘1", child: "deck-command" },
  { label: "ISSUES", key: "⌥⌘2", child: "deck-issues" },
  { label: "TERMINAL", key: "⌥⌘3", child: "deck-terminal" },
];
// macOS draws the traffic lights over the bar's left edge.
const LEFT_ROOM = 84;

/** Letter-spaced uppercase: a hair space between letters (no tracking in gpui). */
const spaced = (s) => [...s.toUpperCase()].join(" ");

const pad2 = (n) => String(n).padStart(2, "0");

/** A press on a control inside the window_drag bar belongs to the control. */
const own = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

/** "N holding · next <ID>  ⌘⇧J": opens that agent in the Terminal view. "0 holding" muted. */
function holdingChip(k, holding, next) {
  const base = h_flex()
    .id("deck-holding")
    .items_center()
    .gap(8)
    .px(8)
    .py(2)
    .rounded(4)
    .border_1()
    .font_family(MONO)
    .text_size(11);
  if (!holding || !next) {
    return base.border_color(k.line).text_color(k.muted).child(`${holding} holding`);
  }
  return own(
    base
      .border_color(k.hold)
      .bg(k.holdBg)
      .font_weight(600)
      .text_color(k.hold)
      .cursor_pointer()
      .hover((s) => s.opacity(0.85))
      .on_click(() => focusTerminal(next))
      .child(div().flex_none().w(6).h(6).rounded(6).bg(k.hold))
      .child(`${holding} holding · next ${next.id}`)
      .child(div().font_weight(400).text_size(10).text_color(k.muted).child("⌘⇧J")),
  );
}

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
    // A stale or unknown view (e.g. "deck-work" from v1) counts as Command.
    const stored = shared(VIEW_KEY);
    const active = NAV.some((n) => n.child === stored) ? stored : "deck-command";
    const issues = currentStore().issues;
    const holding = issues.filter((i) => i.stage === "holding" && !i.dismissed).length;
    // "next" is the holding issue after the focused agent's (wrapping).
    const focusedTerm = (agents() ?? []).find((a) => a.focused)?.address ?? null;
    const currentKey = issues.find((i) => i.terminal === focusedTerm && i.observed !== false)?.key ?? null;
    const next = nextHolding(issues, currentKey);
    const now = new Date();
    const clock = pad2(now.getHours()) + ":" + pad2(now.getMinutes());

    const nav = NAV.map(({ label, key, child }) => {
      const on = active === child;
      return own(
        div()
          .id("deck-nav-" + child)
          .h_full()
          .flex()
          .items_center()
          .gap(6)
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
          .child(spaced(label))
          .child(div().font_family(MONO).font_weight(400).text_size(10).text_color(k.muted).child(key)),
      );
    });

    const right = h_flex()
      .items_center()
      .gap(12)
      .child(holdingChip(k, holding, next))
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
