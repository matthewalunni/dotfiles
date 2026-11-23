import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOps, pendingOps, pruneDone, resolveRef, columnFor, planOp, resultLine, OP_MAX_AGE,
} from "../../dot_config/herdr-app/mods/deck/lib/boardops.js";

const line = (o) => JSON.stringify({ id: "a1", t: 1000, op: "dismiss", ref: "TF-8", from: "t22", ...o });

test("parseOps: well-formed requests only, first of a duplicate id wins, optional fields kept", () => {
  const text = [
    line({}),
    line({ id: "a1", op: "delete" }), // duplicate id
    "not json",
    line({ id: "b", op: "launch" }), // unknown op
    line({ id: "c", ref: "  " }),
    line({ id: "d", t: "soon" }),
    line({ id: "e", op: "edit", title: "New", brief: "B", from: "" }),
    line({ id: "f", op: "move", column: "verify" }),
    "[1]",
    '{"id":"g","t":1,"op":"dismiss","ref":"TF',
  ].join("\n");
  const ops = parseOps(text);
  assert.deepEqual(ops.map((o) => o.id), ["a1", "e", "f"]);
  assert.equal(ops[0].op, "dismiss");
  assert.deepEqual(ops[1], { id: "e", t: 1000, op: "edit", ref: "TF-8", from: null, title: "New", brief: "B" });
  assert.equal(ops[2].column, "verify");
  assert.deepEqual(parseOps(null), []);
});

test("pendingOps: skips done, too old and far-future requests; oldest first", () => {
  const now = 10 * OP_MAX_AGE;
  const ops = [
    { id: "late", t: now - 10 }, { id: "early", t: now - 20 }, { id: "done", t: now - 5 },
    { id: "old", t: now - OP_MAX_AGE - 1 }, { id: "future", t: now + 61_000 },
  ];
  assert.deepEqual(pendingOps(ops, { done: now }, now).map((o) => o.id), ["early", "late"]);
});

test("pruneDone: forgets ids older than OP_MAX_AGE", () => {
  const now = 10 * OP_MAX_AGE;
  assert.deepEqual(pruneDone({ a: now - 1, b: now - OP_MAX_AGE - 1 }, now), { a: now - 1 });
  assert.deepEqual(pruneDone(null, now), {});
});

const issues = [
  { key: "t1|s", id: "TF-8", kind: undefined, title: "Gate" },
  { key: "backlog|x", id: "B-3", kind: "backlog", discarded: false },
  { key: "backlog|y", id: "B-4", kind: "backlog", discarded: true },
];

test("resolveRef: visible id in any case, or the store key", () => {
  assert.equal(resolveRef(issues, "tf-8").key, "t1|s");
  assert.equal(resolveRef(issues, " B-3 ").key, "backlog|x");
  assert.equal(resolveRef(issues, "backlog|y").id, "B-4");
  assert.equal(resolveRef(issues, "TF-9"), null);
  assert.equal(resolveRef(issues, ""), null);
});

test("columnFor: keys, labels and done; nothing for holding or unknown", () => {
  assert.equal(columnFor("verify"), "verify");
  assert.equal(columnFor("Started"), "survey");
  assert.equal(columnFor("LANDED"), "landed");
  assert.equal(columnFor("done"), "landed");
  assert.equal(columnFor("holding"), null);
  assert.equal(columnFor("backlog"), null);
  assert.equal(columnFor(undefined), null);
});

const op = (o) => ({ id: "x", t: 1, op: "dismiss", ref: "TF-8", from: "t22", ...o });

test("planOp: only the chat agent; the card must exist and fit the op", () => {
  assert.match(planOp(op({ from: "t9" }), issues, "t22").error, /only the deck chat agent/);
  assert.match(planOp(op({}), issues, null).error, /only the deck chat agent/);
  assert.match(planOp(op({ ref: "TF-1" }), issues, "t22").error, /no card TF-1/);
  assert.match(planOp(op({ ref: "B-3" }), issues, "t22").error, /backlog card/);
  assert.match(planOp(op({ op: "start" }), issues, "t22").error, /not a backlog card/);
  assert.match(planOp(op({ op: "restore", ref: "B-3" }), issues, "t22").error, /not discarded/);
  assert.match(planOp(op({ op: "start", ref: "B-4" }), issues, "t22").error, /restore it first/);
  assert.equal(planOp(op({}), issues, "t22").issue.id, "TF-8");
  assert.equal(planOp(op({ op: "restore", ref: "B-4" }), issues, "t22").issue.id, "B-4");
  assert.equal(planOp(op({ op: "start", ref: "b-3" }), issues, "t22").issue.id, "B-3");
});

test("planOp: move needs a real column; edit needs a non-empty title or a brief", () => {
  assert.equal(planOp(op({ op: "move", column: "Done" }), issues, "t22").column, "landed");
  assert.match(planOp(op({ op: "move", column: "holding" }), issues, "t22").error, /started, build, verify, landed/);
  assert.deepEqual(planOp(op({ op: "edit", title: "  New  " }), issues, "t22").edit, { title: "New" });
  assert.deepEqual(planOp(op({ op: "edit", brief: "" }), issues, "t22").edit, { brief: "" });
  assert.match(planOp(op({ op: "edit", title: " " }), issues, "t22").error, /cannot be empty/);
  assert.match(planOp(op({ op: "edit" }), issues, "t22").error, /--title or --brief/);
});

test("resultLine: one JSON line the CLI can match by id", () => {
  assert.deepEqual(JSON.parse(resultLine("x", false, "nope", 5)), { id: "x", ok: false, message: "nope", t: 5 });
});

test("parseOps: goal requests keep their goal, project, start, done-when and days", () => {
  const ops = parseOps([
    line({ id: "g1", op: "goal-new", ref: "Ship chat", days: 14, project: "deck", start: "2026-11-23", doneWhen: "all from chat" }),
    line({ id: "g2", op: "goal", ref: "TF-8", goal: "G-1" }),
    line({ id: "g3", op: "goal-new", ref: "x", days: "14" }), // days must be a number: the field is dropped, not the request
  ].join("\n"));
  assert.deepEqual(ops.map((o) => o.id), ["g1", "g2", "g3"]);
  assert.deepEqual(ops[0], { id: "g1", t: 1000, op: "goal-new", ref: "Ship chat", from: "t22", days: 14, project: "deck", start: "2026-11-23", doneWhen: "all from chat" });
  assert.equal(ops[1].goal, "G-1");
  assert.equal(ops[2].days, undefined);
});

test("planOp: goal-new needs no card; goal needs a card and a goal; chat only", () => {
  const issues = [{ key: "k1", id: "TF-8" }];
  const op = (o) => ({ id: "x", t: 1, from: "t22", ...o });
  assert.deepEqual(planOp(op({ op: "goal-new", ref: "Ship chat", days: 14, project: "deck" }), issues, "t22"),
    { goalNew: { title: "Ship chat", days: 14, project: "deck", start: null, doneWhen: null } });
  assert.match(planOp(op({ op: "goal-new", ref: "Ship", from: "t9" }), issues, "t22").error, /only the deck chat agent/);
  assert.deepEqual(planOp(op({ op: "goal", ref: "tf-8", goal: "G-1" }), issues, "t22"), { issue: issues[0], goal: "G-1" });
  assert.match(planOp(op({ op: "goal", ref: "TF-8" }), issues, "t22").error, /goal needs a goal/);
  assert.match(planOp(op({ op: "goal", ref: "TF-1", goal: "G-1" }), issues, "t22").error, /no card TF-1/);
  const disc = [{ key: "backlog|e", id: "B-3", kind: "backlog", discarded: true }];
  assert.match(planOp(op({ op: "goal", ref: "B-3", goal: "G-1" }), disc, "t22").error, /discarded/);
  assert.equal(planOp(op({ op: "goal", ref: "B-3", goal: "none" }), disc, "t22").goal, "none");
});
