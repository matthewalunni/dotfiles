import { test } from "node:test";
import assert from "node:assert/strict";
import { findChatTerminal, newestBorn, splitComplete, chatLaunch, listProjectFiles, parseFileList } from "../../dot_config/herdr-app/mods/deck/lib/chatsource.js";
import { CHAT_NAME } from "../../dot_config/herdr-app/mods/deck/lib/chatpaths.js";

test("findChatTerminal picks the live terminal named deck-chat", () => {
  assert.equal(findChatTerminal([{ address: "t1", name: "x", state: "live" }, { address: "t2", name: CHAT_NAME, state: "live" }]), "t2");
  assert.equal(findChatTerminal([{ address: "t3", name: CHAT_NAME, state: "dead" }]), null);
  assert.equal(findChatTerminal([]), null);
  assert.equal(findChatTerminal(null), null);
});

test("newestBorn picks the newest-born jsonl and ignores other files", () => {
  assert.equal(newestBorn([{ name: "a.jsonl", birthMs: 5 }, { name: "b.jsonl", birthMs: 9 }, { name: "c.txt", birthMs: 99 }]), "b.jsonl");
  assert.equal(newestBorn([]), null);
});

test("splitComplete keeps a partial last line in the carry", () => {
  const a = splitComplete('{"a":1}\n{"b"', "");
  assert.deepEqual(a, { lines: ['{"a":1}'], carry: '{"b"' });
  assert.deepEqual(splitComplete(':2}\n', a.carry), { lines: ['{"b":2}'], carry: "" });
  assert.deepEqual(splitComplete("", "xy"), { lines: [], carry: "xy" });
});

test("chatLaunch names the agent, stays parentless and adds each repo once", () => {
  const { cmd, args } = chatLaunch(["/r/a", "/r/b"], "/h");
  assert.equal(cmd, "hc");
  const at = (f) => args[args.indexOf(f) + 1];
  assert.ok(args.includes("--no-parent"));
  assert.equal(at("--name"), "deck-chat");
  assert.equal(at("--cwd"), "/h/.local/state/herdr-deck/chat-cwd");
  assert.deepEqual(args.filter((a, i) => args[i - 1] === "--add-dir"), ["/r/a", "/r/b"]);
  assert.equal(args.filter((a) => a === "--add-dir").length, 2);
  assert.ok(args.indexOf("claude") < args.indexOf("--add-dir"));
});

test("parseFileList reads birth seconds and names", () => {
  assert.deepEqual(parseFileList("1700000000 s1.jsonl\n1700000500 s2.jsonl\n"), [
    { name: "s1.jsonl", birthMs: 1700000000000 },
    { name: "s2.jsonl", birthMs: 1700000500000 },
  ]);
  assert.deepEqual(parseFileList("garbage\n\n"), []);
});

test("listProjectFiles passes the dir only as a positional argument", () => {
  const { cmd, args } = listProjectFiles("/p q");
  assert.equal(cmd, "/bin/zsh");
  assert.equal(args[0], "-lc");
  assert.ok(!args[1].includes("/p q"));
  assert.ok(args.includes("/p q"));
});
