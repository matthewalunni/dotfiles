import test from "node:test";
import assert from "node:assert/strict";
import { rosterGroups } from "../../dot_config/herdr-app/mods/deck/lib/roster.js";

const NOW = 10_000_000;
const MIN = 60_000;
const issue = (over = {}) => ({
  key: "k" + Math.random(), id: "X-1", title: "t", repo: "r", stage: "build", status: "working",
  pr: null, claims: [], prompt: null, observed: true, commitsAhead: null, holdingSince: null, landedAt: null, ...over,
});

test("no issues gives no groups", () => {
  assert.deepEqual(rosterGroups([], NOW), []);
  assert.deepEqual(rosterGroups(undefined, NOW), []);
});

test("holding is longest-waiting first and shows minutes held", () => {
  const a = issue({ key: "a", id: "A-1", stage: "holding", holdingSince: NOW - 5 * MIN });
  const b = issue({ key: "b", id: "B-1", stage: "holding", holdingSince: NOW - 20 * MIN });
  const [g] = rosterGroups([a, b], NOW);
  assert.equal(g.id, "holding");
  assert.equal(g.title, "Holding · you");
  assert.deepEqual(g.rows.map((r) => r.key), ["b", "a"]);
  assert.equal(g.rows[0].stage, "20m");
  assert.equal(g.rows[0].since, NOW - 20 * MIN);
});

test("idle agents sit under working with the stage word", () => {
  const w = issue({ key: "w", stage: "build" });
  const i = issue({ key: "i", stage: "survey", status: "idle" });
  const groups = rosterGroups([w, i], NOW);
  assert.deepEqual(groups.map((g) => g.id), ["working"]);
  assert.deepEqual(groups[0].rows.map((r) => r.key), ["w", "i"]);
  assert.equal(groups[0].rows[0].stage, "Build");
  assert.equal(groups[0].rows[0].since, null);
});

test("seven landed show the five newest first", () => {
  const landed = Array.from({ length: 7 }, (_, n) => issue({ key: "l" + n, stage: "landed", landedAt: NOW - (7 - n) * MIN }));
  const [g] = rosterGroups(landed, NOW);
  assert.equal(g.id, "landed");
  assert.deepEqual(g.rows.map((r) => r.key), ["l6", "l5", "l4", "l3", "l2"]);
});

test("a backlog entry never appears, and empty groups are omitted", () => {
  const entry = issue({ key: "bk", kind: "backlog", stage: "backlog" });
  assert.deepEqual(rosterGroups([entry], NOW), []);
  const groups = rosterGroups([entry, issue({ key: "w" }), issue({ key: "h", stage: "holding", holdingSince: NOW })], NOW);
  assert.deepEqual(groups.map((g) => g.id), ["holding", "working"]);
});

test("rows carry the repo and the note the view prints", () => {
  const [g] = rosterGroups([issue({ key: "w", id: "W-2", project: "proj", repo: "r", commitsAhead: 2 })], NOW);
  assert.deepEqual(g.rows[0], { key: "w", name: "W-2", stage: "Build", note: "2 commits", since: null, project: "proj" });
});
