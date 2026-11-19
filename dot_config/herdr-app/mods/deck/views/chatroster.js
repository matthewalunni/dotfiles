// Chat roster: the 380 px rail of agents (Holding · you, Working, Landed). Click a row to open its page.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { shared } from "herdr";
import { rosterGroups } from "../lib/roster.js";
import { repoColor } from "../lib/board.js";
import { liveIssues } from "../lib/present.js";
import { currentStore, STORE_KEY } from "../data.js";
import { BARLOW, tokens, dot, spaced } from "./ui.js";
import { openIssue, keepFresh, drew } from "./focus.js";

export default class ChatRoster extends View {
  init(_p, cx) {
    keepFresh(this, cx, "deck-chat");
    this.scroll = ScrollHandle.new();
    // Redraw each minute so the minutes held move.
    cx.timer.every(60_000, (cx) => cx.notify());
  }

  row(g, r, issue, k) {
    const holding = g.id === "holding";
    const landed = g.id === "landed";
    return h_flex()
      .id("roster-row-" + r.key)
      .flex_none()
      .items_start()
      .gap(10)
      .px(14)
      .py(9)
      .border_l(3)
      .border_color(holding ? k.hold : k.panel)
      .when(holding, (el) => el.bg(k.holdBg))
      .cursor_pointer()
      .hover((s) => s.bg(k.raised))
      .on_click(() => issue && openIssue(issue, "chat"))
      .child(div().mt(5).child(dot(repoColor(r.project, k.repo), 8)))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .child(
            h_flex()
              .items_center()
              .gap(8)
              .child(div().flex_1().min_w(0).truncate().font_weight(holding ? 700 : 400).text_color(landed ? k.muted : k.strong).child(r.name))
              .child(div().flex_none().text_size(11).text_color(holding ? k.hold : k.muted).child(r.stage)),
          )
          .child(div().truncate().text_size(11).text_color(k.muted).child(r.note)),
      );
  }

  render(cx) {
    drew(this);
    shared(STORE_KEY); // re-render on store changes
    const k = tokens();
    const issues = currentStore().issues;
    const byKey = new Map(liveIssues(issues).map((i) => [i.key, i]));
    const groups = rosterGroups(issues, Date.now());
    const live = groups.reduce((n, g) => n + (g.id === "landed" ? 0 : g.rows.length), 0);
    const rows = [];
    for (const g of groups) {
      rows.push(
        div()
          .flex_none()
          .px(14)
          .pt(14)
          .pb(6)
          .font_family(BARLOW)
          .font_weight(600)
          .text_size(12)
          .text_color(g.id === "holding" ? k.hold : k.muted)
          .child(spaced(g.title)),
      );
      for (const r of g.rows) rows.push(this.row(g, r, byKey.get(r.key), k));
    }
    return v_flex()
      .id("chat-roster")
      .w(380)
      .flex_none()
      .h_full()
      .min_h(0)
      .bg(k.panel)
      .border_l(1)
      .border_color(k.line)
      .child(
        h_flex()
          .flex_none()
          .h(52)
          .items_center()
          .gap(10)
          .px(14)
          .border_b(1)
          .border_color(k.line)
          .child(div().font_family(BARLOW).font_weight(600).text_size(15).text_color(k.strong).child(spaced("Agents")))
          .child(div().flex_1())
          .child(div().text_color(k.muted).child(`${live} live`)),
      )
      .child(v_flex().id("roster-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).children(rows))
      .child(div().flex_none().px(14).py(10).border_t(1).border_color(k.line).text_size(11).text_color(k.muted).child("click an agent to open its page"));
  }
}
