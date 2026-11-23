// Goals: a Gantt roadmap of what the agents' work adds up to (lib/goals.js).
// Rows are goals grouped by project; each bar is the goal's time box, filled
// by the share of its tasks landed, with a dot per landing, ◆ at the end and
// pills at Today for the agents on it. The chat agent makes and links goals
// (herdr-board goal-new / goal); this view only shows them.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { roadmap, shortDay, MONTHS } from "../lib/goals.js";
import { repoColor } from "../lib/board.js";
import { currentStore, currentGoals } from "../data.js";
import { tokens, tone, ring, keyChip, MONO } from "./ui.js";
import { keepFresh, drew, openIssue } from "./focus.js";

const LEFT = 300;
const ROW = 44;
const GROUP = 32;
const RULER = 40;
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

const pct = (f) => `${(f * 100).toFixed(3)}%`;
const day = (from, i) => {
  const d = new Date(from);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
};

/** Columns behind every timeline row: weekend shading and the Today line. */
function backdrop(m, k) {
  const step = 1 / m.days;
  const out = [];
  for (let i = 0; i < m.days; i++) {
    const wd = day(m.from, i).getDay();
    if (wd === 6) out.push(div().absolute().top(0).bottom(0).left(pct(i * step)).w(pct(2 * step)).bg(k.wash));
    if (wd === 1 && i > 0) out.push(div().absolute().top(0).bottom(0).left(pct(i * step)).w(1).bg(k.hair));
  }
  out.push(div().absolute().top(0).bottom(0).left(pct(m.now)).w(1).bg(k.hold).opacity(0.6));
  return out;
}

/** The day ruler: weekday letter and date per column; Today as a pill. */
function ruler(m, k) {
  const step = 1 / m.days;
  const cols = [];
  for (let i = 0; i < m.days; i++) {
    const d = day(m.from, i);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    cols.push(
      v_flex()
        .absolute().top(0).bottom(0).left(pct(i * step)).w(pct(step))
        .items_center().justify_center()
        .text_size(10).text_color(weekend ? k.line : k.muted)
        .child(DOW[d.getDay()])
        .child(div().text_size(11).child(String(d.getDate()))),
    );
  }
  const first = day(m.from, 0), last = day(m.from, m.days - 1);
  const month = MONTHS[first.getMonth()] + (last.getMonth() !== first.getMonth() ? " – " + MONTHS[last.getMonth()] : "");
  return h_flex()
    .flex_none()
    .h(RULER)
    .border_b_1()
    .border_color(k.hair)
    .child(h_flex().flex_none().w(LEFT).h_full().px(18).items_center().text_size(12).text_color(k.muted).child(month))
    .child(
      div().flex_1().h_full().relative()
        .children(cols)
        .child(
          div().absolute().top(9).left(pct(m.now)).ml(-22).w(44).h(22).rounded(6).bg(k.hold)
            .flex().items_center().justify_center()
            .text_size(11).font_weight(600).text_color(k.holdInk).child("Today"),
        ),
    );
}

export default class GoalsView extends View {
  init(_p, cx) {
    this.hover = null;
    /** Goal ids whose issues are folded away (click the goal's row). */
    this.collapsed = new Set();
    keepFresh(this, cx, "deck-goals");
    // Today moves: redraw every few minutes.
    cx.timer.every(5 * 60_000, (cx) => cx.notify());
  }

  /** One goal: the name column and its bar. */
  row(r, k, issues) {
    const color = repoColor(r.project ?? "none", k.repo);
    const ink = tone(r.tone, k);
    const done = r.status === "Done";
    const span = Math.max(0.0001, r.endFrac - r.startFrac);
    const fill = r.total ? r.done / r.total : 0;
    const hovered = this.hover === r.id;

    const open = !this.collapsed.has(r.id) && r.tasks.length > 0;
    const left = h_flex()
      .flex_none().w(LEFT).h_full().px(18).gap(10).items_center()
      .child(div().flex_none().w(8).text_size(10).text_color(k.muted).child(r.tasks.length ? (open ? "▾" : "▸") : ""))
      .child(ring(ink, fill * 100, 13))
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_weight(500).text_color(k.strong).child(r.title))
      .child(div().flex_none().text_size(11).text_color(ink).child(r.status));

    const bar = div()
      .absolute().top(11).h(22)
      .left(pct(r.startFrac)).w(pct(span))
      .rounded(6).overflow_hidden()
      .bg(color + "1f").border_1().border_color(color + (done ? "40" : "66"))
      .child(div().absolute().top(0).bottom(0).left(0).w(pct(fill)).bg(color + (done ? "33" : "59")))
      .children(
        r.landed.map((f) =>
          div().absolute().top(7).left(pct((f - r.startFrac) / span)).ml(-3).w(6).h(6).rounded(6).bg(done ? k.muted : k.strong),
        ),
      )
      .child(div().absolute().left(8).top(3).text_size(11).font_weight(500).text_color(done ? k.muted : k.strong).child(`${r.done}/${r.total}`));

    const end = svg("mods/deck/icons/diamond.svg")
      .absolute().top(16).left(pct(r.endFrac)).ml(-6).w(12).h(12)
      .text_color(r.tone === "fail" ? k.fail : done ? k.line : k.text);

    const agents = h_flex()
      .absolute().top(12).left(pct(r.now)).ml(10).gap(4)
      .children(
        r.agents.map((a) =>
          h_flex()
            .id("goal-agent-" + a.key)
            .h(20).px(8).gap(5).items_center().rounded(10)
            .bg(a.hold ? k.hold : k.raised)
            .text_size(11).text_color(a.hold ? k.holdInk : k.text)
            .cursor_pointer()
            .hover((s) => s.opacity(0.85))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              const it = issues.find((i) => i.key === a.key);
              if (it) openIssue(it, "board");
            })
            .child(div().font_family(MONO).text_size(10).child(a.id))
            .child(a.hold ? "waiting on you" : a.what.toLowerCase()),
        ),
      );

    return h_flex()
      .id("goal-row-" + r.id)
      .flex_none().h(ROW)
      .border_b_1().border_color(k.hair)
      .bg(hovered ? k.wash : "#00000000")
      .cursor_pointer()
      .on_click((_e, cx) => {
        if (this.collapsed.has(r.id)) this.collapsed.delete(r.id);
        else this.collapsed.add(r.id);
        cx.notify();
      })
      .on_hover((on, cx) => {
        const next = on ? r.id : this.hover === r.id ? null : this.hover;
        if (next !== this.hover) {
          this.hover = next;
          cx.notify();
        }
      })
      .child(left)
      .child(
        div().flex_1().h_full().relative()
          .children(backdrop(this.model, k))
          .child(bar)
          .child(end)
          .when(r.agents.length > 0, (el) => el.child(agents)),
      );
  }

  /**
   * One of a goal's issues, indented under it: stage ring, id, title, stage;
   * on the timeline its span from start to landing (or now), or a hollow
   * "not started" marker at Today for a backlog issue. Click: its issue page.
   */
  taskRow(t, r, m, k, issues) {
    const color = repoColor(r.project ?? "none", k.repo);
    const pctFor = { backlog: 0, survey: 15, build: 50, verify: 75, holding: 100, landed: 100 };
    const ink = t.hold ? k.hold : t.landed ? k.ok : t.stage === "backlog" ? k.muted : k.work;
    const card = t.key ? issues.find((i) => i.key === t.key) : null;

    const left = h_flex()
      .flex_none().w(LEFT).h_full().pl(54).pr(18).gap(8).items_center()
      .child(ring(ink, pctFor[t.stage] ?? 15, 11))
      .child(div().flex_none().font_family(MONO).text_size(10).text_color(k.muted).child(t.id))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.landed ? k.muted : k.text).child(t.title || "untitled"))
      .child(div().flex_none().text_size(11).text_color(ink).child(t.hold ? "Waiting" : t.label));

    const span = t.startFrac == null
      ? h_flex()
          .absolute().top(9).left(pct(m.now)).ml(-5).gap(6).items_center()
          .child(div().w(10).h(10).rounded(10).border_1().border_color(k.muted))
          .child(div().text_size(11).text_color(k.muted).child("not started"))
      : div()
          .absolute().top(12).h(8).rounded(8)
          .left(pct(t.startFrac)).w(pct(Math.max(0.004, t.endFrac - t.startFrac)))
          .bg(t.hold ? k.hold : t.landed ? color + "4d" : color + "b3")
          .when(t.landed, (el) => el.child(div().absolute().right(-3).top(1).w(6).h(6).rounded(6).bg(k.strong)));

    return h_flex()
      .id("goal-task-" + r.id + "-" + t.id)
      .flex_none().h(32)
      .border_b_1().border_color(k.hair)
      .when(Boolean(card), (el) =>
        el.cursor_pointer()
          .hover((s) => s.bg(k.wash))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            openIssue(card, "board");
          }),
      )
      .child(left)
      .child(div().flex_1().h_full().relative().children(backdrop(m, k)).child(span));
  }

  /** The bottom strip: the hovered goal in words, else the legend. */
  footer(k) {
    const r = this.model.groups.flatMap((g) => g.rows).find((x) => x.id === this.hover);
    const base = h_flex().flex_none().h(40).px(18).gap(16).items_center().border_t_1().border_color(k.hair).text_size(12).text_color(k.muted);
    if (!r) {
      const sw = (el, text) => h_flex().gap(6).items_center().child(el).child(text);
      return base
        .child(sw(div().w(22).h(8).rounded(3).bg(k.brandWash), "Time box · fill = landed"))
        .child(sw(div().w(6).h(6).rounded(6).bg(k.strong), "A task landed"))
        .child(sw(svg("mods/deck/icons/diamond.svg").w(10).h(10).text_color(k.text), "Time box ends"))
        .child(sw(div().w(18).h(10).rounded(5).bg(k.hold), "Waiting on you"))
        .child(div().flex_1())
        .child(h_flex().gap(6).items_center().child(keyChip("⌥⌘1")).child("Ask Chat to make or link goals"));
    }
    const left = r.daysLeft > 0 ? `${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left` : "time box spent";
    return base
      .child(div().font_family(MONO).text_size(11).child(r.id))
      .child(div().text_color(k.strong).font_weight(500).child(r.title))
      .child(div().text_color(tone(r.tone, k)).child(r.status))
      .child(div().child(`${r.done} of ${r.total} landed`))
      .child(div().child(`${shortDay(r.start)} → ${shortDay(r.end)} · ${left}`))
      .when(Boolean(r.doneWhen), (el) => el.child(div().flex_1().min_w(0).truncate().child("Done when: " + r.doneWhen)));
  }

  render() {
    drew(this);
    const k = tokens();
    const store = currentStore();
    const now = Date.now();
    this.model = roadmap(currentGoals(), store.issues, now);
    const m = this.model;
    const rows = m.groups.flatMap((g) => g.rows);
    const total = rows.reduce((n, r) => n + r.total, 0);
    const landed = rows.reduce((n, r) => n + r.done, 0);

    const header = h_flex()
      .flex_none().h(46).px(18).gap(10).items_center().border_b_1().border_color(k.hair)
      .child(div().text_size(14).font_weight(600).text_color(k.strong).child("Goals"))
      .child(div().text_size(12).text_color(k.muted).child(rows.length ? `${rows.length} goal${rows.length === 1 ? "" : "s"} · ${landed} of ${total} tasks landed` : ""))
      .when(m.hidden > 0, (el) => el.child(div().text_size(12).text_color(k.muted).child(`· ${m.hidden} ended over two weeks ago`)));

    if (!rows.length) {
      return v_flex().size_full().bg(k.bg).child(header).child(
        v_flex().flex_1().items_center().justify_center().gap(8).text_color(k.muted)
          .child(div().text_size(14).text_color(k.strong).child("No goals yet"))
          .child(div().text_size(12).child("Ask the chat agent for one, e.g. \"make a 2-week goal for deck: run the board from chat\"."))
          .child(div().font_family(MONO).text_size(11).child("herdr-board goal-new <title> --days N --project NAME")),
      );
    }

    const body = [];
    for (const g of m.groups) {
      const name = g.project ?? "No project";
      body.push(
        h_flex()
          .flex_none().h(GROUP).px(18).gap(9).items_center()
          .bg(k.chrome).border_b_1().border_color(k.hair)
          .text_size(12)
          .child(div().w(9).h(9).rounded(3).bg(repoColor(g.project ?? "none", k.repo)))
          .child(div().font_weight(500).text_color(k.strong).child(name))
          .child(div().text_color(k.muted).child(String(g.rows.length))),
      );
      for (const r of g.rows) {
        body.push(this.row({ ...r, now: m.now }, k, store.issues));
        if (!this.collapsed.has(r.id)) for (const t of r.tasks) body.push(this.taskRow(t, r, m, k, store.issues));
      }
    }

    return v_flex()
      .size_full().bg(k.bg)
      .child(header)
      .child(ruler(m, k))
      .child(v_flex().id("goals-rows").flex_1().min_h(0).overflow_y_scrollbar().children(body))
      .child(this.footer(k));
  }
}
