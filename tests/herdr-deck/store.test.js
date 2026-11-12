import test from "node:test";
import assert from "node:assert/strict";
import { emptyStore, prefixFor, reconcile, dismiss, markReplied } from "../../dot_config/herdr-app/mods/deck/lib/store.js";

const DAY = 86400000;
const ob = (o = {}) => ({
  terminal: "t7", status: "working", title: "t", cwd: "/x", repo: "taskflow", root: "/x",
  branch: "fix/x", commitsAhead: 0, pr: null, ghError: null, claims: [], prompt: null,
  brief: null, replied: false, ...o,
});
const pr = (o = {}) => ({ number: 455, title: "p", state: "OPEN", checks: [], ...o });
const get = (s, key) => s.issues.find((i) => i.key === key);

test("ids are stable and per-repo prefixed", () => {
  let s = reconcile(emptyStore(), [ob(), ob({ terminal: "t9" }), ob({ terminal: "t1", repo: "readflow" }), ob({ terminal: "t2", repo: null })], 1);
  assert.deepEqual(s.issues.map((i) => i.id), ["TF-1", "TF-2", "RF-1", "XX-1"]);
  s = reconcile(s, [ob()], 2);
  assert.equal(s.issues.length, 4);
  assert.equal(get(s, "t7|fix/x").id, "TF-1");
});

test("new branch on same terminal is a new issue; old kept; HEAD is no branch", () => {
  let s = reconcile(emptyStore(), [ob()], 1);
  s = reconcile(s, [ob({ branch: "fix/y" })], 2);
  assert.deepEqual(s.issues.map((i) => i.id), ["TF-1", "TF-2"]);
  s = reconcile(s, [ob({ terminal: "t3", branch: "HEAD" })], 3);
  assert.ok(get(s, "t3|-"));
  s = reconcile(s, [ob({ terminal: "t4", branch: null })], 3);
  assert.ok(get(s, "t4|-"));
});

test("done makes holding with one log event, none on repeat", () => {
  let s = reconcile(emptyStore(), [ob()], 1);
  s = reconcile(s, [ob({ status: "done" })], 2);
  const i = get(s, "t7|fix/x");
  assert.equal(i.stage, "holding");
  assert.equal(i.holdingSince, 2);
  s = reconcile(s, [ob({ status: "done" })], 3);
  assert.deepEqual(s.log.map((e) => [e.what, e.tone]), [["is waiting on you", "hold"]]);
  assert.equal(get(s, "t7|fix/x").holdingSince, 2);
});

test("stage, PR and check events", () => {
  let s = reconcile(emptyStore(), [ob()], 1);
  s = reconcile(s, [ob({ commitsAhead: 2 })], 2);
  s = reconcile(s, [ob({ commitsAhead: 2, pr: pr({ checks: [{ name: "ci", status: "pending", detail: "" }] }) })], 3);
  s = reconcile(s, [ob({ commitsAhead: 2, pr: pr({ checks: [{ name: "ci", status: "pass", detail: "" }] }) })], 4);
  assert.deepEqual(s.log.map((e) => [e.what, e.tone]), [
    ["moved to Build", "work"], ["moved to Verify", "work"], ["opened PR #455", "work"], ["checks passed", "ok"],
  ]);
  s = reconcile(s, [ob({ commitsAhead: 2, pr: pr({ checks: [{ name: "lint", status: "fail", detail: "" }] }) })], 5);
  assert.deepEqual(s.log.at(-1), { t: 5, key: "t7|fix/x", id: "TF-1", what: "lint failed", tone: "warn" });
});

test("markReplied clears holding; awaitingAck flow", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done" })], 1);
  s = markReplied(s, "t7|fix/x");
  assert.equal(get(s, "t7|fix/x").holdingSince, null);
  s = reconcile(s, [ob({ status: "done" })], 2);
  assert.equal(get(s, "t7|fix/x").holdingSince, null);
  assert.equal(get(s, "t7|fix/x").awaitingAck, true);
  s = reconcile(s, [ob({ status: "working" })], 3);
  assert.equal(get(s, "t7|fix/x").awaitingAck, false);
  s = reconcile(s, [ob({ status: "done" })], 4);
  assert.equal(get(s, "t7|fix/x").holdingSince, 4);
  assert.equal(get(s, "t7|fix/x").stage, "holding");
});

test("merged PR clears holding and lands", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done", pr: pr() })], 1);
  assert.equal(get(s, "t7|fix/x").stage, "holding");
  s = reconcile(s, [ob({ status: "done", pr: pr({ state: "MERGED" }) })], 2);
  const i = get(s, "t7|fix/x");
  assert.equal(i.holdingSince, null);
  assert.equal(i.stage, "landed");
  assert.equal(i.landedAt, 2);
  s = reconcile(s, [ob({ status: "done", pr: pr({ state: "MERGED" }) })], 3);
  assert.equal(get(s, "t7|fix/x").landedAt, 2);
  assert.equal(s.log.filter((e) => e.what === "landed").length, 1);
});

test("dismiss clears holding and lands", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done" })], 1);
  s = dismiss(s, "t7|fix/x", 5);
  const i = get(s, "t7|fix/x");
  assert.equal(i.stage, "landed");
  assert.equal(i.holdingSince, null);
  assert.equal(i.landedAt, 5);
  s = reconcile(s, [ob({ status: "done" })], 6);
  assert.equal(get(s, "t7|fix/x").stage, "landed");
});

test("landed issue older than 7 days dropped, log kept; vanished terminal kept", () => {
  let s = reconcile(emptyStore(), [ob(), ob({ terminal: "t9" })], 1);
  s = dismiss(s, "t7|fix/x", 10);
  s = reconcile(s, [], 10 + 6 * DAY);
  assert.equal(s.issues.length, 2);
  s = reconcile(s, [], 10 + 8 * DAY);
  assert.deepEqual(s.issues.map((i) => i.id), ["TF-2"]);
  assert.ok(s.log.some((e) => e.what === "landed" && e.id === "TF-1"));
});

test("log capped at 200, newest last", () => {
  let s = emptyStore();
  for (let n = 0; n < 250; n++) s = reconcile(s, [ob({ terminal: "a" + n, status: "done" })], n);
  assert.equal(s.log.length, 200);
  assert.equal(s.log.at(-1).t, 249);
});

test("prefixFor table", () => {
  const want = { taskflow: "TF", repvault: "RV", readflow: "RF", speakflow: "SF", promptr: "PR", content: "CO", digestIQ: "DI", biscuitai: "BA" };
  for (const [repo, p] of Object.entries(want)) assert.equal(prefixFor(repo, {}), p, repo);
});

test("prefix collision uses next free letter and persists per repo", () => {
  let s = reconcile(emptyStore(), [ob({ terminal: "a", repo: "reportfile" }), ob({ terminal: "b", repo: "readme" })], 1);
  assert.deepEqual(s.prefixes, { reportfile: "RE", readme: "RA" });
  s = reconcile(s, [ob({ terminal: "c", repo: "readme" })], 2);
  assert.deepEqual(s.issues.map((i) => i.id), ["RE-1", "RA-1", "RA-2"]);
});
