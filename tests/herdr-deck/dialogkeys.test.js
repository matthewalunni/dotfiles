import test from "node:test";
import assert from "node:assert/strict";
import { dialogKey } from "../../dot_config/herdr-app/mods/deck/lib/dialogkeys.js";

const k = (key, o = {}) => ({ key, shift: false, cmd: false, held: false, ...o });

test("confirm: the key that opened it confirms", () => {
  assert.equal(dialogKey(k("m"), { kind: "confirm", next: "merge" }), "confirm");
  assert.equal(dialogKey(k("m"), { kind: "confirm", next: "anyway" }), "confirm");
  assert.equal(dialogKey(k("m"), { kind: "confirm" }), "confirm"); // default is anyway
  assert.equal(dialogKey(k("m", { shift: true }), { kind: "confirm", next: "ship" }), "confirm");
  assert.equal(dialogKey(k("M", { shift: true }), { kind: "confirm", next: "ship" }), "confirm");
});
test("confirm: stray keys are null", () => {
  const c = { kind: "confirm", next: "merge" };
  for (const key of ["enter", "j", "y", "1", "space", "n"]) assert.equal(dialogKey(k(key), c), null);
  assert.equal(dialogKey(k("m", { shift: true }), c), null);
  assert.equal(dialogKey(k("m"), { kind: "confirm", next: "ship" }), null);
  assert.equal(dialogKey(k("m", { cmd: true }), c), null);
  assert.equal(dialogKey(k("m", { shift: true }), { kind: "confirm", next: "anyway" }), null);
});
test("a held (repeating) key never confirms", () => {
  assert.equal(dialogKey(k("m", { held: true }), { kind: "confirm", next: "merge" }), null);
  assert.equal(dialogKey(k("m", { held: true }), { kind: "review", next: "merge" }), null);
  assert.equal(dialogKey(k("enter", { held: true }), { kind: "review", next: "merge" }), null);
});
test("esc cancels both", () => {
  assert.equal(dialogKey(k("escape"), { kind: "confirm", next: "merge" }), "cancel");
  assert.equal(dialogKey(k("escape"), { kind: "review", next: "ship" }), "cancel");
});
test("review gate: enter reviews, the opening key proceeds", () => {
  assert.equal(dialogKey(k("enter"), { kind: "review", next: "merge" }), "review");
  assert.equal(dialogKey(k("m"), { kind: "review", next: "merge" }), "proceed");
  assert.equal(dialogKey(k("m"), { kind: "review", next: "anyway" }), "proceed");
  assert.equal(dialogKey(k("m", { shift: true }), { kind: "review", next: "ship" }), "proceed");
  assert.equal(dialogKey(k("m"), { kind: "review", next: "ship" }), null);
  assert.equal(dialogKey(k("r"), { kind: "review", next: "merge" }), null);
});
test("unknown dialog is null", () => {
  assert.equal(dialogKey(k("m"), { kind: "other" }), null);
  assert.equal(dialogKey(k("m"), null), null);
});

test("remove: D again dismisses, X deletes, esc cancels; nothing else", () => {
  const r = { kind: "remove" };
  assert.equal(dialogKey(k("d"), r), "dismiss");
  assert.equal(dialogKey(k("x"), r), "delete");
  assert.equal(dialogKey(k("escape"), r), "cancel");
  for (const key of ["enter", "m", "s", "j"]) assert.equal(dialogKey(k(key), r), null);
  assert.equal(dialogKey(k("x", { held: true }), r), null);
  assert.equal(dialogKey(k("d", { cmd: true }), r), null);
});
