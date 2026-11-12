// Issue board: five stage columns of cards, and the LIST / BOARD toggle.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { setShared } from "herdr";
import { boardColumns, boardNote, repoColor } from "../lib/board.js";
import { minutesSince, prChip } from "../lib/present.js";
import { MODE_KEY } from "../data.js";
import { heading, label, stageColor, dot, keyChip } from "./ui.js";

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
    const note = boardNote(i);
    const pc = prChip(i);
    return v_flex()
      .id("card-" + i.key)
      .flex_none()
      .bg(k.panel)
      .border_1()
      .border_color(on ? k.brand : k.line)
      .px(11)
      .py(10)
      .gap(7)
      .cursor_pointer()
      .hover((s) => s.bg(k.raised))
      .on_click(() => onCard(i))
      .child(
        h_flex()
          .gap(8)
          .child(div().text_color(k.muted).child(i.id))
          .child(div().flex_1())
          .child(div().text_color(k.muted).child(ago(i, now))),
      )
      .child(div().text_color(k.strong).line_height(1.35).max_h(48).overflow_hidden().child(i.title || "untitled"))
      .child(div().text_color(toneColor[note.tone]).truncate().child(note.text))
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .text_color(k.muted)
          .child(div().flex_none().w(7).h(7).bg(repoColor(i.repo, k.repo)))
          .child(div().flex_1().min_w(0).truncate().child(i.repo ?? "no repo"))
          .child(div().flex_none().child(pc.text)),
      );
  };
  const column = (c) => {
    const hot = c.stage === "holding";
    const accent = c.stage === "survey" ? k.muted : stageColor(c.stage, k);
    return v_flex()
      .flex_1()
      .min_w(0)
      .h_full()
      .gap(8)
      .p(10)
      .border_1()
      .border_color(hot ? k.hold : k.line)
      .when(hot, (el) => el.bg(k.holdBg))
      .child(
        h_flex()
          .flex_none()
          .items_center()
          .gap(8)
          .px(2)
          .pb(4)
          .child(dot(accent, 9, true))
          .child(label(c.label, accent))
          .child(div().text_color(k.muted).child(String(c.items.length))),
      )
      .child(
        v_flex()
          .id("board-col-" + c.stage)
          .flex_1()
          .min_h(0)
          .gap(8)
          .overflow_y_scrollbar()
          .children(c.items.map(card)),
      );
  };
  return v_flex()
    .flex_1()
    .min_w(0)
    .h_full()
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
        .when(Boolean(opts.filterName), (el) =>
          el.child(div().px(8).py(3).border_1().border_color(k.brand).text_color(k.brand).truncate().max_w(220).child(String(opts.filterName).toUpperCase())),
        )
        .child(div().flex_1())
        .child(div().text_color(k.muted).child("h j k l move · ↵ or click a card to open")),
    )
    .child(h_flex().flex_1().min_h(0).gap(12).px(16).py(14).children(cols.map(column)))
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
        .child(div().text_color(k.text).child("Cards move by themselves:"))
        .child(div().child("Started"))
        .child(div().child("→"))
        .child(h_flex().gap(6).child(div().child("Build")).child(div().text_color(k.text).child("first edit")))
        .child(div().child("→"))
        .child(h_flex().gap(6).child(div().child("Verify")).child(div().text_color(k.text).child("PR opened")))
        .child(div().child("→"))
        .child(h_flex().gap(6).child(div().child("Landed")).child(div().text_color(k.text).child("merged")))
        .child(div().flex_1())
        .child(div().text_color(k.hold).child("● Holding whenever the agent waits for you, from any column")),
    );
}
