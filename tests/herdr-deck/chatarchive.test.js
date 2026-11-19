import test from "node:test";
import assert from "node:assert/strict";
import { closedRecord, archiveLine, appendExec } from "../../dot_config/herdr-app/mods/deck/lib/chatarchive.js";

const issue = {
  key: "t1", id: "D-1", title: "Fix the widget", repo: "demo", stage: "build",
  pr: { number: 7, state: "OPEN", title: "x", checks: [] }, brief: "Make it work",
  createdAt: 100, terminal: "t1",
};

test("closedRecord: every field, how deleted", () => {
  assert.deepEqual(closedRecord(issue, "deleted", 500), {
    key: "t1", title: "Fix the widget", repo: "demo", stage: "build",
    pr: { number: 7, state: "OPEN" }, brief: "Make it work",
    createdAt: 100, removedAt: 500, how: "deleted",
  });
});
test("closedRecord: no PR gives null; backlog entry maps title and brief", () => {
  const e = { kind: "backlog", key: "backlog|e1", id: "B-1", title: "Later", brief: "Do later", repo: "demo", stage: "backlog", pr: null, createdAt: 9 };
  const r = closedRecord(e, "discarded", 10);
  assert.equal(r.title, "Later");
  assert.equal(r.brief, "Do later");
  assert.equal(r.pr, null);
  assert.equal(r.how, "discarded");
  assert.equal(r.key, "backlog|e1");
});
test("archiveLine: one JSON line with id, session, type and at", () => {
  const b = { id: "s:u1", session: "s", type: "text", role: "agent", text: "a\nb", t: 1 };
  const line = archiveLine(b, 42);
  assert.ok(!line.includes("\n"));
  const o = JSON.parse(line);
  assert.equal(o.id, "s:u1");
  assert.equal(o.session, "s");
  assert.equal(o.type, "text");
  assert.equal(o.at, 42);
  assert.equal(o.text, "a\nb");
});
test("appendExec: path and line only as the last two positional args", () => {
  const path = "/x/y.jsonl";
  const line = 'a "q" $(rm -rf /)\nb';
  const { cmd, args } = appendExec(path, line);
  assert.equal(cmd, "/bin/zsh");
  assert.equal(args[0], "-lc");
  assert.deepEqual(args.slice(-2), [path, line]);
  assert.ok(!args[1].includes(path));
  assert.ok(!args[1].includes("rm -rf"));
});
