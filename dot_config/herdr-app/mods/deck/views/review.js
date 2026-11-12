// Review soft gate, opened as a dialog with props
// { view: "review", key, headSha, next: "merge"|"ship"|"anyway" } when a merge
// button is pressed before the diff for that head was opened. "Review diff"
// shows the PR tab (its Changes); "Merge without reviewing" carries on to the
// merge confirm (confirm.js, next = merge | ship | anyway), which merges only
// when confirmed there. Keys (lib/dialogkeys.js): ↵ Review diff, the opening
// key again (M, or ⇧M for ship) Merge without reviewing, Esc / Cancel close.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay, setShared } from "herdr";
import { currentStore, showView, SEL_KEY, TAB_KEY } from "../data.js";
import { openConfirm, dialogBeat, forgetDialog } from "./merge.js";
import { MONO, tokens, heading, button, keyChip, keyOf } from "./ui.js";
import { dialogKey, confirmKeyLabel } from "../lib/dialogkeys.js";

export default class ReviewGateView extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    // "This issue has a merge dialog up" (merge.js mergeKey): a heartbeat.
    const p = props() ?? {};
    dialogBeat(p.key, p.overlay);
    cx.timer.every(1000, () => dialogBeat(p.key, p.overlay));
  }

  shut() {
    const p = props() ?? {};
    if (p.overlay) {
      forgetDialog(p.key, p.overlay);
      closeOverlay(p.overlay);
    }
  }

  review() {
    const p = props() ?? {};
    setShared(SEL_KEY, p.key);
    setShared(TAB_KEY, "pr");
    showView("deck-issues");
    this.shut();
  }

  /** On to the confirm for the same merge, pinned to the head this gate showed. */
  proceed() {
    const p = props() ?? {};
    const issue = currentStore().issues.find((i) => i.key === p.key);
    if (!issue) return;
    const next = p.next === "ship" || p.next === "merge" ? p.next : "anyway";
    this.shut();
    openConfirm(issue, p.headSha ?? null, next);
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
        const d = dialogKey(keyOf(e), { kind: "review", next: p.next });
        if (!d) return;
        cx.stop_propagation();
        if (d === "cancel") this.shut();
        else if (d === "review" && issue) this.review();
        else if (d === "proceed" && issue) this.proceed();
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
          .child(keyChip("esc")),
      )
      .child(
        div()
          .text_color(k.muted)
          .truncate()
          .child(issue ? `${issue.id} · PR #${issue.pr?.number ?? "?"} · ${issue.pr?.title ?? issue.title}` : "This issue is no longer in the store."),
      )
      .child(div().flex_1().text_color(k.text).line_height(1.4).child(`The changes at commit ${sha} have not been shown in Deck. ${what} still runs every other check, then asks you to confirm.`))
      .child(
        h_flex()
          .justify_end()
          .gap(8)
          .child(button("review-cancel", "Cancel", "plain", () => this.shut(), false, "esc"))
          .child(button("review-skip", "Merge without reviewing", "ghost", () => this.proceed(), !issue, confirmKeyLabel(p.next)))
          .child(button("review-open", "Review diff", "primary", () => this.review(), !issue, "↵")),
      );
  }
}
