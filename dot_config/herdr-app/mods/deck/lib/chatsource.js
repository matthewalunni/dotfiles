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
 * hc run for the chat agent: named, kept, parentless, in its own cwd, with each
 * repo as --add-dir.
 * @param {string[]} repos @param {string} home
 */
export function chatLaunch(repos, home) {
  const args = ["run", "--bg", "--json", "--keep", "--no-parent", "--name", CHAT_NAME, "--cwd", expandHome(CHAT_CWD, home), "claude"];
  for (const r of repos) args.push("--add-dir", r);
  return { cmd: "hc", args };
}

// stat -f '%FB %N': birth time in (fractional) seconds, then the name. The dir is "$1" only.
// nullglob: an empty dir prints nothing and exits 0 instead of zsh's "no matches" error.
export const LIST_SH = 'setopt nullglob; cd "$1" 2>/dev/null || exit 0; for f in *.jsonl; do [ -f "$f" ] && stat -f "%FB %N" "$f"; done; exit 0';

/** exec(cmd, args) listing `<birth seconds> <name>` per *.jsonl in `dir`. @param {string} dir */
export function listProjectFiles(dir) {
  return { cmd: "/bin/zsh", args: ["-lc", LIST_SH, "list", dir] };
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
