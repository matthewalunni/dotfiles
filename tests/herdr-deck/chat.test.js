import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscriptLine, summarizeAction } from "../../dot_config/herdr-app/mods/deck/lib/chat.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/chat");
const lines = fs.readFileSync(path.join(FIX, "transcript.jsonl"), "utf8").split("\n").filter(Boolean);
const line = (uuid) => lines.find((l) => JSON.parse(l).uuid === uuid);
const parse = (uuid) => parseTranscriptLine(line(uuid), "s1");

test("user text line", () => {
  const out = parse("u-1");
  assert.equal(out.length, 1);
  const b = out[0];
  assert.equal(b.type, "text");
  assert.equal(b.role, "user");
  assert.equal(b.text, "what's waiting on me?");
  assert.equal(b.id, "s1:u-1");
  assert.equal(b.session, "s1");
  assert.equal(b.t, Date.parse("2026-11-19T06:47:10.000Z"));
});
test("assistant text line", () => {
  const out = parse("a-1");
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "text");
  assert.equal(out[0].role, "agent");
  assert.equal(out[0].text, "Two tasks need review.");
});
test("Bash hc send becomes an action block", () => {
  const out = parse("a-2");
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "action");
  assert.equal(out[0].verb, "sent");
  assert.equal(out[0].target, "term_1");
  assert.equal(out[0].detail, "rebase");
});
test("other Bash commands produce no block", () => {
  assert.deepEqual(parse("a-3"), []);
});
test("summarizeAction verbs", () => {
  assert.equal(summarizeAction("hc keys term_1 2").verb, "pressed");
  assert.equal(summarizeAction("hc keys term_1 2").detail, "2");
  assert.equal(summarizeAction("hc read term_1").verb, "read");
  assert.equal(summarizeAction("hc wait term_1").verb, "waited");
  const f = summarizeAction('herdr-backlog --title "x" --body y');
  assert.equal(f.verb, "filed");
  assert.equal(f.detail, "x");
  assert.equal(summarizeAction("gh pr merge 37").verb, "merged");
  assert.equal(summarizeAction("ls -la"), null);
  assert.equal(summarizeAction(""), null);
});
test("summarizeAction tolerates quotes and never executes", () => {
  const r = summarizeAction('hc send t1 -- "it\'s $(touch /nope) `x`"');
  assert.equal(r.verb, "sent");
  assert.equal(r.detail, "it's $(touch /nope) `x`");
  assert.doesNotThrow(() => summarizeAction('hc send t1 -- "unterminated'));
});
test("compact_boundary becomes a divider", () => {
  const out = parse("s-1");
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "divider");
  assert.equal(out[0].kind, "compacted");
});
test("non-chat lines produce nothing", () => {
  for (const id of ["u-3", "u-4", "u-5", "a-4", "u-2", "u-6"]) {
    assert.deepEqual(parse(id), [], id);
  }
});
test("hc envelope is stripped", () => {
  assert.equal(parse("u-7")[0].text, "hello");
});
test("malformed input never throws", () => {
  assert.deepEqual(parseTranscriptLine('{"type":"user","mess', "s1"), []);
  assert.deepEqual(parseTranscriptLine("", "s1"), []);
  assert.deepEqual(parseTranscriptLine("null", "s1"), []);
  for (const rec of [
    { type: "assistant", message: { content: [] } },
    { type: "mode" },
    { type: "assistant" },
    { type: "assistant", message: {} },
    { type: "assistant", message: { content: null } },
    { type: "assistant", message: { content: [null] } },
    { type: "assistant", message: { content: "plain string" } },
  ]) {
    assert.deepEqual(parseTranscriptLine(JSON.stringify({ uuid: "x-1", ...rec }), "s1"), [], JSON.stringify(rec));
  }
  assert.deepEqual(parseTranscriptLine(undefined, "s1"), []);
});
test("ids are stable", () => {
  assert.equal(parse("u-1")[0].id, parse("u-1")[0].id);
});
test("fixture hygiene", () => {
  for (const f of fs.readdirSync(FIX)) {
    const body = fs.readFileSync(path.join(FIX, f), "utf8");
    assert.doesNotMatch(body, /\/Users\/|@[a-z0-9.-]+\.[a-z]/i, f);
  }
});
