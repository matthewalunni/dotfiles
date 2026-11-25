// Shared Deck UI parts in Earthcode Moss: labels, headings, buttons, rings, chips, panels.
// Colors come only from deckTokens(theme()).
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, notify } from "herdr";
import { deckTokens } from "../lib/tokens.js";
import { reviewOf, REVIEW_LABEL } from "../lib/review.js";

export const SANS = "SF Pro Text";
// Kept so older imports keep working: the condensed display face is retired.
export const BARLOW = SANS;
export const MONO = "JetBrains Mono";

/** The current tokens. */
export const tokens = () => deckTokens(theme());

/** Plain text. (Letter-spaced caps are retired; kept so callers don't change.) */
export const spaced = (s) => String(s);

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
  return { backlog: k.brand, survey: k.muted, build: k.work, verify: k.work, holding: k.hold, landed: k.ok }[stage] ?? k.muted;
}

/** Small quiet section label: sentence case, medium weight. */
export function label(text, color) {
  const k = tokens();
  return div().font_family(SANS).font_weight(500).text_size(12).text_color(color ?? k.muted).child(String(text));
}

/** Heading: sentence case semibold sans, tight leading. */
export function heading(text, size = 18, color) {
  const k = tokens();
  return div()
    .font_family(SANS)
    .font_weight(600)
    .text_size(Math.max(14, size - 4))
    .line_height(1.25)
    .text_color(color ?? k.strong)
    .child(String(text ?? ""));
}

/** A key hint: small rounded tonal cap, no outline. */
export function keyChip(text, border, color) {
  const k = tokens();
  return div()
    .flex_none()
    .px(5)
    .py(1)
    .rounded(5)
    .bg(border ? "#00000026" : k.wash)
    .font_family(MONO)
    .font_weight(400)
    .text_size(10)
    .line_height(1.3)
    .text_color(color ?? k.muted)
    .whitespace_nowrap()
    .child(String(text));
}

/**
 * kind: "primary" (holding amber, dark ink), "brand" (brand fill), "ghost" (brand tint), "danger"
 * (fail tint), "plain" (quiet tonal). Disabled buttons don't click.
 * `key` (optional) shows its shortcut as a hint chip after the label.
 */
export function button(id, text, kind, onClick, disabled = false, key = null) {
  const k = tokens();
  const look = {
    primary: { bg: k.hold, fg: k.holdInk, hover: 0.9 },
    brand: { bg: k.brand, fg: k.holdInk, hover: 0.9 },
    ghost: { bg: k.brandWash, fg: k.brand },
    danger: { bg: k.fail + "26", fg: k.fail },
    plain: { bg: k.wash, fg: k.text },
  }[kind] ?? { bg: k.wash, fg: k.text };
  const solid = look.hover != null;
  let el = div()
    .id(id)
    .flex_none()
    .h(30)
    .px(13)
    .rounded(8)
    .flex()
    .items_center()
    .justify_center()
    .bg(look.bg)
    .font_family(SANS)
    .font_weight(600)
    .text_size(13)
    .text_color(look.fg)
    .whitespace_nowrap()
    .child(String(text))
    .when(Boolean(key), (b) => b.gap(8).child(keyChip(key, solid ? look.fg : null, solid ? look.fg : null)));
  if (disabled) return el.opacity(0.4);
  return el
    .cursor_pointer()
    .hover((s) => (solid ? s.opacity(look.hover) : s.bg(k.raised)))
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
  return div().flex_none().px(8).py(2).rounded(10).bg(bg).text_size(11).text_color(fg).whitespace_nowrap().child(String(text));
}

/** A card's review cost badge: "Unattended" (ok green) or "Needs me" (quiet). */
export function reviewBadge(issue, k = tokens()) {
  const free = reviewOf(issue) === "unattended";
  return div().flex_none().px(7).py(1).rounded(8).bg(free ? k.okBg : k.wash).text_size(11).text_color(free ? k.ok : k.muted)
    .whitespace_nowrap().child(REVIEW_LABEL[reviewOf(issue)]);
}

/** A square or round dot. */
export function dot(color, size = 8, round = false) {
  const d = div().flex_none().w(size).h(size).bg(color);
  return round ? d.rounded(size) : d;
}

/** Rounded surface with a hairline edge. */
export function panel(el) {
  const k = tokens();
  return el.relative().bg(k.panel).rounded(12).border_1().border_color(k.hair).shadow_lg();
}

/** A horizontal segmented bar (telemetry, checks). */
export function segments(colors, h = 8) {
  return h_flex().flex_1().gap(2).children(colors.map((c) => div().flex_1().h(h).rounded(h).bg(c)));
}

// data.js already posts a toast for these.
const QUIET = new Set(["prompt changed", "agent is working"]);
// Errors that say it all: shown as the toast's title.
const PLAIN = new Set(["Agent has a draft — not sent", "Branch moved — review again"]);

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
    if (r && r.ok === false && PLAIN.has(r.error)) notify({ title: r.error, level: "warning" });
    else if (r && r.ok === false && r.error && !QUIET.has(r.error)) notify({ title: failTitle, body: r.error, level: "error" });
    else if (r && r.ok && r.error) notify({ title: r.error, level: "warning" });
    onDone?.(r, cx);
  });
}

/**
 * A gpui KeyEvent as lib/keys.js reads it. Any of cmd / ctrl / alt counts as
 * "cmd": those chords belong to keys.json or to typing, never to a Deck key.
 */
export function keyOf(e) {
  const m = e?.modifiers ?? {};
  // cmd: any of ⌘, ctrl, ⌥ (what Deck's shortcuts stand aside for); alt and mod (⌘ / ctrl alone) tell them apart.
  return {
    key: String(e?.key ?? ""), shift: Boolean(m.shift), cmd: Boolean(m.platform || m.control || m.alt),
    alt: Boolean(m.alt), mod: Boolean(m.platform || m.control), held: Boolean(e?.is_held),
  };
}
