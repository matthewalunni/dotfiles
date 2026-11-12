// New task, opened as a dialog with props { view: "newtask", repo } by N
// (Command, Issues list or board) or the + New task button in the Issues
// header. "goes to the Backlog · nothing starts yet". Repo chips (the repos of
// the issues and backlog entries, plus Choose folder…), a Title input and a
// Brief textarea. The dialog owns the keyboard: typing is only text
// (lib/newtask.js dialogKeyNewTask); ⌘↵ adds, esc cancels, Tab / Shift-Tab
// move, Enter in Title goes to Brief. Adding is data.js fileTask: the
// herdr-backlog script with argv only; on failure the error shows here and the
// text stays. Nothing starts.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, shared, openOverlay, closeOverlay, notify, home, pickFolder } from "herdr";
import { currentStore, fileTask, SEL_KEY } from "../data.js";
import { repoChoices, defaultRepo, dialogKeyNewTask } from "../lib/newtask.js";
import { repoColor } from "../lib/board.js";
import { remember, dialogBeat, forgetDialog, anyDialogOpen } from "./merge.js";
import { MONO, tokens, label, heading, button, keyChip, keyOf } from "./ui.js";

// Its slot in the dialog registry (merge.js): one New task at a time, and N stays off while it is up.
const KEY = "deck:newtask";
const BRIEF_HINT = "What's wrong or wanted, where it lives, what done looks like, and what proof to attach.";

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
    .px(9)
    .py(3)
    .border_1()
    .border_color(k.brand)
    .text_color(k.brand)
    .cursor_pointer()
    .hover((s) => s.bg(k.raised))
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
    this.root = typeof p.repo === "string" && p.repo ? p.repo : null;
    this.error = null;
    this.busy = false;
    this.field = "title";
    this.handle = cx.focus_handle();
    this.title = InputState.new({ placeholder: "Short title" });
    this.brief = TextareaState.new({ placeholder: BRIEF_HINT, rows: 5 });
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
    this.title.focus();
    dialogBeat(KEY, p.overlay);
    cx.timer.every(1000, () => dialogBeat(KEY, p.overlay));
  }

  shut() {
    const p = props() ?? {};
    if (p.overlay) {
      forgetDialog(KEY, p.overlay);
      closeOverlay(p.overlay);
    }
  }

  /** Tab / Shift-Tab: Title ↔ Brief. */
  move(d) {
    const next = this.field === "title" ? "brief" : this.field === "brief" ? "title" : d > 0 ? "title" : "brief";
    (next === "title" ? this.title : this.brief).focus();
  }

  submit(cx) {
    if (this.busy) return;
    this.busy = true;
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
        .px(10)
        .py(5)
        .border_1()
        .border_color(on ? k.brand : k.line)
        .text_color(on ? k.strong : k.text)
        .cursor_pointer()
        .hover((s) => s.bg(k.raised))
        .on_click((_e, cx) => {
          this.root = c.root;
          this.error = null;
          cx.notify();
        })
        .child(div().flex_none().w(7).h(7).bg(repoColor(c.name, k.repo)))
        .child(c.name);
    };
    const field = (title, on, body) =>
      v_flex()
        .gap(6)
        .child(label(title))
        .child(div().px(10).py(8).border_1().border_color(on ? k.brand : k.line).bg(k.bg).cursor_text().child(body));
    return v_flex()
      .id("deck-new-task")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const d = dialogKeyNewTask(keyOf(e), this.field);
        if (!d) return; // text for the input: never a Deck shortcut
        cx.stop_propagation();
        if (d === "cancel") this.shut();
        else if (d === "submit") this.submit(cx);
        else this.move(d === "next" ? 1 : -1);
      })
      .size_full()
      .min_h(0)
      .px(24)
      .py(22)
      .gap(16)
      .bg(k.panel)
      .border_1()
      .border_color(k.brand)
      .font_family(MONO)
      .text_size(12)
      .text_color(k.text)
      .child(
        h_flex()
          .items_baseline()
          .gap(12)
          .child(heading("New task", 22))
          .child(div().text_color(k.muted).child("goes to the Backlog · nothing starts yet")),
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
                  .px(10)
                  .py(5)
                  .border_1()
                  .border_dashed()
                  .border_color(k.line)
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
      .child(field("Brief · what the agent will be told", this.field === "brief", Textarea.new(this.brief).w_full().h(96).text_size(12).text_color(k.strong)))
      .when(Boolean(this.error), (el) => el.child(div().px(10).py(8).border_1().border_color(k.fail).text_color(k.fail).child(String(this.error))))
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().flex_1().min_w(0).truncate().text_color(k.muted).child("tab next field · typing never triggers shortcuts"))
          .child(button("nt-cancel", "Cancel", "plain", () => this.shut(), false, "esc"))
          .child(button("nt-add", this.busy ? "Adding…" : "Add to Backlog", "brand", (_e, cx) => this.submit(cx), this.busy, "⌘↵")),
      );
  }
}
