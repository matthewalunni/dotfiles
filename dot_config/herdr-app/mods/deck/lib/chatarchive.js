// Pure helpers for the closed-issue log and the chat archive. No herdr imports.

/**
 * The record kept when a card is removed. Works for a store Issue and a backlog
 * entry (both carry key, title, repo, stage, pr, brief, createdAt).
 * @param {object} issue @param {"deleted"|"discarded"} how @param {number} now
 */
export function closedRecord(issue, how, now) {
  return {
    key: issue.key,
    title: issue.title,
    repo: issue.repo ?? null,
    stage: issue.stage,
    pr: issue.pr ? { number: issue.pr.number, state: issue.pr.state } : null,
    brief: issue.brief ?? null,
    createdAt: issue.createdAt,
    removedAt: now,
    how,
  };
}

/** One JSON line (no trailing newline; JSON escapes any newline in the text). @param {object} block @param {number} now */
export function archiveLine(block, now) {
  return JSON.stringify({ ...block, at: now });
}

export const APPEND_SH = 'mkdir -p "$(dirname "$1")" && printf \'%s\\n\' "$2" >> "$1"';

/**
 * exec(cmd, args) that appends `line` to `path`; both are positional arguments only.
 * Plain /bin/sh, not a login shell: nothing a profile prints gets in the way.
 * @param {string} path @param {string} line
 */
export function appendExec(path, line) {
  return { cmd: "/bin/sh", args: ["-c", APPEND_SH, "append", path, line] };
}

/** How many archive lines are replayed into the chat log on start (the archive file keeps every line). */
export const REPLAY_LINES = 500;

/** exec(cmd, args) printing the last `n` lines of the archive at `path` (an argument, never in a script). */
export function replayExec(path, n = REPLAY_LINES) {
  return { cmd: "/usr/bin/tail", args: ["-n", String(n), path] };
}

/**
 * The chat blocks in archive text (archiveLine lines): `at` dropped, the
 * "cleared" dividers skipped (appendBlocks regenerates them from the session
 * change), bad lines and records without a string id skipped.
 * @param {unknown} text @returns {object[]}
 */
export function archiveBlocks(text) {
  const blocks = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line) continue;
    try {
      const { at, ...block } = JSON.parse(line);
      if (block.type === "divider" && block.kind === "cleared") continue;
      if (typeof block.id === "string") blocks.push(block);
    } catch {}
  }
  return blocks;
}

/** How long a failure notice stays quiet once shown. */
export const NOTE_QUIET_MS = 60_000;

/**
 * Whether the failure `key` is due a notice at `now`: not shown in the last
 * `ms`. Returns the map to keep (a new one when due; `seen` is never changed).
 * @param {Map<string, number>} seen @param {string} key @param {number} now @param {number} [ms]
 * @returns {{ due: boolean, seen: Map<string, number> }}
 */
export function noteDue(seen, key, now, ms = NOTE_QUIET_MS) {
  const last = seen.get(key);
  if (last != null && now - last < ms) return { due: false, seen };
  const next = new Map(seen);
  next.set(key, now);
  return { due: true, seen: next };
}
