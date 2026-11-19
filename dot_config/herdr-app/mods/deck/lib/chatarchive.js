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

/** exec(cmd, args) that appends `line` to `path`; both are positional arguments only. @param {string} path @param {string} line */
export function appendExec(path, line) {
  return { cmd: "/bin/zsh", args: ["-lc", APPEND_SH, "append", path, line] };
}
