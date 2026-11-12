// Command Center: decision band, stage counters, holding + in-flight list,
// telemetry per repo and the comms log.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { shared } from "herdr";
import { pickDecision, STAGE_LABEL as STAGE_NAME } from "../lib/stage.js";
import { STAGES, stagePct, repoTelemetry, issueNote, minutesSince, hhmm, liveIssues } from "../lib/present.js";
import { keyAction } from "../lib/keys.js";
import { currentStore, focusTerminal, openUrl, STORE_KEY } from "../data.js";
import { BARLOW, MONO, tokens, tone, stageColor, label, heading, button, ring, panel, segments, spaced, act, keyOf } from "./ui.js";
import { mergeButtons, mergeKey } from "./merge.js";
import { openKeys } from "./keys.js";
import { registerFocus, focusOnShow, openIssue } from "./focus.js";

const STAGE_LABEL = { ...STAGE_NAME, holding: "Holding · you" };
const pad2 = (n) => String(n).padStart(2, "0");

/** Open an issue's page (and give its overview the keyboard); j / k there follow this list. */
function inspect(issue, order) {
  globalThis.__deckIssueOrder = order.map((i) => i.key);
  openIssue(issue, "command");
}

/** One claim as a readout: "NAME PASS". */
function readout(c, k) {
  const running = c.source === "ci" && c.verdict === "NO DATA";
  const word = running ? "RUNNING" : c.verdict;
  const color = c.verdict === "PASS" ? k.ok : c.verdict === "FAIL" ? k.fail : k.nodata;
  return h_flex()
    .flex_none()
    .gap(6)
    .child(div().max_w(180).truncate().text_color(k.text).child(String(c.claim).toUpperCase()))
    .child(div().text_color(color).child(word));
}

export default class CommandView extends View {
  init(_p, cx) {
    this.scroll = ScrollHandle.new();
    this.busy = null;
    this.cur = null; // the row j/k moves (an issue key); default: the decision
    this.order = []; // the list's issues, top to bottom (set in render)
    this.rowAt = new Map(); // issue key -> child index in the list (for scrolling)
    this.handle = cx.focus_handle();
    registerFocus("deck-command", this.handle);
    // Redraw each minute so T+ minutes move.
    cx.timer.every(60_000, (cx) => cx.notify());
  }

  /** The row the keys act on: the cursor, else the decision, else the first. */
  cursor() {
    return this.order.find((i) => i.key === this.cur) ?? this.order.find((i) => i.key === this.decisionKey) ?? this.order[0] ?? null;
  }

  onKey(e, cx) {
    const issue = this.cursor();
    // 1–9 and P send to an agent; Command shows no options, so they stay off here.
    const a = keyAction(keyOf(e), { view: "command", mode: "list", tab: "overview", typing: false, optionCount: 0, hasIssue: Boolean(issue) });
    if (!a) return;
    switch (a.type) {
      case "move": {
        if (!issue) return;
        const at = this.order.indexOf(issue);
        const next = this.order[Math.max(0, Math.min(this.order.length - 1, at + a.dy))];
        this.cur = next.key;
        const row = this.rowAt.get(next.key);
        if (row != null) this.scroll.scroll_to_item(row);
        break;
      }
      case "open": inspect(issue, this.order); break;
      case "reply":
        // Opens the issue with its reply box focused (when it has one).
        globalThis.__deckReplyFocus = issue.key;
        inspect(issue, this.order);
        break;
      case "terminal": if (issue.observed !== false) focusTerminal(issue); break;
      case "github": if (issue.pr?.url) act(cx, () => openUrl(issue.pr.url), "Could not open GitHub"); break;
      case "merge":
      case "mergeShip":
        // Only the decision band has merge buttons: M acts on that row alone.
        if (issue.key !== this.decisionKey) return;
        if (!mergeKey(this, issue, a.type === "mergeShip")) return;
        break;
      case "help": openKeys(); break;
      default: return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  band(issue, k) {
    const now = Date.now();
    const meta = [issue.id, issue.repo ?? "no repo", issue.branch ?? "no branch", `T+${minutesSince(issue.holdingSince, now)}M`]
      .map((s) => String(s).toUpperCase())
      .join(" · ");
    const claims = issue.claims ?? [];
    const shown = claims.slice(0, 3);
    const readouts = h_flex().flex_1().min_w(0).gap(18).items_center().overflow_hidden();
    if (!issue.pr) readouts.child(div().text_color(k.muted).child(issue.root ? "NO PR YET" : "NOT A GIT REPO"));
    else if (!claims.length) readouts.child(div().text_color(k.nodata).child("NO PROOF OR CHECKS"));
    for (const c of shown) readouts.child(readout(c, k));
    if (claims.length > shown.length) readouts.child(div().text_color(k.muted).child(`+${claims.length - shown.length} MORE`));

    return h_flex()
      .flex_none()
      .items_stretch()
      .border_1()
      .border_color(k.hold)
      .bg(k.holdBg)
      .child(
        v_flex()
          .w(150)
          .flex_none()
          .bg(k.hold)
          .items_center()
          .justify_center()
          .font_family(BARLOW)
          .font_weight(600)
          .text_size(16)
          .line_height(1.15)
          .text_color(k.holdInk)
          .child(spaced("Decision"))
          .child(spaced("required")),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .px(20)
          .py(16)
          .gap(10)
          .child(div().text_color(k.muted).truncate().child(meta))
          .child(heading(issue.title || issue.id, 30).truncate())
          .child(
            h_flex()
              .items_center()
              .gap(10)
              .child(readouts)
              .child(button("band-inspect", "Inspect", "ghost", () => inspect(issue, this.order), false, "↵"))
              .children(mergeButtons(this, issue, "band")),
          ),
      );
  }

  counters(issues, k) {
    return h_flex()
      .flex_none()
      .items_stretch()
      .border_1()
      .border_color(k.line)
      .children(
        STAGES.map((s, n) => {
          const c = s === "survey" ? k.text : stageColor(s, k);
          const count = issues.filter((i) => i.stage === s).length;
          return v_flex()
            .flex_1()
            .min_w(0)
            .px(16)
            .py(14)
            .gap(6)
            .when(n < STAGES.length - 1, (el) => el.border_r(1).border_color(k.line))
            .when(s === "holding", (el) => el.bg(k.holdBg))
            .child(div().text_size(11).text_color(k.muted).child(pad2(n + 1)))
            .child(div().text_size(34).line_height(1).font_weight(700).text_color(c).child(String(count)))
            .child(label(STAGE_LABEL[s], c));
        }),
      );
  }

  row(issue, k, on) {
    const c = stageColor(issue.stage, k);
    return h_flex()
      .id("cmd-row-" + issue.key)
      .flex_none()
      .items_center()
      .gap(12)
      .px(14)
      .py(10)
      .border_t(1)
      .border_color(k.line)
      .cursor_pointer()
      .when(on, (el) => el.bg(k.raised))
      .hover((s) => s.bg(k.raised))
      .on_click(() => inspect(issue, this.order))
      .child(div().flex_none().w(2).h(16).when(on, (el) => el.bg(k.brand)))
      .child(ring(c, stagePct(issue.stage)))
      .child(div().w(52).flex_none().text_color(k.muted).truncate().child(issue.id))
      .child(div().flex_1().min_w(0).truncate().text_color(k.strong).child(issue.title || "untitled"))
      .child(div().max_w(260).flex_none().truncate().text_color(c).child(issueNote(issue)))
      .child(div().w(84).flex_none().text_right().truncate().text_color(k.muted).child(issue.repo ?? "—"));
  }

  list(issues, k) {
    const holding = issues.filter((i) => i.stage === "holding").sort((a, b) => (a.holdingSince ?? 0) - (b.holdingSince ?? 0));
    const flying = issues.filter((i) => i.stage !== "holding" && i.stage !== "landed");
    this.order = [...holding, ...flying];
    const curKey = this.cursor()?.key ?? null;
    this.rowAt = new Map();
    const rows = [];
    const add = (i) => {
      this.rowAt.set(i.key, rows.length);
      rows.push(this.row(i, k, i.key === curKey));
    };
    if (holding.length) for (const i of holding) add(i);
    else rows.push(div().flex_none().px(14).py(10).border_t(1).border_color(k.line).text_color(k.muted).child("Nothing is waiting on you."));
    if (flying.length) {
      rows.push(
        h_flex()
          .flex_none()
          .items_center()
          .gap(10)
          .px(14)
          .pt(16)
          .pb(10)
          .border_t(1)
          .border_color(k.line)
          .child(label("In flight", k.work))
          .child(div().text_color(k.muted).child(pad2(flying.length))),
      );
      for (const i of flying) add(i);
    }
    return panel(
      v_flex()
        .flex_1()
        .min_h(0)
        .child(
          h_flex()
            .flex_none()
            .items_center()
            .gap(10)
            .px(14)
            .py(12)
            .child(label("Holding for you", k.hold))
            .child(div().text_color(k.muted).child(pad2(holding.length)))
            .child(div().flex_1())
            .child(h_flex().gap(4).text_color(k.muted).child(div().text_color(k.text).child("j k")).child("move ·").child(div().text_color(k.text).child("↵")).child("open ·").child(div().text_color(k.text).child("?")).child("keys"))
            .child(div().text_color(k.muted).child(`IN FLIGHT ${pad2(flying.length)}`)),
        )
        .child(v_flex().id("cmd-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).children(rows)),
    );
  }

  telemetry(issues, k) {
    const rows = repoTelemetry(issues);
    return panel(
      v_flex()
        .flex_none()
        .p(14)
        .gap(10)
        .child(label("Telemetry"))
        .when(!rows.length, (el) => el.child(div().text_color(k.muted).child("No repos yet.")))
        .children(
          rows.slice(0, 8).map((r) =>
            h_flex()
              .items_center()
              .gap(10)
              .child(div().w(96).flex_none().truncate().text_color(r.repo ? k.strong : k.muted).child(r.repo ?? "no repo"))
              .child(segments(r.segments.map((t) => tone(t, k))))
              .child(div().w(84).flex_none().text_right().text_color(r.state === "survey" ? k.muted : stageColor(r.state, k)).child(r.word)),
          ),
        ),
    );
  }

  comms(log, k) {
    const last = log.slice(-6).reverse();
    return panel(
      v_flex()
        .flex_1()
        .min_h(0)
        .p(14)
        .gap(10)
        .overflow_hidden()
        .child(label("Comms log"))
        .when(!last.length, (el) => el.child(div().text_color(k.muted).child("No activity yet.")))
        .children(
          last.map((e) =>
            h_flex()
              .gap(10)
              .child(div().flex_none().text_color(k.muted).child(hhmm(e.t)))
              .child(div().flex_none().text_color(k.brand).child(e.id))
              .child(
                div()
                  .flex_1()
                  .min_w(0)
                  .text_color(e.tone === "hold" ? k.hold : e.tone === "warn" ? k.nodata : e.tone === "ok" ? k.ok : k.text)
                  .child(e.what),
              ),
          ),
        ),
    );
  }

  render(cx) {
    shared(STORE_KEY); // re-render on store changes
    // Shown (first draw, back from another view): the keys are ours.
    focusOnShow(this, "deck-command", () => this.handle.focus(), cx);
    const k = tokens();
    const store = currentStore();
    // Backlog entries are not agents: no row, count, telemetry or empty-state change here.
    const issues = liveIssues(store.issues);
    const decision = pickDecision(issues.filter((i) => i.stage === "holding"));
    this.decisionKey = decision?.key ?? null;
    if (!issues.length) this.order = [];

    const left = v_flex().flex_1().min_w(0).min_h(0).gap(16);
    if (decision) left.child(this.band(decision, k));
    left.child(this.counters(issues, k));
    if (!issues.length) {
      left.child(
        panel(
          v_flex()
            .flex_1()
            .min_h(0)
            .items_center()
            .justify_center()
            .child(div().text_size(13).text_color(k.muted).child("No agents yet. Start one with cmd-t.")),
        ),
      );
    } else left.child(this.list(issues, k));

    return h_flex()
      .id("deck-command")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .size_full()
      .items_stretch()
      .min_h(0)
      .bg(k.bg)
      .font_family(MONO)
      .text_size(12)
      .text_color(k.text)
      .px(20)
      .pt(18)
      .pb(20)
      .gap(16)
      .child(left)
      .child(v_flex().w(380).flex_none().min_h(0).gap(16).child(this.telemetry(issues, k)).child(this.comms(store.log, k)));
  }
}
