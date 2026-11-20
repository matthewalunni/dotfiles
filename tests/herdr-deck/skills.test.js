import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CLOSED_LOG, CHAT_ARCHIVE_DIR, CHAT_NAME } from "../../dot_config/herdr-app/mods/deck/lib/chatpaths.js";
import { parseTranscriptLine } from "../../dot_config/herdr-app/mods/deck/lib/chat.js";
import { closedRecord, archiveLine } from "../../dot_config/herdr-app/mods/deck/lib/chatarchive.js";
import { CHAT_SYSTEM_PROMPT } from "../../dot_config/herdr-app/mods/deck/lib/chatsource.js";
import { CHAT_ATTACH } from "../../dot_config/herdr-app/mods/deck/lib/chatview.js";

const readme = fs.readFileSync(new URL("../../README.md", import.meta.url), "utf8");

test("README: the first-run trust step names the real way to answer it", () => {
  assert.ok(readme.includes("Open terminal"));
  assert.ok(readme.includes(CHAT_ATTACH));
  assert.ok(!readme.includes("in the chat pane"));
});

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
test("orchestrator: says where the deck store is and how to read it", () => {
  assert.ok(orch.includes("~/.config/herdr-app/shared.json"));
  assert.ok(orch.includes('."deck.store".issues[]'));
  assert.match(orch, /jq -c '\."deck\.store"/);
});
test("the chat agent's system prompt names its terminal and the orchestrator skill (whose description triggers on it)", () => {
  assert.ok(CHAT_SYSTEM_PROMPT.includes(`hc terminal ${CHAT_NAME}`));
  assert.ok(CHAT_SYSTEM_PROMPT.includes("orchestrator skill"));
  assert.ok(CHAT_SYSTEM_PROMPT.includes("the board is the source of truth"));
  assert.match(orch, /^name: orchestrator$/m);
  assert.match(orch, new RegExp(`^description: .*chat agent for the Herdr board \\(terminal name ${CHAT_NAME}\\)`, "m"));
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
