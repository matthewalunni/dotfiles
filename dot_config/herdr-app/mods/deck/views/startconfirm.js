// Backlog start confirm, opened as a dialog with props { view: "startconfirm", key }
// by S (or the Start agent button) on a backlog card. "Start an agent on B-n?"
// Pressing S again starts (lib/dialogkeys.js, kind "start"); Enter does nothing;
// Esc / Cancel close it; a held key never counts. Starting is data.js
// startBacklog: the worktree, then space.new with claude, then the entry is
// marked started. A failure is left on the card (START_ERR_KEY) and toasted.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, openOverlay, closeOverlay, notify, setShared, home } from "herdr";
import { currentStore, startBacklog, START_ERR_KEY } from "../data.js";
import { previewPlan } from "../lib/backlog.js";
import { dialogKey } from "../lib/dialogkeys.js";
import { remember, dialogOpen, dialogBeat, forgetDialog } from "./merge.js";
import { MONO, tokens, heading, button, keyChip, keyOf } from "./ui.js";

const liveEntry = (key) => currentStore().issues.find((i) => i.kind === "backlog" && i.key === key && !i.discarded) ?? null;

/**
 * S on a backlog card: opens the confirm (one per entry). Returns whether it opened.
 * @param {any} host the view (host.busy blocks it) @param {any} issue
 */
export function startKey(host, issue) {
  if (issue?.kind !== "backlog" || issue.discarded || host?.busy) return false;
  if (dialogOpen(issue)) return false;
  remember(issue, openOverlay({ mod: "deck", props: { view: "startconfirm", key: issue.key }, kind: "dialog", width: 520 }));
  return true;
}

export default class StartConfirmView extends View {
  init(_p, cx) {
    this.busy = false;
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

  start(cx) {
    const p = props() ?? {};
    const entry = liveEntry(p.key);
    if (!entry || this.busy) return;
    this.busy = true;
    setShared(START_ERR_KEY, null);
    cx.notify();
    cx.spawn(async (cx) => {
      let r;
      try {
        r = await startBacklog(entry);
      } catch (e) {
        r = { ok: false, error: String(e?.message ?? e) };
      }
      if (r.ok) notify({ title: `Started an agent on ${entry.id}`, body: "It shows up in Started.", level: "success" });
      else {
        setShared(START_ERR_KEY, { key: entry.key, error: r.error ?? "unknown error" });
        notify({ title: `Could not start ${entry.id}`, body: r.error ?? "unknown error", level: "error" });
      }
      this.busy = false;
      this.shut();
      cx.notify();
    });
  }

  render(_cx) {
    const k = tokens();
    const p = props() ?? {};
    const entry = liveEntry(p.key);
    const plan = entry ? previewPlan(entry, home()) : null;
    const branch = plan && "branch" in plan ? plan.branch : null;
    return v_flex()
      .id("deck-start-confirm")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const d = dialogKey(keyOf(e), { kind: "start" });
        if (!d) return;
        cx.stop_propagation();
        if (d === "cancel") this.shut();
        else if (d === "confirm" && entry && !this.busy) this.start(cx);
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
          .child(div().flex_1().child(heading(entry ? `Start an agent on ${entry.id}?` : "Start an agent?", 20)))
          .child(keyChip("esc")),
      )
      .child(
        !entry
          ? div().text_color(k.muted).child("This task is no longer in the Backlog.")
          : h_flex()
            .flex_wrap()
            .line_height(1.55)
            .child(div().child("Creates the worktree "))
            .child(div().text_color(k.strong).child(branch ?? "(branch)"))
            .child(div().child(` in ${entry.repo ?? "the repo"} and starts claude with the brief. Nothing is merged or pushed.`)),
      )
      .child(
        h_flex()
          .justify_end()
          .gap(8)
          .child(button("start-cancel", "Cancel", "plain", () => this.shut(), false, "esc"))
          .child(button("start-go", this.busy ? "Starting…" : "Start", "brand", (_e, cx) => this.start(cx), this.busy || !entry, "S")),
      );
  }
}
