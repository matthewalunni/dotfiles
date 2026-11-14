import test from "node:test";
import assert from "node:assert/strict";
import { emptyStore, prefixFor, reconcile, dismiss, markReplied, updatePr, markReviewed } from "../../dot_config/herdr-app/mods/deck/lib/store.js";

const DAY = 86400000;
const ob = (o = {}) => ({
  terminal: "t7", status: "working", title: "t", cwd: "/x", repo: "taskflow", root: "/x",
  branch: "fix/x", commitsAhead: 0, pr: null, ghError: null, claims: [], prompt: null,
  brief: null, replied: false, ...o,
});
const pr = (o = {}) => ({ number: 455, title: "p", state: "OPEN", checks: [], ...o });
const get = (s, key) => s.issues.find((i) => i.key === key);
// The issue of terminal t's current session (the newest one), and its key.
const T = (s, t) => s.issues.filter((i) => i.terminal === t).sort((a, b) => b.createdAt - a.createdAt)[0];
const K = (s, t) => T(s, t)?.key;

test("ids are stable and per-repo prefixed", () => {
  let s = reconcile(emptyStore(), [ob(), ob({ terminal: "t9" }), ob({ terminal: "t1", repo: "readflow" }), ob({ terminal: "t2", repo: null })], 1);
  assert.deepEqual(s.issues.map((i) => i.id), ["TF-1", "TF-2", "RF-1", "XX-1"]);
  s = reconcile(s, [ob()], 2);
  assert.equal(s.issues.length, 4);
  assert.equal(T(s, "t7").id, "TF-1");
});

test("one session, one issue: a new branch keeps the issue, even after a PR; HEAD is no branch", () => {
  let s = reconcile(emptyStore(), [ob({ pr: pr() })], 1);
  s = reconcile(s, [ob({ branch: "fix/y" })], 2);
  assert.deepEqual(s.issues.map((i) => [i.id, i.branch]), [["TF-1", "fix/y"]]);
  s = reconcile(s, [ob({ branch: "HEAD" })], 3);
  assert.equal(T(s, "t7").branch, null);
});

test("three agent sessions in one space are three issues", () => {
  const space = "taskflow";
  const three = [
    ob({ terminal: "t12", session: "100", space, cwd: "/home/Projects", repo: null, root: null, branch: null }),
    ob({ terminal: "t14", session: "200", space, branch: "main" }),
    ob({ terminal: "t15", session: "300", space, branch: "main" }),
  ];
  let s = reconcile(emptyStore(), three, 1);
  s = reconcile(s, three, 2);
  assert.deepEqual(s.issues.map((i) => [i.terminal, i.id, i.project]), [["t12", "TF-1", "taskflow"], ["t14", "TF-2", "taskflow"], ["t15", "TF-3", "taskflow"]]);
});

test("project is the repo, else the space; an XX issue gets a real ID once its project is known", () => {
  let s = reconcile(emptyStore(), [ob({ space: "notes", repo: "readflow" })], 1);
  assert.equal(T(s, "t7").project, "readflow");
  s = reconcile(emptyStore(), [ob({ repo: null, root: null, space: null })], 1);
  assert.equal(T(s, "t7").id, "XX-1");
  s = reconcile(s, [ob({ repo: null, root: null, space: "taskflow" })], 2);
  assert.deepEqual(s.issues.map((i) => [i.id, i.project]), [["TF-1", "taskflow"]]);
});

test("an agent missing for a while in the same terminal keeps its issue; a reused terminal ID is a new one", () => {
  let s = reconcile(emptyStore(), [ob({ session: "100" })], 1);
  s = reconcile(s, [], 2);
  assert.equal(T(s, "t7").observed, false);
  s = reconcile(s, [ob({ session: "100" })], 3);
  assert.deepEqual(s.issues.map((i) => [i.id, i.observed]), [["TF-1", true]]);
  s = reconcile(s, [], 4);
  s = reconcile(s, [ob({ session: "200" })], 5);
  assert.deepEqual(s.issues.map((i) => [i.id, i.observed]), [["TF-1", false], ["TF-2", true]]);
});

test("duplicates left by a polling gap fold into the live issue", () => {
  const dup = { issues: [], counters: { TF: 2 }, prefixes: { taskflow: "TF" }, retired: {}, backlogTombs: {}, log: [] };
  let s = reconcile(emptyStore(), [ob({ session: "100" })], 1);
  s = reconcile(s, [], 2);
  // what the old matcher did after the gap: a second issue for the same session
  const live = { ...T(s, "t7"), key: "t7|100|3", id: "TF-2", observed: true, lastSeen: 3, createdAt: 3 };
  s = { ...s, ...{ counters: dup.counters }, issues: [...s.issues, live] };
  s = reconcile(s, [ob({ session: "100" })], 4);
  assert.deepEqual(s.issues.map((i) => [i.id, i.observed]), [["TF-2", true]]);
});

test("a reused terminal ID (a different session) is a new issue", () => {
  let s = reconcile(emptyStore(), [ob({ session: "100" })], 1);
  s = reconcile(s, [ob({ session: "999" })], 2);
  assert.deepEqual(s.issues.map((i) => [i.id, i.observed]), [["TF-1", false], ["TF-2", true]]);
  // An unknown session (lookup failed) does not split one.
  s = reconcile(s, [ob({ session: null })], 3);
  assert.equal(s.issues.length, 2);
  assert.equal(T(s, "t7").session, "999");
});

test("issues from before sessions: the duplicates of a terminal's session are dropped, PR ones kept", () => {
  const base = reconcile(emptyStore(), [ob()], 1).issues[0];
  const old = (o) => {
    const { session, space, project, ...i } = { ...base, terminal: "t12", ...o };
    return i;
  };
  const store = {
    ...emptyStore(),
    issues: [
      old({ key: "t12|-", id: "XX-2", repo: null, root: null, branch: null, lastSeen: 5 }),
      old({ key: "t12|main", id: "TF-1", observed: false, lastSeen: 4 }),
      old({ key: "t12|fix", id: "TF-4", observed: false, pr: pr(), lastSeen: 3 }),
    ],
  };
  const s = reconcile(store, [ob({ terminal: "t12", session: "100", space: "taskflow", repo: null, root: null, branch: null })], 10);
  assert.deepEqual(s.issues.map((i) => [i.key, i.id, i.observed]), [["t12|-", "TF-1", true], ["t12|fix", "TF-4", false]]);
});

test("done makes holding with one log event, none on repeat", () => {
  let s = reconcile(emptyStore(), [ob()], 1);
  s = reconcile(s, [ob({ status: "done" })], 2);
  const i = T(s, "t7");
  assert.equal(i.stage, "holding");
  assert.equal(i.holdingSince, 2);
  s = reconcile(s, [ob({ status: "done" })], 3);
  assert.deepEqual(s.log.map((e) => [e.what, e.tone]), [["is waiting on you", "hold"]]);
  assert.equal(T(s, "t7").holdingSince, 2);
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
  assert.deepEqual(s.log.at(-1), { t: 5, key: K(s, "t7"), id: "TF-1", what: "lint failed", tone: "warn" });
});

test("markReplied clears holding; awaitingAck flow", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done" })], 1);
  s = markReplied(s, K(s, "t7"), 1);
  assert.equal(T(s, "t7").holdingSince, null);
  s = reconcile(s, [ob({ status: "done" })], 2);
  assert.equal(T(s, "t7").holdingSince, null);
  assert.equal(T(s, "t7").awaitingAck, true);
  s = reconcile(s, [ob({ status: "working" })], 3);
  assert.equal(T(s, "t7").awaitingAck, false);
  s = reconcile(s, [ob({ status: "done" })], 4);
  assert.equal(T(s, "t7").holdingSince, 4);
  assert.equal(T(s, "t7").stage, "holding");
});

test("merged PR clears holding and lands", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done", pr: pr() })], 1);
  assert.equal(T(s, "t7").stage, "holding");
  s = reconcile(s, [ob({ status: "done", pr: pr({ state: "MERGED" }) })], 2);
  const i = T(s, "t7");
  assert.equal(i.holdingSince, null);
  assert.equal(i.stage, "landed");
  assert.equal(i.landedAt, 2);
  s = reconcile(s, [ob({ status: "done", pr: pr({ state: "MERGED" }) })], 3);
  assert.equal(T(s, "t7").landedAt, 2);
  assert.equal(s.log.filter((e) => e.what === "landed").length, 1);
});

test("dismiss clears holding and lands", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done" })], 1);
  s = dismiss(s, K(s, "t7"), 5);
  const i = T(s, "t7");
  assert.equal(i.stage, "landed");
  assert.equal(i.holdingSince, null);
  assert.equal(i.landedAt, 5);
  s = reconcile(s, [ob({ status: "done" })], 6);
  assert.equal(T(s, "t7").stage, "landed");
});

test("landed issue older than 7 days dropped, log kept; an ended session clears after a day", () => {
  let s = reconcile(emptyStore(), [ob(), ob({ terminal: "t9" })], 1);
  s = dismiss(s, K(s, "t7"), 10);
  s = reconcile(s, [], 10 + 6 * DAY);
  assert.equal(s.issues.length, 1, "the ended t9 session is gone, the landed one stays");
  assert.equal(s.issues[0].id, "TF-1");
  s = reconcile(s, [], 10 + 8 * DAY);
  assert.equal(s.issues.length, 0);
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
  s = dismiss(s, K(s, "t7"), 10);
  const later = 10 + 8 * DAY;
  s = reconcile(s, [ob({ status: "done" })], later);
  assert.equal(s.issues.length, 0);
  assert.equal(s.retired["s:t7|-"], later);
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

test("a retired session is forgotten when it ends; old retired entries are capped", () => {
  const idle = ob({ status: "idle" });
  let s = reconcile(emptyStore(), [idle], 1);
  s = dismiss(s, K(s, "t7"), 2);
  s = reconcile(s, [idle], 2 + 8 * DAY);
  assert.ok(s.retired["s:t7|-"]);
  s = reconcile(s, [idle], 3 + 8 * DAY);
  assert.equal(s.issues.length, 0, "still retired while the session runs");
  s = reconcile(s, [], 4 + 8 * DAY);
  assert.equal(s.retired["s:t7|-"], undefined, "forgotten once the session ends");
  s = reconcile(s, [ob()], 5 + 8 * DAY);
  assert.equal(T(s, "t7").id, "TF-2", "a new agent there is a new issue");
  const big = { ...emptyStore(), retired: Object.fromEntries(Array.from({ length: 600 }, (_, n) => ["k" + n, 1000 + n])) };
  const r = reconcile(big, [], 2000);
  assert.equal(Object.keys(r.retired).length, 500);
  assert.ok(r.retired.k599 && !r.retired.k0);
});

test("unobserved issue loses holding and prompt, then is dropped after a day", () => {
  const prompt = { kind: "permission", text: "ok?", options: [{ label: "Yes", keys: ["y"] }] };
  let s = reconcile(emptyStore(), [ob({ status: "blocked", prompt })], 1);
  assert.equal(T(s, "t7").stage, "holding");
  s = reconcile(s, [], 2);
  const i = T(s, "t7");
  assert.equal(i.holdingSince, null);
  assert.equal(i.observed, false);
  assert.equal(i.lastSeen, 1);
  assert.deepEqual(i.prompt, noPrompt);
  assert.notEqual(i.stage, "holding");
  s = reconcile(s, [], 1 + DAY - 1);
  assert.equal(s.issues.length, 1);
  s = reconcile(s, [], 1 + DAY + 1);
  assert.equal(s.issues.length, 0);
  assert.deepEqual(s.retired, {});
});

test("observed issue is flagged observed with lastSeen", () => {
  const s = reconcile(emptyStore(), [ob()], 5);
  assert.equal(T(s, "t7").observed, true);
  assert.equal(T(s, "t7").lastSeen, 5);
});

test("landed is sticky until the agent works again", () => {
  let s = reconcile(emptyStore(), [ob({ pr: pr({ state: "MERGED" }) })], 1);
  s = reconcile(s, [ob({ pr: null, status: "idle" })], 2);
  assert.equal(T(s, "t7").stage, "landed");
  assert.equal(T(s, "t7").landedAt, 1);
  s = reconcile(s, [ob({ pr: null, status: "working" })], 3);
  assert.equal(T(s, "t7").stage, "survey");
});

test("ghError keeps the previous PR", () => {
  let s = reconcile(emptyStore(), [ob({ pr: pr() })], 1);
  s = reconcile(s, [ob({ pr: null, ghError: "rate limited" })], 2);
  assert.equal(T(s, "t7").pr.number, 455);
  assert.equal(T(s, "t7").ghError, "rate limited");
});

test("a CLOSED PR does not land", () => {
  const s = reconcile(emptyStore(), [ob({ pr: pr({ state: "CLOSED" }) })], 1);
  assert.notEqual(T(s, "t7").stage, "landed");
});

test("awaitingAck is cleared by idle", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done" })], 1);
  s = markReplied(s, K(s, "t7"), 1);
  s = reconcile(s, [ob({ status: "idle" })], 2);
  assert.equal(T(s, "t7").awaitingAck, false);
  assert.equal(T(s, "t7").holdingSince, null);
});

test("prefixes and retired survive a JSON round-trip", () => {
  let s = reconcile(emptyStore(), [ob(), ob({ terminal: "t2", repo: "readflow" })], 1);
  s = JSON.parse(JSON.stringify(s));
  s = reconcile(s, [ob({ terminal: "t3", repo: "readflow" })], 2);
  assert.equal(T(s, "t3").id, "RF-2");
  assert.deepEqual(s.prefixes, { taskflow: "TF", readflow: "RF" });
});

const ask = (text) => ({ kind: "permission", text, options: [{ label: "Yes", keys: ["1"] }, { label: "No", keys: ["2"] }] });

test("I1: after a reply, a different blocked prompt is holding again", () => {
  let s = reconcile(emptyStore(), [ob({ status: "blocked", prompt: ask("Run rm?") })], 1);
  s = markReplied(s, K(s, "t7"), 10);
  s = reconcile(s, [ob({ status: "blocked", prompt: ask("Run rm?") })], 11);
  assert.equal(T(s, "t7").holdingSince, null);
  s = reconcile(s, [ob({ status: "blocked", prompt: ask("Run curl?") })], 12);
  const i = T(s, "t7");
  assert.equal(i.awaitingAck, false);
  assert.equal(i.holdingSince, 12);
  assert.equal(i.stage, "holding");
});

test("I1: the same prompt still showing 15 s after the reply is holding again", () => {
  let s = reconcile(emptyStore(), [ob({ status: "blocked", prompt: ask("Run rm?") })], 1);
  s = markReplied(s, K(s, "t7"), 1000);
  s = reconcile(s, [ob({ status: "blocked", prompt: ask("Run rm?") })], 1000 + 14999);
  assert.equal(T(s, "t7").holdingSince, null);
  assert.equal(T(s, "t7").awaitingAck, true);
  s = reconcile(s, [ob({ status: "blocked", prompt: ask("Run rm?") })], 1000 + 15000);
  assert.equal(T(s, "t7").awaitingAck, false);
  assert.equal(T(s, "t7").holdingSince, 16000);
});

test("I2: merged, then working, then blocked is holding again", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done", pr: pr() })], 1);
  s = reconcile(s, [ob({ status: "done", pr: pr({ state: "MERGED" }) })], 2);
  assert.equal(T(s, "t7").stage, "landed");
  s = reconcile(s, [ob({ status: "done", pr: pr({ state: "MERGED" }) })], 3);
  assert.equal(T(s, "t7").holdingSince, null, "the done that was merged does not re-flag");
  s = reconcile(s, [ob({ status: "working", pr: pr({ state: "MERGED" }) })], 4);
  assert.equal(T(s, "t7").stage, "landed");
  s = reconcile(s, [ob({ status: "blocked", pr: pr({ state: "MERGED" }) })], 5);
  assert.equal(T(s, "t7").holdingSince, 5);
  assert.equal(T(s, "t7").stage, "holding");
});

test("I3: switching branch with no PR moves the issue (same ID, no ghost)", () => {
  let s = reconcile(emptyStore(), [ob({ terminal: "t1", branch: "main" })], 1);
  const before = T(s, "t1");
  assert.equal(before.id, "TF-1");
  s = reconcile(s, [ob({ terminal: "t1", branch: "feat-x", commitsAhead: 1 })], 2);
  assert.equal(s.issues.length, 1);
  const i = T(s, "t1");
  assert.equal(i.id, "TF-1");
  assert.equal(i.createdAt, 1);
  assert.equal(i.branch, "feat-x");
  assert.equal(s.counters.TF, 1);
});

test("I3: switching branch after the issue landed keeps the same issue", () => {
  let s = reconcile(emptyStore(), [ob({ terminal: "t1", branch: "main" })], 1);
  s = dismiss(s, K(s, "t1"), 2);
  s = reconcile(s, [ob({ terminal: "t1", branch: "feat-x" })], 3);
  assert.deepEqual(s.issues.map((i) => i.id), ["TF-1"]);
});

test("updatePr refreshes one issue's PR and logs check events", () => {
  const pend = pr({ checks: [{ name: "ci", status: "pending", detail: "" }] });
  let s = reconcile(emptyStore(), [ob({ commitsAhead: 1, pr: pend })], 1);
  s = updatePr(s, K(s, "t7"), { pr: pr({ checks: [{ name: "ci", status: "pass", detail: "" }] }), ghError: null, claims: [] }, 2);
  assert.equal(T(s, "t7").pr.checks[0].status, "pass");
  assert.equal(s.log.at(-1).what, "checks passed");
  s = updatePr(s, K(s, "t7"), { pr: null, ghError: "rate limited", claims: [] }, 3);
  assert.equal(T(s, "t7").pr.number, 455);
});

test("updatePr: a merge seen there clears holding at the transition", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done", pr: pr() })], 1);
  s = updatePr(s, K(s, "t7"), { pr: pr({ state: "MERGED" }), ghError: null, claims: [] }, 2);
  assert.equal(T(s, "t7").stage, "landed");
  s = reconcile(s, [ob({ status: "done", pr: pr({ state: "MERGED" }) })], 3);
  assert.equal(T(s, "t7").stage, "landed");
  assert.equal(T(s, "t7").holdingSince, null);
});

test("G1: reviewedSha is recorded per issue and survives polls", () => {
  const a = "a".repeat(40);
  let s = reconcile(emptyStore(), [ob({ pr: pr({ headSha: a }) })], 1);
  assert.equal(T(s, "t7").reviewedSha, null);
  s = markReviewed(s, K(s, "t7"), a);
  assert.equal(T(s, "t7").reviewedSha, a);
  s = reconcile(JSON.parse(JSON.stringify(s)), [ob({ pr: pr({ headSha: a }) })], 2);
  assert.equal(T(s, "t7").reviewedSha, a);
  assert.equal(markReviewed(s, K(s, "t7"), a), s, "no-op when unchanged");
  assert.equal(markReviewed(s, K(s, "t7"), "nope"), s, "only a full sha");
});

const doneQ = { kind: "question", text: "All done. Merge?", options: [] };

test("N1: merge quiets only the done screen showing at merge time", () => {
  let s = reconcile(emptyStore(), [ob({ status: "done", prompt: doneQ, pr: pr() })], 1);
  s = reconcile(s, [ob({ status: "done", prompt: doneQ, pr: pr({ state: "MERGED" }) })], 2);
  s = reconcile(s, [ob({ status: "done", prompt: doneQ, pr: pr({ state: "MERGED" }) })], 3);
  assert.equal(T(s, "t7").holdingSince, null);
  assert.equal(T(s, "t7").stage, "landed");
  s = reconcile(s, [ob({ status: "blocked", prompt: ask("Run git push?"), pr: pr({ state: "MERGED" }) })], 4);
  assert.equal(T(s, "t7").holdingSince, 4);
  assert.equal(T(s, "t7").stage, "holding");
});

test("N1: merge quiet ends on a different prompt or after 15 s", () => {
  const start = () => {
    let s = reconcile(emptyStore(), [ob({ status: "done", prompt: doneQ, pr: pr() })], 1);
    return reconcile(s, [ob({ status: "done", prompt: doneQ, pr: pr({ state: "MERGED" }) })], 1000);
  };
  let s = reconcile(start(), [ob({ status: "done", prompt: { kind: "question", text: "Shipped.", options: [] }, pr: pr({ state: "MERGED" }) })], 2000);
  assert.equal(T(s, "t7").holdingSince, 2000);
  s = reconcile(start(), [ob({ status: "done", prompt: doneQ, pr: pr({ state: "MERGED" }) })], 1000 + 14999);
  assert.equal(T(s, "t7").holdingSince, null);
  s = reconcile(s, [ob({ status: "done", prompt: doneQ, pr: pr({ state: "MERGED" }) })], 1000 + 15000);
  assert.equal(T(s, "t7").holdingSince, 16000);
});

test("N4: same session in a different folder is the same issue", () => {
  let s = reconcile(emptyStore(), [ob({ terminal: "t1", branch: "main", root: "/a", repo: "taskflow" })], 1);
  s = reconcile(s, [ob({ terminal: "t1", branch: "feat-x", root: "/b", repo: "readflow" })], 2);
  assert.deepEqual(s.issues.map((i) => [i.id, i.project]), [["TF-1", "readflow"]]);
});

test("log says Started", () => {
  let s = reconcile(emptyStore(), [ob({ commitsAhead: 2 })], 1);
  s = reconcile(s, [ob({ commitsAhead: 0 })], 2);
  assert.ok(s.log.some((e) => e.what === "moved to Started"), JSON.stringify(s.log));
  assert.ok(!s.log.some((e) => e.what === "moved to Survey"));
});
