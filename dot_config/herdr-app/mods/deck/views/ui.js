// Shared Deck UI parts in Earthcode Moss: labels, headings, buttons, rings, chips, panels.
// Colors come only from deckTokens(theme()).
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, notify } from "herdr";
import { deckTokens } from "../lib/tokens.js";

export const BARLOW = "Barlow Condensed";
export const MONO = "JetBrains Mono";

/** The current tokens. */
export const tokens = () => deckTokens(theme());

/** Letter-spaced uppercase: a hair space between letters (gpui has no tracking). */
export const spaced = (s) => [...String(s).toUpperCase()].join(" ");

/** Tone name (lib/present.js) -> color. */
export function tone(name, k = tokens()) {
  switch (name) {
    case "work": return k.work;
    case "ok": return k.ok;
    case "fail": return k.fail;
    case "nodata": return k.nodata;
    case "hold": return k.hold;
    case "brand": return k.brand;
    case "muted": return k.muted;
    case "strong": return k.strong;
    case "off": return k.line;
    default: return k.text;
  }
}

/** Stage -> color. */
export function stageColor(stage, k = tokens()) {
  return { survey: k.muted, build: k.work, verify: k.work, holding: k.hold, landed: k.ok }[stage] ?? k.muted;
}

/** Small uppercase letter-spaced label (Barlow 13). */
export function label(text, color) {
  const k = tokens();
  return div().font_family(BARLOW).font_weight(600).text_size(13).text_color(color ?? k.muted).child(spaced(text));
}

/** Barlow heading, uppercase. Large sizes are not letter-spaced (the mocks use .05em). */
export function heading(text, size = 18, color) {
  const k = tokens();
  const s = String(text ?? "");
  return div()
    .font_family(BARLOW)
    .font_weight(600)
    .text_size(size)
    .line_height(1.1)
    .text_color(color ?? k.strong)
    .child(size >= 22 ? s.toUpperCase() : spaced(s));
}

/**
 * kind: "primary" (holding amber, black ink), "ghost" (brand outline), "danger"
 * (fail outline), "plain" (line outline). Disabled buttons don't click.
 */
export function button(id, text, kind, onClick, disabled = false) {
  const k = tokens();
  const look = {
    primary: { bg: k.hold, fg: k.holdInk, border: k.hold },
    ghost: { bg: null, fg: k.brand, border: k.brand },
    danger: { bg: null, fg: k.fail, border: k.fail },
    plain: { bg: null, fg: k.text, border: k.line },
  }[kind] ?? { bg: null, fg: k.text, border: k.line };
  let el = div()
    .id(id)
    .flex_none()
    .h(32)
    .px(14)
    .flex()
    .items_center()
    .justify_center()
    .border_1()
    .border_color(look.border)
    .font_family(BARLOW)
    .font_weight(700)
    .text_size(14)
    .text_color(look.fg)
    .whitespace_nowrap()
    .child(spaced(text));
  if (look.bg) el = el.bg(look.bg);
  if (disabled) return el.opacity(0.4);
  return el
    .cursor_pointer()
    .hover((s) => (look.bg ? s.opacity(0.88) : s.bg(k.raised)))
    .on_click((e, cx) => {
      cx.stop_propagation();
      onClick(e, cx);
    });
}

const RINGS = [0, 15, 50, 75, 100];

/** Stage ring: an outlined circle filled to pct (survey 15, build 50, verify 75, holding/landed 100). */
export function ring(color, pct, size = 12) {
  const p = RINGS.reduce((best, r) => (Math.abs(r - pct) < Math.abs(best - pct) ? r : best), 0);
  return svg(`mods/deck/icons/ring-${p}.svg`).flex_none().w(size).h(size).text_color(color);
}

/** A small filled chip. */
export function chip(text, fg, bg) {
  return div().flex_none().px(7).py(1).bg(bg).text_size(11).text_color(fg).whitespace_nowrap().child(String(text));
}

/** A square or round dot. */
export function dot(color, size = 8, round = false) {
  const d = div().flex_none().w(size).h(size).bg(color);
  return round ? d.rounded(size) : d;
}

/** Panel with the Command Center's brand corner brackets (top-left, bottom-right). */
export function panel(el) {
  const k = tokens();
  const corner = (top) =>
    div()
      .absolute()
      .w(10)
      .h(10)
      .border_color(k.brand)
      .when(top, (d) => d.top(-1).left(-1).border_t(2).border_l(2))
      .when(!top, (d) => d.bottom(-1).right(-1).border_b(2).border_r(2));
  return el.relative().bg(k.panel).border_1().border_color(k.line).child(corner(true)).child(corner(false));
}

/** A horizontal segmented bar (telemetry, checks). */
export function segments(colors, h = 8) {
  return h_flex().flex_1().gap(2).children(colors.map((c) => div().flex_1().h(h).bg(c)));
}

// data.js already posts a toast for these.
const QUIET = new Set(["prompt changed", "agent is working"]);

/**
 * Runs an async action (one of data.js's) from a click; a failure shows as a toast.
 * `onDone(result, cx)` runs after, with a task cx (e.g. to clear a busy flag).
 */
export function act(cx, fn, failTitle, onDone) {
  cx.spawn(async (cx) => {
    let r;
    try {
      r = await fn();
    } catch (e) {
      r = { ok: false, error: String(e?.message ?? e) };
    }
    if (r && r.ok === false && r.error && !QUIET.has(r.error)) notify({ title: failTitle, body: r.error, level: "error" });
    else if (r && r.ok && r.error) notify({ title: r.error, level: "warning" });
    onDone?.(r, cx);
  });
}
