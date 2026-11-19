import test from "node:test";
import assert from "node:assert/strict";
import {
  chatAgent, nullSince, trustWaiting, TRUST_MS, approvalFrom, matchOption, clipDetail, wheelAway,
  recentBlocks, attachCards, chatViewKey, canSendToChat, SEND_BLOCKED, composerLocked, followKey, followScroll,
  chatOpenCommand, CHAT_ATTACH, TRUST_NOTE, prCwds, logMark,
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

test("shouldAutoStart: once, only while shown and only when no chat agent is live", async () => {
  const { shouldAutoStart } = await import("../../dot_config/herdr-app/mods/deck/lib/chatview.js");
  const agent = { address: "t9", status: "idle", focused: false };
  assert.equal(shouldAutoStart({ shown: true, agent: null, tried: false }), true);
  assert.equal(shouldAutoStart({ shown: true, agent: null, tried: true }), false);
  assert.equal(shouldAutoStart({ shown: false, agent: null, tried: false }), false);
  assert.equal(shouldAutoStart({ shown: true, agent, tried: false }), false);
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

test("chatViewKey: N opens a new task (shift too); not held, cmd or with a dialog open", () => {
  const ev = (key, o = {}) => ({ key, shift: false, cmd: false, held: false, ...o });
  const c = { approval: false, canAnswer: true, dialog: false };
  assert.equal(chatViewKey(ev("n"), c), "newTask");
  assert.equal(chatViewKey(ev("N", { shift: true }), c), "newTask");
  assert.equal(chatViewKey(ev("n", { held: true }), c), null);
  assert.equal(chatViewKey(ev("n", { cmd: true }), c), null);
  assert.equal(chatViewKey(ev("n"), { ...c, dialog: true }), null);
  assert.equal(chatViewKey(ev("n"), { approval: true, canAnswer: true, dialog: false }), "newTask");
});

// ---- final review fixes

test("canSendToChat: only while the chat agent is working, idle or done (never blocked or unknown)", () => {
  for (const s of ["working", "idle", "done"]) assert.equal(canSendToChat(s), true, s);
  for (const s of ["blocked", null, undefined, "weird"]) assert.equal(canSendToChat(s), false, String(s));
  assert.equal(SEND_BLOCKED, "answer the chat agent's prompt first");
});

test("composerLocked: while an approval card or the trust note shows", () => {
  assert.equal(composerLocked({ approval: false, trust: false }), false);
  assert.equal(composerLocked({ approval: true, trust: false }), true);
  assert.equal(composerLocked({ approval: false, trust: true }), true);
});

test("followKey / followScroll: following keys on the last block and the prompt rows, not the row count", () => {
  const k1 = followKey({ lastId: "s:199", approval: false, trust: false });
  const k2 = followKey({ lastId: "s:200", approval: false, trust: false }); // same row count past the cap
  assert.notEqual(k1, k2);
  assert.notEqual(followKey({ lastId: "s:200", approval: true, trust: false }), k2);
  assert.notEqual(followKey({ lastId: "s:200", approval: false, trust: true }), k2);
  assert.equal(followKey({ lastId: "s:200", approval: false, trust: false }), k2);
  assert.equal(followScroll(null, k1, 500), true); // first draw: to the bottom
  assert.equal(followScroll(k1, k2, 0), true);
  assert.equal(followScroll(k1, k2, 40), false); // the reader scrolled up
  assert.equal(followScroll(k2, k2, 0), false);
});

test("logMark: changes when a block is added to a capped log (same length)", () => {
  const a = logMark({ blocks: [{ id: "s:1" }, { id: "s:2" }] });
  const b = logMark({ blocks: [{ id: "s:2" }, { id: "s:3" }] });
  assert.notEqual(a, b);
  assert.equal(logMark(null), "0:");
  assert.equal(logMark({ blocks: [{ id: "s:2" }, { id: "s:3" }] }), b);
});

test("chatOpenCommand: peeks the chat terminal; the trust note names the fallback hc attach", () => {
  assert.deepEqual(chatOpenCommand("t9"), { name: "terminal.peek", args: { terminal: "t9" } });
  assert.equal(chatOpenCommand(null), null);
  assert.equal(CHAT_ATTACH, "hc attach deck-chat");
  assert.ok(TRUST_NOTE.includes(CHAT_ATTACH));
});

test("prCwds: each distinct repo root from the store, in order; one try without a cwd when there is none", () => {
  const issues = [
    { key: "a", root: "/r/one" },
    { key: "b", root: "/r/two" },
    { key: "c", root: "/r/one" },
  ];
  assert.deepEqual(prCwds(issues), ["/r/one", "/r/two"]);
  assert.deepEqual(prCwds([]), [null]);
});
