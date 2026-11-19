import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CLOSED_LOG, CHAT_ARCHIVE_DIR, CHAT_NAME } from "../../dot_config/herdr-app/mods/deck/lib/chatpaths.js";
import { parseTranscriptLine } from "../../dot_config/herdr-app/mods/deck/lib/chat.js";
import { closedRecord, archiveLine } from "../../dot_config/herdr-app/mods/deck/lib/chatarchive.js";

const read = (n) => fs.readFileSync(new URL(`../../dot_claude/skills/${n}/SKILL.md`, import.meta.url), "utf8");
const history = read("herdr-history");
const orch = read("orchestrator");

const record = closedRecord({ key: "k", title: "t", stage: "build", pr: { number: 1, state: "OPEN" }, createdAt: 1 }, "deleted", 2);
const sample = parseTranscriptLine(JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-11-19T06:47:10.000Z", message: { role: "user", content: "hi" } }), "S1")[0];
assert.ok(sample, "parser yields a text block");
const lineKeys = Object.keys(JSON.parse(archiveLine(sample, 1)));

test("herdr-history: both paths verbatim", () => {
  assert.ok(history.includes(CLOSED_LOG));
  assert.ok(history.includes(CHAT_ARCHIVE_DIR));
});
test("herdr-history: every closedRecord field and archive line key", () => {
  for (const f of Object.keys(record)) assert.ok(history.includes(`\`${f}\``), `closed field ${f}`);
  for (const k of lineKeys) assert.ok(history.includes(`\`${k}\``), `archive key ${k}`);
});
test("herdr-history: has jq and grep examples", () => {
  assert.match(history, /jq /);
  assert.match(history, /grep /);
});
test("orchestrator: required commands and rules", () => {
  for (const s of ["herdr-history", "hc send", "hc ls", "hc read", "hc keys", "hc wait", "herdr-backlog", "never start a filed task", CHAT_NAME]) {
    assert.ok(orch.includes(s), s);
  }
  assert.match(orch, /hc send <name> -- /);
});
test("orchestrator: adds no permission rules", () => {
  for (const s of ["allowlist", "permission policy", "ask before merging"]) {
    assert.ok(!orch.toLowerCase().includes(s), s);
  }
});
test("both skills: frontmatter with one-line description", () => {
  for (const [n, t] of [["orchestrator", orch], ["herdr-history", history]]) {
    assert.ok(t.startsWith(`---\nname: ${n}\n`), `${n} name`);
    assert.match(t, /^description: Use when .+$/m, `${n} description`);
  }
});
