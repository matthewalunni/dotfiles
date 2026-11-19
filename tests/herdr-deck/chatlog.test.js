import test from "node:test";
import assert from "node:assert/strict";
import { emptyChatLog, appendBlocks, cardsFor } from "../../dot_config/herdr-app/mods/deck/lib/chat.js";

const tb = (id, session, text = "hi") => ({ id, session, t: 1, type: "text", role: "user", text });

test("appending the same block twice leaves one", () => {
  let log = appendBlocks(emptyChatLog(), [tb("s1:a", "s1")], 1);
  log = appendBlocks(log, [tb("s1:a", "s1")], 2);
  assert.equal(log.blocks.length, 1);
});

test("restart replay returns the identical object", () => {
  const log = appendBlocks(emptyChatLog(), [tb("s1:a", "s1"), tb("s1:b", "s1")], 1);
  assert.equal(appendBlocks(log, [tb("s1:a", "s1"), tb("s1:b", "s1")], 5), log);
  assert.equal(appendBlocks(log, [], 5), log);
});

test("replaying duplicates within one batch keeps one", () => {
  const log = appendBlocks(emptyChatLog(), [tb("s1:a", "s1"), tb("s1:a", "s1")], 1);
  assert.equal(log.blocks.length, 1);
});

test("a new session inserts exactly one cleared divider", () => {
  let log = appendBlocks(emptyChatLog(), [tb("s1:a", "s1")], 1);
  log = appendBlocks(log, [tb("s2:a", "s2"), tb("s2:b", "s2")], 9);
  assert.deepEqual(log.blocks.map((b) => b.type), ["text", "divider", "text", "text"]);
  assert.equal(log.blocks[1].kind, "cleared");
  assert.equal(log.blocks[1].t, 9);
  assert.equal(log.session, "s2");
  // replay of old session blocks must not add dividers or blocks
  assert.equal(appendBlocks(log, [tb("s1:a", "s1")], 10), log);
});

test("first block of an empty log gets no divider", () => {
  const log = appendBlocks(emptyChatLog(), [tb("s1:a", "s1")], 1);
  assert.equal(log.blocks.length, 1);
  assert.equal(log.session, "s1");
});

test("input log is not mutated", () => {
  const log = appendBlocks(emptyChatLog(), [tb("s1:a", "s1")], 1);
  appendBlocks(log, [tb("s2:a", "s2")], 2);
  assert.equal(log.blocks.length, 1);
  assert.equal(log.ids.size, 1);
});

const issues = [
  { key: "CHZ-12", pr: { number: 37, title: "t", state: "OPEN", checks: [] } },
  { key: "CHZ-3", pr: null },
];

test("cardsFor links deck key then PR", () => {
  assert.deepEqual(cardsFor("waybar-fix is on CHZ-12, PR #37 is green", issues), [
    { type: "deck", issueKey: "CHZ-12" },
    { type: "github", number: 37, issueKey: "CHZ-12" },
  ]);
});
test("cardsFor unmatched PR number", () => {
  assert.deepEqual(cardsFor("#99", issues), [{ type: "github", number: 99, issueKey: null }]);
});
test("cardsFor no keys", () => {
  assert.deepEqual(cardsFor("nothing here", issues), []);
});
test("cardsFor matches whole words only", () => {
  assert.deepEqual(cardsFor("CHZ-123 and XCHZ-12", issues), []);
});
test("cardsFor accepts 'PR N', dedupes, keeps first-appearance order", () => {
  assert.deepEqual(cardsFor("PR 37 then CHZ-3, CHZ-12 again PR 37 and #37 CHZ-3", issues), [
    { type: "github", number: 37, issueKey: "CHZ-12" },
    { type: "deck", issueKey: "CHZ-3" },
    { type: "deck", issueKey: "CHZ-12" },
  ]);
});
test("cardsFor tolerates bad input and keys with regex characters", () => {
  assert.deepEqual(cardsFor(null, issues), []);
  assert.deepEqual(cardsFor("a.b-1", [{ key: "a.b-1", pr: null }]), [{ type: "deck", issueKey: "a.b-1" }]);
  assert.deepEqual(cardsFor("axb-1", [{ key: "a.b-1", pr: null }]), []);
});

test("cardsFor matches the visible id (what @ completes and agents write), carrying the store key", async () => {
  const { mentionName } = await import("../../dot_config/herdr-app/mods/deck/lib/chat.js");
  const store = [{ key: "t9|-|1700000000000", id: "TF-1", pr: { number: 7 } }, { key: "backlog|B-1", id: "B-1", pr: null }];
  assert.equal(mentionName(store[0]), "TF-1");
  assert.equal(mentionName({ key: "only-key" }), "only-key");
  assert.deepEqual(cardsFor("TF-1 and B-1, PR #7", store), [
    { type: "deck", issueKey: "t9|-|1700000000000" },
    { type: "deck", issueKey: "backlog|B-1" },
    { type: "github", number: 7, issueKey: "t9|-|1700000000000" },
  ]);
  assert.deepEqual(cardsFor("t9|-|1700000000000", store), []);
});
