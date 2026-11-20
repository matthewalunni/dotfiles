// New task, opened as a dialog with props { view: "newtask", repo? } by N
// (Chat, Issues list or board), the + New task button in the Issues header,
// and from any layout by the global ⌘⇧N (the deck-new mod opens this same view,
// without a repo: the selected issue's is the default then). Repo chips (the
// repos of the issues and backlog entries, plus Choose folder…), a Title input,
// a Brief textarea and a Just a terminal checkbox. The dialog owns the
// keyboard: typing is only text (lib/newtask.js dialogKeyNewTask); ⌘↵ starts
// now, ⌥⌘↵ adds to the Backlog, esc cancels, Tab / Shift-Tab move, Enter in
// Title goes to Brief, Space on the checkbox toggles it.
// Start now is data.js startNow: the backlog Start's path (worktree, space.new
// with claude and the brief, or with Just a terminal the default shell), then
// the new space is selected. No S, S confirm: Matt typed it and pressed ⌘↵.
// Adding is data.js fileTask: the herdr-backlog script with argv only; not with
// Just a terminal. On failure the error shows here and the text stays.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, shared, openOverlay, closeOverlay, notify, home, pickFolder } from "herdr";
import { currentStore, fileTask, startNow, SEL_KEY } from "../data.js";
import { repoChoices, defaultRepo, dialogKeyNewTask, oneAtATime, freshId, NO_TERMINAL_BACKLOG } from "../lib/newtask.js";
import { repoColor } from "../lib/board.js";
import { remember, dialogBeat, forgetDialog, anyDialogOpen, claimDialog } from "./merge.js";
import { MONO, tokens, label, heading, button, keyChip, keyOf, SANS } from "./ui.js";

// Its slot in the dialog registry (merge.js): one New task at a time, and N stays off while it is up.
const KEY = "deck:newtask";
const BRIEF_HINT = "What's wrong or wanted, where it lives, what done looks like, and what proof to attach.";
const BRIEF_HINT_TERMINAL = "Optional: a terminal starts with no task.";
// The dialog may draw only on the next frame: focus Title once it has (focus.js does the same).
const SETTLE_MS = 40;

const baseName = (p) => String(p).replace(/\/+$/, "").split("/").pop() || p;

/**
 * N / + New task. `selKey` is the issue the opener has selected (its repo is
 * the default). Returns whether it opened (not while another Deck dialog is up).
 * @param {string|null} [selKey]
 */
export function openNewTask(selKey = shared(SEL_KEY) ?? null) {
  if (anyDialogOpen()) return false;
  const repo = defaultRepo(currentStore().issues, selKey);
  remember({ key: KEY }, openOverlay({ mod: "deck", props: { view: "newtask", repo }, kind: "dialog", modal: true, width: 640 }));
  return true;
}

/** The + New task button (Issues header, list and board). */
export function newTaskButton(k) {
  return h_flex()
    .id("new-task")
    .flex_none()
    .items_center()
    .gap(7)
    .px(11)
    .h(26)
    .rounded(8)
    .bg(k.brandWash)
    .text_color(k.brand)
    .font_weight(600)
    .text_size(12)
    .cursor_pointer()
    .hover((s) => s.opacity(0.85))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      openNewTask();
    })
    .child(keyChip("N", k.brand, k.brand))
    .child("+ New task");
}

export default class NewTaskView extends View {
  init(_p, cx) {
    const p = props() ?? {};
    // Opened by ⌘⇧N over another Deck dialog: don't stack, close at once.
    if (!claimDialog(KEY, p.overlay)) {
      this.closed = true;
      if (p.overlay) cx.spawn(async () => closeOverlay(p.overlay));
    }
    this.root = typeof p.repo === "string" && p.repo ? p.repo : defaultRepo(currentStore().issues, shared(SEL_KEY) ?? null);
    this.error = null;
    this.busy = false;
    this.terminal = false; // Just a terminal
    this.id = freshId(); // the entry id a Start now uses (kept for a retry)
    this.pendingWorktree = null; // a worktree a lost start left, reused by the next ⌘↵
    this.startOnce = oneAtATime((form) => startNow(form));
    this.field = "title";
    this.handle = cx.focus_handle();
    this.termHandle = cx.focus_handle();
    this.title = InputState.new({ placeholder: "Short title" });
    // Its placeholder is drawn by the view, so it wraps (the state's own stays on one line).
    this.brief = TextareaState.new({ rows: 5 });
    this.brief.on("change", (_e, cx) => cx.notify());
    this.brief.set_soft_wrap(true);
    const on = (state, name) => {
      state.on("focus", (_e, cx) => {
        this.field = name;
        cx.notify();
      });
      state.on("blur", (_e, cx) => {
        if (this.field === name) this.field = null;
        cx.notify();
      });
    };
    on(this.title, "title");
    on(this.brief, "brief");
    // Enter in Title (should the key reach the input): on to Brief.
    this.title.on("submit", () => this.brief.focus());
    // The keyboard is in Title at once: now, and again a beat later once the dialog has drawn.
    const takeTitle = () => {
      try {
        if (this.field !== "brief") {
          this.title.focus();
          this.field = "title";
        }
      } catch {
        // closed meanwhile
      }
    };
    takeTitle();
    cx.timer.after(SETTLE_MS, (cx) => {
      takeTitle();
      cx.notify();
    });
    dialogBeat(KEY, p.overlay);
    cx.timer.every(1000, () => dialogBeat(KEY, p.overlay));
  }

  /** esc / Cancel: ignored while a filing is in flight (it can't be cancelled). */
  cancel() {
    if (!this.busy) this.shut();
  }

  shut() {
    if (this.closed) return;
    this.closed = true;
    const p = props() ?? {};
    if (p.overlay) {
      forgetDialog(KEY, p.overlay);
      closeOverlay(p.overlay);
    }
  }

  /** Which control has the keyboard: Title, Brief or the checkbox. */
  focusedField() {
    try {
      if (this.termHandle.is_focused()) return "terminal";
    } catch {
      // closed meanwhile
    }
    return this.field === "terminal" ? null : this.field;
  }

  /** Tab / Shift-Tab: Title → Brief → Just a terminal → Title. */
  move(d) {
    const order = ["title", "brief", "terminal"];
    const at = order.indexOf(this.focusedField() ?? "");
    const next = at < 0 ? (d > 0 ? "title" : "terminal") : order[(at + (d > 0 ? 1 : 2)) % 3];
    if (next === "terminal") {
      this.field = "terminal";
      this.termHandle.focus();
    } else (next === "title" ? this.title : this.brief).focus();
  }

  toggleTerminal(cx) {
    if (this.busy) return;
    this.terminal = !this.terminal;
    this.error = null;
    cx.notify();
  }

  /** ⌘↵ / Start now: no second confirm (Matt typed it and pressed ⌘↵). */
  start(cx) {
    if (this.busy) return;
    this.busy = "start";
    this.error = null;
    cx.notify();
    const form = {
      id: this.id, title: this.title.value(), brief: this.brief.value(), root: this.root,
      terminal: this.terminal, pendingWorktree: this.pendingWorktree,
    };
    cx.spawn(async (cx) => {
      let next;
      try {
        next = await this.startOnce(form);
      } catch (e) {
        next = { done: false, error: String(e?.message ?? e) };
      }
      if (next === null) return; // a press while one is in flight
      this.busy = false;
      if (next.done) {
        notify({ title: form.terminal ? "Terminal started" : "Agent started", body: String(form.title).trim(), level: "success" });
        this.shut();
      } else {
        this.error = next.error ?? "Could not start";
        if (next.pendingWorktree) this.pendingWorktree = next.pendingWorktree;
      }
      cx.notify();
    });
  }

  /** ⌥⌘↵ / Add to Backlog: not with Just a terminal. */
  submit(cx) {
    if (this.busy) return;
    if (this.terminal) {
      this.error = NO_TERMINAL_BACKLOG;
      cx.notify();
      return;
    }
    this.busy = "backlog";
    this.error = null;
    cx.notify();
    const form = { title: this.title.value(), brief: this.brief.value(), root: this.root };
    cx.spawn(async (cx) => {
      let next;
      try {
        next = await fileTask(form);
      } catch (e) {
        next = { done: false, error: String(e?.message ?? e) };
      }
      this.busy = false;
      if (next.done) {
        notify({ title: "Added to the Backlog", body: String(form.title).trim(), level: "success" });
        this.shut();
      } else this.error = next.error ?? "Could not add the task";
      cx.notify();
    });
  }

  choose(cx) {
    cx.spawn(async (cx) => {
      let path = null;
      try {
        path = await pickFolder({ prompt: "Use repo" });
      } catch (e) {
        this.error = "Could not open the folder picker: " + String(e?.message ?? e);
      }
      if (typeof path === "string" && path) {
        this.root = path.replace(/\/+$/, "") || path;
        this.error = null;
      }
      cx.notify();
    });
  }

  render(_cx) {
    const k = tokens();
    const termOn = this.focusedField() === "terminal";
    const chips = repoChoices(currentStore().issues);
    if (this.root && !chips.some((c) => c.root === this.root)) chips.push({ root: this.root, name: baseName(this.root) });
    const hm = String(home() ?? "").replace(/\/+$/, "");
    const tilde = (x) => (hm && String(x).startsWith(hm + "/") ? "~" + String(x).slice(hm.length) : String(x));
    const chip = (c, i) => {
      const on = c.root === this.root;
      return h_flex()
        .id("nt-repo-" + i)
        .flex_none()
        .items_center()
        .gap(7)
        .px(11)
        .py(6)
        .rounded(8)
        .bg(on ? k.brandWash : k.wash)
        .text_color(on ? k.strong : k.text)
        .cursor_pointer()
        .hover((s) => s.bg(k.raised))
        .on_click((_e, cx) => {
          this.root = c.root;
          this.error = null;
          cx.notify();
        })
        .child(div().flex_none().w(7).h(7).rounded(3).bg(repoColor(c.name, k.repo)))
        .child(c.name);
    };
    const field = (title, on, body) =>
      v_flex()
        .gap(6)
        .child(label(title))
        .child(div().px(12).py(9).rounded(8).border_1().border_color(on ? k.brand : k.hair).bg(k.bg).cursor_text().child(body));
    return v_flex()
      .id("deck-new-task")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const d = dialogKeyNewTask(keyOf(e), this.focusedField());
        if (!d) return; // text for the input: never a Deck shortcut
        cx.stop_propagation();
        if (d === "cancel") this.cancel();
        else if (d === "start") this.start(cx);
        else if (d === "backlog") this.submit(cx);
        else if (d === "toggle") this.toggleTerminal(cx);
        else this.move(d === "next" ? 1 : -1);
      })
      .size_full()
      .min_h(0)
      .px(24)
      .py(22)
      .gap(16)
      .bg(k.panel)
      .border_1()
      .border_color(k.hair)
      .font_family(SANS)
      .text_size(12)
      .text_color(k.text)
      .child(
        h_flex()
          .items_baseline()
          .gap(12)
          .child(heading("New task", 24))
          .child(div().text_color(k.muted).child(this.terminal ? "⌘↵ opens a terminal in a new worktree" : "⌘↵ starts an agent now · ⌥⌘↵ files it to the Backlog")),
      )
      .child(
        v_flex()
          .gap(6)
          .child(label("Repo"))
          .child(
            h_flex()
              .flex_wrap()
              .gap(6)
              .children(chips.map(chip))
              .child(
                div()
                  .id("nt-choose")
                  .flex_none()
                  .px(11)
                  .py(6)
                  .rounded(8)
                  .bg(k.wash)
                  .text_color(k.muted)
                  .cursor_pointer()
                  .hover((s) => s.text_color(k.strong))
                  .on_click((_e, cx) => this.choose(cx))
                  .child("Choose folder…"),
              ),
          )
          .child(div().text_color(k.muted).truncate().child(this.root ? tilde(this.root) : "No repo yet: choose a folder")),
      )
      .child(field("Title", this.field === "title", Input.new(this.title).w_full().text_size(12).text_color(k.strong)))
      .child(field(this.terminal ? "Brief · optional" : "Brief · what the agent will be told", this.field === "brief",
        div()
          .relative()
          .w_full()
          .h(96)
          .when(!this.brief.value(), (el) =>
            el.child(div().absolute().top(0).left(0).right(0).whitespace_normal().line_height(1.55).text_color(k.muted)
              .child(this.terminal ? BRIEF_HINT_TERMINAL : BRIEF_HINT)))
          .child(Textarea.new(this.brief).w_full().h(96).text_size(12).text_color(k.strong))))
      .child(this.checkbox(k, termOn))
      .when(Boolean(this.error), (el) => el.child(div().px(12).py(9).rounded(8).bg(k.fail + "1f").text_color(k.fail).child(String(this.error))))
      .child(
        h_flex()
          .items_center()
          .gap(8)
          // The keys are on the buttons; the room left says why Add to Backlog is off.
          .child(div().flex_1().min_w(0).text_color(k.muted).whitespace_normal()
            .child(this.terminal ? "terminals don't go to the Backlog" : ""))
          .child(button("nt-cancel", "Cancel", "plain", () => this.cancel(), Boolean(this.busy), "esc"))
          .child(button("nt-add", this.busy === "backlog" ? "Adding…" : "Add to Backlog", "ghost", (_e, cx) => this.submit(cx),
            Boolean(this.busy) || this.terminal, "⌥⌘↵"))
          .child(button("nt-start", this.busy === "start" ? "Starting…" : "Start now", "brand", (_e, cx) => this.start(cx),
            Boolean(this.busy), "⌘↵")),
      );
  }

  /** The Just a terminal checkbox: Tab reaches it, Space or a click toggles it. */
  checkbox(k, on) {
    return h_flex()
      .id("nt-terminal")
      .track_focus(this.termHandle)
      .flex_none()
      .items_center()
      .gap(9)
      .px(10)
      .py(6)
      .rounded(8)
      .cursor_pointer()
      .on_click((_e, cx) => {
        this.field = "terminal";
        this.termHandle.focus();
        this.toggleTerminal(cx);
      })
      .child(
        div()
          .flex_none()
          .w(16)
          .h(16)
          .rounded(5)
          .border_1()
          .border_color(this.terminal ? k.brand : k.line)
          .flex()
          .items_center()
          .justify_center()
          .text_size(11)
          .text_color(k.holdInk)
          .when(this.terminal, (el) => el.bg(k.brand).child("✓")),
      )
      .child(div().text_color(this.terminal ? k.strong : k.text).child("Just a terminal"))
      .child(div().text_color(k.muted).child("· a shell in a new worktree, no agent, brief optional"));
  }
}
