import test from "node:test";
import assert from "node:assert/strict";
import {
  STATE_DIR, CLOSED_LOG, CHAT_ARCHIVE_DIR, CHAT_NAME, CHAT_CWD,
  projectDir, expandHome, archiveFile, transcriptPath,
} from "../../dot_config/herdr-app/mods/deck/lib/chatpaths.js";

test("constants", () => {
  assert.equal(STATE_DIR, "~/.local/state/herdr-deck");
  assert.equal(CLOSED_LOG, "~/.local/state/herdr-deck/closed.jsonl");
  assert.equal(CHAT_ARCHIVE_DIR, "~/.local/state/herdr-deck/chat");
  assert.equal(CHAT_NAME, "deck-chat");
  assert.equal(CHAT_CWD, "~/.local/state/herdr-deck/chat-cwd");
});
test("projectDir: every / and . becomes -", () => {
  assert.equal(
    projectDir("/h", "/h/.local/state/herdr-deck/chat-cwd"),
    "/h/.claude/projects/-h--local-state-herdr-deck-chat-cwd",
  );
});
test("transcriptPath", () => {
  assert.equal(
    transcriptPath("/h", "/h/.local/share/chezmoi", "abc"),
    "/h/.claude/projects/-h--local-share-chezmoi/abc.jsonl",
  );
});
test("archiveFile: UTC month", () => {
  assert.equal(archiveFile("/h", Date.UTC(2026, 10, 19)), "/h/.local/state/herdr-deck/chat/2026-11.jsonl");
  assert.equal(archiveFile("/h", Date.UTC(2026, 0, 1)), "/h/.local/state/herdr-deck/chat/2026-01.jsonl");
});
test("expandHome", () => {
  assert.equal(expandHome("~/.local/state/herdr-deck/closed.jsonl", "/h"), "/h/.local/state/herdr-deck/closed.jsonl");
  assert.equal(expandHome("/abs/path", "/h"), "/abs/path");
});
