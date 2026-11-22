// The Chat view (the deck-chat-main block of the deck-chat row): one continuous
// conversation with the chat agent in a 700 px centered column, with the
// composer under it. The sidebar on the left (spaces, machines, agents, key
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
import {
  chatAgent, shouldAutoStart, nullSince, trustWaiting, approvalFrom, wheelAway, recentBlocks, attachCards, chatViewKey,
  composerLocked, followKey, followScroll, logMark, TRUST_NOTE, focusJump, contextLabel, isThinking, thinkingLabel,
} from "../lib/chatview.js";
import { currentStore, sharedOnce, STORE_KEY, VIEW_KEY } from "../data.js";
import { CHAT_KEY, chatPrompt, answerChat, ensureChat, openChatTerminal, chatContext } from "../chat.js";
import { MONO, tokens, button, act, keyOf, SANS, dot } from "./ui.js";
import { renderBlock } from "./chatblocks.js";
import { prsWanted, fetchPrs } from "./chatcards.js";
import { Composer } from "./chatcomposer.js";
import { openKeys } from "./keys.js";
import { openNewTask } from "./newtask.js";
import { anyDialogOpen } from "./merge.js";
import { registerFocus, focusOnShow, keepFresh, drew, goTo } from "./focus.js";

const CHILD = "deck-chat";
const POLL_MS = 1500;
// The context meter reads the chat agent's screen this often while Chat is shown.
const CONTEXT_MS = 5000;
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
    this.sentAt = null; // when a message went out, until the agent's status says working
    this.context = null; // the chat agent's context use, percent (its status line), or null
    this.contextBusy = false;
    this.thinking = false; // the thinking row is showing (redrawn to step its dots)
    cx.timer.every(POLL_MS, (cx) => {
      if (!isShown()) return;
      // Opening the view starts the chat agent (once; the Start button covers a failure).
      if (shouldAutoStart({ shown: true, agent: chatAgent(terminals(), agents()), tried: this.autoTried })) {
        this.autoTried = true;
        this.start(cx);
      }
      this.poll(cx);
    });
    cx.timer.every(CONTEXT_MS, (cx) => {
      if (isShown()) this.readContext(cx);
    });
    // The chat log is not in keepFresh's fingerprint: redraw when it changes.
    // A click on the sidebar's Spaces or Agents moves the focus to another terminal:
    // open the Terminal view on it. The baseline keeps moving while this view is hidden,
    // so coming back to Chat never jumps.
    this.termKey = focusJump(null, focused()).key;
    cx.timer.every(FRESH_MS, () => {
      const r = focusJump(this.termKey, focused());
      this.termKey = r.key;
      if (r.jump && isShown()) goTo("deck-terminal");
    });
    cx.timer.every(FRESH_MS, (cx) => {
      if (isShown() && (this.thinking || currentMark() !== this.drawnLog)) cx.notify();
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

  /** Reads the chat agent's context use off its status line (one at a time). */
  readContext(cx) {
    if (this.contextBusy) return;
    this.contextBusy = true;
    cx.spawn(async (cx) => {
      let pct = null;
      try {
        pct = await chatContext();
      } catch {
        pct = null;
      }
      this.contextBusy = false;
      if (pct !== this.context) {
        this.context = pct;
        cx.notify();
      }
    });
  }

  /** The composer's context meter (lib/chatview.js contextLabel), or null. */
  contextMeter() {
    return contextLabel(this.context);
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
    this.sentAt = Date.now();
  }

  sendFailed() {
    this.sentAt = null;
  }

  /** The agent is working on a reply: the agent header with stepping dots. */
  thinkingRow(k, now) {
    return h_flex()
      .w_full()
      .items_center()
      .gap(8)
      .child(dot(k.brand, 7, true))
      .child(div().font_weight(600).text_size(12).text_color(k.muted).child(thinkingLabel(now)));
  }

  /** Whether the composer must hold its text: a prompt (approval card or trust note) is showing. */
  sendLocked() {
    return composerLocked({ approval: Boolean(this.approval), trust: this.trust || this.blocked });
  }

  /** The trust note, with the button that shows the chat agent's terminal (a peek). */
  trustNote(k) {
    return h_flex()
      .w_full()
      .items_center()
      .gap(12)
      .px(14)
      .py(10)
      .bg(k.holdWash)
      .rounded(10)
      .child(div().flex_1().min_w(0).text_size(12).text_color(k.hold).line_height(1.5).child(TRUST_NOTE))
      .child(
        button("chat-open-terminal", "Open terminal", "plain", (_e, cx) => {
          act(cx, async () => openChatTerminal(), "Could not open the chat agent's terminal");
        }),
      );
  }

  /** Shows the chat agent's terminal (a peek), for prompts the deck cannot answer. */
  openTerminal(cx) {
    act(cx, async () => openChatTerminal(), "Could not open the chat agent's terminal");
  }

  /** Blocked on something no card can show: say so, with the way to answer it. */
  blockedNote(k) {
    return h_flex()
      .w_full()
      .items_center()
      .gap(12)
      .px(14)
      .py(10)
      .bg(k.holdWash)
      .rounded(10)
      .child(div().flex_1().min_w(0).text_size(12).text_color(k.hold).line_height(1.5).child("The chat agent is waiting on a prompt the deck can't show. Answer it in its terminal."))
      .child(button("chat-blocked-terminal", "Open terminal", "plain", (_e, cx) => this.openTerminal(cx)));
  }

  onKey(e, cx) {
    // The view's keys only while its own handle has the keyboard: in the
    // composer every key is the composer's (its handler took Enter, esc and the list keys).
    if (!this.handle.is_focused()) return;
    const menu = this.approval?.menu ? this.approval.options.length : 0;
    const a = chatViewKey(keyOf(e), { approval: Boolean(this.approval), canAnswer: this.canAnswer, dialog: anyDialogOpen(), menu });
    if (!a) return;
    if (a.startsWith("pick:")) {
      const o = this.approval.options.find((x) => x.keys?.[0] === a.slice(5));
      if (!o) return;
      this.answer(o, cx);
      cx.stop_propagation();
      cx.notify();
      return;
    }
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
      .bg(k.wash)
      .rounded(10)
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
    sharedOnce(STORE_KEY); // re-render on store changes
    const raw = shared(CHAT_KEY); // and on chat log changes
    focusOnShow(this, CHILD, () => this.composer.focus(), cx);
    const k = tokens();
    const now = Date.now();

    const agent = chatAgent(terminals(), agents());
    this.nullAt = agent ? nullSince(this.nullAt, agent.status, now) : null;
    const trust = Boolean(agent) && trustWaiting(agent.status, this.nullAt, now);
    this.trust = trust;
    this.focusedPane = Boolean(agent?.focused);
    this.blocked = agent?.status === "blocked";
    this.canAnswer = Boolean(agent) && !agent.focused && !this.answering;
    this.approval = agent?.status === "blocked" ? approvalFrom(this.prompt) : null;
    // Blocked, the screen read back, and still nothing to show: never leave the person guessing.
    const unreadable = agent?.status === "blocked" && !this.approval && !this.polling && this.prompt != null;
    // Once herdr reports working, or a reply landed first, the status alone drives the row.
    const last = raw?.blocks?.at?.(-1);
    const replied = this.sentAt != null && last?.role === "agent" && last.t >= this.sentAt;
    if (!agent || agent.status === "working" || replied) this.sentAt = null;
    const thinking = Boolean(agent) && !trust && !this.approval && isThinking({ status: agent.status, sentAt: this.sentAt, now });
    this.thinking = thinking;

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
    else if (unreadable) rows.push(col(this.blockedNote(k)));
    if (thinking) rows.push(col(this.thinkingRow(k, now)));
    rows.push(div().flex_none().h(1)); // the bottom: what following scrolls to

    // Something new at the bottom: follow it down, unless the wheel has taken
    // the reader up. Keyed on the last block (lib/chatview.js followKey), not the
    // row count, which stops changing once the log passes MAX_BLOCKS.
    const follow = followKey({ lastId: drawn.at(-1)?.id, approval: Boolean(this.approval), trust, thinking });
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
      .font_family(SANS)
      .text_size(13)
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
