// The Chat view's block renderers, by block type (lib/chatregistry.js). Add a
// block type with one registerBlock call; renderBlock draws any block, and an
// unknown type (or a renderer that throws) draws a one-line note instead.
//
// A renderer is (block, cx, ctx) => element; ctx is { k: tokens, host: the
// Chat view } (host.busy, host.run(cx, fn, failTitle), host.canAnswer,
// host.answer(option, cx)).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { createRegistry, BLOCK_TYPES } from "../lib/chatregistry.js";
import { clipDetail, plainHtml } from "../lib/chatview.js";
import { button, dot } from "./ui.js";
import { githubCard, deckCard } from "./chatcards.js";

const note = (k, text) => div().w_full().text_size(11).text_color(k.muted).child(text);

const blocks = createRegistry((type, _block, _cx, ctx) => note(ctx.k, `unknown block: ${String(type)}`));

/** Adds (or replaces) the renderer for `type`. */
export function registerBlock(type, render) {
  blocks.register(type, render);
}

/** The registered block types. */
export function blockKinds() {
  return blocks.kinds();
}

/** Draws one block through its renderer. @param {any} block @param {any} cx @param {{k: any, host: any}} ctx */
export function renderBlock(block, cx, ctx) {
  try {
    return blocks.run(block?.type, block, cx, ctx);
  } catch (e) {
    return note(ctx.k, `could not draw a ${String(block?.type)} block: ${String(e?.message ?? e)}`);
  }
}

/**
 * User: a bubble on the right. Agent: on the left, under a CHAT label, as markdown.
 * Both are selectable TextViews (plain div text cannot be selected or copied).
 */
function text(block, _cx, { k }) {
  if (block.role === "user") {
    return h_flex()
      .w_full()
      .justify_end()
      .child(div().max_w(520).px(14).py(10).bg(k.raised).rounded(14).text_color(k.strong).line_height(1.5).child(TextView.html(`chat-${block.id}`, plainHtml(block.text)).selectable(true)));
  }
  return v_flex()
    .w_full()
    .gap(8)
    .child(
      h_flex()
        .items_center()
        .gap(8)
        .child(dot(k.brand, 7, true))
        .child(div().font_weight(600).text_size(12).text_color(k.muted).child("Chat")),
    )
    .child(div().w_full().text_color(k.text).line_height(1.6).child(TextView.markdown(`chat-${block.id}`, String(block.text ?? "")).selectable(true)));
}

/** What the agent did: check, verb, target, a muted detail (cut to ~120 characters). */
function action(block, _cx, { k }) {
  return h_flex()
    .w_full()
    .items_center()
    .gap(10)
    .px(12)
    .py(8)
    .bg(k.wash)
    .rounded(8)
    .text_size(12)
    .child(svg("mods/deck/icons/check.svg").flex_none().w(14).h(14).text_color(k.ok))
    .child(div().flex_none().text_color(k.ok).child(String(block.verb ?? "")))
    .when(Boolean(block.target), (el) => el.child(div().flex_none().text_color(k.strong).child(String(block.target))))
    .when(Boolean(block.detail), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(k.muted).child(clipDetail(block.detail))));
}

/** A thin centered rule: "context compacted" / "context cleared". */
function divider(block, _cx, { k }) {
  const rule = () => div().flex_1().h(1).bg(k.hair);
  return h_flex()
    .w_full()
    .items_center()
    .gap(12)
    .child(rule())
    .child(div().flex_none().text_size(11).text_color(k.muted).child(block.kind === "cleared" ? "context cleared" : "context compacted"))
    .child(rule());
}

/**
 * The chat agent's pending permission prompt (lib/chatview.js approvalFrom).
 * Approve / Skip are off while the chat pane has the keyboard.
 */
function approval(block, _cx, { k, host }) {
  const off = !host.canAnswer;
  return v_flex()
    .w_full()
    .gap(10)
    .p(14)
    .bg(k.holdWash)
    .rounded(12)
    .child(div().font_weight(700).text_color(k.strong).child(block.title))
    .when(Boolean(block.subtitle), (el) => el.child(div().text_color(k.muted).line_height(1.5).child(clipDetail(block.subtitle, 300))))
    .child(
      h_flex()
        .items_center()
        .gap(8)
        .child(button("chat-approve", "Approve", "primary", (_e, cx) => host.answer(block.approve, cx), off, "⏎"))
        .when(Boolean(block.skip), (el) => el.child(button("chat-skip", "Skip", "plain", (_e, cx) => host.answer(block.skip, cx), off, "esc")))
        .when(host.focusedPane, (el) => el.child(div().text_size(11).text_color(k.muted).child("off while the chat pane has the keyboard"))),
    );
}

// One renderer per BLOCK_TYPES entry (registerBlock throws on a missing one, so the two cannot drift).
const BUILT_IN = { text, action, divider, approval, github: githubCard, deck: deckCard };
for (const type of BLOCK_TYPES) registerBlock(type, BUILT_IN[type]);
