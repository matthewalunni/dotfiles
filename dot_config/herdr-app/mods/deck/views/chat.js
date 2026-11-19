// The Chat view (stack child deck-chat): one continuous conversation with the
// chat agent in a 700 px centered column, the composer under it and the agent
// roster (views/chatroster.js) on the right. No status strip.
//
// Blocks come from the shared chat log (chat.js tails the agent's transcript);
// each agent message is followed by the deck / GitHub cards for what it
// mentions. The approval card is not in the transcript: it is the permission
// prompt on the chat pane's screen, read every 1.5 s while this view is shown,
// and answered (Approve / Skip) only while the chat pane does not have the
// keyboard. A trust modal (status unknown) is never answered from here.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { shared, terminals, agents } from "herdr";
import { shownChild } from "../lib/views.js";
import { reviveChatLog } from "../lib/chat.js";
import { chatAgent, nullSince, trustWaiting, approvalFrom, wheelAway, recentBlocks, attachCards, chatViewKey } from "../lib/chatview.js";
import { currentStore, STORE_KEY, VIEW_KEY } from "../data.js";
import { CHAT_KEY, chatPrompt, answerChat, ensureChat } from "../chat.js";
import { MONO, tokens, button, act, keyOf } from "./ui.js";
import { renderBlock } from "./chatblocks.js";
import { prsWanted, fetchPrs } from "./chatcards.js";
import { Composer } from "./chatcomposer.js";
import ChatRoster from "./chatroster.js";
import { openKeys } from "./keys.js";
import { registerFocus, focusOnShow, keepFresh, drew } from "./focus.js";

const CHILD = "deck-chat";
const POLL_MS = 1500;
const FRESH_MS = 250;
// Drawn at most; older blocks stay in the log and the archive.
const MAX_BLOCKS = 200;
const COLUMN = 700;

const isShown = () => shownChild(shared("layout"), shared(VIEW_KEY)) === CHILD;
const logLength = () => shared(CHAT_KEY)?.blocks?.length ?? 0;

export default class ChatView extends View {
  init(p, cx) {
    keepFresh(this, cx, CHILD);
    this.handle = cx.focus_handle();
    registerFocus(CHILD, this.handle);
    this.scroll = ScrollHandle.new();
    this.roster = cx.new(ChatRoster, p);
    this.composer = new Composer(this);
    this.busy = null; // a deck card's action in flight
    this.answering = false;
    this.prompt = null; // the chat pane's prompt at the last poll
    this.polling = false;
    this.approval = null;
    this.canAnswer = false;
    this.focusedPane = false;
    this.nullAt = null; // since when the chat agent's status is unknown
    this.away = 0; // how far the wheel took the transcript above its bottom (0: follow)
    this.drawnRows = null;
    this.drawnLog = 0;
    this.starting = false;
    this.startErr = null;
    cx.timer.every(POLL_MS, (cx) => {
      if (isShown()) this.poll(cx);
    });
    // The chat log is not in keepFresh's fingerprint: redraw when it grows.
    cx.timer.every(FRESH_MS, (cx) => {
      if (isShown() && logLength() !== this.drawnLog) cx.notify();
    });
  }

  /** Reads the chat pane's prompt (only while it is blocked) for the approval card. */
  poll(cx) {
    if (this.polling) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        const r = await chatPrompt();
        this.prompt = r?.prompt ?? null;
      } catch {
        this.prompt = null;
      } finally {
        this.polling = false;
        cx.notify();
      }
    });
  }

  /** A deck card's action, one at a time (host.busy). */
  run(cx, fn, failTitle) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    act(cx, fn, failTitle, (_r, cx) => {
      this.busy = null;
      cx.notify();
    });
  }

  /** Approve / Skip: answerChat presses it only if the prompt on screen is still the one shown. */
  answer(option, cx) {
    const a = this.approval;
    if (!a || !option || !this.canAnswer) return;
    this.answering = true;
    cx.notify();
    act(cx, () => answerChat(option, a.prompt), "Could not answer the chat agent", (_r, cx) => {
      this.answering = false;
      this.prompt = null;
      this.poll(cx);
      cx.notify();
    });
  }

  /** The Start button when no chat agent is running. */
  start(cx) {
    if (this.starting) return;
    this.starting = true;
    this.startErr = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let r;
      try {
        r = await ensureChat();
      } catch (e) {
        r = { ok: false, error: String(e?.message ?? e) };
      }
      this.starting = false;
      this.startErr = r?.ok ? null : r?.error || "could not start the chat agent";
      cx.notify();
    });
  }

  // Composer host.
  leaveComposer() {
    this.handle.focus();
  }

  sent() {
    this.away = 0;
  }

  onKey(e, cx) {
    // Typing: every key is the composer's (its own handler took Enter, esc and the list keys).
    if (this.composer.typing && !this.handle.is_focused()) return;
    const a = chatViewKey(keyOf(e), { approval: Boolean(this.approval), canAnswer: this.canAnswer });
    if (!a) return;
    switch (a) {
      case "approve":
        this.answer(this.approval.approve, cx);
        break;
      case "skip":
        if (!this.approval.skip) return;
        this.answer(this.approval.skip, cx);
        break;
      case "type":
        this.composer.focus();
        break;
      case "help":
        openKeys();
        break;
      default:
        return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  notRunning(k) {
    return v_flex()
      .w_full()
      .gap(8)
      .px(14)
      .py(12)
      .border_1()
      .border_color(k.line)
      .rounded(8)
      .child(
        h_flex()
          .items_center()
          .gap(12)
          .child(div().flex_1().text_color(k.muted).child("The chat agent is not running."))
          .child(button("chat-start", this.starting ? "Starting…" : "Start", "brand", (_e, cx) => this.start(cx), this.starting)),
      )
      .when(Boolean(this.startErr), (el) => el.child(div().text_color(k.fail).line_height(1.5).child(this.startErr)));
  }

  render(cx) {
    drew(this);
    shared(STORE_KEY); // re-render on store changes
    const raw = shared(CHAT_KEY); // and on chat log changes
    focusOnShow(this, CHILD, () => this.composer.focus(), cx);
    const k = tokens();
    const now = Date.now();

    const agent = chatAgent(terminals(), agents());
    this.nullAt = agent ? nullSince(this.nullAt, agent.status, now) : null;
    const trust = Boolean(agent) && trustWaiting(agent.status, this.nullAt, now);
    this.focusedPane = Boolean(agent?.focused);
    this.canAnswer = Boolean(agent) && !agent.focused && !this.answering;
    this.approval = agent?.status === "blocked" ? approvalFrom(this.prompt) : null;

    const log = reviveChatLog(raw);
    this.drawnLog = raw?.blocks?.length ?? 0;
    const { shown, hidden } = recentBlocks(log.blocks, MAX_BLOCKS);
    const ctx = { k, host: this };
    const col = (el) => div().flex_none().w_full().max_w(COLUMN).child(el);
    const note = (text, color = k.muted) => col(div().text_size(11).text_color(color).child(text));

    const rows = [];
    if (hidden) rows.push(note(`${hidden} earlier blocks are in the chat archive`));
    if (!log.blocks.length && agent) rows.push(note("Ask the chat agent about the board. It sees every agent.", k.text));
    for (const b of attachCards(shown, currentStore().issues)) rows.push(col(renderBlock(b, cx, ctx)));
    if (!agent) rows.push(col(this.notRunning(k)));
    else if (trust) rows.push(note("waiting for trust confirmation in the chat pane", k.hold));
    if (this.approval) rows.push(col(renderBlock(this.approval, cx, ctx)));
    rows.push(div().flex_none().h(1)); // the bottom: what following scrolls to

    // New rows: follow them down, unless the wheel has taken the reader up.
    if (rows.length !== this.drawnRows) {
      if (this.drawnRows == null || this.away === 0) this.scroll.scroll_to_item(rows.length - 1);
      this.drawnRows = rows.length;
    }
    if (prsWanted()) cx.timer.after(0, (cx) => fetchPrs(cx));

    const transcript = v_flex()
      .id("chat-transcript")
      .flex_1()
      .min_h(0)
      .w_full()
      .items_center()
      .gap(18)
      .px(16)
      .pt(24)
      .pb(12)
      .overflow_y_scrollbar()
      .track_scroll(this.scroll)
      .on_scroll_wheel((e) => {
        this.away = wheelAway(this.away, e?.delta?.y ?? 0);
      })
      .children(rows);

    return h_flex()
      .id(CHILD)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .size_full()
      .min_h(0)
      .items_stretch()
      .bg(k.bg)
      .font_family(MONO)
      .text_size(12)
      .text_color(k.text)
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .min_h(0)
          .items_center()
          .child(transcript)
          .child(
            h_flex().flex_none().w_full().justify_center().px(16).pt(4).pb(20)
              .child(div().w_full().max_w(COLUMN).child(this.composer.render(k))),
          ),
      )
      .child(this.roster);
  }
}
