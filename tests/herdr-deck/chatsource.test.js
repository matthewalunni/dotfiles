import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findChatTerminal, newestBorn, splitComplete, chatLaunch, listProjectFiles, parseFileList, utf8Length, advance, LIST_SH,
  firstOffset, sessionSeen, sessionFloor, logFloor, keepFrom, sendArgs, CHAT_SYSTEM_PROMPT, tailExec, sizeExec, TAIL_SH, SIZE_SH,
} from "../../dot_config/herdr-app/mods/deck/lib/chatsource.js";
import { emptyChatLog, appendBlocks, reviveChatLog, capChatLog } from "../../dot_config/herdr-app/mods/deck/lib/chat.js";
import { archiveLine, archiveBlocks } from "../../dot_config/herdr-app/mods/deck/lib/chatarchive.js";
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
  assert.equal(cmd, "/bin/sh");
  assert.equal(args[0], "-c");
  assert.ok(!args[1].includes("/p q"));
  assert.ok(args.includes("/p q"));
});

test("utf8Length counts bytes like UTF-8 without Buffer", () => {
  assert.equal(utf8Length("abc"), 3);
  assert.equal(utf8Length("é"), 2);
  assert.equal(utf8Length("€"), 3);
  assert.equal(utf8Length("\u{1F600}"), 4);
  assert.equal(utf8Length("�"), 3);
  assert.equal(utf8Length("\uD800"), 3);
  for (const t of ["héllo € \u{1F600}", "x\n"]) assert.equal(utf8Length(t), Buffer.byteLength(t));
});

test("advance consumes whole lines by byte count", () => {
  const chunk = '{"a":"é"}\n{"b":"\u{1F600}"}\n{"c"';
  const r = advance(chunk, 100, 1000);
  assert.deepEqual(r.lines, ['{"a":"é"}', '{"b":"\u{1F600}"}']);
  assert.equal(r.offset, 100 + Buffer.byteLength('{"a":"é"}\n{"b":"\u{1F600}"}\n'));
});

test("advance leaves a chunk cut mid-character after the last newline for the next read", () => {
  const r = advance("ok\n�", 0, 4);
  assert.deepEqual(r.lines, ["ok"]);
  assert.equal(r.offset, 3);
});

test("advance with no complete line waits, unless the cap was hit", () => {
  assert.deepEqual(advance('{"a"', 7, 1000), { lines: [], offset: 7 });
  assert.deepEqual(advance("x".repeat(10), 7, 10), { lines: [], offset: 17 });
});

test("advance counts blank lines in the offset", () => {
  assert.deepEqual(advance("a\n\nb\n", 0, 100), { lines: ["a", "b"], offset: 5 });
});

test("listProjectFiles script tolerates an empty dir and reads sub-second birth", () => {
  // POSIX sh: an unmatched glob stays literal, so the loop skips a name that does not exist.
  assert.ok(LIST_SH.includes('[ -e "$f" ] || continue'));
  assert.ok(LIST_SH.includes("%FB"));
});

test("parseFileList reads a decimal birth time", () => {
  assert.deepEqual(parseFileList("1700000000.500000000 s1.jsonl\n1700000000.250000000 s 2.jsonl\n"), [
    { name: "s1.jsonl", birthMs: 1700000000500 },
    { name: "s 2.jsonl", birthMs: 1700000000250 },
  ]);
});

test("reviveChatLog rebuilds ids and session after a JSON round trip", () => {
  const b = (id, session) => ({ id, session, t: 1, type: "text", role: "user", text: "x" });
  const log = appendBlocks(emptyChatLog(), [b("A:1", "A"), b("B:1", "B")], 5);
  const lossy = reviveChatLog(JSON.parse(JSON.stringify(log)));
  assert.ok(lossy.ids instanceof Set);
  assert.deepEqual([...lossy.ids].sort(), [...log.ids].sort());
  assert.equal(lossy.session, "B");
  assert.equal(lossy.blocks.length, log.blocks.length);
  assert.equal(reviveChatLog(null).blocks.length, 0);
  assert.equal(reviveChatLog(log), log);
});

test("archive round trip: replaying the archive rebuilds the live log", () => {
  const b = (id, session) => ({ id, session, t: 1, type: "text", role: "user", text: "x" });
  let live = emptyChatLog();
  const archived = [];
  for (const batch of [[b("A:1", "A")], [b("B:1", "B")], [b("B:2", "B")]]) {
    const next = appendBlocks(live, batch, 9);
    for (const blk of next.blocks.slice(live.blocks.length)) archived.push(archiveLine(blk, 9));
    live = next;
  }
  // The same filter chat.js uses (archiveBlocks): replaying the archived
  // dividers too would double them (the bug), so they are skipped.
  const blocks = archiveBlocks(archived.join("\n") + "\n");
  assert.ok(blocks.every((x) => !("at" in x)));
  const replayed = appendBlocks(emptyChatLog(), blocks, 9);
  assert.deepEqual(replayed.blocks.map((x) => x.id), live.blocks.map((x) => x.id));
  assert.equal(live.blocks.filter((x) => x.kind === "cleared").length, 1);
});

// ---- final review fixes

test("firstOffset: resume a session the log has seen from 0; a new one from its end; an empty file from 0", () => {
  assert.equal(firstOffset({ sessionSeen: true, size: 900 }), 0);
  assert.equal(firstOffset({ sessionSeen: false, size: 900 }), 900);
  assert.equal(firstOffset({ sessionSeen: false, size: 0 }), 0);
  assert.equal(firstOffset({ sessionSeen: true, size: 0 }), 0);
  assert.equal(firstOffset({ sessionSeen: false, size: Number.NaN }), 0);
});

test("sessionSeen / sessionFloor / keepFrom: any block of the session counts; the floor skips the cleared divider", () => {
  const b = (id, session, t) => ({ id, session, t, type: "text", role: "user", text: "x" });
  const log = appendBlocks(emptyChatLog(), [b("A:1", "A", 10), b("B:1", "B", 30), b("B:2", "B", 40)], 99);
  assert.equal(sessionSeen(log, "A"), true);
  assert.equal(sessionSeen(log, "B"), true);
  assert.equal(sessionSeen(log, "C"), false);
  assert.equal(sessionSeen(log, null), false);
  assert.equal(sessionSeen(emptyChatLog(), "A"), false);
  // B's "cleared" divider has t = 99 (now), not a transcript time: it is not the floor.
  assert.equal(sessionFloor(log, "B"), 30);
  assert.equal(sessionFloor(log, "C"), null);
  const read = [b("B:0", "B", 20), b("B:1", "B", 30), b("B:3", "B", 50)];
  assert.deepEqual(keepFrom(read, 30).map((x) => x.id), ["B:1", "B:3"]);
  assert.equal(keepFrom(read, null), read);
});

test("resume after a restart: re-reading the file from 0 adds only what is new, even past the log cap", () => {
  const b = (n) => ({ id: `S:${n}`, session: "S", t: 1000 + n, type: "text", role: "agent", text: "m" + n });
  const seen = Array.from({ length: 8 }, (_, i) => b(i));
  const log = capChatLog(appendBlocks(emptyChatLog(), seen, 1), 5); // S:3..S:7 kept
  const reread = [...seen, b(8), b(9)]; // the whole file, two written while the deck was away
  const next = appendBlocks(log, keepFrom(reread, sessionFloor(log, "S")), 2);
  assert.deepEqual(next.blocks.slice(log.blocks.length).map((x) => x.id), ["S:8", "S:9"]);
});

test("archive replay into a capped log adds nothing older than what it holds (no out-of-order old blocks)", () => {
  const b = (n, s = "S") => ({ id: `${s}:${n}`, session: s, t: 1000 + n, type: "text", role: "agent", text: "m" + n });
  const all = [b(0, "R"), ...Array.from({ length: 8 }, (_, i) => b(i + 1))];
  const log = capChatLog(appendBlocks(emptyChatLog(), all, 1), 5);
  assert.deepEqual(log.blocks.map((x) => x.id), ["S:4", "S:5", "S:6", "S:7", "S:8"]); // R:0 and S's divider capped away
  assert.equal(logFloor(log), 1004);
  const next = appendBlocks(log, keepFrom(all, logFloor(log)), 2);
  assert.equal(next, log);
  assert.equal(logFloor(emptyChatLog()), null);
});

test("sendArgs: hc send deck-chat -- <text>, the text one argument, untouched", () => {
  for (const t of ['say "hi" it\'s me', "two\nlines", "-n not a flag", "/compact", "$(rm -rf /)"]) {
    assert.deepEqual(sendArgs(t), ["send", CHAT_NAME, "--", t]);
  }
});

test("chatLaunch tells claude it is the deck chat agent (--append-system-prompt) before the repos", () => {
  const { args } = chatLaunch(["/r/a"], "/h");
  const i = args.indexOf("--append-system-prompt");
  assert.ok(i > args.indexOf("claude"));
  assert.equal(args[i + 1], CHAT_SYSTEM_PROMPT);
  assert.ok(i < args.indexOf("--add-dir"));
  assert.match(CHAT_SYSTEM_PROMPT, /deck-chat/);
  assert.match(CHAT_SYSTEM_PROMPT, /orchestrator skill/);
  assert.match(CHAT_SYSTEM_PROMPT, /source of truth/);
});

test("the chat shell scripts run in /bin/sh -c (no login shell), values only as positional args", () => {
  const f = "/p q/$(x).jsonl";
  assert.deepEqual(tailExec(f, 11, 256), { cmd: "/bin/sh", args: ["-c", TAIL_SH, "tail", f, "11", "256"] });
  assert.deepEqual(sizeExec(f), { cmd: "/bin/sh", args: ["-c", SIZE_SH, "size", f] });
  for (const s of [LIST_SH, TAIL_SH, SIZE_SH]) {
    assert.ok(!s.includes("/p q"));
    assert.ok(!s.includes("setopt"));
  }
});
