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

// stat -f '%B %N': birth time in seconds, then the name. The dir is "$1" only.
export const LIST_SH = 'cd "$1" 2>/dev/null || exit 0; for f in *.jsonl; do [ -f "$f" ] && stat -f "%B %N" "$f"; done; exit 0';

/** exec(cmd, args) listing `<birth seconds> <name>` per *.jsonl in `dir`. @param {string} dir */
export function listProjectFiles(dir) {
  return { cmd: "/bin/zsh", args: ["-lc", LIST_SH, "list", dir] };
}

/** @param {string} out @returns {{name: string, birthMs: number}[]} */
export function parseFileList(out) {
  const files = [];
  for (const line of String(out ?? "").split("\n")) {
    const m = /^(\d+) (.+)$/.exec(line);
    if (m) files.push({ name: m[2], birthMs: Number(m[1]) * 1000 });
  }
  return files;
}
