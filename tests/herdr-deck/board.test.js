import { deckTokens } from "../../dot_config/herdr-app/mods/deck/lib/tokens.js";
import test from "node:test";
import assert from "node:assert/strict";
import { boardColumns, moveBoard, nextHolding, repoColor, boardNote, cardClick } from "../../dot_config/herdr-app/mods/deck/lib/board.js";

const iss = (key, stage, o = {}) => ({ key, stage, holdingSince: null, lastSeen: 0, dismissed: false, ...o });

test("five fixed columns, newest first, dismissed excluded", () => {
  const cols = boardColumns([
    iss("a", "build", { lastSeen: 1 }), iss("b", "build", { lastSeen: 5 }),
    iss("c", "build", { lastSeen: 9, dismissed: true }),
    iss("d", "holding", { holdingSince: 10 }), iss("e", "holding", { holdingSince: 20 }),
  ]);
  assert.deepEqual(cols.map((c) => [c.stage, c.label]), [
    ["holding", "Holding"], ["survey", "Started"], ["build", "Build"], ["verify", "Verify"], ["landed", "Landed"]]);
  assert.deepEqual(cols[0].items.map((i) => i.key), ["e", "d"]);
  assert.deepEqual(cols[2].items.map((i) => i.key), ["b", "a"]);
});

test("empty columns", () => {
  const cols = boardColumns([iss("a", "holding", { holdingSince: 1 }), iss("b", "verify")]);
  assert.equal(cols.length, 5);
  assert.deepEqual(moveBoard(cols, { col: 0, row: 0 }, { dx: 1 }), { col: 3, row: 0 });
  assert.deepEqual(moveBoard(cols, { col: 3, row: 0 }, { dx: 1 }), { col: 3, row: 0 });
  assert.deepEqual(moveBoard(cols, { col: 3, row: 0 }, { dx: -1 }), { col: 0, row: 0 });
  assert.deepEqual(moveBoard(cols, { col: 0, row: 0 }, { dx: -1 }), { col: 0, row: 0 });
  // j/k on an empty column does not crash
  assert.deepEqual(moveBoard(cols, { col: 1, row: 0 }, { dy: 1 }), { col: 1, row: 0 });
  assert.deepEqual(moveBoard(boardColumns([]), { col: 0, row: 3 }, { dy: -1, dx: 1 }), { col: 0, row: 0 });
});

test("row clamps to column length when changing column", () => {
  const cols = boardColumns([iss("a", "holding", { holdingSince: 1 }), iss("b", "holding", { holdingSince: 2 }),
    iss("c", "holding", { holdingSince: 3 }), iss("d", "build")]);
  assert.deepEqual(moveBoard(cols, { col: 0, row: 2 }, { dx: 1 }), { col: 2, row: 0 });
  assert.deepEqual(moveBoard(cols, { col: 0, row: 2 }, { dy: 1 }), { col: 0, row: 2 });
});

test("nextHolding wraps in holdingSince order", () => {
  const l = [iss("a", "holding", { holdingSince: 30 }), iss("b", "holding", { holdingSince: 10 }),
    iss("c", "holding", { holdingSince: 20 }), iss("d", "build")];
  assert.equal(nextHolding(l, null).key, "b");
  assert.equal(nextHolding(l, "b").key, "c");
  assert.equal(nextHolding(l, "a").key, "b");
  assert.equal(nextHolding(l, "d").key, "b");
});

test("nextHolding none", () => {
  assert.equal(nextHolding([iss("d", "build")], "d"), null);
  assert.equal(nextHolding([], null), null);
});

test("boardNote: holding question, working, failing check, merged, stage", () => {
  assert.deepEqual(boardNote(iss("a", "holding", { prompt: { text: "\nRun tests?\nmore" } })), { text: "Run tests?", tone: "hold" });
  assert.deepEqual(boardNote(iss("a", "build", { status: "working" })), { text: "Working…", tone: "work" });
  assert.deepEqual(boardNote(iss("a", "verify", { status: "working", pr: { checks: [{ status: "fail" }, { status: "fail" }] } })), { text: "2 checks failing", tone: "fail" });
  assert.deepEqual(boardNote(iss("a", "landed")), { text: "Merged", tone: "ok" });
  assert.deepEqual(boardNote(iss("a", "survey", { status: "idle" })), { text: "Started", tone: "muted" });
});

test("repoColor is stable per name", () => {
  const pal = deckTokens({}).repo;
  assert.equal(pal.length, 8);
  assert.equal(repoColor("readflow", pal), repoColor("readflow", pal));
  assert.ok(pal.includes(repoColor(null, pal)));
});

test("cardClick: first click selects, only the stored selection opens", () => {
  assert.equal(cardClick(undefined, "a"), "select");
  assert.equal(cardClick("b", "a"), "select");
  assert.equal(cardClick("a", "a"), "open");
});
