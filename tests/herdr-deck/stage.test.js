import test from "node:test";
import assert from "node:assert/strict";
import { nextHolding, deriveStage, pickDecision } from "../../dot_config/herdr-app/mods/deck/lib/stage.js";

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
