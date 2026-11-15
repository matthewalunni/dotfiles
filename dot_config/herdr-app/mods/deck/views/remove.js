// Remove an issue, opened as a dialog with props { view: "remove", key } by D
// (or the Dismiss button) on an agent issue. Two ways out:
//   Dismiss (D again): off the board now; the card comes back if the agent works again.
//   Delete (X): the card goes and this agent session is never tracked again.
// Both change only Deck's record; the terminal, branch and PR are untouched.
// Esc / Cancel close it; a held key never counts (lib/dialogkeys.js, kind "remove").
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, openOverlay, closeOverlay, shared } from "herdr";
import { currentStore, dismiss, deleteIssue, VIEW_KEY, SEL_KEY, ISSUE_FROM_KEY } from "../data.js";
import { backTarget } from "../lib/issuepage.js";
import { dialogKey } from "../lib/dialogkeys.js";
import { remember, dialogOpen, dialogBeat, forgetDialog } from "./merge.js";
import { goTo } from "./focus.js";
import { MONO, tokens, heading, button, keyChip, keyOf } from "./ui.js";

const liveIssue = (key) => currentStore().issues.find((i) => i.key === key && i.kind !== "backlog") ?? null;

/**
 * D on an agent issue: opens the dialog (one per issue). Returns whether it opened.
 * @param {any} host the view (host.busy blocks it) @param {any} issue
 */
export function removeKey(host, issue) {
  if (!issue || issue.kind === "backlog" || host?.busy) return false;
  if (dialogOpen(issue)) return false;
  remember(issue, openOverlay({ mod: "deck", props: { view: "remove", key: issue.key }, kind: "dialog", width: 520 }));
  return true;
}

export default class RemoveView extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
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

  /** Dismiss or delete, then leave the issue page if it was showing this issue. */
  finish(how) {
    const issue = liveIssue((props() ?? {}).key);
    if (!issue) return this.shut();
    const onPage = shared(VIEW_KEY) === "deck-issue" && shared(SEL_KEY) === issue.key;
    if (how === "delete") deleteIssue(issue);
    else dismiss(issue);
    this.shut();
    if (onPage) {
      const b = backTarget(shared(ISSUE_FROM_KEY));
      goTo(b.child, { agent: b.focus });
    }
  }

  render(_cx) {
    const k = tokens();
    const issue = liveIssue((props() ?? {}).key);
    const line = (key, name, what) =>
      h_flex().gap(10).items_start()
        .child(div().flex_none().w(28).child(keyChip(key)))
        .child(v_flex().gap(2).child(div().text_color(k.strong).child(name)).child(div().text_color(k.muted).line_height(1.5).child(what)));
    return v_flex()
      .id("deck-remove")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const d = dialogKey(keyOf(e), { kind: "remove" });
        if (!d) return;
        cx.stop_propagation();
        if (d === "cancel") this.shut();
        else this.finish(d);
      })
      .size_full()
      .min_h(0)
      .px(22)
      .py(20)
      .gap(14)
      .bg(k.panel)
      .border_1()
      .border_color(k.brand)
      .font_family(MONO)
      .text_size(12)
      .text_color(k.text)
      .child(
        h_flex()
          .items_center()
          .child(div().flex_1().child(heading(issue ? `Remove ${issue.id}?` : "Remove this issue?", 20)))
          .child(keyChip("esc")),
      )
      .child(
        !issue
          ? div().text_color(k.muted).child("This issue is already gone.")
          : v_flex()
            .gap(12)
            .child(div().text_color(k.strong).truncate().child(issue.title || "untitled"))
            .child(line("D", "Dismiss", "Off the board now. It comes back if the agent starts working again."))
            .child(line("X", "Delete", "Gone for good: Deck stops tracking this agent session. A new agent in that terminal gets a new card."))
            .child(div().text_color(k.muted).child("Only Deck's card changes. The terminal, branch and PR are untouched.")),
      )
      .child(
        h_flex()
          .justify_end()
          .gap(8)
          .child(button("remove-cancel", "Cancel", "plain", () => this.shut(), false, "esc"))
          .child(button("remove-dismiss", "Dismiss", "plain", () => this.finish("dismiss"), !issue, "D"))
          .child(button("remove-delete", "Delete", "brand", () => this.finish("delete"), !issue, "X")),
      );
  }
}
