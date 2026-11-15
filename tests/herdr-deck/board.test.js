import { deckTokens } from "../../dot_config/herdr-app/mods/deck/lib/tokens.js";
import test from "node:test";
import assert from "node:assert/strict";
import { boardColumns, boardLanes, moveBoard, nextHolding, repoColor, boardNote } from "../../dot_config/herdr-app/mods/deck/lib/board.js";

const iss = (key, stage, o = {}) => ({ key, stage, holdingSince: null, lastSeen: 0, dismissed: false, ...o });

test("five fixed columns, newest first, dismissed excluded; a waiting card stays in its work column", () => {
  const cols = boardColumns([
    iss("a", "build", { lastSeen: 1 }), iss("b", "build", { lastSeen: 5 }),
    iss("c", "build", { lastSeen: 9, dismissed: true }),
    iss("d", "holding", { holdingSince: 10, dirty: true }), iss("e", "holding", { holdingSince: 20 }),
  ]);
  assert.deepEqual(cols.map((c) => [c.stage, c.label]), [
    ["backlog", "Backlog"], ["survey", "Started"], ["build", "Build"], ["verify", "Verify"], ["landed", "Landed"]]);
  assert.deepEqual(cols[1].items.map((i) => i.key), ["e"]);
  assert.deepEqual(cols[2].items.map((i) => i.key), ["d", "b", "a"]);
});

test("a pinned card sits in its pinned column", () => {
  const cols = boardColumns([iss("a", "build", { pin: { column: "verify", prState: null, at: 1 } })]);
  assert.deepEqual(cols[3].items.map((i) => i.key), ["a"]);
  assert.equal(cols[2].items.length, 0);
});

test("empty columns", () => {
  const cols = boardColumns([iss("a", "survey"), iss("b", "verify")]);
  assert.equal(cols.length, 5);
  assert.deepEqual(moveBoard(cols, { col: 0, row: 0 }, { dx: 1 }), { col: 1, row: 0 });
  assert.deepEqual(moveBoard(cols, { col: 1, row: 0 }, { dx: 1 }), { col: 3, row: 0 });
  assert.deepEqual(moveBoard(cols, { col: 3, row: 0 }, { dx: 1 }), { col: 3, row: 0 });
  assert.deepEqual(moveBoard(cols, { col: 3, row: 0 }, { dx: -1 }), { col: 1, row: 0 });
  assert.deepEqual(moveBoard(cols, { col: 1, row: 0 }, { dx: -1 }), { col: 1, row: 0 });
  // j/k on an empty column does not crash
  assert.deepEqual(moveBoard(cols, { col: 1, row: 0 }, { dy: 1 }), { col: 1, row: 0 });
  assert.deepEqual(moveBoard(boardColumns([]), { col: 0, row: 3 }, { dy: -1, dx: 1 }), { col: 0, row: 0 });
});

test("row clamps to column length when changing column", () => {
  const cols = boardColumns([iss("a", "survey", { lastSeen: 3 }), iss("b", "survey", { lastSeen: 2 }),
    iss("c", "survey", { lastSeen: 1 }), iss("d", "build")]);
  assert.deepEqual(moveBoard(cols, { col: 1, row: 2 }, { dx: 1 }), { col: 2, row: 0 });
  assert.deepEqual(moveBoard(cols, { col: 1, row: 2 }, { dy: 1 }), { col: 1, row: 2 });
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
  // Dragged to Landed without a merge: done, not merged.
  assert.deepEqual(boardNote(iss("a", "build", { pin: { column: "landed", prState: null, at: 1 } })), { text: "Done", tone: "ok" });
  // Waiting shows on a pinned card too.
  assert.equal(boardNote(iss("a", "holding", { prompt: { text: "Ok?" }, pin: { column: "verify", prState: null, at: 1 } })).tone, "hold");
});

test("repoColor is stable per name", () => {
  const pal = deckTokens({}).repo;
  assert.equal(pal.length, 8);
  assert.equal(repoColor("readflow", pal), repoColor("readflow", pal));
  assert.ok(pal.includes(repoColor(null, pal)));
});


test("lanes: one per project by name, no project last; columns walk lane by lane", () => {
  const cols = boardColumns([
    iss("a", "build", { project: "taskflow", lastSeen: 9 }),
    iss("b", "build", { repo: "readflow", lastSeen: 1 }),
    iss("c", "holding", { project: null, repo: null, holdingSince: 5 }),
    iss("d", "build", { project: "taskflow", lastSeen: 3 }),
    iss("e", "backlog", { kind: "backlog", repo: "readflow" }),
  ]);
  assert.deepEqual(cols[2].items.map((i) => i.key), ["b", "a", "d"]);
  const lanes = boardLanes(cols);
  assert.deepEqual(lanes.map((l) => [l.project, l.count]), [["readflow", 2], ["taskflow", 2], [null, 1]]);
  assert.deepEqual(lanes[1].cells.map((c) => c.map((i) => i.key)), [[], [], ["a", "d"], [], []]);
  assert.deepEqual(boardLanes(boardColumns([])), []);
});

test("an ended session's card says so", () => {
  assert.deepEqual(boardNote(iss("a", "build", { observed: false })), { text: "Session ended", tone: "muted" });
  assert.equal(boardNote(iss("a", "landed", { observed: false })).text, "Merged");
});
