import test from "node:test";
import assert from "node:assert/strict";
import {
  chatAgent, nullSince, trustWaiting, TRUST_MS, approvalFrom, matchOption, clipDetail, wheelAway,
  recentBlocks, attachCards, chatViewKey,
} from "../../dot_config/herdr-app/mods/deck/lib/chatview.js";

const term = (o = {}) => ({ address: "t9", name: "deck-chat", state: "live", status: null, ...o });

test("chatAgent: the live deck-chat terminal, its status and focus (from agents() when there)", () => {
  assert.equal(chatAgent([], []), null);
  assert.equal(chatAgent([term({ state: "dead" })], []), null);
  assert.deepEqual(chatAgent([term({ status: "idle" })], null), { address: "t9", status: "idle", focused: false });
  assert.deepEqual(
    chatAgent([term({ status: "idle" })], [{ address: "t9", status: "blocked", focused: true }]),
    { address: "t9", status: "blocked", focused: true },
  );
  assert.deepEqual(chatAgent([term({ status: "weird" })], [{ address: "t1", status: "idle", focused: true }]), { address: "t9", status: null, focused: false });
});

test("nullSince / trustWaiting: an unknown status held past TRUST_MS is a waiting trust modal", () => {
  assert.equal(nullSince(null, null, 100), 100);
  assert.equal(nullSince(100, null, 900), 100);
  assert.equal(nullSince(100, "idle", 900), null);
  assert.equal(trustWaiting(null, 0, TRUST_MS - 1), false);
  assert.equal(trustWaiting(null, 0, TRUST_MS), true);
  assert.equal(trustWaiting("idle", 0, TRUST_MS * 2), false);
  assert.equal(trustWaiting(null, null, TRUST_MS * 2), false);
});

const perm = {
  kind: "permission",
  text: "Bash command\nhc keys TF-1 2\nDo you want to proceed?",
  options: [
    { label: "Yes", keys: ["1"] },
    { label: "Yes, and don't ask again for hc keys commands", keys: ["2"] },
    { label: "No, and tell Claude what to do differently (esc)", keys: ["3"] },
  ],
};

test("approvalFrom: a permission prompt becomes an approval block (Approve = Yes, Skip = No)", () => {
  const a = approvalFrom(perm);
  assert.equal(a.type, "approval");
  assert.equal(a.title, "Bash command");
  assert.equal(a.subtitle, "hc keys TF-1 2 · Do you want to proceed?");
  assert.equal(a.approve.label, "Yes");
  assert.equal(a.skip.keys[0], "3");
  assert.equal(a.prompt, perm);
});

test("approvalFrom: nothing for other prompts; Skip falls back to the last option", () => {
  assert.equal(approvalFrom(null), null);
  assert.equal(approvalFrom({ kind: "menu", text: "Pick", options: perm.options }), null);
  assert.equal(approvalFrom({ kind: "permission", text: "x", options: [] }), null);
  const a = approvalFrom({ kind: "permission", text: "", options: [{ label: "Allow", keys: ["1"] }, { label: "Deny", keys: ["2"] }] });
  assert.equal(a.title, "Permission needed");
  assert.equal(a.approve.label, "Allow");
  assert.equal(a.skip.label, "Deny");
});

test("matchOption: the fresh option only when the prompt is unchanged and it can be pressed", () => {
  const fresh = structuredClone(perm);
  assert.deepEqual(matchOption(perm, fresh, perm.options[0]), fresh.options[0]);
  assert.equal(matchOption(perm, { ...fresh, text: "Other command" }, perm.options[0]), null);
  assert.equal(matchOption(perm, null, perm.options[0]), null);
  assert.equal(matchOption(null, fresh, perm.options[0]), null);
  assert.equal(matchOption(perm, fresh, { label: "Maybe", keys: ["9"] }), null);
  const noKeys = { ...fresh, options: fresh.options.map((o) => ({ ...o, keys: [] })) };
  assert.equal(matchOption(perm, noKeys, perm.options[0]), null);
  const q = { kind: "question", text: "Which?", options: [{ label: "A", keys: [], reply: "1" }, { label: "B", keys: [], reply: "2" }] };
  assert.deepEqual(matchOption(q, structuredClone(q), q.options[1]), q.options[1]);
});

test("clipDetail: at most n characters, with an ellipsis", () => {
  assert.equal(clipDetail("short"), "short");
  const long = "x".repeat(300);
  assert.equal(clipDetail(long).length, 120);
  assert.ok(clipDetail(long).endsWith("…"));
  assert.equal(clipDetail("a\nb"), "a b");
  assert.equal(clipDetail(null), "");
});

test("wheelAway: how far above the bottom the wheel has moved (never below 0)", () => {
  assert.equal(wheelAway(0, 40), 40);
  assert.equal(wheelAway(40, -30), 10);
  assert.equal(wheelAway(10, -30), 0);
  assert.equal(wheelAway(0, Number.NaN), 0);
});

test("recentBlocks: the last max blocks and how many are left out", () => {
  const blocks = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }));
  assert.deepEqual(recentBlocks(blocks, 3), { shown: blocks.slice(2), hidden: 2 });
  assert.deepEqual(recentBlocks(blocks, 10), { shown: blocks, hidden: 0 });
});

test("attachCards: an agent text block is followed by its cards (ids from the block); others pass through", () => {
  const issues = [{ key: "TF-1", pr: { number: 7 } }, { key: "AB-2", pr: null }];
  const blocks = [
    { id: "s:1", type: "text", role: "user", text: "what about TF-1?" },
    { id: "s:2", type: "text", role: "agent", text: "TF-1 has PR #7; AB-2 and #9 too" },
    { id: "s:3", type: "action", verb: "read", target: "AB-2" },
  ];
  const out = attachCards(blocks, issues);
  assert.deepEqual(out.map((b) => b.id), ["s:1", "s:2", "s:2:deck:TF-1", "s:2:github:7", "s:2:deck:AB-2", "s:2:github:9", "s:3"]);
  assert.deepEqual(out[3], { id: "s:2:github:7", type: "github", number: 7, issueKey: "TF-1" });
  assert.deepEqual(out[5], { id: "s:2:github:9", type: "github", number: 9, issueKey: null });
});

test("chatViewKey: with the view focused, Enter approves and esc skips an approval; Enter otherwise types", () => {
  const ev = (key, o = {}) => ({ key, shift: false, cmd: false, held: false, ...o });
  assert.equal(chatViewKey(ev("enter"), { approval: true, canAnswer: true }), "approve");
  assert.equal(chatViewKey(ev("escape"), { approval: true, canAnswer: true }), "skip");
  assert.equal(chatViewKey(ev("enter"), { approval: true, canAnswer: false }), null);
  assert.equal(chatViewKey(ev("enter"), { approval: false, canAnswer: true }), "type");
  assert.equal(chatViewKey(ev("i"), { approval: false, canAnswer: true }), "type");
  assert.equal(chatViewKey(ev("escape"), { approval: false, canAnswer: true }), null);
  assert.equal(chatViewKey(ev("enter", { held: true }), { approval: true, canAnswer: true }), null);
  assert.equal(chatViewKey(ev("enter", { cmd: true }), { approval: true, canAnswer: true }), null);
  assert.equal(chatViewKey(ev("?"), { approval: false, canAnswer: true }), "help");
});
