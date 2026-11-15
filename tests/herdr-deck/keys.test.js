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
test("⇧H/⇧L move the selected card a column on the board, not a backlog card", () => {
  assert.deepEqual(keyAction(k("H", { shift: true }), ctx({ mode: "board" })), { type: "pinCol", dx: -1 });
  assert.deepEqual(keyAction(k("l", { shift: true }), ctx({ mode: "board" })), { type: "pinCol", dx: 1 });
  assert.equal(keyAction(k("L", { shift: true }), ctx({ mode: "board", backlog: true })), null);
  assert.equal(keyAction(k("L", { shift: true }), ctx({ mode: "board", hasIssue: false })), null);
  assert.equal(keyAction(k("L", { shift: true }), ctx()), null);
  assert.equal(keyAction(k("L", { shift: true, held: true }), ctx({ mode: "board" })), null);
});
test("n/p are files only on the changes tab", () => {
  assert.deepEqual(keyAction(k("n"), ctx()), { type: "newTask" }); // v1.4: off the PR tab, n is New task
  assert.deepEqual(keyAction(k("n"), ctx({ tab: "changes" })), { type: "file", d: 1 });
  assert.deepEqual(keyAction(k("p"), ctx({ tab: "changes" })), { type: "file", d: -1 });
  assert.deepEqual(keyAction(k("p"), ctx()), { type: "proof" });
});
test("shift digits pick tabs in both spellings", () => {
  assert.deepEqual(keyAction(k("1", { shift: true }), ctx()), { type: "tab", tab: "overview" });
  assert.deepEqual(keyAction(k("!"), ctx()), { type: "tab", tab: "overview" });
  assert.deepEqual(keyAction(k("@"), ctx()), { type: "tab", tab: "pr" });
  assert.deepEqual(keyAction(k("2", { shift: true }), ctx()), { type: "tab", tab: "pr" });
});
test("two tabs: shift-3 picks nothing", () => {
  assert.equal(keyAction(k("#"), ctx()), null);
  assert.equal(keyAction(k("#", { shift: true }), ctx()), null);
  assert.equal(keyAction(k("3", { shift: true }), ctx({ tab: "changes" })), null);
});
test("action letters and merge", () => {
  assert.deepEqual(keyAction(k("r"), ctx()), { type: "reply" });
  assert.deepEqual(keyAction(k("t"), ctx()), { type: "terminal" });
  assert.deepEqual(keyAction(k("o"), ctx()), { type: "github" });
  assert.deepEqual(keyAction(k("m"), ctx()), { type: "merge" });
  assert.deepEqual(keyAction(k("m", { shift: true }), ctx()), { type: "mergeShip" });
  assert.equal(keyAction(k("m"), ctx({ hasIssue: false })), null);
});
test("cmd-modified keys are null", () => {
  assert.equal(keyAction(k("j", { cmd: true }), ctx()), null);
  assert.equal(keyAction(k("1", { cmd: true, shift: true }), ctx()), null);
});
test("proof reachable on changes tab", () => {
  const c = ctx({ tab: "changes" });
  assert.deepEqual(keyAction(k("p", { shift: true }), c), { type: "proof" });
  assert.deepEqual(keyAction(k("P", { shift: true }), c), { type: "proof" });
  assert.deepEqual(keyAction(k("p"), c), { type: "file", d: -1 });
});
test("caps lock is not shift", () => {
  assert.deepEqual(keyAction(k("M"), ctx()), { type: "merge" });
  assert.deepEqual(keyAction(k("M", { shift: true }), ctx()), { type: "mergeShip" });
  assert.deepEqual(keyAction(k("P"), ctx({ tab: "changes" })), { type: "file", d: -1 });
});
test("shift-j/k/r/t/o behave like the plain keys", () => {
  for (const key of ["j", "k", "r", "t", "o"]) {
    assert.deepEqual(keyAction(k(key, { shift: true }), ctx()), keyAction(k(key), ctx()));
    assert.notEqual(keyAction(k(key, { shift: true }), ctx()), null);
  }
});
test("shift with a digit past 3 is not an answer", () => {
  // GPUI may report shift-4 as key "4" + shift: that is "$", never option 4.
  for (const key of ["4", "5", "9"]) assert.equal(keyAction(k(key, { shift: true }), ctx({ optionCount: 9 })), null);
  assert.equal(keyAction(k("$"), ctx({ optionCount: 9 })), null);
});
test("held digit does not answer", () => {
  assert.equal(keyAction(k("1", { held: true }), ctx()), null);
  for (const key of ["r", "t", "p", "o", "m", "enter", "v", "?", "@"]) assert.equal(keyAction(k(key, { held: true }), ctx()), null, key);
  assert.equal(keyAction(k("m", { held: true, shift: true }), ctx()), null);
  assert.equal(keyAction(k("1", { held: true, shift: true }), ctx()), null);
});
test("held j still moves", () => {
  assert.deepEqual(keyAction(k("j", { held: true }), ctx()), { type: "move", dy: 1 });
  assert.deepEqual(keyAction(k("up", { held: true }), ctx()), { type: "move", dy: -1 });
  assert.deepEqual(keyAction(k("l", { held: true }), ctx({ mode: "board" })), { type: "col", dx: 1 });
  assert.deepEqual(keyAction(k("n", { held: true }), ctx({ tab: "changes" })), { type: "file", d: 1 });
});

const page = (o = {}) => ctx({ view: "issue", ...o });
test("issue page: esc leaves the reply box first, then goes back", () => {
  assert.deepEqual(keyAction(k("escape"), page({ typing: true })), { type: "leave" });
  assert.deepEqual(keyAction(k("escape"), page({ typing: false })), { type: "back" });
  for (const key of ["j", "k", "t", "m", "1", "r"]) assert.equal(keyAction(k(key), page({ typing: true })), null, key);
});
test("issue page: j/k step issues, held too; T is the terminal", () => {
  assert.deepEqual(keyAction(k("j"), page()), { type: "step", d: 1 });
  assert.deepEqual(keyAction(k("k"), page()), { type: "step", d: -1 });
  assert.deepEqual(keyAction(k("down"), page()), { type: "step", d: 1 });
  assert.deepEqual(keyAction(k("j", { held: true }), page()), { type: "step", d: 1 });
  assert.deepEqual(keyAction(k("t"), page()), { type: "terminal" });
  assert.equal(keyAction(k("t", { held: true }), page()), null);
});
test("issue page: every detail key, none of the list's", () => {
  assert.deepEqual(keyAction(k("2"), page()), { type: "answer", n: 2 });
  assert.equal(keyAction(k("4"), page()), null);
  assert.deepEqual(keyAction(k("r"), page()), { type: "reply" });
  assert.deepEqual(keyAction(k("p"), page()), { type: "proof" });
  assert.deepEqual(keyAction(k("o"), page()), { type: "github" });
  assert.deepEqual(keyAction(k("m"), page()), { type: "merge" });
  assert.deepEqual(keyAction(k("m", { shift: true }), page()), { type: "mergeShip" });
  assert.deepEqual(keyAction(k("@"), page()), { type: "tab", tab: "pr" });
  assert.deepEqual(keyAction(k("n"), page({ tab: "changes" })), { type: "file", d: 1 });
  assert.deepEqual(keyAction(k("?"), page()), { type: "help" });
  for (const key of ["enter", "/", "v", "h", "l"]) assert.equal(keyAction(k(key), page()), null, key);
  assert.equal(keyAction(k("1", { held: true }), page()), null);
  assert.equal(keyAction(k("m", { held: true }), page()), null);
});
