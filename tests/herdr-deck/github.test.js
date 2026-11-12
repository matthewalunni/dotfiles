import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GIT_CMDS, PR_FIELDS, parseGitState, parsePr, parseDiff,
} from "../../dot_config/herdr-app/mods/deck/lib/github.js";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const ok = (stdout) => ({ code: 0, stdout, stderr: "" });
const bad = (code, stderr) => ({ code, stdout: "", stderr });

test("GIT_CMDS and PR_FIELDS are verbatim", () => {
  assert.deepEqual(GIT_CMDS, [
    ["rev-parse", "--show-toplevel"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    ["rev-list", "--count", "<base>..HEAD"],
  ]);
  assert.equal(PR_FIELDS, "number,title,state,url,reviewDecision,statusCheckRollup,files,additions,deletions,baseRefName,headRefName,commits");
});

test("fixtures map to state, checks, files", () => {
  for (const [file, state] of [["pr-open.json", "OPEN"], ["pr-merged.json", "MERGED"], ["pr-closed.json", "CLOSED"]]) {
    const raw = JSON.parse(fx(file));
    const { pr, error } = parsePr(ok(fx(file)));
    assert.equal(error, null);
    assert.equal(pr.state, state);
    assert.equal(pr.files.length, raw.files.length);
    assert.deepEqual(pr.files[0], { path: raw.files[0].path, add: raw.files[0].additions, del: raw.files[0].deletions });
    assert.equal(pr.commits, raw.commits.length);
    assert.equal(pr.base, raw.baseRefName);
    assert.equal(pr.head, raw.headRefName);
    assert.equal(pr.review, raw.reviewDecision || null);
    assert.equal(pr.checks.length, raw.statusCheckRollup.length);
    for (const c of pr.checks) assert.ok(["pass", "fail", "pending"].includes(c.status));
  }
  const { pr } = parsePr(ok(fx("pr-open.json")));
  assert.equal(pr.checks.find((c) => c.name === "Web · tests").status, "pass"); // SKIPPED
});

const withChecks = (rollup) => ok(JSON.stringify({ number: 1, title: "t", state: "OPEN", url: "u", reviewDecision: "", statusCheckRollup: rollup, files: [], additions: 0, deletions: 0, baseRefName: "main", headRefName: "x", commits: [] }));
test("check status mapping, CheckRun and StatusContext", () => {
  const run = (status, conclusion) => ({ __typename: "CheckRun", name: "n", status, conclusion });
  const ctx = (state) => ({ __typename: "StatusContext", context: "ci/x", state });
  const { pr } = parsePr(withChecks([
    run("COMPLETED", "SUCCESS"), run("COMPLETED", "NEUTRAL"), run("COMPLETED", "SKIPPED"),
    run("COMPLETED", "FAILURE"), run("COMPLETED", "CANCELLED"), run("COMPLETED", "TIMED_OUT"), run("COMPLETED", "ACTION_REQUIRED"),
    run("IN_PROGRESS", ""), run("QUEUED", null),
    ctx("SUCCESS"), ctx("FAILURE"), ctx("ERROR"), ctx("PENDING"), ctx("EXPECTED"),
  ]));
  assert.deepEqual(pr.checks.map((c) => c.status), [
    "pass", "pass", "pass", "fail", "fail", "fail", "fail", "pending", "pending",
    "pass", "fail", "fail", "pending", "pending",
  ]);
  assert.equal(pr.checks[9].name, "ci/x");
  assert.equal(pr.review, null);
});

test("parsePr errors", () => {
  assert.deepEqual(parsePr(bad(1, 'no pull requests found for branch "x"')), { pr: null, error: null });
  assert.deepEqual(parsePr(bad(1, "HTTP 401")), { pr: null, error: "GitHub unavailable" });
  assert.deepEqual(parsePr(bad(4, "error connecting to api.github.com")), { pr: null, error: "GitHub unavailable" });
  assert.deepEqual(parsePr(ok("not json")), { pr: null, error: "GitHub unavailable" });
  assert.deepEqual(parsePr(ok("")), { pr: null, error: "GitHub unavailable" });
});

test("parseGitState", () => {
  const s = parseGitState({
    toplevel: ok("/Users/m/code/herdr\n"), branch: ok("feat/x\n"), base: ok("origin/develop\n"), ahead: ok("3\n"),
  });
  assert.deepEqual(s, { repo: "herdr", root: "/Users/m/code/herdr", branch: "feat/x", base: "develop", commitsAhead: 3 });
  const fb = parseGitState({ toplevel: ok("/a/b\n"), branch: ok("main\n"), base: bad(128, "fatal"), ahead: null });
  assert.equal(fb.base, "main");
  assert.equal(fb.commitsAhead, null);
  const none = parseGitState({ toplevel: bad(128, "fatal: not a git repository"), branch: bad(128, ""), base: bad(128, ""), ahead: null });
  assert.deepEqual(none, { repo: null, root: null, branch: null, base: "main", commitsAhead: null });
});

test("parseDiff on a real diff", () => {
  const files = parseDiff(fx("pr.diff"));
  assert.equal(files.length, (fx("pr.diff").match(/^diff --git /gm) || []).length);
  assert.equal(files[0].path, ".gitignore");
  assert.equal(files[0].add, 1);
  assert.equal(files[0].del, 0);
  const h = files[0].hunks[0];
  assert.match(h.header, /^@@ -169,6 \+169,7 @@/);
  assert.deepEqual(h.lines.slice(2, 5).map((l) => [l.a, l.b, l.sign]), [[171, 171, " "], [null, 172, "+"], [172, 173, " "]]);
  for (const f of files) for (const hk of f.hunks) {
    const m = hk.header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    const oldN = hk.lines.filter((l) => l.sign !== "+").length;
    const newN = hk.lines.filter((l) => l.sign !== "-").length;
    assert.equal(oldN, m[2] === undefined ? 1 : +m[2], hk.header);
    assert.equal(newN, m[4] === undefined ? 1 : +m[4], hk.header);
  }
});

test("parseDiff numbering across mixed +/-", () => {
  const d = [
    "diff --git a/x.txt b/x.txt", "index 1..2 100644", "--- a/x.txt", "+++ b/x.txt",
    "@@ -10,5 +10,6 @@ fn", " c1", "-old1", "-old2", "+new1", "+new2", "+new3", " c2", " c3", "",
  ].join("\n");
  const [f] = parseDiff(d);
  assert.equal(f.add, 3);
  assert.equal(f.del, 2);
  assert.deepEqual(f.hunks[0].lines.map((l) => [l.a, l.b, l.sign, l.code]), [
    [10, 10, " ", "c1"], [11, null, "-", "old1"], [12, null, "-", "old2"],
    [null, 11, "+", "new1"], [null, 12, "+", "new2"], [null, 13, "+", "new3"],
    [13, 14, " ", "c2"], [14, 15, " ", "c3"],
  ]);
});

test("parseDiff tolerates binary and rename headers", () => {
  const d = [
    "diff --git a/img.png b/img.png", "index 1..2 100644", "Binary files a/img.png and b/img.png differ",
    "diff --git a/old name.js b/new name.js", "similarity index 90%", "rename from old name.js", "rename to new name.js",
    "index 1..2 100644", "--- a/old name.js", "+++ b/new name.js\t", "@@ -1,2 +1,2 @@", " a", "-b", "+c", "\\ No newline at end of file",
    "diff --git a/gone.txt b/gone.txt", "deleted file mode 100644", "--- a/gone.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "--- starts with dashes",
  ].join("\n");
  const f = parseDiff(d);
  assert.deepEqual(f.map((x) => x.path), ["img.png", "new name.js", "gone.txt"]);
  assert.deepEqual(f[0].hunks, []);
  assert.equal(f[1].add, 1);
  assert.equal(f[1].hunks[0].lines.length, 3);
  assert.equal(f[2].del, 1);
  assert.equal(f[2].hunks[0].lines[0].code, "-- starts with dashes");
});
