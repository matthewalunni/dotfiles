import test from "node:test";
import assert from "node:assert/strict";
import {
  completionQuery, applyCompletion, filterChoices, composerKey, stepPick, outgoing, SLASH_COMMANDS,
} from "../../dot_config/herdr-app/mods/deck/lib/chatcomposer.js";

const ev = (key, o = {}) => ({ key, shift: false, cmd: false, held: false, ...o });

test("completionQuery: @ at the end of the text, after a space or at the start", () => {
  assert.deepEqual(completionQuery("@"), { trigger: "@", query: "", start: 0 });
  assert.deepEqual(completionQuery("ask @TF"), { trigger: "@", query: "TF", start: 4 });
  assert.deepEqual(completionQuery("line\n@ab-1"), { trigger: "@", query: "ab-1", start: 5 });
  assert.equal(completionQuery("mail me@host"), null);
  assert.equal(completionQuery("@TF-1 done"), null);
  assert.equal(completionQuery(""), null);
  assert.equal(completionQuery(null), null);
});

test("completionQuery: / only as the whole message (a command)", () => {
  assert.deepEqual(completionQuery("/"), { trigger: "/", query: "", start: 0 });
  assert.deepEqual(completionQuery("/com"), { trigger: "/", query: "com", start: 0 });
  assert.equal(completionQuery("see a/b"), null);
  assert.equal(completionQuery("x /clear"), null);
  assert.equal(completionQuery("/clear now"), null);
});

test("applyCompletion replaces the trigger word and adds a space", () => {
  assert.equal(applyCompletion("ask @TF", completionQuery("ask @TF"), "@TF-1"), "ask @TF-1 ");
  assert.equal(applyCompletion("/c", completionQuery("/c"), "/compact"), "/compact ");
});

test("filterChoices: case-insensitive prefix after the trigger, at most 8, no duplicates", () => {
  assert.deepEqual(filterChoices(["/compact", "/clear"], "/", "cl"), ["/clear"]);
  assert.deepEqual(filterChoices(["/compact", "/clear"], "/", ""), ["/compact", "/clear"]);
  assert.deepEqual(filterChoices(["TF-1", "tf-2", "AB-1", "TF-1"], "@", "tf"), ["@TF-1", "@tf-2"]);
  const many = Array.from({ length: 20 }, (_, i) => `A-${i}`);
  assert.equal(filterChoices(many, "@", "").length, 8);
  assert.deepEqual(filterChoices([null, "", "X-1"], "@", ""), ["@X-1"]);
});

test("SLASH_COMMANDS: /compact and /clear", () => {
  assert.deepEqual([...SLASH_COMMANDS], ["/compact", "/clear"]);
});

test("composerKey without the popup: Enter sends, Shift+Enter is the input's newline, esc leaves", () => {
  assert.equal(composerKey(ev("enter"), false), "send");
  assert.equal(composerKey(ev("enter", { shift: true }), false), null);
  assert.equal(composerKey(ev("escape"), false), "leave");
  assert.equal(composerKey(ev("tab"), false), null);
  assert.equal(composerKey(ev("up"), false), null);
  assert.equal(composerKey(ev("a"), false), null);
  assert.equal(composerKey(ev("enter", { cmd: true }), false), null);
  assert.equal(composerKey(ev("enter", { held: true }), false), null);
});

test("composerKey with the popup: ↑ ↓ move, Tab / Enter pick, esc closes", () => {
  assert.equal(composerKey(ev("up"), true), "up");
  assert.equal(composerKey(ev("down"), true), "down");
  assert.equal(composerKey(ev("down", { held: true }), true), "down");
  assert.equal(composerKey(ev("tab"), true), "pick");
  assert.equal(composerKey(ev("enter"), true), "pick");
  assert.equal(composerKey(ev("escape"), true), "close");
  assert.equal(composerKey(ev("enter", { shift: true }), true), null);
  assert.equal(composerKey(ev("x"), true), null);
});

test("stepPick wraps within the list", () => {
  assert.equal(stepPick(0, 1, 3), 1);
  assert.equal(stepPick(2, 1, 3), 0);
  assert.equal(stepPick(0, -1, 3), 2);
  assert.equal(stepPick(5, 0, 3), 2);
  assert.equal(stepPick(0, 1, 0), 0);
});

test("agentChoices: the names cardsFor matches (ids), live issues only", async () => {
  const { agentChoices } = await import("../../dot_config/herdr-app/mods/deck/lib/chatcomposer.js");
  const issues = [
    { key: "t9|-|1", id: "TF-1", stage: "build" },
    { key: "backlog|B-1", id: "B-1", stage: "backlog", kind: "backlog" },
  ];
  assert.deepEqual(agentChoices(issues), ["TF-1", "B-1"]);
});

test("undoEnterNewline: the one newline (plus indent) an Enter just inserted, at the end or mid-text", async () => {
  const { undoEnterNewline } = await import("../../dot_config/herdr-app/mods/deck/lib/chatcomposer.js");
  assert.equal(undoEnterNewline("ab", "ab\n"), "ab");
  assert.equal(undoEnterNewline("ab", "a\nb"), "ab");
  assert.equal(undoEnterNewline("/cle", "/cle\n"), "/cle");
  assert.equal(undoEnterNewline("  x", "  x\n  "), "  x");
  assert.equal(undoEnterNewline("ab", "abc"), null);
  assert.equal(undoEnterNewline("ab", "a\n\nb"), null);
  assert.equal(undoEnterNewline("a\nb", "a\nb"), null);
  assert.equal(undoEnterNewline(null, "x\n"), null);
});

test("submitPlan: with the list open Enter picks (never sends); with it closed Enter sends", async () => {
  const { submitPlan } = await import("../../dot_config/herdr-app/mods/deck/lib/chatcomposer.js");
  const list = { q: { trigger: "/", query: "cle", start: 0 }, items: ["/clear"], at: 0 };
  // The input acted first: Enter's "\n" landed and closed the list; the list before that change counts.
  assert.deepEqual(submitPlan({ text: "/cle\n", before: "/cle", changedJustNow: true, popBefore: list, pop: null, recentKey: false }),
    { do: "pick", text: "/cle", list });
  // Mid-text cursor: the inserted newline is removed, not sent.
  assert.deepEqual(submitPlan({ text: "ask @T\nF", before: "ask @TF", changedJustNow: true, popBefore: null, pop: null, recentKey: false }),
    { do: "send", text: "ask @TF" });
  // Submit with no inserted newline: the open list picks.
  assert.deepEqual(submitPlan({ text: "/cle", before: "/cl", changedJustNow: false, popBefore: null, pop: list, recentKey: false }),
    { do: "pick", text: "/cle", list });
  // A bare Enter with no list sends.
  assert.deepEqual(submitPlan({ text: "hello\n", before: "hello", changedJustNow: true, popBefore: null, pop: null, recentKey: false }),
    { do: "send", text: "hello" });
  // The key handler already took this Enter: only the stray newline is undone.
  assert.deepEqual(submitPlan({ text: "/clear \n", before: "/clear ", changedJustNow: true, popBefore: null, pop: null, recentKey: true }),
    { do: "ignore", text: "/clear " });
  // An older newline (a Shift+Enter some time ago) is left alone.
  assert.deepEqual(submitPlan({ text: "a\nb", before: "ab", changedJustNow: false, popBefore: null, pop: null, recentKey: false }),
    { do: "send", text: "a\nb" });
});

test("outgoing: trailing whitespace (an Enter's newline) is dropped; blank is nothing", () => {
  assert.equal(outgoing("hello\n"), "hello");
  assert.equal(outgoing("  two\nlines \n"), "  two\nlines");
  assert.equal(outgoing(" \n "), "");
  assert.equal(outgoing(undefined), "");
});
