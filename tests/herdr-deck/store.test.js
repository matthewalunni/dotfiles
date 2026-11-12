import test from "node:test";
import assert from "node:assert/strict";
import { emptyStore, prefixFor, reconcile, dismiss, markReplied, updatePr } from "../../dot_config/herdr-app/mods/deck/lib/store.js";

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

test("new branch on same terminal after a PR is a new issue; old kept; HEAD is no branch", () => {
  let s = reconcile(emptyStore(), [ob({ pr: pr() })], 1);
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
  s = markReplied(s, "t7|fix/x", 1);
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
  s = reconcile(s, [ob({ terminal: "t9" })], 10 + 8 * DAY);
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

const noPrompt = { kind: "none", text: "", options: [] };

test("expired landed issue stays retired while terminal is still observed", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done" })], 1);
  s = dismiss(s, "t7|fix/x", 10);
  const later = 10 + 8 * DAY;
  s = reconcile(s, [ob({ status: "done" })], later);
  assert.equal(s.issues.length, 0);
  assert.equal(s.retired["t7|fix/x"], later);
  const logLen = s.log.length;
  s = reconcile(s, [ob({ status: "done" })], later + 1000);
  assert.equal(s.issues.length, 0);
  assert.equal(s.counters.TF, 1);
  assert.equal(s.log.length, logLen);
  // a different terminal still gets the next id
  s = reconcile(s, [ob({ terminal: "t9" })], later + 2000);
  assert.equal(s.issues[0].id, "TF-2");
});

test("expired merged issue stays retired", () => {
  let s = reconcile(emptyStore(), [ob({ pr: pr({ state: "MERGED" }) })], 1);
  s = reconcile(s, [ob({ pr: pr({ state: "MERGED" }) })], 1 + 8 * DAY);
  s = reconcile(s, [ob({ pr: pr({ state: "MERGED" }) })], 1 + 9 * DAY);
  assert.equal(s.issues.length, 0);
  assert.equal(s.counters.TF, 1);
});

test("retired entries expire after 30 unobserved days and are capped", () => {
  let s = reconcile(emptyStore(), [ob()], 1);
  s = dismiss(s, "t7|fix/x", 2);
  s = reconcile(s, [], 2 + 8 * DAY);
  assert.ok(s.retired["t7|fix/x"]);
  s = reconcile(s, [], 2 + 8 * DAY + 31 * DAY);
  assert.equal(s.retired["t7|fix/x"], undefined);
  const big = { ...emptyStore(), retired: Object.fromEntries(Array.from({ length: 600 }, (_, n) => ["k" + n, 1000 + n])) };
  const r = reconcile(big, [], 2000);
  assert.equal(Object.keys(r.retired).length, 500);
  assert.ok(r.retired.k599 && !r.retired.k0);
});

test("unobserved issue loses holding and prompt, then is dropped after 7 days", () => {
  const prompt = { kind: "permission", text: "ok?", options: [{ label: "Yes", keys: ["y"] }] };
  let s = reconcile(emptyStore(), [ob({ status: "blocked", prompt })], 1);
  assert.equal(get(s, "t7|fix/x").stage, "holding");
  s = reconcile(s, [], 2);
  const i = get(s, "t7|fix/x");
  assert.equal(i.holdingSince, null);
  assert.equal(i.observed, false);
  assert.equal(i.lastSeen, 1);
  assert.deepEqual(i.prompt, noPrompt);
  assert.notEqual(i.stage, "holding");
  s = reconcile(s, [], 1 + 7 * DAY + 1);
  assert.equal(s.issues.length, 0);
  assert.ok(s.retired["t7|fix/x"]);
});

test("observed issue is flagged observed with lastSeen", () => {
  const s = reconcile(emptyStore(), [ob()], 5);
  assert.equal(get(s, "t7|fix/x").observed, true);
  assert.equal(get(s, "t7|fix/x").lastSeen, 5);
});

test("landed is sticky until the agent works again", () => {
  let s = reconcile(emptyStore(), [ob({ pr: pr({ state: "MERGED" }) })], 1);
  s = reconcile(s, [ob({ pr: null, status: "idle" })], 2);
  assert.equal(get(s, "t7|fix/x").stage, "landed");
  assert.equal(get(s, "t7|fix/x").landedAt, 1);
  s = reconcile(s, [ob({ pr: null, status: "working" })], 3);
  assert.equal(get(s, "t7|fix/x").stage, "survey");
});

test("ghError keeps the previous PR", () => {
  let s = reconcile(emptyStore(), [ob({ pr: pr() })], 1);
  s = reconcile(s, [ob({ pr: null, ghError: "rate limited" })], 2);
  assert.equal(get(s, "t7|fix/x").pr.number, 455);
  assert.equal(get(s, "t7|fix/x").ghError, "rate limited");
});

test("a CLOSED PR does not land", () => {
  const s = reconcile(emptyStore(), [ob({ pr: pr({ state: "CLOSED" }) })], 1);
  assert.notEqual(get(s, "t7|fix/x").stage, "landed");
});

test("awaitingAck is cleared by idle", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done" })], 1);
  s = markReplied(s, "t7|fix/x", 1);
  s = reconcile(s, [ob({ status: "idle" })], 2);
  assert.equal(get(s, "t7|fix/x").awaitingAck, false);
  assert.equal(get(s, "t7|fix/x").holdingSince, null);
});

test("prefixes and retired survive a JSON round-trip", () => {
  let s = reconcile(emptyStore(), [ob(), ob({ terminal: "t2", repo: "readflow" })], 1);
  s = JSON.parse(JSON.stringify(s));
  s = reconcile(s, [ob({ terminal: "t3", repo: "readflow" })], 2);
  assert.equal(get(s, "t3|fix/x").id, "RF-2");
  assert.deepEqual(s.prefixes, { taskflow: "TF", readflow: "RF" });
});

const ask = (text) => ({ kind: "permission", text, options: [{ label: "Yes", keys: ["1"] }, { label: "No", keys: ["2"] }] });

test("I1: after a reply, a different blocked prompt is holding again", () => {
  let s = reconcile(emptyStore(), [ob({ status: "blocked", prompt: ask("Run rm?") })], 1);
  s = markReplied(s, "t7|fix/x", 10);
  s = reconcile(s, [ob({ status: "blocked", prompt: ask("Run rm?") })], 11);
  assert.equal(get(s, "t7|fix/x").holdingSince, null);
  s = reconcile(s, [ob({ status: "blocked", prompt: ask("Run curl?") })], 12);
  const i = get(s, "t7|fix/x");
  assert.equal(i.awaitingAck, false);
  assert.equal(i.holdingSince, 12);
  assert.equal(i.stage, "holding");
});

test("I1: the same prompt still showing 15 s after the reply is holding again", () => {
  let s = reconcile(emptyStore(), [ob({ status: "blocked", prompt: ask("Run rm?") })], 1);
  s = markReplied(s, "t7|fix/x", 1000);
  s = reconcile(s, [ob({ status: "blocked", prompt: ask("Run rm?") })], 1000 + 14999);
  assert.equal(get(s, "t7|fix/x").holdingSince, null);
  assert.equal(get(s, "t7|fix/x").awaitingAck, true);
  s = reconcile(s, [ob({ status: "blocked", prompt: ask("Run rm?") })], 1000 + 15000);
  assert.equal(get(s, "t7|fix/x").awaitingAck, false);
  assert.equal(get(s, "t7|fix/x").holdingSince, 16000);
});

test("I2: merged, then working, then blocked is holding again", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done", pr: pr() })], 1);
  s = reconcile(s, [ob({ status: "done", pr: pr({ state: "MERGED" }) })], 2);
  assert.equal(get(s, "t7|fix/x").stage, "landed");
  s = reconcile(s, [ob({ status: "done", pr: pr({ state: "MERGED" }) })], 3);
  assert.equal(get(s, "t7|fix/x").holdingSince, null, "the done that was merged does not re-flag");
  s = reconcile(s, [ob({ status: "working", pr: pr({ state: "MERGED" }) })], 4);
  assert.equal(get(s, "t7|fix/x").stage, "landed");
  s = reconcile(s, [ob({ status: "blocked", pr: pr({ state: "MERGED" }) })], 5);
  assert.equal(get(s, "t7|fix/x").holdingSince, 5);
  assert.equal(get(s, "t7|fix/x").stage, "holding");
});

test("I3: switching branch with no PR moves the issue (same ID, no ghost)", () => {
  let s = reconcile(emptyStore(), [ob({ terminal: "t1", branch: "main" })], 1);
  const before = get(s, "t1|main");
  assert.equal(before.id, "TF-1");
  s = reconcile(s, [ob({ terminal: "t1", branch: "feat-x", commitsAhead: 1 })], 2);
  assert.equal(s.issues.length, 1);
  const i = get(s, "t1|feat-x");
  assert.equal(i.id, "TF-1");
  assert.equal(i.createdAt, 1);
  assert.equal(i.branch, "feat-x");
  assert.equal(get(s, "t1|main"), undefined);
  assert.equal(s.counters.TF, 1);
});

test("I3: switching branch after the old issue landed makes a new issue", () => {
  let s = reconcile(emptyStore(), [ob({ terminal: "t1", branch: "main" })], 1);
  s = dismiss(s, "t1|main", 2);
  s = reconcile(s, [ob({ terminal: "t1", branch: "feat-x" })], 3);
  assert.deepEqual(s.issues.map((i) => i.id), ["TF-1", "TF-2"]);
});

test("updatePr refreshes one issue's PR and logs check events", () => {
  const pend = pr({ checks: [{ name: "ci", status: "pending", detail: "" }] });
  let s = reconcile(emptyStore(), [ob({ commitsAhead: 1, pr: pend })], 1);
  s = updatePr(s, "t7|fix/x", { pr: pr({ checks: [{ name: "ci", status: "pass", detail: "" }] }), ghError: null, claims: [] }, 2);
  assert.equal(get(s, "t7|fix/x").pr.checks[0].status, "pass");
  assert.equal(s.log.at(-1).what, "checks passed");
  s = updatePr(s, "t7|fix/x", { pr: null, ghError: "rate limited", claims: [] }, 3);
  assert.equal(get(s, "t7|fix/x").pr.number, 455);
});

test("updatePr: a merge seen there clears holding at the transition", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done", pr: pr() })], 1);
  s = updatePr(s, "t7|fix/x", { pr: pr({ state: "MERGED" }), ghError: null, claims: [] }, 2);
  assert.equal(get(s, "t7|fix/x").stage, "landed");
  s = reconcile(s, [ob({ status: "done", pr: pr({ state: "MERGED" }) })], 3);
  assert.equal(get(s, "t7|fix/x").stage, "landed");
  assert.equal(get(s, "t7|fix/x").holdingSince, null);
});
