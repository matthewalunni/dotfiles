import test from "node:test";
import assert from "node:assert/strict";
import { closedRecord, archiveLine, appendExec, archiveBlocks, replayExec, REPLAY_LINES, noteDue } from "../../dot_config/herdr-app/mods/deck/lib/chatarchive.js";

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
  assert.equal(cmd, "/bin/sh");
  assert.equal(args[0], "-c");
  assert.deepEqual(args.slice(-2), [path, line]);
  assert.ok(!args[1].includes(path));
  assert.ok(!args[1].includes("rm -rf"));
});
test("archiveBlocks: blocks without `at`, no cleared dividers, bad lines and id-less records skipped", () => {
  const lines = [
    archiveLine({ id: "s:1", session: "s", type: "text", role: "user", text: "hi", t: 1 }, 5),
    archiveLine({ id: "s:cleared", session: "s", type: "divider", kind: "cleared", t: 2 }, 5),
    archiveLine({ id: "s:2", session: "s", type: "divider", kind: "compacted", t: 3 }, 5),
    "{not json",
    JSON.stringify({ type: "text", text: "no id", at: 1 }),
    "",
  ];
  assert.deepEqual(archiveBlocks(lines.join("\n")), [
    { id: "s:1", session: "s", type: "text", role: "user", text: "hi", t: 1 },
    { id: "s:2", session: "s", type: "divider", kind: "compacted", t: 3 },
  ]);
  assert.deepEqual(archiveBlocks(""), []);
  assert.deepEqual(archiveBlocks(null), []);
});
test("replayExec: the archive's last n lines (tail -n), the path one argument", () => {
  assert.deepEqual(replayExec("/a b/2026-11.jsonl", 500), { cmd: "/usr/bin/tail", args: ["-n", "500", "/a b/2026-11.jsonl"] });
  assert.equal(REPLAY_LINES, 500);
});
test("noteDue: once per distinct failure per minute; the input map untouched", () => {
  const a = noteDue(new Map(), "x", 1000);
  assert.equal(a.due, true);
  const b = noteDue(a.seen, "x", 1000 + 59_999);
  assert.equal(b.due, false);
  assert.equal(noteDue(b.seen, "y", 2000).due, true);
  const c = noteDue(b.seen, "x", 1000 + 60_000);
  assert.equal(c.due, true);
  assert.equal(a.seen.get("x"), 1000);
  assert.equal(noteDue(a.seen, "x", 1500, 100).due, true);
});
