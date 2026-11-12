import test from "node:test";
import assert from "node:assert/strict";
import { keyAction } from "../../dot_config/herdr-app/mods/deck/lib/keys.js";

const ctx = (o = {}) => ({ view: "issues", mode: "list", tab: "overview", typing: false, optionCount: 3, hasIssue: true, ...o });
const k = (key, o = {}) => ({ key, shift: false, cmd: false, ...o });

test("ignores letters while typing", () => {
  for (const key of ["m", "t", "1", "j", "r", "enter"]) assert.equal(keyAction(k(key), ctx({ typing: true })), null);
  assert.deepEqual(keyAction(k("escape"), ctx({ typing: true })), { type: "back" });
});
test("digit beyond options is null", () => {
  assert.deepEqual(keyAction(k("3"), ctx()), { type: "answer", n: 3 });
  assert.equal(keyAction(k("4"), ctx()), null);
  assert.equal(keyAction(k("1"), ctx({ optionCount: 0 })), null);
});
test("movement, open, back, help", () => {
  assert.deepEqual(keyAction(k("j"), ctx()), { type: "move", dy: 1 });
  assert.deepEqual(keyAction(k("k"), ctx()), { type: "move", dy: -1 });
  assert.deepEqual(keyAction(k("enter"), ctx()), { type: "open" });
  assert.deepEqual(keyAction(k("?"), ctx()), { type: "help" });
  assert.deepEqual(keyAction(k("/", { shift: true }), ctx()), { type: "help" });
  assert.deepEqual(keyAction(k("/"), ctx()), { type: "filter" });
});
test("h/l only on the board", () => {
  assert.equal(keyAction(k("h"), ctx()), null);
  assert.deepEqual(keyAction(k("h"), ctx({ mode: "board" })), { type: "col", dx: -1 });
  assert.deepEqual(keyAction(k("l"), ctx({ mode: "board" })), { type: "col", dx: 1 });
  assert.deepEqual(keyAction(k("v"), ctx()), { type: "toggleMode" });
});
test("n/p only on the changes tab", () => {
  assert.equal(keyAction(k("n"), ctx()), null);
  assert.deepEqual(keyAction(k("n"), ctx({ tab: "changes" })), { type: "file", d: 1 });
  assert.deepEqual(keyAction(k("p"), ctx({ tab: "changes" })), { type: "file", d: -1 });
  assert.deepEqual(keyAction(k("p"), ctx()), { type: "proof" });
});
test("shift digits pick tabs in both spellings", () => {
  assert.deepEqual(keyAction(k("1", { shift: true }), ctx()), { type: "tab", tab: "overview" });
  assert.deepEqual(keyAction(k("@"), ctx()), { type: "tab", tab: "pr" });
  assert.deepEqual(keyAction(k("#", { shift: true }), ctx()), { type: "tab", tab: "changes" });
});
test("action letters and merge", () => {
  assert.deepEqual(keyAction(k("r"), ctx()), { type: "reply" });
  assert.deepEqual(keyAction(k("t"), ctx()), { type: "terminal" });
  assert.deepEqual(keyAction(k("o"), ctx()), { type: "github" });
  assert.deepEqual(keyAction(k("m"), ctx()), { type: "merge" });
  assert.deepEqual(keyAction(k("m", { shift: true }), ctx()), { type: "mergeShip" });
  assert.deepEqual(keyAction(k("M"), ctx()), { type: "mergeShip" });
  assert.equal(keyAction(k("m"), ctx({ hasIssue: false })), null);
});
test("cmd-modified keys are null", () => {
  assert.equal(keyAction(k("j", { cmd: true }), ctx()), null);
  assert.equal(keyAction(k("1", { cmd: true, shift: true }), ctx()), null);
});
