// Review soft gate, opened as a dialog with props
// { view: "review", key, headSha, next: "merge"|"ship"|"anyway" } when a merge
// button is pressed before the diff for that head was opened. "Review diff"
// shows the PR tab (its Changes); "Merge without reviewing" carries on with the
// normal path (head check and lock included), or opens the Merge anyway dialog.
// Esc / Cancel close it; Enter does nothing.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay, setShared } from "herdr";
import { currentStore, merge, mergeAndShip, showView, SEL_KEY, TAB_KEY } from "../data.js";
import { openConfirm } from "./merge.js";
import { MONO, tokens, heading, button, act } from "./ui.js";

export default class ReviewGateView extends View {
  init(_p, cx) {
    this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  shut() {
    const id = (props() ?? {}).overlay;
    if (id) closeOverlay(id);
  }

  review() {
    const p = props() ?? {};
    setShared(SEL_KEY, p.key);
    setShared(TAB_KEY, "pr");
    showView("deck-issues");
    this.shut();
  }

  proceed(cx) {
    const p = props() ?? {};
    const issue = currentStore().issues.find((i) => i.key === p.key);
    if (!issue || this.busy) return;
    if (p.next === "anyway") {
      this.shut();
      openConfirm(issue, p.headSha ?? null);
      return;
    }
    const ship = p.next === "ship";
    this.busy = true;
    cx.notify();
    act(cx, () => (ship ? mergeAndShip(issue, p.headSha) : merge(issue, p.headSha)), ship ? "Merge + ship failed" : "Merge failed", (_r, cx) => {
      this.busy = false;
      this.shut();
      cx.notify();
    });
  }

  render(_cx) {
    const k = tokens();
    const p = props() ?? {};
    const issue = currentStore().issues.find((i) => i.key === p.key) ?? null;
    const sha = typeof p.headSha === "string" ? p.headSha.slice(0, 7) : "?";
    const what = p.next === "ship" ? "Merge + ship" : p.next === "anyway" ? "Merge anyway" : "Merge";
    return v_flex()
      .id("deck-review-gate")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        cx.stop_propagation();
        this.shut();
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .bg(k.panel)
      .font_family(MONO)
      .text_size(12)
      .text_color(k.text)
      .child(
        h_flex()
          .items_center()
          .child(div().flex_1().child(heading("You haven't opened this diff yet", 22)))
          .child(div().text_size(11).text_color(k.muted).child("Esc")),
      )
      .child(
        div()
          .text_color(k.muted)
          .truncate()
          .child(issue ? `${issue.id} · PR #${issue.pr?.number ?? "?"} · ${issue.pr?.title ?? issue.title}` : "This issue is no longer in the store."),
      )
      .child(div().flex_1().text_color(k.text).line_height(1.4).child(`The changes at commit ${sha} have not been shown in Deck. ${what} still runs every other check.`))
      .child(
        h_flex()
          .justify_end()
          .gap(8)
          .child(button("review-cancel", "Cancel", "plain", () => this.shut()))
          .child(button("review-skip", this.busy ? "Merging…" : "Merge without reviewing", "ghost", (_e, cx) => this.proceed(cx), this.busy || !issue))
          .child(button("review-open", "Review diff", "primary", () => this.review(), this.busy || !issue)),
      );
  }
}
