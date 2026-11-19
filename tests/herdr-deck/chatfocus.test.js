import test from "node:test";
import assert from "node:assert/strict";
import { terminalFocusKey, focusJump } from "../../dot_config/herdr-app/mods/deck/lib/chatview.js";

const f = (o = {}) => ({ space: "s1", tab: "t1", pane: "p1", terminal: "t5", shown: null, agent: "t5", cwd: null, ...o });

test("terminalFocusKey: null unless a terminal or agent has the focus", () => {
  assert.equal(terminalFocusKey(null), null);
  assert.equal(terminalFocusKey(f({ terminal: null, agent: null })), null);
  assert.equal(terminalFocusKey(f()), "s1|t1|t5|t5");
  assert.equal(terminalFocusKey(f({ terminal: null })), "s1|t1||t5");
  assert.equal(terminalFocusKey(f({ agent: null })), "s1|t1|t5|");
});

test("focusJump: the first terminal focus only records a baseline", () => {
  assert.deepEqual(focusJump(null, f(), null), { key: "s1|t1|t5|t5", jump: false });
});

test("focusJump: a different terminal, tab or space jumps", () => {
  const base = terminalFocusKey(f());
  assert.equal(focusJump(base, f({ terminal: "t6", agent: "t6" }), null).jump, true);
  assert.equal(focusJump(base, f({ tab: "t2" }), null).jump, true);
  assert.equal(focusJump(base, f({ space: "s2" }), null).jump, true);
});

test("focusJump: the same terminal does not jump and keeps the key", () => {
  const base = terminalFocusKey(f());
  assert.deepEqual(focusJump(base, f({ pane: "p9" }), null), { key: base, jump: false });
});

test("focusJump: focus on a mod pane (no terminal) neither jumps nor forgets the baseline", () => {
  const base = terminalFocusKey(f());
  assert.deepEqual(focusJump(base, f({ pane: "chat", terminal: null, agent: null }), null), { key: base, jump: false });
  assert.deepEqual(focusJump(base, null, null), { key: base, jump: false });
});

test("focusJump: the chat agent's own terminal is ignored", () => {
  const base = terminalFocusKey(f());
  assert.deepEqual(focusJump(base, f({ terminal: "t9", agent: null }), "t9"), { key: base, jump: false });
  assert.deepEqual(focusJump(base, f({ terminal: null, agent: "t9" }), "t9"), { key: base, jump: false });
});
