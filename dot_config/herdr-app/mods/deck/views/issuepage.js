// The issue page (stack child deck-issue): the issue overview on the left
// (540 px, the Issues view's detail stacked into one column) and the agent's
// live terminal on the right (the active-tab pane, its tab shown with
// tab.select when the page opens, never a focus call). Keys go to the overview until T, which
// gives the terminal the keyboard; ⌘⇧I (deck.agent-issue) comes back.
// When the issue's terminal is gone, the right side shows "Agent not running"
// instead (the deck-issue-side stack's other child) and nothing is focused.
//
// Views here: "issue" (the overview), "thread" (the Live thread header over
// the pane), "issuegone" (the right side when the agent is gone) and
// "issuehints" (the key strip along the bottom).
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { shared, setShared, run } from "herdr";
import { groupIssues, projectOf } from "../lib/present.js";
import { boardColumns } from "../lib/board.js";
import { keyAction } from "../lib/keys.js";
import { issuePane, stepIssue, backTarget } from "../lib/issuepage.js";
import { currentStore, STORE_KEY, SEL_KEY, TAB_KEY, ISSUE_FROM_KEY, VIEW_KEY } from "../data.js";
import { MONO, tokens, label, keyChip, heading, keyOf, SANS } from "./ui.js";
import { initDetail, showIssue, detailKeys, detailKey, issueDetail } from "./issues.js";
import { openKeys } from "./keys.js";
import { registerFocus, goTo, focusOnShow, openIssue, showIssueSide, keepFresh, drew } from "./focus.js";
import { shownChild } from "../lib/views.js";
import { resumeButton } from "./resume.js";
import { lastSummary } from "../lib/board.js";

/** The selected issue, or null (it was dismissed or expired). */
function selectedIssue() {
  const key = shared(SEL_KEY);
  return currentStore().issues.find((i) => i.key === key) ?? null;
}

/**
 * The order j / k step through: the one the opening view handed over
 * (globalThis.__deckIssueOrder: the Issues list with its filter, or the
 * board's columns), else the board's or the list's own order.
 */
function pageOrder(current) {
  const issues = currentStore().issues;
  const keys = globalThis.__deckIssueOrder;
  if (Array.isArray(keys) && current && keys.includes(current.key)) {
    const byKey = new Map(issues.map((i) => [i.key, i]));
    const order = keys.map((k) => byKey.get(k)).filter(Boolean);
    if (order.some((i) => i.key === current.key)) return order;
  }
  const visible = groupIssues(issues, null).flatMap((g) => g.items);
  return shared(ISSUE_FROM_KEY) === "board" ? boardColumns(visible).flatMap((c) => c.items) : visible;
}

/** Gives the issue's terminal the keyboard (as ⌥⌘1 does), only while it is observed. */
function typeInThread(issue) {
  if (issuePane(issue) !== "terminal") return;
  run("agent.focus", { terminal: issue.terminal });
}

export default class IssuePage extends View {
  init(_p, cx) {
    keepFresh(this, cx, "deck-issue");
    initDetail(this);
    this.side = null; // the right side last selected ("terminal" | "gone")
    this.handle = cx.focus_handle();
    registerFocus("deck-issue", this.handle);
  }

  back() {
    const b = backTarget(shared(ISSUE_FROM_KEY));
    goTo(b.child, { agent: b.focus });
  }

  onKey(e, cx) {
    const issue = this.shown;
    const st = detailKeys(issue, true);
    const typing = this.typing && !this.handle.is_focused();
    const a = keyAction(keyOf(e), {
      view: "issue", mode: "list", tab: st.tab === "pr" ? "changes" : "overview",
      typing, optionCount: Math.min(9, st.options.length), hasIssue: Boolean(issue), backlog: st.backlog,
    });
    if (!a) return;
    switch (a.type) {
      case "leave":
        // esc in the reply box leaves the box; the next esc goes back.
        this.handle.focus();
        break;
      case "back":
        if (st.tab === "pr") setShared(TAB_KEY, "overview");
        else this.back();
        break;
      case "step": {
        const order = pageOrder(issue);
        const next = stepIssue(order, issue?.key ?? null, a.d);
        if (!next || next.key === issue?.key) return; // clamped at the first / last
        globalThis.__deckIssueOrder = order.map((i) => i.key);
        openIssue(next, shared(ISSUE_FROM_KEY) ?? "list");
        break;
      }
      case "terminal":
        if (issuePane(issue) !== "terminal") return;
        typeInThread(issue);
        break;
      case "help":
        openKeys();
        break;
      default:
        if (!issue || !detailKey(this, a, issue, st, cx)) return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  render(cx) {
    drew(this);
    shared(STORE_KEY); // re-render on store changes
    const k = tokens();
    const issue = selectedIssue();
    showIssue(this, issue);
    // Shown (opened, or a j / k step): the keys are ours (goTo focused us already; again once drawn).
    focusOnShow(this, "deck-issue", () => this.handle.focus(), cx);
    // Keep the right side in step: an agent that ends while its page is up
    // turns the pane into "Agent not running".
    const pane = issuePane(issue);
    if (this.side !== pane && shownChild(shared("layout"), shared(VIEW_KEY)) === "deck-issue") {
      this.side = pane;
      cx.timer.after(0, () => showIssueSide(pane));
    }

    const back = backTarget(shared(ISSUE_FROM_KEY));
    const root = v_flex()
      .id("deck-issue")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .size_full().min_h(0).bg(k.bg).font_family(SANS).text_size(12).text_color(k.text);
    if (!issue) {
      return root.child(
        v_flex().flex_1().items_center().justify_center().gap(10).text_color(k.muted)
          .child("This issue is no longer on the board.")
          .child(h_flex().gap(6).items_center().child(keyChip("esc")).child(back.label)),
      );
    }
    const hint = h_flex().flex_none().items_center().gap(6).text_color(k.muted).child(keyChip("j k")).child("issue");
    return root.child(
      issueDetail(this, issue, k, cx, {
        stacked: true,
        back: { label: back.label, onClick: () => this.back() },
        crumb: `/ ${projectOf(issue) ?? "no project"} › ${issue.id}`,
        hint,
      }),
    );
  }
}

/** "Live thread" over the pane: what it is, and how the keyboard gets in and out. */
export class ThreadView extends View {
  init(_p, cx) {
    keepFresh(this, cx, "deck-issue");
  }

  render() {
    drew(this);
    shared(STORE_KEY);
    const k = tokens();
    const issue = selectedIssue();
    const who = issue ? `${projectOf(issue) ?? "no project"} · ${issue.title || issue.id}` : "";
    return h_flex()
      .size_full()
      .items_center()
      .gap(12)
      .px(16)
      .bg(k.chrome)
      .font_family(SANS)
      .text_size(12)
      .text_color(k.muted)
      .child(label("Live thread", k.brand))
      .child(div().flex_1().min_w(0).truncate().child(who))
      .child(
        h_flex()
          .id("thread-type")
          .flex_none()
          .items_center()
          .gap(6)
          .cursor_pointer()
          .hover((s) => s.text_color(k.strong))
          .on_click(() => issue && typeInThread(issue))
          .child("Type into the agent")
          .child(keyChip("T")),
      )
      .child(h_flex().flex_none().items_center().gap(6).child("· back to overview").child(keyChip("⌘⇧I")).child("· back to board").child(keyChip("⌘esc")));
  }
}

/** The right side when the issue's terminal is gone (a backlog entry: "No agent yet"). */
export class GoneView extends View {
  init(_p, cx) {
    keepFresh(this, cx, "deck-issue");
  }

  render() {
    drew(this);
    shared(STORE_KEY);
    const k = tokens();
    const issue = selectedIssue();
    if (issue?.kind === "backlog") {
      return v_flex()
        .size_full()
        .p(8)
        .bg(k.bg)
        .border_l(1)
        .border_color(k.line)
        .font_family(SANS)
        .text_size(12)
        .text_color(k.muted)
        .child(
          v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).bg(k.wash).rounded(12)
            .child(label("No agent yet", k.muted))
            .child(div().child(issue.discarded ? "Discarded. Restore it to start an agent." : "Press S to start one. Its live thread shows up here.")),
        );
    }
    const last = lastSummary(issue);
    const resume = issue ? resumeButton("gone-resume", issue, "brand") : null;
    return v_flex()
      .size_full()
      .items_center()
      .justify_center()
      .gap(10)
      .bg(k.bg)
      .border_l(1)
      .border_color(k.line)
      .font_family(SANS)
      .text_size(12)
      .text_color(k.muted)
      .child(heading("Agent not running", 18, k.strong))
      .child(div().child(issue ? `${issue.id}'s terminal has ended. The overview shows what Deck last saw.` : "No agent for this issue."))
      .when(Boolean(last), (el) => el.child(
        v_flex().max_w(460).gap(4).p(12).rounded(10).bg(k.wash).line_height(1.5)
          .child(div().text_color(k.strong).child(last.done))
          .when(Boolean(last.question), (el) => el.child(div().text_color(k.hold).child("Open question: " + last.question))),
      ))
      .when(Boolean(resume), (el) => el.child(resume))
      .when(!issue?.agent?.id && Boolean(issue), (el) => el.child(div().text_size(11).child("No Claude session was recorded, so it cannot be resumed.")));
  }
}

const HINTS = [
  ["esc", "back"], ["j k", "issue"], ["1–9", "answer"], ["R", "reply"],
  ["T", "type in thread"], ["⌘⇧I", "back to overview"], ["⌘esc", "back, from the thread"], ["M", "merge"],
];

const BACKLOG_HINTS = [["esc", "back"], ["j k", "issue"], ["S", "start agent (S again)"], ["X", "discard"]];

/** The key strip along the page's bottom. */
export class IssueHints extends View {
  init(_p, cx) {
    keepFresh(this, cx, "deck-issue");
  }

  render() {
    drew(this);
    shared(STORE_KEY);
    const k = tokens();
    const entry = selectedIssue()?.kind === "backlog";
    return h_flex()
      .size_full()
      .items_center()
      .gap(14)
      .px(20)
      .bg(k.chrome)
      .border_t(1)
      .border_color(k.line)
      .font_family(SANS)
      .text_size(11)
      .text_color(k.muted)
      .children((entry ? BACKLOG_HINTS : HINTS).map(([key, what]) => h_flex().flex_none().items_center().gap(6).child(keyChip(key)).child(what)))
      .child(div().flex_1())
      .child(div().flex_none().child(entry ? "Nothing starts until you press S twice" : "Keys go to the overview until you press T"));
  }
}
