// Issues: sidebar (nav, views, repos), the list grouped by stage (or the board),
// and the selected issue's detail (Overview with question box + actions, GitHub
// rail) or its Pull request tab (pr.js). The detail is exported (issueDetail)
// for the issue page (issuepage.js); ↵ and a board card click open that page.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle, VirtualListScrollHandle, InputState, Input } from "gpui-base";
import { shared, setShared, notify, home } from "herdr";
import { groupIssues, matchesView, repoTelemetry, stagePct, prChip, checkTally, quickReplies, hhmm, minutesSince, projectOf } from "../lib/present.js";
import { stampText } from "../lib/proof.js";
import {
  currentStore, reply, pressOption, requestProof, dismiss, moveCard, openUrl, openEvidence, focusTerminal,
  discardEntry, restoreEntry, setReviewCost, STORE_KEY, SEL_KEY, TAB_KEY, MODE_KEY, START_ERR_KEY,
} from "../data.js";
import { previewPlan, backlogFiler } from "../lib/backlog.js";
import { startKey } from "./startconfirm.js";
import { removeKey } from "./remove.js";
import { openNewTask, newTaskButton } from "./newtask.js";
import { MONO, tokens, tone, stageColor, label, heading, button, ring, chip, dot, act, keyChip, keyOf, reviewBadge, SANS } from "./ui.js";
import { REVIEW_SORT_KEY, REVIEW_LABEL, reviewOf, otherReview } from "../lib/review.js";
import { mergeButtons, mergeKey, anyDialogOpen } from "./merge.js";
import { prTab, diffFiles } from "./pr.js";
import { boardPane, modeToggle, sortChip } from "./board.js";
import { boardColumns, moveBoard } from "../lib/board.js";
import { STAGE_LABEL as STAGE_NAME, PIN_COLUMNS, boardColumn } from "../lib/stage.js";
import { keyAction } from "../lib/keys.js";
import { openKeys } from "./keys.js";
import { registerFocus, goTo, focusOnShow, openIssue, keepFresh, drew } from "./focus.js";

const STAGE_LABEL = { ...STAGE_NAME, holding: "Holding for you" };
const VIEWS = [
  { value: "holding", text: "Holding for you" },
  { value: "failing", text: "Failing checks" },
  { value: "nodata", text: "No data" },
  { value: "unattended", text: "Safe unattended" },
  { value: "landed", text: "Landed" },
  { value: "discarded", text: "Discarded" },
];
const REVIEW = {
  APPROVED: ["Review: approved", "ok"],
  CHANGES_REQUESTED: ["Review: changes requested", "fail"],
  REVIEW_REQUIRED: ["Review: waiting on you", "nodata"],
};
const MAX_FILES = 8;
const MAX_QUESTION = 400;

/** ⇧U: unattended cards first, in the list and on the board. */
const byReview = () => shared(REVIEW_SORT_KEY) === true;
/** The U button: says what the card is now; a press flips it. */
const reviewButton = (id, issue, busy) =>
  button(id, "Review cost: " + REVIEW_LABEL[reviewOf(issue)].toLowerCase(), "plain", () => setReviewCost(issue, otherReview(issue)), busy, "U");

const sameFilter = (a, b) => (a?.kind ?? null) === (b?.kind ?? null) && (a?.value ?? null) === (b?.value ?? null);
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

/**
 * Text button that keeps its label exactly as the agent wrote it (prompt options,
 * quick replies). `key` (1–9 for options) shows as a hint chip before it.
 */
export function optionButton(id, text, primary, onClick, disabled, key = null) {
  const k = tokens();
  let el = h_flex()
    .id(id)
    .flex_none()
    .items_center()
    .gap(8)
    .px(12)
    .py(7)
    .rounded(8)
    .bg(primary ? k.holdWash : k.wash)
    .text_color(primary ? k.hold : k.strong)
    .whitespace_normal()
    .when(key != null, (el) => el.child(keyChip(key)))
    .child(div().flex_1().min_w(0).child(text));
  if (disabled) return el.opacity(0.4);
  return el.cursor_pointer().hover((s) => s.bg(k.raised)).on_click((e, cx) => {
    cx.stop_propagation();
    onClick(e, cx);
  });
}

// ------------------------------------------------------------ detail (shared)
// The issue detail is drawn by the Issues view and by the issue page
// (issuepage.js). `host` is the view: it owns busy, the reply input and its
// typing flag, the scroll handles and the diff file n / p is on.

/** Sets up a view as a detail host (call from its init). */
export function initDetail(host) {
  host.busy = null;
  host.railScroll = ScrollHandle.new();
  host.bodyScroll = ScrollHandle.new();
  host.diffScroll = VirtualListScrollHandle.new();
  host.shown = null; // the issue the detail shows (set in render)
  host.draftKey = null; // the issue the reply draft was typed for
  host.input = InputState.new({ placeholder: "› reply…" });
  host.input.on("change", () => {
    host.draftKey = host.input.value() ? host.shown?.key ?? null : null;
  });
  host.input.on("submit", (_e, cx) => sendDraft(host, cx));
  // Letter keys are text while the reply box has the keyboard.
  host.typing = false;
  host.input.on("focus", (_e, cx) => {
    host.typing = true;
    cx.notify();
  });
  host.input.on("blur", (_e, cx) => {
    host.typing = false;
    cx.notify();
  });
  host.filePath = null; // the diff file n / p is on
  host.fileFor = null; // the issue filePath belongs to
}

/** The detail now shows `issue`: a draft typed for another issue is dropped, and n / p start over. */
export function showIssue(host, issue) {
  if (host.shown && host.shown.key !== issue?.key) {
    host.input.set_value("");
    host.draftKey = null;
  }
  host.shown = issue;
  if (host.fileFor !== (issue?.key ?? null)) {
    host.fileFor = issue?.key ?? null;
    host.filePath = null;
  }
}

/** Runs an action for `issue` with the host's busy flag held. */
export function runFor(host, cx, issue, fn, failTitle, after) {
  if (host.busy) return;
  host.busy = issue.key;
  cx.notify();
  act(cx, fn, failTitle, (r, cx) => {
    host.busy = null;
    after?.(r);
    cx.notify();
  });
}

/** Sends the reply box's text to the issue shown, only if it was typed for that issue. */
export function sendDraft(host, cx) {
  const issue = host.shown;
  const text = host.input.value().trim();
  if (!issue || !text || host.busy) return;
  if (host.draftKey && host.draftKey !== issue.key) {
    host.input.set_value("");
    host.draftKey = null;
    notify({ title: "That draft was for another issue — cleared, not sent", level: "warning" });
    cx.notify();
    return;
  }
  runFor(host, cx, issue, () => reply(issue, text), "Reply failed", (r) => {
    if (r?.ok) {
      host.input.set_value("");
      host.draftKey = null;
    }
  });
}

/**
 * What the detail's keys see: the tab, the options 1–9 answer, whether R has a
 * box, and `backlog` (a live backlog entry: only S, X and U act on it).
 * @param {any} issue @param {boolean} detail whether the detail is on screen
 */
export function detailKeys(issue, detail) {
  const entry = issue?.kind === "backlog";
  const tab = shared(TAB_KEY) === "pr" && issue?.pr && !entry ? "pr" : "overview";
  const p = issue?.prompt;
  const asks = Boolean(detail && issue && !entry && tab === "overview" && issue.observed !== false && p && p.kind !== "none");
  return {
    tab, options: asks ? p.options ?? [] : [], canReply: Boolean(asks && p.kind === "question"),
    backlog: Boolean(entry && !issue.discarded),
  };
}

/**
 * Handles a detail key action (answer, reply, proof, merge, github, tab, file, review)
 * for `issue`. Returns false when the action is not a detail one or does nothing.
 * T is the caller's (the Issues view opens the Terminal view, the page focuses its pane).
 */
export function detailKey(host, a, issue, st, cx) {
  switch (a.type) {
    case "start":
      // Opens the confirm; only its second S starts.
      return st.backlog && startKey(host, issue);
    case "remove":
      return !st.backlog && removeKey(host, issue);
    case "discard":
      if (!st.backlog || host.busy) return false;
      discardEntry(issue);
      return true;
    case "review":
      // U flips the review cost: needs me <-> unattended.
      return setReviewCost(issue, otherReview(issue));
    case "answer": {
      const o = st.options[a.n - 1];
      if (!o || host.busy) return false;
      runFor(host, cx, issue, () => pressOption(issue, o), "Could not answer");
      return true;
    }
    case "reply":
      if (!st.canReply) return false;
      host.input.focus();
      return true;
    case "proof":
      if (issue.observed === false || !issue.root || host.busy) return false;
      runFor(host, cx, issue, () => requestProof(issue), "Request proof failed");
      return true;
    case "merge":
    case "mergeShip":
      return mergeKey(host, issue, a.type === "mergeShip");
    case "github":
      if (!issue.pr?.url) return false;
      act(cx, () => openUrl(issue.pr.url), "Could not open GitHub");
      return true;
    case "tab":
      if (a.tab !== "overview" && !issue.pr) return false;
      setShared(TAB_KEY, a.tab === "overview" ? "overview" : "pr");
      return true;
    case "file": {
      const d = diffFiles(issue);
      if (!d) return false;
      const at = d.paths.indexOf(host.filePath);
      const n = at < 0 ? (a.d > 0 ? 0 : d.paths.length - 1) : Math.max(0, Math.min(d.paths.length - 1, at + a.d));
      host.filePath = d.paths[n];
      host.diffScroll.scroll_to_item(d.fileRow[n], "top");
      return true;
    }
    default:
      return false;
  }
}

/**
 * The issue detail: header (crumb, back, T, GitHub) over the Overview (with
 * its GitHub rail, or `stacked`: the rail's sections inline, question first)
 * or the Pull request tab.
 * @param {any} host @param {any} issue
 * @param {{ crumb?: string, back?: {label: string, onClick: Function}|null, hint?: any, stacked?: boolean }} [opts]
 */
export function issueDetail(host, issue, k, cx, opts = {}) {
  if (issue.kind === "backlog") return backlogDetail(host, issue, k, opts);
  const tab = shared(TAB_KEY) === "pr" && issue.pr ? "pr" : "overview";
  const crumb = opts.crumb ?? `${projectOf(issue) ?? "no project"} › ${issue.id}`;
  const col = v_flex().flex_1().min_w(0).h_full();
  const hdr = header(issue, tab === "pr" ? crumb + " › Pull request" : crumb, k, opts.back ?? null, opts.hint ?? null, Boolean(opts.stacked));
  if (tab === "pr") return col.child(hdr).child(prTab(host, issue, k, cx, (el) => el.child(tabs(issue, "pr", k))));
  const store = currentStore();
  if (opts.stacked) return col.child(hdr).child(overview(host, issue, store, k, true));
  return col.child(hdr).child(h_flex().flex_1().min_h(0).items_stretch().child(overview(host, issue, store, k, false)).child(rail(host, issue, k)));
}

/** "12m", "3h", "2d" since `t`. */
function age(t, now) {
  const m = minutesSince(t, now);
  return m < 60 ? m + "m" : m < 1440 ? Math.floor(m / 60) + "h" : Math.floor(m / 1440) + "d";
}

/** An absolute path under the home folder as "~/…". */
const tilde = (p) => {
  const h = String(home() ?? "").replace(/\/+$/, "");
  return h && p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
};

/**
 * A backlog entry's page (the mock's Backlog card): where it came from, the
 * brief the agent will be told, what starting it does, and S Start agent /
 * X Discard (a discarded entry: Restore). Start only opens the confirm.
 */
function backlogDetail(host, issue, k, opts) {
  const now = Date.now();
  const crumb = opts.crumb ?? `${projectOf(issue) ?? "no project"} › ${issue.id}`;
  const hdr = header(issue, crumb, k, opts.back ?? null, opts.hint ?? null, true);
  const filer = backlogFiler(issue, currentStore().issues);
  const plan = previewPlan(issue, home());
  const err = shared(START_ERR_KEY);
  const failed = err && err.key === issue.key ? String(err.error) : null;
  const busy = Boolean(host.busy);
  const fact = (what, value, rest = "") =>
    h_flex().flex_wrap().gap(0).child(div().child(what + " ")).child(div().text_color(k.strong).child(value)).when(Boolean(rest), (el) => el.child(div().child(rest)));
  const section = (title, body) => v_flex().gap(6).child(label(title)).child(body);
  const buttons = h_flex().flex_none().flex_wrap().items_center().gap(8);
  if (issue.discarded) {
    buttons.child(button("bk-restore", "Restore", "ghost", () => restoreEntry(issue), busy));
  } else {
    buttons
      .child(button("bk-start", "Start agent", "brand", () => startKey(host, issue), busy, "S"))
      .child(button("bk-discard", "Discard", "plain", () => discardEntry(issue), busy, "X"))
      .child(reviewButton("bk-review", issue, busy));
  }
  const body = v_flex()
    .id("backlog-body")
    .flex_1()
    .min_h(0)
    .gap(18)
    .overflow_y_scrollbar()
    .track_scroll(host.bodyScroll)
    .child(section("Where it came from",
      h_flex().flex_wrap().items_center().gap(10)
        .child(div().flex_none().px(8).py(2).rounded(10).bg(k.wash).text_size(11).child(String(issue.source || "agent")))
        .child(filer
          ? h_flex().flex_wrap().child(div().child("Filed by ")).child(div().text_color(k.strong).child(`${filer.id} · ${filer.title || "untitled"}`)).child(div().child(" while it worked"))
          : div().child(issue.source === "you" ? "Filed by you from Deck" : `Filed by an ${issue.source || "agent"}`)),
    ))
    .child(section("Brief · what the agent will be told",
      div().p(12).rounded(10).bg(k.wash).line_height(1.6).text_color(issue.brief ? k.strong : k.muted).child(issue.brief || "No brief"),
    ))
    .child(section("When you start it",
      "error" in plan
        ? div().text_color(k.fail).child(plan.error)
        : v_flex().gap(4)
          .child(fact("Runs git in", tilde(issue.root ?? "")))
          .child(fact("Worktree", tilde(plan.path)))
          .child(fact("Branch", plan.branch, " from the repo's HEAD"))
          .child(fact("Agent", "claude", ", told to use herdr-proof")),
    ))
    .when(Boolean(failed), (el) => el.child(
      v_flex().gap(4).rounded(10).bg(k.fail + "1f").p(12)
        .child(div().text_color(k.fail).child("Could not start. Nothing was marked started."))
        .child(div().text_color(k.strong).line_height(1.5).child(failed)),
    ));
  return v_flex().flex_1().min_w(0).h_full().child(hdr).child(
    v_flex()
      .flex_1()
      .min_h(0)
      .px(22)
      .py(18)
      .gap(18)
      .child(
        v_flex()
          .gap(8)
          .child(heading(issue.title || issue.id, opts.stacked ? 26 : 30).max_h(66).overflow_hidden())
          .child(
            h_flex()
              .items_center()
              .gap(10)
              .text_color(k.muted)
              .child(div().px(9).py(2).rounded(10).bg(issue.discarded ? k.wash : k.brandWash).text_size(11).text_color(issue.discarded ? k.muted : k.brand)
                .child(issue.discarded ? "Discarded · " + age(issue.discardedAt, now) : "Backlog · " + age(issue.createdAt, now)))
              .when(!issue.discarded, (el) => el.child(reviewBadge(issue, k)))
              .child(div().child(projectOf(issue) ?? "no project"))
              .child(div().child(issue.discarded ? "· kept 7 days" : "· not started")),
          ),
      )
      .child(body)
      .child(buttons),
  );
}

function tabs(issue, tab, k) {
  const t = (name, text, key) =>
    div()
      .id("tab-" + name)
      .px(10)
      .h(28)
      .flex()
      .items_center()
      .rounded(8)
      .bg(tab === name ? k.raised : "#00000000")
      .font_weight(tab === name ? 600 : 500)
      .text_color(tab === name ? k.strong : k.muted)
      .cursor_pointer()
      .hover((s) => s.text_color(k.strong))
      .on_click(() => setShared(TAB_KEY, name))
      .child(h_flex().items_center().gap(6).child(text).child(div().text_size(10).text_color(k.muted).child(key)));
  return h_flex()
    .flex_none()
    .gap(4)
    .child(t("overview", "Overview", "⇧1"))
    .when(Boolean(issue.pr), (el) => el.child(t("pr", `Pull request #${issue.pr.number}`, "⇧2")));
}

/** The detail's top bar. `compact` (the issue page): no Terminal / GitHub buttons (the live thread and the actions have them). */
function header(issue, crumb, k, back, hint, compact) {
  return h_flex()
    .flex_none()
    .h(48)
    .items_center()
    .gap(8)
    .px(20)
    .when(Boolean(back), (el) => el.child(button("hdr-back", back.label, "plain", back.onClick, false, "esc")))
    .child(div().flex_1().min_w(0).truncate().text_color(k.muted).child(crumb))
    .when(Boolean(hint), (el) => el.child(hint))
    .when(!compact && issue.observed !== false, (el) => el.child(button("hdr-terminal", "Terminal", "plain", () => focusTerminal(issue), false, "T")))
    .when(!compact && Boolean(issue.pr?.url), (el) =>
      el.child(button("hdr-github", "Open in GitHub ↗", "ghost", (_e, cx) => act(cx, () => openUrl(issue.pr.url), "Could not open GitHub"), false, "O")),
    );
}

function questionBox(host, issue, k) {
  const p = issue.prompt;
  if (issue.observed === false || !p || p.kind === "none") return null;
  const busy = Boolean(host.busy);
  const text = String(p.text ?? "").trim();
  const box = v_flex()
    .flex_none()
    .rounded(12)
    .bg(k.holdWash)
    .p(14)
    .gap(10)
    .child(div().text_color(k.hold).line_height(1.5).child("Agent asks: " + clip(text || "(no question text)", MAX_QUESTION)));
  const options = p.options ?? [];
  if (options.length) {
    box.child(
      v_flex()
        .gap(6)
        .children(
          options.map((o, n) =>
            optionButton(`opt-${issue.key}-${n}`, o.label, false, (_e, cx) =>
              runFor(host, cx, issue, () => pressOption(issue, o), "Could not answer"), busy, n < 9 ? String(n + 1) : null).w_full(),
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
            .h(34)
            .px(12)
            .flex()
            .items_center()
            .rounded(8)
            .border_1()
            .border_color(k.hair)
            .bg(k.bg)
            .cursor_text()
            .when(host.typing, (el) => el.border_color(k.brand))
            .child(div().flex_1().min_w(0).h_full().child(Input.new(host.input).h_full().w_full().text_size(12).text_color(k.strong)))
            .child(div().flex_none().text_size(11).text_color(k.muted).child(host.typing ? "↵ send · esc leave" : "R reply")),
        )
        .children(quick.map((q) => optionButton(`quick-${issue.key}-${q}`, q, false, (_e, cx) => runFor(host, cx, issue, () => reply(issue, q), "Reply failed"), busy)))
        .child(button("reply-send", busy ? "Sending…" : "Send", "primary", (_e, cx) => sendDraft(host, cx), busy, "↵")),
    );
  }
  return box;
}

function actions(host, issue, k, stacked) {
  const busy = Boolean(host.busy);
  const live = issue.observed !== false;
  const row = h_flex().flex_none().flex_wrap().items_center().justify_end().gap(8);
  if (live && issue.root) {
    row.child(button("act-proof", "Request proof", "plain", (_e, cx) => runFor(host, cx, issue, () => requestProof(issue), "Request proof failed"), busy, "P"));
  }
  row.child(reviewButton("act-review", issue, busy));
  if (issue.kind !== "backlog") row.child(button("act-dismiss", "Remove…", "plain", () => removeKey(host, issue), busy, "D"));
  row.children(mergeButtons(host, issue, "act"));
  if (stacked && issue.pr?.url) {
    row.child(button("act-github", "GitHub ↗", "ghost", (_e, cx) => act(cx, () => openUrl(issue.pr.url), "Could not open GitHub"), false, "O"));
  }
  return row;
}

/** The page's line under the title: "HOLDING · 2M" then branch · commits · PR. */
function metaLine(issue, k) {
  const n = issue.commitsAhead ?? 0;
  const facts = [issue.branch ?? "no branch", `${n} commit${n === 1 ? "" : "s"}`];
  if (issue.pr) facts.push(`PR #${issue.pr.number}`);
  const since = issue.stage === "holding" && issue.holdingSince ? ` · ${minutesSince(issue.holdingSince, Date.now())}m` : "";
  return v_flex()
    .gap(4)
    .child(div().font_weight(600).text_color(stageColor(issue.stage, k)).child(String(STAGE_NAME[issue.stage] ?? issue.stage) + since))
    .child(div().text_color(k.muted).truncate().child(facts.join(" · ")));
}

function overview(host, issue, store, k, stacked) {
  const events = store.log.filter((e) => e.key === issue.key).slice(-14);
  const toneColor = (t) => (t === "hold" ? k.hold : t === "warn" ? k.nodata : t === "ok" ? k.ok : k.work);
  const q = questionBox(host, issue, k);
  return v_flex()
    .flex_1()
    .min_w(0)
    .min_h(0)
    .px(22)
    .py(20)
    .gap(16)
    .child(heading(issue.title || issue.id, stacked ? 24 : 30).max_h(66).overflow_hidden())
    .when(stacked, (el) => el.child(metaLine(issue, k)))
    .child(tabs(issue, "overview", k))
    .when(stacked && Boolean(q), (el) => el.child(q))
    .child(
      v_flex()
        .id("issue-body")
        .flex_1()
        .min_h(0)
        .gap(16)
        .overflow_y_scrollbar()
        .track_scroll(host.bodyScroll)
        .child(
          v_flex()
            .gap(6)
            .child(label("Your brief"))
            .child(
              div()
                .p(12)
                .rounded(10)
                .bg(k.wash)
                .line_height(1.6)
                .text_color(issue.brief ? k.strong : k.muted)
                .child(issue.brief ? String(issue.brief) : "Brief unknown"),
            ),
        )
        .when(stacked, (el) => el.children(railSections(issue, k)))
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
                  .child(div().mt(5).child(dot(toneColor(e.tone), 7, true)))
                  .child(div().w(40).flex_none().text_color(k.muted).child(hhmm(e.t)))
                  .child(div().flex_1().min_w(0).child(String(e.what ?? "").replace(/^moved to Survey$/, "moved to Started"))),
              ),
            ),
        ),
    )
    .when(!stacked && Boolean(q), (el) => el.child(q))
    .child(actions(host, issue, k, stacked));
}

/**
 * The GitHub facts (PR, checks, inspection, files) as a list of sections: the
 * Issues view draws them in its rail, the issue page inline in its overview.
 * Without a PR, one section says why.
 */
function railSections(issue, k) {
  const empty = (title, sub) => [
    v_flex().gap(8).child(label("GitHub")).child(div().text_color(k.strong).child(title)).when(Boolean(sub), (el) => el.child(div().text_color(k.muted).child(sub))),
  ];
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

  return [
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
  ];
}

function rail(host, issue, k) {
  const base = v_flex().w(300).flex_none().h_full().bg(k.chrome);
  const body = v_flex()
    .id("issue-rail")
    .flex_1()
    .min_h(0)
    .p(16)
    .gap(14)
    .overflow_y_scrollbar()
    .track_scroll(host.railScroll)
    .children(railSections(issue, k));
  const pr = issue.root ? issue.pr : null;
  if (!pr) return base.child(body);
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

export default class IssuesView extends View {
  init(_p, cx) {
    keepFresh(this, cx, "deck-issues");
    this.filter = null;
    this.listScroll = ScrollHandle.new();
    initDetail(this);
    this.rowAt = new Map(); // issue key -> child index in the list (for scrolling)
    this.handle = cx.focus_handle();
    registerFocus("deck-issues", this.handle);
  }

  // ------------------------------------------------------------ keys

  /** The view state keys see. In board mode the board shows, not the detail (except the PR tab). */
  keyState() {
    const issue = this.shown;
    const board = shared(MODE_KEY) === "board";
    const d0 = detailKeys(issue, true);
    const detail = Boolean(issue) && (d0.tab === "pr" || !board);
    return { issue, board, detail, ...detailKeys(issue, detail) };
  }

  /** The issues in on-screen order: the list's, or the board's columns left to right. */
  order() {
    const visible = groupIssues(currentStore().issues, this.filter, byReview()).flatMap((g) => g.items);
    return shared(MODE_KEY) === "board" ? boardColumns(visible, byReview()).flatMap((c) => c.items) : visible;
  }

  onKey(e, cx) {
    const st = this.keyState();
    const { issue, board } = st;
    const typing = this.typing && !this.handle.is_focused();
    const a = keyAction(keyOf(e), {
      view: "issues", mode: board ? "board" : "list", tab: st.tab === "pr" ? "changes" : "overview",
      typing, optionCount: Math.min(9, st.options.length), hasIssue: Boolean(issue), backlog: st.backlog,
      dialog: anyDialogOpen(),
    });
    if (!a) return;
    const visible = groupIssues(currentStore().issues, this.filter, byReview()).flatMap((g) => g.items);
    switch (a.type) {
      case "move":
      case "col": {
        if (board) {
          const cols = boardColumns(visible, byReview());
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
      case "pinCol": {
        if (!board || !issue) return;
        const at = PIN_COLUMNS.indexOf(boardColumn(issue));
        const to = PIN_COLUMNS[at < 0 ? 0 : Math.max(0, Math.min(PIN_COLUMNS.length - 1, at + a.dx))];
        if (to === boardColumn(issue)) return;
        moveCard(issue, to);
        break;
      }
      case "open":
        // ↵ opens the issue page, from the list and the board alike.
        if (!issue) return;
        this.openPage(issue);
        break;
      case "filter": {
        // "/" steps through the sidebar views: all → Holding → Failing → No data → Safe unattended → Landed → Discarded → all.
        const at = this.filter?.kind === "view" ? VIEWS.findIndex((v) => v.value === this.filter.value) : -1;
        const v = VIEWS[at + 1];
        this.filter = v ? { kind: "view", value: v.value } : null;
        setShared(TAB_KEY, "overview");
        break;
      }
      case "terminal":
        if (issue.observed === false) return;
        focusTerminal(issue);
        break;
      case "back":
        if (typing) this.handle.focus();
        else if (st.tab === "pr") setShared(TAB_KEY, "overview");
        else if (this.filter) this.filter = null;
        else return;
        break;
      case "help":
        openKeys();
        break;
      case "reviewSort":
        // ⇧U: unattended cards first within each stage (list) or project (board), or back.
        setShared(REVIEW_SORT_KEY, !byReview());
        break;
      case "toggleMode":
        setShared(MODE_KEY, board ? "list" : "board");
        break;
      case "newTask":
        if (!openNewTask(issue?.key ?? null)) return;
        break;
      default:
        if (!detailKey(this, a, issue, st, cx)) return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  select(issue) {
    setShared(SEL_KEY, issue.key);
    setShared(TAB_KEY, "overview");
  }

  /** Opens the issue page; j/k there step through this view's order. */
  openPage(issue) {
    const board = shared(MODE_KEY) === "board";
    globalThis.__deckIssueOrder = this.order().map((i) => i.key);
    openIssue(issue, board ? "board" : "list");
  }

  run(cx, issue, fn, failTitle, after) {
    runFor(this, cx, issue, fn, failTitle, after);
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
      .rounded(8)
      .cursor_pointer()
      .text_color(active ? k.strong : k.text)
      .when(active, (el) => el.bg(k.raised))
      .hover((s) => (active ? s : s.bg(k.wash)))
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
        : v === "discarded" ? dot(k.muted, 10, false)
        : v === "unattended" ? ring(k.ok, 0, 10)
        : ring(v === "failing" ? k.fail : k.nodata, 0, 10);
    const repos = repoTelemetry(issues);
    return v_flex()
      .id("issues-side")
      .w(210)
      .flex_none()
      .h_full()
      .bg(k.chrome)
      .px(10)
      .py(14)
      .gap(2)
      .overflow_y_scrollbar()
      .child(this.sideItem("side-chat", null, "Chat", null, false, () => goTo("deck-chat"), "⌥⌘2"))
      .child(this.sideItem("side-issues", null, "Issues", issues.filter((i) => matchesView(i, null)).length, !this.filter, (_e, cx) => {
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
      .child(div().px(10).pt(16).pb(6).child(label("Projects")))
      .children(
        repos.map((r) => {
          const f = { kind: "repo", value: r.repo };
          const n = issues.filter((i) => matchesView(i, f)).length;
          return this.sideItem("side-repo-" + (r.repo ?? "-"), dot(r.state === "survey" ? k.muted : stageColor(r.state, k), 8), r.repo ?? "no project", n, sameFilter(this.filter, f), toggle(f));
        }),
      );
  }

  // ------------------------------------------------------------ list

  list(issues, selected, k) {
    const groups = groupIssues(issues, this.filter, byReview());
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
            .mx(8)
            .px(10)
            .rounded(8)
            .cursor_pointer()
            .when(on, (el) => el.bg(k.raised))
            .hover((s) => (on ? s : s.bg(k.wash)))
            .on_click(() => this.select(i))
            .child(ring(c, stagePct(i.stage)))
            .child(div().w(48).flex_none().truncate().font_family(MONO).text_size(11).text_color(k.muted).child(i.id))
            .child(div().flex_1().min_w(0).truncate().text_color(k.strong).child(i.title || "untitled"))
            // Landed work is reviewed already: no badge there.
            .when(i.stage !== "landed" && !i.discarded, (el) => el.child(reviewBadge(i, k)))
            .child(h_flex().flex_none().items_center().gap(5).text_color(k.muted).child(dot(tone(pc.tone, k), 7, true)).child(pc.text)),
        );
      }
    }
    if (!rows.length) {
      rows.push(div().p(16).text_color(k.muted).child(issues.length ? "No issues match this view." : "No agents yet. Start one with cmd-t."));
    }
    const filterName = !this.filter ? null
      : this.filter.kind === "repo" ? this.filter.value ?? "no project"
      : VIEWS.find((v) => v.value === this.filter.value)?.text;
    return v_flex()
      .w(440)
      .flex_none()
      .h_full()
      .child(
        h_flex()
          .flex_none()
          .h(52)
          .items_center()
          .gap(12)
          .px(16)
          .overflow_hidden()
          .child(heading("Issues", 20))
          .child(modeToggle("list", k))
          .child(newTaskButton(k))
          .when(Boolean(filterName), (el) =>
            el.child(div().px(9).h(24).flex().items_center().rounded(12).bg(k.brandWash).text_size(12).text_color(k.brand).truncate().max_w(220).child(String(filterName))),
          )
          .when(byReview(), (el) => el.child(sortChip(k)))
          .child(div().flex_1().min_w(0))
          .child(h_flex().min_w(0).flex_shrink(1).overflow_hidden().gap(4).text_color(k.muted).child(div().flex_none().text_color(k.text).child("j k")).child(div().flex_none().child("move ·")).child(div().flex_none().text_color(k.text).child("/")).child(div().flex_none().child("filter ·")).child(div().flex_none().text_color(k.text).child("⇧U")).child(div().flex_none().child("sort")))
          .child(div().flex_none().text_color(k.muted).child(String(groups.reduce((n, g) => n + g.items.length, 0)))),
      )
      .child(v_flex().id("issues-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.listScroll).children(rows));
  }

  render(cx) {
    drew(this);
    shared(STORE_KEY); // re-render on store changes
    const k = tokens();
    const store = currentStore();
    const issues = store.issues;
    const selKey = shared(SEL_KEY);
    // Only an issue the list shows can be the detail's: a filter that hides
    // the selected one moves the detail to the first visible issue.
    const visible = groupIssues(issues, this.filter, byReview()).flatMap((g) => g.items);
    const board = shared(MODE_KEY) === "board";
    const order = board ? boardColumns(visible, byReview()).flatMap((c) => c.items) : visible;
    const issue = order.find((i) => i.key === selKey) ?? order[0] ?? null;
    showIssue(this, issue);
    // Shown (first draw, back from another view): the keys are ours.
    focusOnShow(this, "deck-issues", () => this.handle.focus(), cx);
    const tab = shared(TAB_KEY) === "pr" && issue?.pr ? "pr" : "overview";

    const root = h_flex()
      .id("deck-issues")
      .track_focus(this.handle)
      // A press anywhere here takes the keyboard back from a terminal (the
      // reply box takes it again on its own press).
      .on_mouse_down("left", () => { if (!this.typing) this.handle.focus(); })
      .on_key_down((e, cx) => this.onKey(e, cx))
      .size_full().items_stretch().min_h(0).bg(k.bg).font_family(SANS).text_size(12).text_color(k.text);
    root.child(this.sidebar(issues, k));

    if (issue && tab === "pr") return root.child(issueDetail(this, issue, k, cx));

    if (board) {
      const filterName = !this.filter ? null
        : this.filter.kind === "repo" ? this.filter.value ?? "no project"
        : VIEWS.find((v) => v.value === this.filter.value)?.text;
      // One click on a card opens its page.
      return root.child(boardPane(visible, issue, k, (i) => this.openPage(i), null, { filterName, byReview: byReview() }));
    }
    root.child(this.list(issues, issue, k));
    if (!issue) {
      const why = issues.length ? "No issues match this view." : "No agents yet. Start one with cmd-t.";
      return root.child(v_flex().flex_1().items_center().justify_center().text_color(k.muted).child(why));
    }
    return root.child(issueDetail(this, issue, k, cx));
  }
}
