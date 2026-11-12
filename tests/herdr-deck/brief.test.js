import test from "node:test";
import assert from "node:assert/strict";
import { findBrief } from "../../dot_config/herdr-app/mods/deck/lib/brief.js";

const line = (display, project, sessionId, timestamp) =>
  JSON.stringify({ display, pastedContents: {}, timestamp, project, sessionId });

const P = "/work/app";
const jsonl = [
  line("old first prompt", P, "s1", 1000),
  line("old second prompt", P, "s1", 1100),
  line("/clear", P, "s2", 2000),
  line("[Pasted text #1 +3 lines]", P, "s2", 2010),
  line("[Image #1]", P, "s2", 2015),
  line("!ls", P, "s2", 2020),
  line("", P, "s2", 2025),
  line("new first prompt\nsecond line", P, "s2", 2030),
  line("other project prompt", "/work/other", "s3", 3000),
  line("root prompt", "/work/repo", "s4", 4000),
  "not json",
  "",
].join("\n");

test("newest session's first kept prompt, first line only", () => {
  assert.equal(findBrief(jsonl, { cwd: P, root: null, after: null }), "new first prompt");
});

test("different project ignored; no match gives null", () => {
  assert.equal(findBrief(jsonl, { cwd: "/nowhere", root: null, after: null }), null);
  assert.equal(findBrief("", { cwd: P, root: null, after: null }), null);
});

test("worktree cwd matches entries recorded at the repo root", () => {
  assert.equal(findBrief(jsonl, { cwd: "/work/repo/wt", root: "/work/repo", after: null }), "root prompt");
});

test("after picks the most recent session started at or after it", () => {
  assert.equal(findBrief(jsonl, { cwd: P, root: null, after: 1050 }), "new first prompt");
  assert.equal(findBrief(jsonl, { cwd: P, root: null, after: 2030 }), "new first prompt");
  assert.equal(findBrief(jsonl, { cwd: P, root: null, after: 2031 }), null);
});

test("hc send wrapper is unwrapped before filtering", () => {
  const j = [
    line('<hc from="t1">do the thing\nmore</hc>', P, "a", 10),
    line('<hc from="t1">/clear</hc>', P, "b", 20),
  ].join("\n");
  assert.equal(findBrief(j, { cwd: P, root: null, after: null }), "do the thing");
});

test("long first line truncated to 280 chars", () => {
  const j = line("x".repeat(500), P, "a", 10);
  assert.equal(findBrief(j, { cwd: P, root: null, after: null }).length, 280);
});
