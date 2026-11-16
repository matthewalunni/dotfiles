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

// Drag state. A press on a card arms it; it becomes a drag once the pointer
// moves DRAG_PX, so a plain click still opens the card. `x`/`y` is the pointer
// in the board, `over` the column under it, `moved` stops the click that ends a drag.
const DRAG_PX = 5;
const dnd = { press: null, key: null, x: 0, y: 0, over: null, moved: false };
const endDrag = () => Object.assign(dnd, { press: null, key: null, over: null });
// Board padding and the gap between columns (see the column row below).
const PAD_X = 16;
const GAP = 12;

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
      .bg(dnd.key === i.key ? k.raised : k.panel)
      .when(dnd.key === i.key, (el) => el.opacity(0.4))
      .border_1()
      .border_color(on ? k.brand : waiting ? k.hold : k.line)
      .px(11)
      .py(10)
      .gap(7)
      .cursor_pointer()
      .hover((s) => s.bg(k.raised))
      .on_mouse_down("left", (e) => {
        dnd.moved = false;
        dnd.press = entry ? null : { key: i.key, x: e.position.x, y: e.position.y };
      })
      .on_click(() => {
        if (dnd.moved) return;
        onCard(i);
      })
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
      .border_color(dnd.key != null && dnd.over === c.stage ? k.brand : k.line)
      .child(dot(accent, 9, true))
      .child(label(c.label, accent))
      .child(div().text_color(k.muted).child(String(c.items.length)));
  };
  const cell = (c, items) => {
    const hot = dnd.key != null && dnd.over === c.stage;
    return v_flex()
      .flex_1()
      .min_w(0)
      .min_h(40)
      .gap(8)
      .p(6)
      .border_1()
      .border_color(hot ? k.brand : "#00000000")
      .when(hot, (el) => el.bg(k.raised))
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
      .child(h_flex().items_start().gap(12).children(cols.map((c, n) => cell(c, l.cells[n]))));
  const lanes = boardLanes(cols);
  const dragged = dnd.key ? (issues ?? []).find((x) => x.key === dnd.key) : null;
  // The column under the pointer, from its x in the board (columns share the width equally).
  const columnAt = (x, width) => {
    const w = (width - 2 * PAD_X + GAP) / cols.length;
    const n = Math.floor((x - PAD_X) / w);
    return n >= 0 && n < cols.length && PIN_COLUMNS.includes(cols[n].stage) ? cols[n].stage : null;
  };
  return v_flex()
    .id("board")
    .relative()
    .flex_1()
    .min_w(0)
    .h_full()
    .on_mouse_move((e, cx) => {
      if (!dnd.press) return;
      if (!dnd.key) {
        if (Math.hypot(e.position.x - dnd.press.x, e.position.y - dnd.press.y) < DRAG_PX) return;
        dnd.key = dnd.press.key;
        dnd.moved = true;
      }
      dnd.x = e.local_position.x;
      dnd.y = e.local_position.y;
      dnd.over = columnAt(e.local_position.x, e.bounds.width);
      cx.notify();
    })
    // Leaving the board cancels the drag (the release would happen out of reach).
    .on_hover((h, cx) => {
      if (h || !dnd.press) return;
      endDrag();
      cx.notify();
    })
    // Dropping outside Started…Landed cancels the drag.
    .on_mouse_up("left", (_e, cx) => {
      const it = dnd.key && (issues ?? []).find((x) => x.key === dnd.key);
      const to = dnd.over;
      const was = dnd.key;
      endDrag();
      if (it && to && boardColumn(it) !== to) moveCard(it, to);
      if (was) cx.notify();
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
    )
    .when(Boolean(dragged), (el) =>
      el.child(
        v_flex()
          .absolute()
          .left(dnd.x + 14)
          .top(dnd.y + 10)
          .w(240)
          .gap(4)
          .px(11)
          .py(8)
          .bg(k.panel)
          .border_1()
          .border_color(k.brand)
          .shadow_lg()
          .child(div().text_color(k.muted).child(dragged.id + (dnd.over ? "  →  " + cols.find((c) => c.stage === dnd.over).label : "")))
          .child(div().text_color(k.strong).truncate().child(dragged.title || "untitled")),
      ),
    );
}
