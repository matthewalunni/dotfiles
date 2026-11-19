// The Chat composer: a multi-line input (Enter sends, Shift+Enter is a newline),
// @ and / completions from a registry, and the footer hints. Owned by the Chat
// view (views/chat.js), which calls render(k) and focus().
//
// While it has the keyboard every key is text, except the few composerKey
// (lib/chatcomposer.js) names: no Deck shortcut runs from here.
//
// Completions: registerCompletion(trigger, provider), provider(query) =>
// string[] (the choices, trigger included). v1: @ the board's agents, / the
// /compact and /clear commands.
import { div } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea } from "gpui-base";
import { createRegistry } from "../lib/chatregistry.js";
import {
  completionQuery, applyCompletion, filterChoices, composerKey, stepPick, outgoing, submitPlan, agentChoices, SLASH_COMMANDS,
} from "../lib/chatcomposer.js";
import { currentStore } from "../data.js";
import { sendToChat } from "../chat.js";
import { SEND_BLOCKED } from "../lib/chatview.js";
import { keyOf } from "./ui.js";

// One Enter can reach both the key handler and the input's submit event.
const ENTER_DEDUP_MS = 150;

const completions = createRegistry(() => []);

/** Adds (or replaces) the completion provider for `trigger` ("@" or "/"). */
export function registerCompletion(trigger, provider) {
  completions.register(trigger, provider);
}

registerCompletion("@", (query) => filterChoices(agentChoices(currentStore().issues), "@", query));
registerCompletion("/", (query) => filterChoices(SLASH_COMMANDS, "/", query));

/** The completion list for the text typed so far: { q, items }, or null when none applies. */
function completionsFor(text) {
  const q = completionQuery(text);
  if (!q) return null;
  let items = [];
  try {
    items = completions.run(q.trigger, q.query) ?? [];
  } catch {
    items = [];
  }
  return items.length ? { q, items } : null;
}

export class Composer {
  /** @param {{ leaveComposer: () => void, sent: () => void, sendLocked: () => boolean }} host */
  constructor(host) {
    this.host = host;
    this.typing = false;
    this.busy = false;
    this.error = null;
    this.pop = null; // { q, items, at }: the open completion list
    this.closedFor = null; // the text esc closed the list on (stays closed until it changes)
    this.enterAt = 0;
    this.input = TextareaState.new({ placeholder: "Message the chat agent…", rows: 2 });
    this.input.set_soft_wrap(true);
    this.input.set_auto_grow(2, 8);
    // What the last change replaced: an Enter the input acted on first has
    // already put its "\n" in (and closed the list) by the time submit arrives.
    this.lastText = "";
    this.textBefore = null;
    this.popBefore = null;
    this.changedAt = 0;
    this.input.on("change", (_e, cx) => {
      this.textBefore = this.lastText;
      this.popBefore = this.pop;
      this.lastText = this.input.value();
      this.changedAt = Date.now();
      this.error = null;
      this.refreshPop();
      cx.notify();
    });
    // An Enter that reached the input: lib/chatcomposer.js submitPlan decides
    // (with a list open it picks, never sends; the inserted newline is undone).
    this.input.on("submit", (e, cx) => {
      if (e?.shift || e?.secondary) return;
      const now = Date.now();
      const plan = submitPlan({
        text: this.input.value(), before: this.textBefore, changedJustNow: now - this.changedAt < ENTER_DEDUP_MS,
        popBefore: this.popBefore, pop: this.pop, recentKey: now - this.enterAt < ENTER_DEDUP_MS,
      });
      this.popBefore = null;
      if (plan.text !== this.input.value()) this.input.set_value(plan.text);
      if (plan.do === "pick") this.pick(plan.list, plan.text);
      else if (plan.do === "send") this.enter(cx);
      cx.notify();
    });
    this.input.on("focus", (_e, cx) => {
      this.typing = true;
      cx.notify();
    });
    this.input.on("blur", (_e, cx) => {
      this.typing = false;
      cx.notify();
    });
  }

  focus() {
    this.input.focus();
  }

  refreshPop() {
    const text = this.input.value();
    if (text === this.closedFor) {
      this.pop = null;
      return;
    }
    this.closedFor = null;
    const next = completionsFor(text);
    const same = next && this.pop && next.items.join("\n") === this.pop.items.join("\n");
    this.pop = next ? { ...next, at: same ? this.pop.at : 0 } : null;
  }

  /** The key handler on the input's frame: keys composerKey names stop here; the rest are text. */
  onKey(e, cx) {
    const a = composerKey(keyOf(e), Boolean(this.pop));
    if (!a) return;
    cx.stop_propagation();
    switch (a) {
      case "send":
        this.enter(cx);
        break;
      case "pick":
        this.pick();
        break;
      case "up":
      case "down":
        this.pop.at = stepPick(this.pop.at, a === "up" ? -1 : 1, this.pop.items.length);
        break;
      case "close":
        this.closedFor = this.input.value();
        this.pop = null;
        break;
      case "leave":
        this.host.leaveComposer();
        break;
    }
    cx.notify();
  }

  /** Enter: once per press, however many handlers hear it. */
  enter(cx) {
    const now = Date.now();
    if (now - this.enterAt < ENTER_DEDUP_MS) return;
    this.enterAt = now;
    this.send(cx);
  }

  /** Puts the highlighted completion of `pop` (the open list) in place of the word being typed in `text`. */
  pick(pop = this.pop, text = this.input.value()) {
    if (!pop) return;
    this.enterAt = Date.now();
    this.pop = null;
    this.input.set_value(applyCompletion(text, pop.q, pop.items[pop.at]));
  }

  /**
   * Sends the text (sendToChat); on failure the text stays and the error shows
   * under the box. Not while the view shows a prompt (host.sendLocked: the
   * approval card or the trust note): the text stays and nothing is typed.
   */
  send(cx) {
    const text = outgoing(this.input.value());
    if (!text || this.busy) return;
    if (this.host.sendLocked()) {
      this.error = SEND_BLOCKED;
      cx.notify();
      return;
    }
    this.busy = true;
    this.error = null;
    this.host.sent();
    cx.notify();
    cx.spawn(async (cx) => {
      let r;
      try {
        r = await sendToChat(text);
      } catch (e) {
        r = { ok: false, error: String(e?.message ?? e) };
      }
      this.busy = false;
      if (r?.ok) {
        // Text typed meanwhile is kept.
        if (outgoing(this.input.value()) === text) this.input.set_value("");
        this.pop = null;
      } else {
        this.error = r?.error || "send failed";
      }
      cx.notify();
    });
  }

  /** The completion list, over the input. */
  popList(k) {
    const pop = this.pop;
    return v_flex()
      .w_full()
      .py(4)
      .border_b(1)
      .border_color(k.line)
      .children(
        pop.items.map((item, i) =>
          h_flex()
            .id("chat-pop-" + i)
            .px(14)
            .py(4)
            .cursor_pointer()
            .when(i === pop.at, (el) => el.bg(k.raised))
            .hover((s) => s.bg(k.raised))
            .on_click((_e, cx) => {
              pop.at = i;
              this.pick();
              cx.notify();
            })
            .child(div().text_color(i === pop.at ? k.strong : k.text).child(item)),
        ),
      );
  }

  render(k) {
    const hint = (text) => div().flex_none().child(text);
    const footer = h_flex()
      .w_full()
      .items_center()
      .gap(14)
      .px(14)
      .py(8)
      .border_t(1)
      .border_color(k.line)
      .text_size(11)
      .text_color(k.muted)
      .child(div().flex_none().px(7).py(1).border_1().border_color(k.line).rounded(4).text_color(k.text).child("scope · all agents"))
      .child(hint("@ mention an agent"))
      .child(hint("/ commands"))
      .child(div().flex_1())
      .child(hint(this.busy ? "sending…" : this.host.sendLocked() ? "answer the prompt above first" : "⏎ send"));
    const box = v_flex()
      .id("chat-composer")
      .w_full()
      .bg(k.panel)
      .border_1()
      .border_color(this.typing ? k.brand : k.line)
      .rounded(8)
      .when(Boolean(this.pop), (el) => el.child(this.popList(k)))
      .child(
        div()
          .w_full()
          .px(14)
          .pt(12)
          .pb(8)
          .cursor_text()
          .on_key_down((e, cx) => this.onKey(e, cx))
          .child(Textarea.new(this.input).w_full().text_size(13).text_color(k.strong)),
      )
      .child(footer);
    return v_flex()
      .w_full()
      .gap(6)
      .child(box)
      .when(Boolean(this.error), (el) => el.child(div().text_color(k.fail).child(this.error)));
  }
}
