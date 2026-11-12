// Issues: sidebar (nav, views, repos), the list grouped by stage, and the
// selected issue's detail (Overview with question box + actions, GitHub rail)
// or its Pull request tab (pr.js).
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle, VirtualListScrollHandle, InputState, Input } from "gpui-base";
import { shared, setShared, notify } from "herdr";
import { groupIssues, matchesView, repoTelemetry, stagePct, prChip, checkTally, quickReplies, hhmm } from "../lib/present.js";
import { stampText } from "../lib/proof.js";
import {
  currentStore, reply, pressOption, requestProof, dismiss, openUrl, openEvidence, focusTerminal,
  STORE_KEY, SEL_KEY, TAB_KEY, MODE_KEY,
} from "../data.js";
import { MONO, tokens, tone, stageColor, label, heading, button, ring, chip, dot, act, keyChip, keyOf } from "./ui.js";
import { mergeButtons, mergeKey } from "./merge.js";
import { prTab, diffFiles } from "./pr.js";
import { boardPane, modeToggle } from "./board.js";
import { boardColumns, cardClick, moveBoard } from "../lib/board.js";
import { keyAction } from "../lib/keys.js";
import { openKeys } from "./keys.js";
import { registerFocus, goTo, focusOnShow } from "./focus.js";

const STAGE_LABEL = { holding: "Holding for you", verify: "Verify", build: "Build", survey: "Survey", landed: "Landed" };
const VIEWS = [
  { value: "holding", text: "Holding for you" },
  { value: "failing", text: "Failing checks" },
  { value: "nodata", text: "No data" },
  { value: "landed", text: "Landed" },
];
const REVIEW = {
  APPROVED: ["Review: approved", "ok"],
  CHANGES_REQUESTED: ["Review: changes requested", "fail"],
  REVIEW_REQUIRED: ["Review: waiting on you", "nodata"],
};
const MAX_FILES = 8;
const MAX_QUESTION = 400;

const sameFilter = (a, b) => (a?.kind ?? null) === (b?.kind ?? null) && (a?.value ?? null) === (b?.value ?? null);
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

/**
 * Text button that keeps its label exactly as the agent wrote it (prompt options,
 * quick replies). `key` (1–9 for options) shows as a hint chip before it.
 */
function optionButton(id, text, primary, onClick, disabled, key = null) {
  const k = tokens();
  let el = h_flex()
    .id(id)
    .flex_none()
    .items_center()
    .gap(8)
    .px(12)
    .py(6)
    .border_1()
    .border_color(primary ? k.hold : k.line)
    .text_color(primary ? k.hold : k.strong)
    .whitespace_normal()
    .when(key != null, (el) => el.child(keyChip(key, primary ? k.hold : k.line)))
    .child(div().flex_1().min_w(0).child(text));
  if (disabled) return el.opacity(0.4);
  return el.cursor_pointer().hover((s) => s.bg(k.raised)).on_click((e, cx) => {
    cx.stop_propagation();
    onClick(e, cx);
  });
}

export default class IssuesView extends View {
  init(_p, cx) {
    this.filter = null;
    this.busy = null;
    this.listScroll = ScrollHandle.new();
    this.railScroll = ScrollHandle.new();
    this.bodyScroll = ScrollHandle.new();
    this.diffScroll = VirtualListScrollHandle.new();
    this.boardOpen = false; // board mode: the detail replaces the board
    this.shown = null; // the issue the detail shows (set in render)
    this.draftKey = null; // the issue the reply draft was typed for
    this.input = InputState.new({ placeholder: "› reply…" });
    this.input.on("change", () => {
      this.draftKey = this.input.value() ? this.shown?.key ?? null : null;
    });
    this.input.on("submit", (_e, cx) => this.sendDraft(cx));
    // Letter keys are text while the reply box has the keyboard.
    this.typing = false;
    this.input.on("focus", (_e, cx) => {
      this.typing = true;
      cx.notify();
    });
    this.input.on("blur", (_e, cx) => {
      this.typing = false;
      cx.notify();
    });
    this.filePath = null; // the diff file n / p is on
    this.fileFor = null; // the issue filePath belongs to
    this.rowAt = new Map(); // issue key -> child index in the list (for scrolling)
    this.handle = cx.focus_handle();
    registerFocus("deck-issues", this.handle);
  }

  // ------------------------------------------------------------ keys

  /** The issues in on-screen order (list, or the board's columns) and the view state keys see. */
  keyState() {
    const issue = this.shown;
    const board = shared(MODE_KEY) === "board";
    const tab = shared(TAB_KEY) === "pr" && issue?.pr ? "pr" : "overview";
    const detail = Boolean(issue) && (tab === "pr" || !board || this.boardOpen);
    const p = issue?.prompt;
    const asks = detail && tab === "overview" && issue.observed !== false && p && p.kind !== "none";
    return { issue, board, tab, detail, options: asks ? p.options ?? [] : [], canReply: Boolean(asks && p.kind === "question") };
  }

  onKey(e, cx) {
    const st = this.keyState();
    const { issue, board } = st;
    const typing = this.typing && !this.handle.is_focused();
    const a = keyAction(keyOf(e), {
      view: "issues", mode: board ? "board" : "list", tab: st.tab === "pr" ? "changes" : "overview",
      typing, optionCount: Math.min(9, st.options.length), hasIssue: Boolean(issue),
    });
    if (!a) return;
    const visible = groupIssues(currentStore().issues, this.filter).flatMap((g) => g.items);
    switch (a.type) {
      case "move":
      case "col": {
        if (board) {
          const cols = boardColumns(visible);
          let col = cols.findIndex((c) => c.items.some((i) => i.key === issue?.key));
          const row = col < 0 ? 0 : cols[col].items.findIndex((i) => i.key === issue.key);
          if (col < 0) col = Math.max(0, cols.findIndex((c) => c.items.length));
          const at = moveBoard(cols, { col, row }, a.type === "col" ? { dx: a.dx } : { dy: a.dy });
          const next = cols[at.col]?.items[at.row];
          if (next) this.select(next);
        } else if (a.type === "move" && visible.length) {
          const at = visible.findIndex((i) => i.key === issue?.key);
          const next = visible[Math.max(0, Math.min(visible.length - 1, (at < 0 ? -1 : at) + a.dy))] ?? visible[0];
          this.select(next);
          const r = this.rowAt.get(next.key);
          if (r != null) this.listScroll.scroll_to_item(r);
        } else return;
        break;
      }
      case "open":
        if (!board || this.boardOpen) return;
        this.boardOpen = true;
        break;
      case "filter": {
        // "/" steps through the sidebar views: all → Holding → Failing → No data → Landed → all.
        const at = this.filter?.kind === "view" ? VIEWS.findIndex((v) => v.value === this.filter.value) : -1;
        const v = VIEWS[at + 1];
        this.filter = v ? { kind: "view", value: v.value } : null;
        setShared(TAB_KEY, "overview");
        break;
      }
      case "answer": {
        const o = st.options[a.n - 1];
        if (!o || this.busy) return;
        this.run(cx, issue, () => pressOption(issue, o), "Could not answer");
        break;
      }
      case "reply":
        if (!st.canReply) return;
        this.input.focus();
        break;
      case "terminal":
        if (issue.observed === false) return;
        focusTerminal(issue);
        break;
      case "proof":
        if (issue.observed === false || !issue.root || this.busy) return;
        this.run(cx, issue, () => requestProof(issue), "Request proof failed");
        break;
      case "merge":
      case "mergeShip":
        if (!mergeKey(this, issue, a.type === "mergeShip")) return;
        break;
      case "github":
        if (!issue.pr?.url) return;
        act(cx, () => openUrl(issue.pr.url), "Could not open GitHub");
        break;
      case "tab":
        if (a.tab !== "overview" && !issue.pr) return;
        setShared(TAB_KEY, a.tab === "overview" ? "overview" : "pr");
        break;
      case "file": {
        const d = diffFiles(issue);
        if (!d) return;
        const at = d.paths.indexOf(this.filePath);
        const n = at < 0 ? (a.d > 0 ? 0 : d.paths.length - 1) : Math.max(0, Math.min(d.paths.length - 1, at + a.d));
        this.filePath = d.paths[n];
        this.diffScroll.scroll_to_item(d.fileRow[n], "top");
        break;
      }
      case "back":
        if (typing) this.handle.focus();
        else if (st.tab === "pr") setShared(TAB_KEY, "overview");
        else if (board && this.boardOpen) this.boardOpen = false;
        else if (this.filter) this.filter = null;
        else return;
        break;
      case "help":
        openKeys();
        break;
      case "toggleMode":
        setShared(MODE_KEY, board ? "list" : "board");
        this.boardOpen = false;
        break;
      default:
        return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  select(issue) {
    if (this.shown?.key !== issue.key) {
      this.input.set_value("");
      this.draftKey = null;
    }
    setShared(SEL_KEY, issue.key);
    setShared(TAB_KEY, "overview");
  }

  /** Runs an action for `issue` with the busy flag held. */
  run(cx, issue, fn, failTitle, after) {
    if (this.busy) return;
    this.busy = issue.key;
    cx.notify();
    act(cx, fn, failTitle, (r, cx) => {
      this.busy = null;
      after?.(r);
      cx.notify();
    });
  }

  sendDraft(cx) {
    const issue = this.shown;
    const text = this.input.value().trim();
    if (!issue || !text || this.busy) return;
    if (this.draftKey && this.draftKey !== issue.key) {
      this.input.set_value("");
      this.draftKey = null;
      notify({ title: "That draft was for another issue — cleared, not sent", level: "warning" });
      cx.notify();
      return;
    }
    this.run(cx, issue, () => reply(issue, text), "Reply failed", (r) => {
      if (r?.ok) {
        this.input.set_value("");
        this.draftKey = null;
      }
    });
  }

  // ------------------------------------------------------------ sidebar

  sideItem(id, mark, text, count, active, onClick, key = null) {
    const k = tokens();
    return h_flex()
      .id(id)
      .flex_none()
      .items_center()
      .gap(8)
      .px(10)
      .py(6)
      .cursor_pointer()
      .text_color(active ? k.strong : k.text)
      .when(active, (el) => el.bg(k.raised))
      .hover((s) => s.bg(k.raised))
      .on_click(onClick)
      .when(Boolean(mark), (el) => el.child(mark))
      .child(div().flex_1().min_w(0).truncate().child(text))
      .when(Boolean(key), (el) => el.child(keyChip(key)))
      .when(count != null, (el) => el.child(div().flex_none().text_color(k.muted).child(String(count))));
  }

  sidebar(issues, k) {
    const toggle = (f) => (_e, cx) => {
      this.filter = sameFilter(this.filter, f) ? null : f;
      setShared(TAB_KEY, "overview");
      cx.notify();
    };
    const viewMark = (v) =>
      v === "holding" ? dot(k.hold, 10, true)
        : v === "landed" ? dot(k.ok, 10, true)
        : ring(v === "failing" ? k.fail : k.nodata, 0, 10);
    const repos = repoTelemetry(issues);
    return v_flex()
      .id("issues-side")
      .w(210)
      .flex_none()
      .h_full()
      .bg(k.chrome)
      .border_r(1)
      .border_color(k.line)
      .px(10)
      .py(14)
      .gap(2)
      .overflow_y_scrollbar()
      .child(this.sideItem("side-command", null, "Command", null, false, () => goTo("deck-command"), "⌥⌘1"))
      .child(this.sideItem("side-issues", null, "Issues", issues.length, !this.filter, (_e, cx) => {
        this.filter = null;
        setShared(TAB_KEY, "overview");
        cx.notify();
      }))
      .child(div().px(10).pt(16).pb(6).child(label("Views")))
      .children(
        VIEWS.map((v) => {
          const f = { kind: "view", value: v.value };
          const n = issues.filter((i) => matchesView(i, f)).length;
          return this.sideItem("side-view-" + v.value, viewMark(v.value), v.text, n, sameFilter(this.filter, f), toggle(f));
        }),
      )
      .child(div().px(10).pt(16).pb(6).child(label("Repos")))
      .children(
        repos.map((r) => {
          const f = { kind: "repo", value: r.repo };
          const n = issues.filter((i) => matchesView(i, f)).length;
          return this.sideItem("side-repo-" + (r.repo ?? "-"), dot(r.state === "survey" ? k.muted : stageColor(r.state, k), 8), r.repo ?? "no repo", n, sameFilter(this.filter, f), toggle(f));
        }),
      );
  }

  // ------------------------------------------------------------ list

  list(issues, selected, k) {
    const groups = groupIssues(issues, this.filter);
    const rows = [];
    this.rowAt = new Map();
    for (const g of groups) {
      const c = stageColor(g.stage, k);
      rows.push(
        h_flex()
          .flex_none()
          .h(32)
          .items_center()
          .gap(8)
          .px(16)
          .bg(k.panel)
          .border_b(1)
          .border_color(k.line)
          .child(ring(c, stagePct(g.stage)))
          .child(label(STAGE_LABEL[g.stage], c))
          .child(div().text_color(k.muted).child(String(g.items.length))),
      );
      for (const i of g.items) {
        const pc = prChip(i);
        const on = selected?.key === i.key;
        this.rowAt.set(i.key, rows.length);
        rows.push(
          h_flex()
            .id("row-" + i.key)
            .flex_none()
            .h(38)
            .items_center()
            .gap(10)
            .px(16)
            .border_b(1)
            .border_color(k.line)
            .cursor_pointer()
            .when(on, (el) => el.bg(k.raised))
            .hover((s) => s.bg(k.raised))
            .on_click(() => this.select(i))
            .child(ring(c, stagePct(i.stage)))
            .child(div().w(44).flex_none().truncate().text_color(k.muted).child(i.id))
            .child(div().flex_1().min_w(0).truncate().text_color(k.strong).child(i.title || "untitled"))
            .child(h_flex().flex_none().items_center().gap(5).text_color(k.muted).child(dot(tone(pc.tone, k), 7, true)).child(pc.text)),
        );
      }
    }
    if (!rows.length) {
      rows.push(div().p(16).text_color(k.muted).child(issues.length ? "No issues match this view." : "No agents yet. Start one with cmd-t."));
    }
    const filterName = !this.filter ? null
      : this.filter.kind === "repo" ? this.filter.value ?? "no repo"
      : VIEWS.find((v) => v.value === this.filter.value)?.text;
    return v_flex()
      .w(440)
      .flex_none()
      .h_full()
      .border_r(1)
      .border_color(k.line)
      .child(
        h_flex()
          .flex_none()
          .h(48)
          .items_center()
          .gap(10)
          .px(16)
          .border_b(1)
          .border_color(k.line)
          .child(heading("Issues", 18))
          .child(modeToggle("list", k, () => (this.boardOpen = false)))
          .when(Boolean(filterName), (el) =>
            el.child(div().px(8).py(3).border_1().border_color(k.brand).text_color(k.brand).truncate().max_w(220).child(String(filterName).toUpperCase())),
          )
          .child(div().flex_1())
          .child(h_flex().gap(4).text_color(k.muted).child(div().text_color(k.text).child("j k")).child("move ·").child(div().text_color(k.text).child("/")).child("filter"))
          .child(div().text_color(k.muted).child(String(groups.reduce((n, g) => n + g.items.length, 0)))),
      )
      .child(v_flex().id("issues-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.listScroll).children(rows));
  }

  // ------------------------------------------------------------ detail

  tabs(issue, tab, k) {
    const t = (name, text, key) =>
      div()
        .id("tab-" + name)
        .pb(8)
        .border_b(2)
        .border_color(tab === name ? k.brand : k.bg)
        .text_color(tab === name ? k.strong : k.muted)
        .cursor_pointer()
        .hover((s) => s.text_color(k.strong))
        .on_click(() => setShared(TAB_KEY, name))
        .child(h_flex().items_center().gap(6).child(text).child(div().text_size(10).text_color(k.muted).child(key)));
    return h_flex()
      .flex_none()
      .gap(18)
      .border_b(1)
      .border_color(k.line)
      .child(t("overview", "Overview", "⇧1"))
      .when(Boolean(issue.pr), (el) => el.child(t("pr", `Pull request #${issue.pr.number}`, "⇧2")));
  }

  header(issue, crumb, k, back) {
    return h_flex()
      .flex_none()
      .h(48)
      .items_center()
      .gap(8)
      .px(20)
      .border_b(1)
      .border_color(k.line)
      .when(Boolean(back), (el) => el.child(button("hdr-back", "← Board", "plain", back, false, "esc")))
      .child(div().flex_1().min_w(0).truncate().text_color(k.muted).child(crumb))
      .when(issue.observed !== false, (el) => el.child(button("hdr-terminal", "Terminal", "plain", () => focusTerminal(issue), false, "T")))
      .when(Boolean(issue.pr?.url), (el) =>
        el.child(button("hdr-github", "Open in GitHub ↗", "ghost", (_e, cx) => act(cx, () => openUrl(issue.pr.url), "Could not open GitHub"), false, "O")),
      );
  }

  questionBox(issue, k) {
    const p = issue.prompt;
    if (issue.observed === false || !p || p.kind === "none") return null;
    const busy = Boolean(this.busy);
    const text = String(p.text ?? "").trim();
    const box = v_flex()
      .flex_none()
      .border_1()
      .border_color(k.hold)
      .bg(k.holdBg)
      .p(14)
      .gap(10)
      .child(div().text_color(k.hold).line_height(1.5).child("◆ AGENT ASKS: " + clip(text || "(no question text)", MAX_QUESTION)));
    const options = p.options ?? [];
    if (options.length) {
      box.child(
        v_flex()
          .gap(6)
          .children(
            options.map((o, n) =>
              optionButton(`opt-${issue.key}-${n}`, o.label, false, (_e, cx) =>
                this.run(cx, issue, () => pressOption(issue, o), "Could not answer"), busy, n < 9 ? String(n + 1) : null).w_full(),
            ),
          ),
      );
    }
    if (p.kind === "question") {
      const quick = options.length ? [] : quickReplies(text);
      box.child(
        h_flex()
          .items_center()
          .gap(8)
          .child(
            div()
              .id("reply-box")
              .flex_1()
              .min_w(0)
              .h(32)
              .px(10)
              .flex()
              .items_center()
              .border_1()
              .border_color(k.line)
              .bg(k.bg)
              .cursor_text()
              .when(this.typing, (el) => el.border_color(k.brand))
              .child(div().flex_1().min_w(0).h_full().child(Input.new(this.input).h_full().w_full().text_size(12).text_color(k.strong)))
              .child(div().flex_none().text_size(11).text_color(k.muted).child(this.typing ? "↵ send · esc leave" : "R reply")),
          )
          .children(quick.map((q) => optionButton(`quick-${issue.key}-${q}`, q, false, (_e, cx) => this.run(cx, issue, () => reply(issue, q), "Reply failed"), busy)))
          .child(button("reply-send", busy ? "Sending…" : "Send", "primary", (_e, cx) => this.sendDraft(cx), busy, "↵")),
      );
    }
    return box;
  }

  actions(issue, k) {
    const busy = Boolean(this.busy);
    const live = issue.observed !== false;
    const row = h_flex().flex_none().flex_wrap().items_center().justify_end().gap(8);
    if (live && issue.root) {
      row.child(button("act-proof", "Request proof", "plain", (_e, cx) => this.run(cx, issue, () => requestProof(issue), "Request proof failed"), busy, "P"));
    }
    if (issue.stage !== "landed") row.child(button("act-dismiss", "Dismiss", "plain", () => dismiss(issue), busy));
    row.children(mergeButtons(this, issue, "act"));
    return row;
  }

  overview(issue, store, k) {
    const events = store.log.filter((e) => e.key === issue.key).slice(-14);
    const toneColor = (t) => (t === "hold" ? k.hold : t === "warn" ? k.nodata : t === "ok" ? k.ok : k.work);
    const q = this.questionBox(issue, k);
    return v_flex()
      .flex_1()
      .min_w(0)
      .min_h(0)
      .px(22)
      .py(20)
      .gap(16)
      .child(heading(issue.title || issue.id, 30).max_h(66).overflow_hidden())
      .child(this.tabs(issue, "overview", k))
      .child(
        v_flex()
          .id("issue-body")
          .flex_1()
          .min_h(0)
          .gap(16)
          .overflow_y_scrollbar()
          .track_scroll(this.bodyScroll)
          .child(
            v_flex()
              .gap(6)
              .child(label("Your brief"))
              .child(
                div()
                  .border_l(2)
                  .border_color(k.brand)
                  .pl(12)
                  .line_height(1.6)
                  .text_color(issue.brief ? k.strong : k.muted)
                  .child(issue.brief ? String(issue.brief) : "Brief unknown"),
              ),
          )
          .child(
            v_flex()
              .gap(9)
              .child(label("Flight log"))
              .when(!events.length, (el) => el.child(div().text_color(k.muted).child("Nothing logged yet.")))
              .children(
                events.map((e) =>
                  h_flex()
                    .gap(12)
                    .items_start()
                    .child(div().mt(4).child(dot(toneColor(e.tone), 8)))
                    .child(div().w(40).flex_none().text_color(k.muted).child(hhmm(e.t)))
                    .child(div().flex_1().min_w(0).child(e.what)),
                ),
              ),
          ),
      )
      .when(Boolean(q), (el) => el.child(q))
      .child(this.actions(issue, k));
  }

  rail(issue, k) {
    const base = v_flex().w(300).flex_none().h_full().bg(k.panel).border_l(1).border_color(k.line);
    const empty = (title, sub) =>
      base.p(16).gap(8).child(label("GitHub")).child(div().text_color(k.strong).child(title)).when(Boolean(sub), (el) => el.child(div().text_color(k.muted).child(sub)));
    if (!issue.root) return empty("Not a git repo", issue.cwd || null);
    const pr = issue.pr;
    if (!pr && issue.ghError) return empty("GitHub unavailable", "Deck retries on its next poll.");
    if (!pr) {
      const n = issue.commitsAhead ?? 0;
      return empty("No pull request yet", `${issue.branch ?? "no branch"} · ${n} commit${n === 1 ? "" : "s"} ahead`);
    }
    const stateChip = pr.state === "OPEN" ? chip("OPEN", k.ok, k.okBg) : pr.state === "MERGED" ? chip("MERGED", k.brand, k.raised) : chip("CLOSED", k.fail, k.raised);
    const [reviewText, reviewTone] = REVIEW[pr.review] ?? ["Review: none", "muted"];
    const tally = checkTally(pr.checks);
    const claims = issue.claims ?? [];
    const files = pr.files ?? [];
    const checkIcon = (s) => (s === "pass" ? ["✓", k.ok] : s === "fail" ? ["✕", k.fail] : ["●", k.nodata]);
    const verdictColor = (v) => (v === "PASS" ? k.ok : v === "FAIL" ? k.fail : k.nodata);

    const body = v_flex()
      .id("issue-rail")
      .flex_1()
      .min_h(0)
      .p(16)
      .gap(14)
      .overflow_y_scrollbar()
      .track_scroll(this.railScroll)
      .child(
        v_flex()
          .gap(6)
          .child(
            h_flex()
              .items_center()
              .gap(8)
              .child(svg("mods/deck/icons/pr.svg").w(16).h(16).text_color(k.text))
              .child(div().text_color(k.strong).child("#" + pr.number))
              .child(stateChip)
              .child(div().flex_1())
              .child(
                div()
                  .id("rail-gh")
                  .text_color(k.muted)
                  .cursor_pointer()
                  .hover((s) => s.text_color(k.brand))
                  .on_click((_e, cx) => act(cx, () => openUrl(pr.url), "Could not open GitHub"))
                  .child("↗"),
              ),
          )
          .child(div().text_color(k.strong).line_height(1.4).max_h(51).overflow_hidden().child(pr.title))
          .child(div().text_color(k.muted).truncate().child(`${pr.head} → ${pr.base} · ${pr.commits} commit${pr.commits === 1 ? "" : "s"}`))
          .child(div().text_color(tone(reviewTone, k)).child(reviewText))
          .when(Boolean(issue.ghError), (el) => el.child(div().text_color(k.nodata).child("GitHub unavailable — last known state"))),
      )
      .child(
        v_flex()
          .gap(7)
          .child(label(tally.total ? `Checks · ${tally.pass} of ${tally.total}` : "Checks"))
          .when(!tally.total, (el) => el.child(div().text_color(k.muted).child("No CI checks")))
          .children(
            (pr.checks ?? []).map((c) => {
              const [icon, color] = checkIcon(c.status);
              return h_flex()
                .gap(8)
                .child(div().w(14).flex_none().text_color(color).child(icon))
                .child(div().flex_1().min_w(0).truncate().child(c.name))
                .child(div().flex_none().text_color(k.muted).child(c.detail || ""));
            }),
          ),
      )
      .child(
        v_flex()
          .gap(7)
          .child(label(claims.length ? `Inspection · ${stampText(claims)}` : "Inspection"))
          .when(!claims.length, (el) => el.child(div().text_color(k.nodata).child("No proof or checks")))
          .children(
            claims.map((c, n) => {
              const opens = c.source === "agent" && c.path && c.verdict === "PASS" && issue.root;
              const row = h_flex()
                .id(`claim-${issue.key}-${n}`)
                .items_center()
                .gap(8)
                .child(chip(c.source === "ci" ? "CI" : "agent", c.source === "ci" ? k.brand : k.work, k.raised))
                .child(div().flex_1().min_w(0).truncate().text_color(opens ? k.strong : k.text).child(c.claim + (opens ? " ↗" : "")))
                .child(div().flex_none().text_color(verdictColor(c.verdict)).child(c.verdict));
              if (!opens) return row;
              return row
                .cursor_pointer()
                .hover((s) => s.bg(k.raised))
                .on_click((_e, cx) => act(cx, () => openEvidence(issue, c.path), "Could not open evidence"));
            }),
          ),
      )
      .child(
        v_flex()
          .gap(7)
          .child(label(`Files changed · ${files.length}`))
          .children(
            files.slice(0, MAX_FILES).map((f) =>
              h_flex()
                .gap(8)
                .child(div().flex_1().min_w(0).truncate().child(f.path.split("/").pop()))
                .child(div().flex_none().text_color(k.ok).child("+" + f.add))
                .child(div().flex_none().text_color(k.fail).child("−" + f.del)),
            ),
          )
          .when(files.length > MAX_FILES, (el) => el.child(div().text_color(k.muted).child(`+${files.length - MAX_FILES} more`))),
      );

    return base
      .child(body)
      .child(
        h_flex()
          .flex_none()
          .gap(6)
          .p(16)
          .pt(0)
          .child(button("rail-diff", "View diff", "plain", () => setShared(TAB_KEY, "pr"), false, "⇧2").flex_1())
          .child(button("rail-github", "GitHub ↗", "ghost", (_e, cx) => act(cx, () => openUrl(pr.url), "Could not open GitHub"), false, "O").flex_1()),
      );
  }

  render(cx) {
    shared(STORE_KEY); // re-render on store changes
    const k = tokens();
    const store = currentStore();
    const issues = store.issues;
    const selKey = shared(SEL_KEY);
    // Only an issue the list shows can be the detail's: a filter that hides
    // the selected one moves the detail to the first visible issue.
    const visible = groupIssues(issues, this.filter).flatMap((g) => g.items);
    const board = shared(MODE_KEY) === "board";
    if (!board) this.boardOpen = false;
    const order = board ? boardColumns(visible).flatMap((c) => c.items) : visible;
    const issue = order.find((i) => i.key === selKey) ?? order[0] ?? null;
    this.shown = issue;
    // Shown (first draw, back from another view): the keys are ours. Before
    // the reply focus below, so R's reply box wins.
    focusOnShow(this, "deck-issues", () => this.handle.focus(), cx);
    if (this.fileFor !== (issue?.key ?? null)) {
      this.fileFor = issue?.key ?? null;
      this.filePath = null;
    }
    // R on the Command Center: open this issue with the reply box focused.
    if (issue && globalThis.__deckReplyFocus === issue.key) {
      globalThis.__deckReplyFocus = null;
      if (this.keyState().canReply) cx.timer.after(40, () => this.input.focus());
    }
    const back = board && this.boardOpen ? (_e, cx) => { this.boardOpen = false; cx.notify(); } : null;
    const tab = shared(TAB_KEY) === "pr" && issue?.pr ? "pr" : "overview";

    const root = h_flex()
      .id("deck-issues")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .size_full().items_stretch().min_h(0).bg(k.bg).font_family(MONO).text_size(12).text_color(k.text);
    root.child(this.sidebar(issues, k));

    if (issue && tab === "pr") {
      return root.child(
        v_flex()
          .flex_1()
          .min_w(0)
          .h_full()
          .child(this.header(issue, `${issue.repo ?? "no repo"} › ${issue.id} › Pull request`, k, back))
          .child(prTab(this, issue, k, cx, (el) => el.child(this.tabs(issue, "pr", k)))),
      );
    }

    if (board && !this.boardOpen) {
      const filterName = !this.filter ? null
        : this.filter.kind === "repo" ? this.filter.value ?? "no repo"
        : VIEWS.find((v) => v.value === this.filter.value)?.text;
      return root.child(
        boardPane(visible, issue, k, (i) => {
          if (cardClick(selKey, i.key) === "open") this.boardOpen = true;
          else this.select(i);
          cx.notify();
        }, () => (this.boardOpen = false), { filterName }),
      );
    }
    if (!board) root.child(this.list(issues, issue, k));
    if (!issue) {
      const why = issues.length ? "No issues match this view." : "No agents yet. Start one with cmd-t.";
      return root.child(v_flex().flex_1().items_center().justify_center().text_color(k.muted).child(why));
    }
    return root.child(
      v_flex()
        .flex_1()
        .min_w(0)
        .h_full()
        .child(this.header(issue, `${issue.repo ?? "no repo"} › ${issue.id}`, k, back))
        .child(h_flex().flex_1().min_h(0).items_stretch().child(this.overview(issue, store, k)).child(this.rail(issue, k))),
    );
  }
}
