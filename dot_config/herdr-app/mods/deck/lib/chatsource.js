// Pure helpers for the chat agent source (chat.js does the herdr-bound work).
// No herdr imports.
import { CHAT_NAME, CHAT_CWD, expandHome } from "./chatpaths.js";

/** The address of the live terminal named CHAT_NAME, else null. @param {any[]} terminals */
export function findChatTerminal(terminals) {
  const t = (terminals ?? []).find((x) => x && x.name === CHAT_NAME && x.state === "live");
  return t?.address ?? null;
}

/** The *.jsonl name with the greatest birthMs; null when there is none. @param {{name: string, birthMs: number}[]} files */
export function newestBorn(files) {
  let best = null;
  for (const f of files ?? []) {
    if (!f?.name?.endsWith(".jsonl")) continue;
    if (!best || f.birthMs > best.birthMs) best = f;
  }
  return best ? best.name : null;
}

/**
 * Whole lines only: `carry` (an earlier partial line) is prefixed to `text`, and a
 * trailing partial line stays in the returned carry.
 * @param {string} text @param {string} carry
 */
export function splitComplete(text, carry) {
  const all = carry + text;
  const parts = all.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l !== ""), carry: rest };
}

/** UTF-8 byte length of a string (the mod runtime has no Buffer). Lone surrogates and U+FFFD count 3. @param {string} s */
export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * What a tail read yields: the whole lines of `chunk` and the byte offset after
 * them. A partial last line (or a character cut by the size cap) is left for the
 * next read. A chunk of `max` bytes with no newline is one over-long line: skip it.
 * @param {string} chunk @param {number} offset @param {number} max
 */
export function advance(chunk, offset, max) {
  const { lines, carry } = splitComplete(chunk, "");
  const total = utf8Length(chunk);
  const used = total - utf8Length(carry);
  if (used > 0) return { lines, offset: offset + used };
  return { lines, offset: total >= max ? offset + max : offset };
}

/**
 * What the chat agent is told on top of Claude's own system prompt, so the
 * orchestrator skill (whose description names deck-chat) applies.
 */
export const CHAT_SYSTEM_PROMPT =
  "You are the Herdr deck chat agent (hc terminal deck-chat): Matt talks to you from the deck's Chat view. " +
  "Use the orchestrator skill; the board is the source of truth.";

/**
 * hc run for the chat agent: named, kept, parentless, in its own cwd, told it
 * is the deck chat agent (--append-system-prompt), with each repo as --add-dir.
 * It is deliberately not resumed (no --continue) yet: chat.js finds the
 * transcript as the newest-born file, and how --continue writes its file is
 * unverified against that (spec deviation, Matt's ruling pending).
 * @param {string[]} repos @param {string} home
 */
export function chatLaunch(repos, home) {
  const args = [
    "run", "--bg", "--json", "--keep", "--no-parent", "--name", CHAT_NAME, "--cwd", expandHome(CHAT_CWD, home),
    "claude", "--append-system-prompt", CHAT_SYSTEM_PROMPT,
  ];
  for (const r of repos) args.push("--add-dir", r);
  return { cmd: "hc", args };
}

/** The argv for `hc send deck-chat -- <text>`: "--" so text starting with "-" is text, not a flag. @param {string} text */
export function sendArgs(text) {
  return ["send", CHAT_NAME, "--", text];
}

// The chat scripts run in plain /bin/sh -c, never a login shell: a profile that
// prints anything would shift the tail's byte offset. Values are positional only.

// stat -f '%FB %N': birth time in (fractional) seconds, then the name. The dir is "$1" only.
// POSIX sh has no nullglob: an unmatched *.jsonl stays literal and the -e test skips it.
export const LIST_SH = 'cd "$1" 2>/dev/null || exit 0; for f in *.jsonl; do [ -e "$f" ] || continue; [ -f "$f" ] && stat -f "%FB %N" "$f"; done; exit 0';

/** exec(cmd, args) listing `<birth seconds> <name>` per *.jsonl in `dir`. @param {string} dir */
export function listProjectFiles(dir) {
  return { cmd: "/bin/sh", args: ["-c", LIST_SH, "list", dir] };
}

/** Bytes of file "$1" from 1-based byte "$2", at most "$3" of them. */
export const TAIL_SH = 'tail -c +"$2" "$1" | head -c "$3"';
/** The size in bytes of file "$1". */
export const SIZE_SH = 'stat -f %z "$1"';

/** exec(cmd, args) reading at most `max` bytes of `file` from 1-based byte `from`. */
export function tailExec(file, from, max) {
  return { cmd: "/bin/sh", args: ["-c", TAIL_SH, "tail", file, String(from), String(max)] };
}

/** exec(cmd, args) printing the size of `file` in bytes. */
export function sizeExec(file) {
  return { cmd: "/bin/sh", args: ["-c", SIZE_SH, "size", file] };
}

/**
 * Where the first read of a session file starts. A session the chat log has
 * already seen resumes from 0 (the deck was away: re-read it; appendBlocks drops
 * what is shown, keepFrom what the log cap let go); one it has never seen starts
 * at its end (no replay of an old transcript). An empty or unknown size is 0.
 * @param {{ sessionSeen: boolean, size: number }} s
 */
export function firstOffset({ sessionSeen, size }) {
  if (sessionSeen) return 0;
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/** Whether the log holds any block of `session` (their ids are `${session}:...`). */
export function sessionSeen(log, session) {
  if (!session) return false;
  const p = `${session}:`;
  return log.session === session || log.blocks.some((b) => typeof b?.id === "string" && b.id.startsWith(p));
}

/**
 * The transcript time of the oldest block of `session` the log still holds,
 * else null. Its "cleared" divider carries the deck's time, not the transcript's: skipped.
 */
export function sessionFloor(log, session) {
  return floorOf(log.blocks.filter((b) => b?.session === session));
}

/**
 * The transcript time of the oldest block the log holds (any session), else
 * null: the archive replay adds nothing older, so a capped log never gets old
 * blocks appended after its newest ones.
 */
export function logFloor(log) {
  return floorOf(log.blocks);
}

function floorOf(blocks) {
  let floor = null;
  for (const b of blocks) {
    if (!b || (b.type === "divider" && b.kind === "cleared")) continue;
    if (Number.isFinite(b.t) && (floor == null || b.t < floor)) floor = b.t;
  }
  return floor;
}

/**
 * On a resume, the blocks not older than `floor`: anything older was shown
 * (and archived) before the log cap let it go. A null floor keeps them all.
 */
export function keepFrom(blocks, floor) {
  return floor == null ? blocks : blocks.filter((b) => !(b.t < floor));
}

/** @param {string} out @returns {{name: string, birthMs: number}[]} */
export function parseFileList(out) {
  const files = [];
  for (const line of String(out ?? "").split("\n")) {
    const m = /^(\d+(?:\.\d+)?) (.+)$/.exec(line);
    if (m) files.push({ name: m[2], birthMs: Math.round(Number(m[1]) * 1000) });
  }
  return files;
}
