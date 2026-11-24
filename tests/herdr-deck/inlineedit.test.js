import test from "node:test";
import assert from "node:assert/strict";
import { beginEdit, editKey, finishEdit } from "../../dot_config/herdr-app/mods/deck/lib/inlineedit.js";
import { planEdit, planOp } from "../../dot_config/herdr-app/mods/deck/lib/boardops.js";
import { editIssue, emptyStore } from "../../dot_config/herdr-app/mods/deck/lib/store.js";

const backlog = { key: "backlog|x", id: "B-3", kind: "backlog", title: "Old title", brief: "Old brief" };
const started = { key: "t1|s", id: "TF-8", title: "Gate", brief: "Do the gate", edits: null, stage: "build" };
const store = () => ({ ...emptyStore(), issues: [backlog, started], log: [] });

/** What the view does when an editor closes: finishEdit, then the shared edit path (planEdit + editIssue). */
function close(s, st, how, text) {
  const r = finishEdit(st, how, text);
  if (!r.edit) return { store: s, restore: r.restore };
  const p = planEdit(r.edit);
  assert.ok(!("error" in p));
  return { store: editIssue(s, st.key, p.edit, 1000, "you"), restore: r.restore };
}

test("beginEdit remembers the old text; only title and brief", () => {
  assert.deepEqual(beginEdit(backlog, "title"), { key: "backlog|x", field: "title", original: "Old title" });
  assert.deepEqual(beginEdit({ key: "k", title: "T" }, "brief"), { key: "k", field: "brief", original: "" });
  assert.equal(beginEdit(backlog, "stage"), null);
  assert.equal(beginEdit(null, "title"), null);
});

test("editKey: Enter saves the title, ⌘↵ saves the brief (Enter is a newline), esc cancels", () => {
  assert.equal(editKey({ key: "enter" }, "title"), "save");
  assert.equal(editKey({ key: "enter", shift: true }, "title"), null);
  assert.equal(editKey({ key: "enter" }, "brief"), null);
  assert.equal(editKey({ key: "enter", mod: true, cmd: true }, "brief"), "save");
  assert.equal(editKey({ key: "enter", mod: true, held: true }, "brief"), null);
  assert.equal(editKey({ key: "escape" }, "title"), "cancel");
  assert.equal(editKey({ key: "escape" }, "brief"), "cancel");
  assert.equal(editKey({ key: "a" }, "title"), null);
});

test("save: a backlog card's title and brief are stored as its own", () => {
  let s = store();
  ({ store: s } = close(s, beginEdit(backlog, "title"), "save", "  New title  "));
  ({ store: s } = close(s, beginEdit(s.issues[0], "brief"), "save", "Line one\nLine two"));
  const b = s.issues.find((i) => i.key === backlog.key);
  assert.equal(b.title, "New title");
  assert.equal(b.brief, "Line one\nLine two");
  assert.deepEqual(s.log.map((e) => e.what), ["title edited by you", "brief edited by you"]);
});

test("save: a started card keeps the edit in `edits` (it outlives what the terminal reports)", () => {
  let s = store();
  ({ store: s } = close(s, beginEdit(started, "title"), "save", "Gate v2"));
  ({ store: s } = close(s, beginEdit(s.issues[1], "brief"), "save", "New brief"));
  const t = s.issues.find((i) => i.key === started.key);
  assert.equal(t.title, "Gate v2");
  assert.deepEqual(t.edits, { title: "Gate v2", brief: "New brief" });
});

test("click-away (blur) saves the same as Enter", () => {
  const st = beginEdit(backlog, "title");
  assert.deepEqual(finishEdit(st, "blur", "Clicked away"), finishEdit(st, "save", "Clicked away"));
  const { store: s } = close(store(), st, "blur", "Clicked away");
  assert.equal(s.issues[0].title, "Clicked away");
  const b = close(store(), beginEdit(backlog, "brief"), "blur", "Brief by blur");
  assert.equal(b.store.issues[0].brief, "Brief by blur");
});

test("esc cancels: nothing stored, the old text comes back", () => {
  const s0 = store();
  for (const field of ["title", "brief"]) {
    const st = beginEdit(started, field);
    const r = finishEdit(st, "cancel", "typed but cancelled");
    assert.deepEqual(r, { edit: null, restore: started[field] });
    assert.equal(close(s0, st, "cancel", "typed but cancelled").store, s0);
  }
});

test("no change, an unchanged title after trimming, or an empty title stores nothing and restores", () => {
  const st = beginEdit(backlog, "title");
  assert.deepEqual(finishEdit(st, "save", "Old title"), { edit: null, restore: "Old title" });
  assert.deepEqual(finishEdit(st, "blur", " Old title "), { edit: null, restore: "Old title" });
  assert.deepEqual(finishEdit(st, "save", "   "), { edit: null, restore: "Old title" });
  assert.deepEqual(finishEdit(beginEdit(backlog, "brief"), "blur", "Old brief"), { edit: null, restore: "Old brief" });
  // An emptied brief is an edit (a brief may be blank).
  assert.deepEqual(finishEdit(beginEdit(backlog, "brief"), "save", ""), { edit: { brief: "" }, restore: null });
});

test("a closed editor ends once: the blur after esc does nothing", () => {
  assert.deepEqual(finishEdit(null, "blur", "x"), { edit: null, restore: null });
});

test("planEdit is the same check herdr-board edit uses", () => {
  assert.deepEqual(planEdit({ title: " T " }), { edit: { title: "T" } });
  assert.deepEqual(planEdit({ brief: "" }), { edit: { brief: "" } });
  assert.equal(planEdit({ title: " " }).error, "the title cannot be empty");
  assert.equal(planEdit({}).error, "edit needs --title or --brief");
  const op = { id: "e", t: 1, op: "edit", ref: "B-3", from: "chat", title: " T ", brief: "B" };
  assert.deepEqual(planOp(op, [backlog], "chat"), { issue: backlog, edit: { title: "T", brief: "B" } });
});

test("an in-place edit of a started card survives a restart (shared.json round trip) and the next terminal report", async () => {
  const { reconcile } = await import("../../dot_config/herdr-app/mods/deck/lib/store.js");
  const ob = { terminal: "t7", status: "working", title: "from terminal", cwd: "/x", repo: "taskflow", root: "/x",
    branch: "fix/x", commitsAhead: 0, pr: null, ghError: null, claims: [], prompt: null, brief: "first prompt", replied: false };
  let s = reconcile(emptyStore(), [ob], 1);
  const card = s.issues[0];
  ({ store: s } = close(s, beginEdit(card, "title"), "save", "Edited in Deck"));
  ({ store: s } = close(s, beginEdit(s.issues[0], "brief"), "blur", "Edited brief"));
  // Herdr persists the store as JSON in shared.json; a restart reads it back.
  s = JSON.parse(JSON.stringify(s));
  s = reconcile(s, [{ ...ob, title: "terminal renamed" }], 5);
  assert.equal(s.issues[0].title, "Edited in Deck");
  assert.equal(s.issues[0].brief, "Edited brief");
});
