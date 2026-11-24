// Issue board: one lane per project across five columns (Backlog first), and the LIST / BOARD toggle.
// Drag a card to another column (or ⇧H/⇧L) and it stays there until a PR opens or merges.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { setShared } from "herdr";
import { boardColumns, boardLanes, boardNote, repoColor } from "../lib/board.js";
import { minutesSince, prChip } from "../lib/present.js";
import { MODE_KEY, currentStore, moveCard } from "../data.js";
import { PIN_COLUMNS, boardColumn } from "../lib/stage.js";
import { heading, label, stageColor, dot, keyChip, reviewBadge } from "./ui.js";
import { newTaskButton } from "./newtask.js";

/** LIST / BOARD toggle; `after` runs on a switch (closes an open detail). */
export function modeToggle(mode, k, after) {
  const one = (value, text) =>
    div()
      .id("mode-" + value)
      .px(10)
      .h(24)
      .flex()
      .items_center()
      .rounded(6)
      .text_size(12)
      .font_weight(mode === value ? 600 : 500)
      .bg(mode === value ? k.raised : "#00000000")
      .text_color(mode === value ? k.strong : k.muted)
      .cursor_pointer()
      .hover((s) => s.text_color(k.strong))
      .on_click((_e, cx) => {
        if (mode !== value) setShared(MODE_KEY, value);
        after?.();
        cx.notify();
      })
      .child(text);
  return h_flex()
    .flex_none()
    .items_center()
    .gap(8)
    .child(h_flex().items_center().gap(2).p(2).rounded(8).bg(k.wash).child(one("list", "List")).child(one("board", "Board")))
    .child(keyChip("V"));
}

/** The header chip while ⇧U has unattended cards sorted first. */
export function sortChip(k) {
  return div().flex_none().px(9).h(24).flex().items_center().rounded(12).bg(k.okBg).text_size(12).text_color(k.ok).whitespace_nowrap().child("Unattended first");
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
 * @param {{filterName: string|null, byReview?: boolean}} opts  byReview: unattended cards first (⇧U)
 */
export function boardPane(issues, selected, k, onCard, onToggled, opts = {}) {
  const now = Date.now();
  const cols = boardColumns(issues, Boolean(opts.byReview));
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
      .bg(dnd.key === i.key || on ? k.raised : k.panel)
      .when(dnd.key === i.key, (el) => el.opacity(0.4))
      .rounded(10)
      .border_1()
      .border_color(on ? k.brand : k.hair)
      .px(12)
      .py(11)
      .gap(8)
      .cursor_pointer()
      .hover((s) => s.bg(k.raised).border_color(k.line))
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
          .child(div().font_family("JetBrains Mono").text_size(11).text_color(k.muted).child(i.id))
          .when(waiting, (el) => el.child(div().px(7).py(1).rounded(8).bg(k.holdWash).text_size(11).text_color(k.hold).child("Waiting on you")))
          .child(div().flex_1())
          .child(div().text_color(k.muted).child(ago(i, now))),
      )
      .child(div().text_color(k.strong).font_weight(500).line_height(1.35).max_h(48).overflow_hidden().child(i.title || "untitled"))
      .child(div().text_color(entry && on ? k.brand : toneColor[note.tone]).truncate().child(note.text))
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .text_color(k.muted)
          .text_size(11)
          .child(div().flex_1().min_w(0).truncate().font_family("JetBrains Mono").child(entry ? "not started" : i.branch ?? "no branch"))
          // Landed work is reviewed already: no badge there.
          .when(boardColumn(i) !== "landed", (el) => el.child(reviewBadge(i, k)))
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
      .px(8)
      .pb(6)
      .child(dot(accent, 7, true))
      .child(label(c.label, dnd.key != null && dnd.over === c.stage ? k.strong : k.text).font_weight(600))
      .child(div().text_size(12).text_color(k.muted).child(String(c.items.length)));
  };
  const cell = (c, items) => {
    const hot = dnd.key != null && dnd.over === c.stage;
    return v_flex()
      .flex_1()
      .min_w(0)
      .min_h(40)
      .gap(8)
      .p(4)
      .rounded(12)
      .bg(hot ? k.brandWash : k.wash)
      .children(items.map(card));
  };
  const lane = (l) =>
    v_flex()
      .flex_none()
      .gap(8)
      .pb(18)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .px(4)
          .pt(10)
          .child(div().flex_none().w(8).h(8).rounded(3).bg(repoColor(l.project, k.repo)))
          .child(div().font_weight(600).text_color(l.project ? k.strong : k.muted).child(l.project ?? "No project"))
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
        .h(52)
        .items_center()
        .gap(12)
        .px(16)
        .child(heading("Issues", 20))
        .child(modeToggle("board", k, onToggled))
        .child(newTaskButton(k))
        .when(Boolean(opts.filterName), (el) =>
          el.child(div().px(9).h(24).flex().items_center().rounded(12).bg(k.brandWash).text_size(12).text_color(k.brand).truncate().max_w(220).child(String(opts.filterName))),
        )
        .when(Boolean(opts.byReview), (el) => el.child(sortChip(k)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(k.muted).truncate().child("h l column · j k card · ⇧H ⇧L move · ↵ open · S start · X discard · U review cost · ⇧U sort")),
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
        .h(40)
        .items_center()
        .gap(10)
        .px(20)
        .text_size(11)
        .text_color(k.muted)
        .child(div().child("Cards move on their own: PR opened → Verify, merged → Landed. Drag one to pin it."))
        .child(div().flex_1())
        .child(h_flex().items_center().gap(6).child(div().flex_none().w(6).h(6).rounded(6).bg(k.hold)).child(div().text_color(k.hold).child("Waiting on you"))),
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
          .bg(k.raised)
          .rounded(10)
          .border_1()
          .border_color(k.brand)
          .shadow_lg()
          .child(div().text_color(k.muted).child(dragged.id + (dnd.over ? "  →  " + cols.find((c) => c.stage === dnd.over).label : "")))
          .child(div().text_color(k.strong).truncate().child(dragged.title || "untitled")),
      ),
    );
}
