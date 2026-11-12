import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STAGES, LIST_ORDER, stagePct, quickReplies, matchesView, groupIssues, repoTelemetry,
  checkTally, prChip, minutesSince, hhmm, diffRows, issueNote,
} from "../../dot_config/herdr-app/mods/deck/lib/present.js";
import { parseDiff } from "../../dot_config/herdr-app/mods/deck/lib/github.js";

const ci = (name, status) => ({ name, status, detail: "" });
const pr = (over = {}) => ({ number: 7, title: "t", state: "OPEN", checks: [], ...over });
const issue = (over = {}) => ({
  key: "k" + Math.random(), id: "X-1", title: "t", repo: "r", stage: "survey", status: "working",
  pr: null, claims: [], prompt: null, observed: true, commitsAhead: null, holdingSince: null, ...over,
});

test("stage order and ring percentages", () => {
  assert.deepEqual(STAGES, ["survey", "build", "verify", "holding", "landed"]);
  assert.deepEqual(LIST_ORDER, ["holding", "verify", "build", "survey", "landed"]);
  assert.deepEqual(STAGES.map(stagePct), [15, 50, 75, 100, 100]);
  assert.equal(stagePct("nope"), 0);
});

test("quickReplies offers a/b/c only when the question lists them", () => {
  assert.deepEqual(quickReplies("Which one? a) red b) blue c) green"), ["a", "b", "c", "lgtm"]);
  assert.deepEqual(quickReplies("Pick (a) or (b)?"), ["a", "b", "lgtm"]);
  assert.deepEqual(quickReplies("Options:\na. first\nb. second"), ["a", "b", "lgtm"]);
  assert.deepEqual(quickReplies("dial a / b / c?"), ["a", "b", "c", "lgtm"]);
  assert.deepEqual(quickReplies("Shall I merge this as a draft?"), ["lgtm"]);
  assert.deepEqual(quickReplies(""), ["lgtm"]);
  assert.deepEqual(quickReplies(null), ["lgtm"]);
});

test("matchesView filters by sidebar view and repo", () => {
  const hold = issue({ stage: "holding" });
  const failing = issue({ stage: "verify", pr: pr({ checks: [ci("a", "pass"), ci("b", "fail")] }) });
  const nodata = issue({ claims: [{ claim: "x", verdict: "NO DATA", source: "agent" }] });
  const landed = issue({ stage: "landed", repo: "other" });
  assert.equal(matchesView(hold, null), true);
  assert.equal(matchesView(hold, { kind: "view", value: "holding" }), true);
  assert.equal(matchesView(failing, { kind: "view", value: "holding" }), false);
  assert.equal(matchesView(failing, { kind: "view", value: "failing" }), true);
  assert.equal(matchesView(nodata, { kind: "view", value: "nodata" }), true);
  assert.equal(matchesView(hold, { kind: "view", value: "nodata" }), false);
  assert.equal(matchesView(landed, { kind: "view", value: "landed" }), true);
  assert.equal(matchesView(landed, { kind: "repo", value: "other" }), true);
  assert.equal(matchesView(hold, { kind: "repo", value: "other" }), false);
  assert.equal(matchesView(issue({ repo: null }), { kind: "repo", value: null }), true);
});

test("groupIssues groups in list order and skips empty groups", () => {
  const a = issue({ stage: "build" });
  const b = issue({ stage: "holding" });
  const c = issue({ stage: "build" });
  const d = issue({ stage: "landed", repo: "z" });
  assert.deepEqual(groupIssues([a, b, c, d], null).map((g) => [g.stage, g.items.length]), [["holding", 1], ["build", 2], ["landed", 1]]);
  assert.deepEqual(groupIssues([a, b, c, d], { kind: "repo", value: "z" }).map((g) => g.stage), ["landed"]);
  assert.deepEqual(groupIssues([], null), []);
});

test("repoTelemetry: most urgent stage per repo, progress segments", () => {
  const rows = repoTelemetry([
    issue({ repo: "tf", stage: "build" }), issue({ repo: "tf", stage: "holding" }),
    issue({ repo: "rf", stage: "verify" }), issue({ repo: "sf", stage: "landed" }),
    issue({ repo: null, stage: "survey" }),
  ]);
  assert.deepEqual(rows.map((r) => [r.repo, r.state, r.word, r.segments.join(",")]), [
    ["tf", "holding", "HOLDING", "work,work,work,hold,off"],
    ["rf", "verify", "VERIFYING", "work,work,work,off,off"],
    ["sf", "landed", "LANDED", "ok,ok,ok,ok,ok"],
    [null, "survey", "SURVEY", "muted,off,off,off,off"],
  ]);
});

test("checkTally and prChip", () => {
  assert.deepEqual(checkTally([]), { pass: 0, fail: 0, pending: 0, total: 0, tone: "off" });
  assert.equal(checkTally([ci("a", "pass"), ci("b", "pending")]).tone, "nodata");
  assert.equal(checkTally([ci("a", "pass"), ci("b", "fail")]).tone, "fail");
  assert.equal(checkTally([ci("a", "pass")]).tone, "ok");
  assert.deepEqual(prChip(issue()), { text: "—", tone: "off" });
  assert.deepEqual(prChip(issue({ pr: pr({ checks: [ci("a", "fail")] }) })), { text: "#7", tone: "fail" });
  assert.deepEqual(prChip(issue({ pr: pr({ state: "MERGED" }) })), { text: "merged", tone: "ok" });
  assert.deepEqual(prChip(issue({ pr: pr({ state: "CLOSED" }) })), { text: "—", tone: "off" });
});

test("issueNote describes what the issue is doing", () => {
  assert.equal(issueNote(issue({ stage: "holding", prompt: { kind: "permission", text: "Do you want to run ls?\nmore", options: [] } })), "Do you want to run ls?");
  assert.equal(issueNote(issue({ stage: "holding", prompt: { kind: "none", text: "", options: [] } })), "waiting on you");
  assert.equal(issueNote(issue({ stage: "verify", pr: pr({ checks: [ci("a", "pass"), ci("b", "pending")] }) })), "PR #7 · checks 1/2");
  assert.equal(issueNote(issue({ stage: "verify", pr: pr() })), "PR #7");
  assert.equal(issueNote(issue({ stage: "build", commitsAhead: 3 })), "3 commits");
  assert.equal(issueNote(issue({ stage: "build", commitsAhead: 1 })), "1 commit");
  assert.equal(issueNote(issue({ stage: "survey", status: "idle" })), "idle");
  assert.equal(issueNote(issue({ stage: "survey", observed: false })), "terminal gone");
  assert.equal(issueNote(issue({ stage: "landed", pr: pr({ state: "MERGED" }) })), "merged");
});

test("time helpers", () => {
  assert.equal(minutesSince(1_000_000, 1_000_000 + 12 * 60_000 + 59_000), 12);
  assert.equal(minutesSince(null, 5), 0);
  assert.equal(minutesSince(10, 5), 0);
  const t = new Date(2026, 10, 12, 9, 5).getTime();
  assert.equal(hhmm(t), "09:05");
});

test("diffRows flattens files, hunks and lines with sizes", () => {
  const files = parseDiff(readFileSync(new URL("./fixtures/pr.diff", import.meta.url), "utf8"));
  const d = diffRows(files, 100000);
  assert.equal(d.truncated, false);
  assert.equal(d.rows.length, d.sizes.length);
  assert.equal(d.rows[0].kind, "file");
  assert.equal(d.rows[0].path, ".gitignore");
  assert.equal(d.rows[1].kind, "hunk");
  assert.equal(d.rows[2].kind, "line");
  assert.deepEqual(d.fileRow.slice(0, 1), [0]);
  assert.equal(d.fileRow.length, files.length);
  for (const [i, f] of files.entries()) assert.equal(d.rows[d.fileRow[i]].path, f.path);
  const lines = d.rows.filter((r) => r.kind === "line").length;
  assert.equal(lines, files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.length, 0), 0));
});

test("diffRows caps lines and marks truncation; tabs become spaces", () => {
  const files = [{ path: "a", add: 3, del: 0, hunks: [{ header: "@@ -1 +1,3 @@", lines: [
    { a: null, b: 1, sign: "+", code: "\tx" }, { a: null, b: 2, sign: "+", code: "y" }, { a: null, b: 3, sign: "+", code: "z" },
  ] }] }, { path: "b", add: 1, del: 0, hunks: [{ header: "@@ -1 +1 @@", lines: [{ a: null, b: 1, sign: "+", code: "q" }] }] }];
  const d = diffRows(files, 2);
  assert.equal(d.truncated, true);
  assert.deepEqual(d.rows.map((r) => r.kind), ["file", "hunk", "line", "line", "truncated"]);
  assert.equal(d.rows[2].code, "    x");
  assert.equal(d.fileRow[1], -1);
});

test("diffRows clips very long lines to 400 characters", () => {
  const long = "x".repeat(5000);
  const files = [{ path: "a", add: 1, del: 0, hunks: [{ header: "@@ -1 +1 @@", lines: [{ a: null, b: 1, sign: "+", code: long }] }] }];
  const code = diffRows(files, 10).rows[2].code;
  assert.equal(code.length, 400);
  assert.equal(code.endsWith("…"), true);
  assert.equal(diffRows([{ ...files[0], hunks: [{ header: "@@ -1 +1 @@", lines: [{ a: null, b: 1, sign: "+", code: "y".repeat(400) }] }] }], 10).rows[2].code.length, 400);
});
