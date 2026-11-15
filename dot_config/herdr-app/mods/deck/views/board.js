// Issue board: one lane per project across five columns (Backlog first), and the LIST / BOARD toggle.
// Drag a card to another column (or ⇧H/⇧L) and it stays there until a PR opens or merges.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { setShared } from "herdr";
import { boardColumns, boardLanes, boardNote, repoColor } from "../lib/board.js";
import { minutesSince, prChip } from "../lib/present.js";
import { MODE_KEY, currentStore, moveCard } from "../data.js";
import { PIN_COLUMNS, boardColumn } from "../lib/stage.js";
import { heading, label, stageColor, dot, keyChip } from "./ui.js";
import { newTaskButton } from "./newtask.js";

/** LIST / BOARD toggle; `after` runs on a switch (closes an open detail). */
export function modeToggle(mode, k, after) {
  const one = (value, text) =>
    div()
      .id("mode-" + value)
      .px(8)
      .py(3)
      .border_1()
      .border_color(mode === value ? k.brand : k.line)
      .text_color(mode === value ? k.brand : k.muted)
      .cursor_pointer()
      .hover((s) => s.text_color(k.strong))
      .on_click((_e, cx) => {
        if (mode !== value) setShared(MODE_KEY, value);
        after?.();
        cx.notify();
      })
      .child(text);
  return h_flex().flex_none().items_center().gap(6).child(one("list", "LIST")).child(one("board", "BOARD")).child(keyChip("V"));
}

// The card being dragged (its key) and the column under the pointer.
let drag = null;
let over = null;

const ago = (issue, now) => {
  const since = issue.holdingSince ?? issue.createdAt ?? issue.lastSeen;
  const m = minutesSince(since, now);
  return m < 1 ? "now" : m < 60 ? m + "m" : Math.floor(m / 60) + "h";
};

/**
 * The board pane. `onCard(issue)` handles clicks.
 * @param {{filterName: string|null}} opts
 */
export function boardPane(issues, selected, k, onCard, onToggled, opts = {}) {
  const now = Date.now();
  const cols = boardColumns(issues);
  const toneColor = { hold: k.hold, work: k.work, fail: k.fail, ok: k.ok, muted: k.muted };
  const card = (i) => {
    const on = selected?.key === i.key;
    const entry = i.kind === "backlog";
    const note = boardNote(i, currentStore().issues);
    // A backlog card has no PR: the selected one shows its key.
    const pc = entry ? { text: on ? "S start" : "—" } : prChip(i);
    const waiting = i.stage === "holding";
    return v_flex()
      .id("card-" + i.key)
      .flex_none()
      .bg(drag === i.key ? k.raised : k.panel)
      .border_1()
      .border_color(on ? k.brand : waiting ? k.hold : k.line)
      .px(11)
      .py(10)
      .gap(7)
      .cursor_pointer()
      .hover((s) => s.bg(k.raised))
      .when(!entry, (el) => el.on_mouse_down("left", () => { drag = i.key; over = null; }))
      .on_click(() => onCard(i))
      .child(
        h_flex()
          .gap(8)
          .child(div().text_color(k.muted).child(i.id))
          .when(waiting, (el) => el.child(div().text_color(k.hold).child("● waiting")))
          .child(div().flex_1())
          .child(div().text_color(k.muted).child(ago(i, now))),
      )
      .child(div().text_color(k.strong).line_height(1.35).max_h(48).overflow_hidden().child(i.title || "untitled"))
      .child(div().text_color(entry && on ? k.brand : toneColor[note.tone]).truncate().child(note.text))
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .text_color(k.muted)
          .child(div().flex_1().min_w(0).truncate().child(entry ? "not started" : i.branch ?? "no branch"))
          .child(div().flex_none().child(pc.text)),
      );
  };
  const accentOf = (c) => (c.stage === "survey" ? k.muted : stageColor(c.stage, k));
  const head = (c) => {
    const accent = accentOf(c);
    return h_flex()
      .flex_1()
      .min_w(0)
      .items_center()
      .gap(8)
      .px(12)
      .pb(4)
      .border_b(2)
      .border_color(k.line)
      .child(dot(accent, 9, true))
      .child(label(c.label, accent))
      .child(div().text_color(k.muted).child(String(c.items.length)));
  };
  const cell = (c, items, project) => {
    const target = PIN_COLUMNS.includes(c.stage);
    const hot = target && drag != null && over === c.stage;
    return v_flex()
      .id("cell-" + (project ?? "-") + "-" + c.stage)
      .flex_1()
      .min_w(0)
      .min_h(40)
      .gap(8)
      .p(6)
      .border_1()
      .border_color(hot ? k.brand : "#00000000")
      .when(target, (el) =>
        el
          .on_hover((h, cx) => {
            if (drag == null) return;
            if (h) over = c.stage;
            else if (over === c.stage) over = null;
            cx.notify();
          })
          .on_mouse_up("left", (_e, cx) => {
            const it = drag && (issues ?? []).find((x) => x.key === drag);
            drag = null;
            over = null;
            if (it && boardColumn(it) !== c.stage) moveCard(it, c.stage);
            cx.notify();
          }),
      )
      .children(items.map(card));
  };
  const lane = (l) =>
    v_flex()
      .flex_none()
      .gap(6)
      .pb(10)
      .border_b(1)
      .border_color(k.line)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .px(6)
          .pt(8)
          .child(div().flex_none().w(8).h(8).bg(repoColor(l.project, k.repo)))
          .child(div().text_color(l.project ? k.strong : k.muted).child(l.project ?? "no project"))
          .child(div().text_color(k.muted).child(String(l.count))),
      )
      .child(h_flex().items_start().gap(12).children(cols.map((c, n) => cell(c, l.cells[n], l.project))));
  const lanes = boardLanes(cols);
  return v_flex()
    .id("board")
    .flex_1()
    .min_w(0)
    .h_full()
    // A drop outside a column cancels the drag.
    .on_mouse_up("left", (_e, cx) => {
      if (drag == null) return;
      drag = null;
      over = null;
      cx.notify();
    })
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
        .child(modeToggle("board", k, onToggled))
        .child(newTaskButton(k))
        .when(Boolean(opts.filterName), (el) =>
          el.child(div().px(8).py(3).border_1().border_color(k.brand).text_color(k.brand).truncate().max_w(220).child(String(opts.filterName).toUpperCase())),
        )
        .child(div().flex_1())
        .child(div().text_color(k.muted).truncate().child("h l column · j k card · ⇧H ⇧L move card · ↵ open · S start · X discard")),
    )
    .child(
      v_flex()
        .flex_1()
        .min_h(0)
        .px(16)
        .py(12)
        .gap(4)
        .child(h_flex().flex_none().gap(12).children(cols.map(head)))
        .child(
          v_flex()
            .id("board-lanes")
            .flex_1()
            .min_h(0)
            .overflow_y_scrollbar()
            .when(lanes.length === 0, (el) => el.child(div().p(20).text_color(k.muted).child("No agents yet. Press N to start one.")))
            .children(lanes.map(lane)),
        ),
    )
    .child(
      h_flex()
        .flex_none()
        .h(44)
        .items_center()
        .gap(14)
        .px(20)
        .border_t(1)
        .border_color(k.line)
        .text_color(k.muted)
        .child(div().text_color(k.text).child("Backlog"))
        .child(div().child("→"))
        .child(h_flex().gap(6).child(div().child("Started")).child(div().text_color(k.text).child("S, S")))
        .child(div().text_color(k.line).child("|"))
        .child(div().text_color(k.text).child("Cards move on their own when:"))
        .child(h_flex().gap(6).child(div().child("Verify")).child(div().text_color(k.text).child("PR opened")))
        .child(div().child("·"))
        .child(h_flex().gap(6).child(div().child("Landed")).child(div().text_color(k.text).child("merged")))
        .child(div().text_color(k.line).child("|"))
        .child(div().text_color(k.text).child("Drag a card to move it; it stays put"))
        .child(div().flex_1())
        .child(div().text_color(k.hold).child("● waiting on you")),
    );
}
