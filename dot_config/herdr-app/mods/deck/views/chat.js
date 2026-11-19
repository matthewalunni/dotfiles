// The Chat view (the deck-chat-main block of the deck-chat row): one continuous
// conversation with the chat agent in a 700 px centered column, with the
// composer under it. The sidebar on the right (spaces, machines, agents, key
// hints) is the Terminal view's own, laid out in layouts/deck.json.
//
// Blocks come from the shared chat log (chat.js tails the agent's transcript);
// each agent message is followed by the deck / GitHub cards for what it
// mentions. The approval card is not in the transcript: it is the permission
// prompt on the chat pane's screen, read every 1.5 s while this view is shown,
// and answered (Approve / Skip) only while the chat pane does not have the
// keyboard. A trust modal (status unknown) is never answered from here: the
// trust note's Open terminal button peeks the chat agent's terminal so the
// person answers it there. While the approval card or the trust note shows, the
// composer keeps its text instead of sending (Enter would answer the prompt).
// Opening the view starts the chat agent once (ensureChat); after a failure
// the "not running" line keeps a Start button.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { shared, terminals, agents, focused } from "herdr";
import { shownChild } from "../lib/views.js";
import { reviveChatLog } from "../lib/chat.js";
import { findChatTerminal } from "../lib/chatsource.js";
import {
  chatAgent, shouldAutoStart, nullSince, trustWaiting, approvalFrom, wheelAway, recentBlocks, attachCards, chatViewKey,
  composerLocked, followKey, followScroll, logMark, TRUST_NOTE, focusJump,
} from "../lib/chatview.js";
import { currentStore, STORE_KEY, VIEW_KEY } from "../data.js";
import { CHAT_KEY, chatPrompt, answerChat, ensureChat, openChatTerminal } from "../chat.js";
import { MONO, tokens, button, act, keyOf } from "./ui.js";
import { renderBlock } from "./chatblocks.js";
import { prsWanted, fetchPrs } from "./chatcards.js";
import { Composer } from "./chatcomposer.js";
import { openKeys } from "./keys.js";
import { openNewTask } from "./newtask.js";
import { anyDialogOpen } from "./merge.js";
import { registerFocus, focusOnShow, keepFresh, drew, goTo } from "./focus.js";

const CHILD = "deck-chat";
const POLL_MS = 1500;
const FRESH_MS = 250;
// Drawn at most; older blocks stay in the log and the archive.
const MAX_BLOCKS = 200;
const COLUMN = 700;

const isShown = () => shownChild(shared("layout"), shared(VIEW_KEY)) === CHILD;
// The log is capped (its length stops changing), so redraws key on its last block too.
const currentMark = () => logMark(shared(CHAT_KEY));

export default class ChatView extends View {
  init(p, cx) {
    keepFresh(this, cx, CHILD);
    this.handle = cx.focus_handle();
    registerFocus(CHILD, this.handle);
    this.scroll = ScrollHandle.new();
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
    this.trust = false; // the trust note is showing
    this.drawnFollow = null; // followKey at the last draw
    this.drawnLog = "";
    this.starting = false;
    this.startErr = null;
    this.autoTried = false;
    cx.timer.every(POLL_MS, (cx) => {
      if (!isShown()) return;
      // Opening the view starts the chat agent (once; the Start button covers a failure).
      if (shouldAutoStart({ shown: true, agent: chatAgent(terminals(), agents()), tried: this.autoTried })) {
        this.autoTried = true;
        this.start(cx);
      }
      this.poll(cx);
    });
    // The chat log is not in keepFresh's fingerprint: redraw when it changes.
    // A click on the sidebar's Spaces or Agents moves the focus to another terminal:
    // open the Terminal view on it. The baseline keeps moving while this view is hidden,
    // so coming back to Chat never jumps.
    this.termKey = focusJump(null, focused(), null).key;
    cx.timer.every(FRESH_MS, () => {
      const r = focusJump(this.termKey, focused(), findChatTerminal(terminals()));
      this.termKey = r.key;
      if (r.jump && isShown()) goTo("deck-terminal");
    });
    cx.timer.every(FRESH_MS, (cx) => {
      if (isShown() && currentMark() !== this.drawnLog) cx.notify();
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

  /** Whether the composer must hold its text: a prompt (approval card or trust note) is showing. */
  sendLocked() {
    return composerLocked({ approval: Boolean(this.approval), trust: this.trust });
  }

  /** The trust note, with the button that shows the chat agent's terminal (a peek). */
  trustNote(k) {
    return h_flex()
      .w_full()
      .items_center()
      .gap(12)
      .px(14)
      .py(10)
      .border_1()
      .border_color(k.hold)
      .rounded(8)
      .child(div().flex_1().min_w(0).text_size(11).text_color(k.hold).line_height(1.5).child(TRUST_NOTE))
      .child(
        button("chat-open-terminal", "Open terminal", "plain", (_e, cx) => {
          act(cx, async () => openChatTerminal(), "Could not open the chat agent's terminal");
        }),
      );
  }

  onKey(e, cx) {
    // The view's keys only while its own handle has the keyboard: in the
    // composer every key is the composer's (its handler took Enter, esc and the list keys).
    if (!this.handle.is_focused()) return;
    const a = chatViewKey(keyOf(e), { approval: Boolean(this.approval), canAnswer: this.canAnswer, dialog: anyDialogOpen() });
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
      case "newTask":
        if (!openNewTask()) return;
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
    this.trust = trust;
    this.focusedPane = Boolean(agent?.focused);
    this.canAnswer = Boolean(agent) && !agent.focused && !this.answering;
    this.approval = agent?.status === "blocked" ? approvalFrom(this.prompt) : null;

    const log = reviveChatLog(raw);
    this.drawnLog = logMark(raw);
    const { shown, hidden } = recentBlocks(log.blocks, MAX_BLOCKS);
    const ctx = { k, host: this };
    const col = (el) => div().flex_none().w_full().max_w(COLUMN).child(el);
    const note = (text, color = k.muted) => col(div().text_size(11).text_color(color).child(text));

    const drawn = attachCards(shown, currentStore().issues);
    const rows = [];
    if (hidden) rows.push(note(`${hidden} earlier blocks are in the chat archive`));
    if (!log.blocks.length && agent) rows.push(note("Ask the chat agent about the board. It sees every agent.", k.text));
    for (const b of drawn) rows.push(col(renderBlock(b, cx, ctx)));
    if (!agent) rows.push(col(this.notRunning(k)));
    else if (trust) rows.push(col(this.trustNote(k)));
    if (this.approval) rows.push(col(renderBlock(this.approval, cx, ctx)));
    rows.push(div().flex_none().h(1)); // the bottom: what following scrolls to

    // Something new at the bottom: follow it down, unless the wheel has taken
    // the reader up. Keyed on the last block (lib/chatview.js followKey), not the
    // row count, which stops changing once the log passes MAX_BLOCKS.
    const follow = followKey({ lastId: drawn.at(-1)?.id, approval: Boolean(this.approval), trust });
    if (followScroll(this.drawnFollow, follow, this.away)) this.scroll.scroll_to_item(rows.length - 1);
    this.drawnFollow = follow;
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
      );
  }
}
