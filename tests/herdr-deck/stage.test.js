import test from "node:test";
import assert from "node:assert/strict";
import { nextHolding, deriveStage, pickDecision, STAGE_LABEL, boardColumn, pinHolds } from "../../dot_config/herdr-app/mods/deck/lib/stage.js";

const pr = (state, checks = []) => ({ number: 1, title: "t", state, checks });
const base = { holdingSince: null, dismissed: false, pr: null, commitsAhead: null, status: "idle" };
const stage = (o) => deriveStage({ ...base, ...o });

test("holding beats everything", () => {
  assert.equal(stage({ holdingSince: 5, pr: pr("MERGED"), dismissed: true }), "holding");
});
test("merged and dismissed are landed", () => {
  assert.equal(stage({ pr: pr("MERGED") }), "landed");
  assert.equal(stage({ dismissed: true }), "landed");
  assert.equal(stage({ dismissed: true, pr: pr("OPEN") }), "landed");
});
test("closed PR is treated as no PR", () => {
  assert.equal(stage({ pr: pr("CLOSED"), commitsAhead: 3 }), "build");
  assert.equal(stage({ pr: pr("CLOSED"), commitsAhead: 0 }), "survey");
});
test("open PR is verify in every sub-state", () => {
  const pending = [{ name: "ci", status: "pending", detail: "" }];
  const done = [{ name: "ci", status: "pass", detail: "" }];
  assert.equal(stage({ pr: pr("OPEN", pending) }), "verify");
  assert.equal(stage({ pr: pr("OPEN", done), status: "working" }), "verify");
  assert.equal(stage({ pr: pr("OPEN", done), status: "idle" }), "verify");
  assert.equal(stage({ pr: pr("OPEN", []), status: "idle" }), "verify");
});
test("no PR: build when commits ahead, else survey", () => {
  assert.equal(stage({ commitsAhead: 2 }), "build");
  assert.equal(stage({ commitsAhead: 0 }), "survey");
  assert.equal(stage({ commitsAhead: null }), "survey");
});

test("nextHolding", () => {
  assert.equal(nextHolding(null, "done", 5, false), 5);
  assert.equal(nextHolding(null, "blocked", 5, false), 5);
  assert.equal(nextHolding(5, "blocked", 9, false), 5);
  assert.equal(nextHolding(5, "idle", 9, false), 5);
  assert.equal(nextHolding(null, "idle", 9, false), null);
  assert.equal(nextHolding(5, "idle", 9, true), null);
  assert.equal(nextHolding(5, "working", 9, false), null);
  assert.equal(nextHolding(null, "done", 9, true), null);
});

test("pickDecision", () => {
  const i = (key, holdingSince, p = null) => ({ key, holdingSince, pr: p });
  assert.equal(pickDecision([]), null);
  assert.equal(pickDecision([i("a", null)]), null);
  assert.equal(pickDecision([i("a", 9), i("b", 3), i("c", null)]).key, "b");
  assert.equal(pickDecision([i("a", 3), i("b", 3, pr("OPEN"))]).key, "b");
  assert.equal(pickDecision([i("a", 3, pr("OPEN")), i("b", 3)]).key, "a");
  assert.equal(pickDecision([i("a", 3), i("b", 3)]).key, "a");
});

test("dirty means build", () => {
  assert.equal(stage({ dirty: true, commitsAhead: 0 }), "build");
  assert.equal(stage({ dirty: true, commitsAhead: null }), "build");
  assert.equal(stage({ dirty: false, commitsAhead: 0 }), "survey");
  assert.equal(stage({ dirty: true, pr: pr("OPEN") }), "verify");
});
test("dirty after merge stays landed", () => {
  assert.equal(stage({ dirty: true, commitsAhead: 2, pr: pr("MERGED") }), "landed");
});
test("labels say Started", () => {
  assert.deepEqual(STAGE_LABEL, { backlog: "Backlog", survey: "Started", build: "Build", verify: "Verify", holding: "Holding", landed: "Landed" });
});

test("boardColumn: the work column, ignoring holding", () => {
  assert.equal(boardColumn({ stage: "holding", holdingSince: 5, pr: null, commitsAhead: 0, dirty: true }), "build");
  assert.equal(boardColumn({ stage: "holding", holdingSince: 5, pr: { state: "OPEN", checks: [] } }), "verify");
  assert.equal(boardColumn({ stage: "survey", holdingSince: null, pr: null }), "survey");
  assert.equal(boardColumn({ kind: "backlog", stage: "backlog" }), "backlog");
});

test("a pin holds until a PR opens or merges after it", () => {
  const pin = (column, prState = null) => ({ column, prState, at: 1 });
  // Pinned, git state says otherwise: the pin wins.
  assert.equal(boardColumn({ stage: "build", holdingSince: null, pr: null, pin: pin("survey") }), "survey");
  assert.equal(boardColumn({ stage: "survey", holdingSince: null, pr: null, pin: pin("landed") }), "landed");
  // A PR opened after the pin: Verify.
  const open = { state: "OPEN", checks: [] };
  assert.equal(boardColumn({ stage: "verify", holdingSince: null, pr: open, pin: pin("build") }), "verify");
  // Pinned while the PR was already open: the pin holds.
  assert.equal(boardColumn({ stage: "verify", holdingSince: null, pr: open, pin: pin("build", "OPEN") }), "build");
  // Merged after the pin: Landed.
  assert.equal(boardColumn({ stage: "landed", holdingSince: null, pr: { state: "MERGED", checks: [] }, pin: pin("build", "OPEN") }), "landed");
  // A closed PR is no event.
  assert.equal(pinHolds(pin("build", "OPEN"), { state: "CLOSED" }), true);
  assert.equal(pinHolds(pin("build"), { state: "OPEN" }), false);
  assert.equal(pinHolds(null, null), false);
  // A bad pin is ignored.
  assert.equal(boardColumn({ stage: "build", holdingSince: null, pr: null, pin: pin("holding") }), "build");
});
