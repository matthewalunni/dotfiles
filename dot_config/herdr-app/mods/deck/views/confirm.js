// Merge confirmation, opened as a dialog with props
// { view: "confirm", key, headSha, next }. next "anyway" (default): "Merge
// anyway" — it lists what is missing (from the lock state each time it draws).
// next "merge" / "ship": the M / ⇧M keys' confirm (a key never merges on its
// own). On confirm it merges pinned to `headSha` (the head shown when it
// opened), so a push since then makes GitHub refuse. Esc / Cancel close it;
// Enter does nothing.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay, notify } from "herdr";
import { currentStore, mergeAnyway, merge, mergeAndShip } from "../data.js";
import { lockOf } from "./merge.js";
import { MONO, tokens, label, heading, button, dot, act, keyChip } from "./ui.js";

export default class ConfirmView extends View {
  init(_p, cx) {
    this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  shut() {
    const id = (props() ?? {}).overlay;
    if (id) closeOverlay(id);
  }

  confirm(cx) {
    const p = props() ?? {};
    const issue = currentStore().issues.find((i) => i.key === p.key);
    if (!issue || this.busy) return;
    this.busy = true;
    cx.notify();
    if (p.next === "merge" || p.next === "ship") {
      const ship = p.next === "ship";
      act(cx, () => (ship ? mergeAndShip(issue, p.headSha) : merge(issue, p.headSha)), ship ? "Merge + ship failed" : "Merge failed", (_r, cx) => {
        this.busy = false;
        this.shut();
        cx.notify();
      });
      return;
    }
    cx.spawn(async (cx) => {
      let r;
      try {
        r = await mergeAnyway(issue, p.headSha);
      } catch (e) {
        r = { ok: false, error: String(e?.message ?? e) };
      }
      if (r.ok) notify({ title: `Merged PR #${issue.pr?.number ?? ""}`, level: "success" });
      else notify({ title: "Merge anyway failed", body: r.error ?? "unknown error", level: "error" });
      this.busy = false;
      this.shut();
      cx.notify();
    });
  }

  render(cx) {
    const k = tokens();
    const p = props() ?? {};
    const issue = currentStore().issues.find((i) => i.key === p.key) ?? null;
    const reasons = issue ? lockOf(issue).reasons : [];
    const sha = typeof p.headSha === "string" ? p.headSha.slice(0, 7) : null;
    const ready = Boolean(issue?.pr && sha);
    const plain = p.next === "merge" || p.next === "ship";
    const what = p.next === "ship" ? "Merge + ship" : "Merge";
    return v_flex()
      .id("deck-confirm")
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
          .child(div().flex_1().child(heading(plain ? `${what} this PR?` : "Merge without full proof?", 22)))
          .child(keyChip("esc")),
      )
      .child(
        div()
          .text_color(k.muted)
          .truncate()
          .child(issue ? `${issue.id} · PR #${issue.pr?.number ?? "?"} · ${issue.pr?.title ?? issue.title}` : "This issue is no longer in the store."),
      )
      .when(!plain, (el) => el.child(label("Missing", k.nodata)))
      .when(!plain, (el) => el.child(
        v_flex()
          .id("confirm-reasons")
          .flex_1()
          .min_h(0)
          .gap(6)
          .overflow_y_scrollbar()
          .when(!reasons.length, (el) => el.child(div().text_color(k.muted).child("Nothing listed.")))
          .children(
            reasons.map((r) =>
              h_flex()
                .gap(8)
                .items_start()
                .child(div().mt(4).child(dot(/failing/.test(r) ? k.fail : k.nodata, 7, true)))
                .child(div().flex_1().min_w(0).text_color(k.strong).child(r)),
            ),
          ),
      ))
      .when(plain, (el) => el.child(div().flex_1().text_color(k.text).line_height(1.4).child(p.next === "ship" ? "Every claim passes. Squash-merges, then tells the agent “merged — ship it”." : "Every claim passes. Squash-merges into the base branch.")))
      .child(
        div()
          .text_color(k.muted)
          .line_height(1.4)
          .child(ready ? `Squash-merges now, at commit ${sha}. If the branch moved since this opened, GitHub refuses.` : "No head commit known — cannot merge from here."),
      )
      .child(
        h_flex()
          .justify_end()
          .gap(8)
          .child(button("confirm-cancel", "Cancel", "plain", () => this.shut(), false, "esc"))
          .child(button("confirm-merge", this.busy ? "Merging…" : plain ? what : "Merge anyway", plain ? "primary" : "danger", (_e, cx) => this.confirm(cx), this.busy || !ready)),
      );
  }
}
