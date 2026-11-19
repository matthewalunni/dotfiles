// Pure path constants and helpers for the deck chat. No herdr imports.
export const STATE_DIR = "~/.local/state/herdr-deck";
export const CLOSED_LOG = "~/.local/state/herdr-deck/closed.jsonl";
export const CHAT_ARCHIVE_DIR = "~/.local/state/herdr-deck/chat";
export const CHAT_NAME = "deck-chat";
export const CHAT_CWD = "~/.local/state/herdr-deck/chat-cwd";

export function expandHome(p, home) {
  return p.startsWith("~/") ? home + p.slice(1) : p;
}

// Claude Code keys a project's transcripts by its cwd with "/" and "." as "-".
export function projectDir(home, cwd) {
  return `${home}/.claude/projects/${cwd.replace(/[/.]/g, "-")}`;
}

export function transcriptPath(home, cwd, session) {
  return `${projectDir(home, cwd)}/${session}.jsonl`;
}

export function archiveFile(home, now) {
  const d = new Date(now);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${expandHome(CHAT_ARCHIVE_DIR, home)}/${d.getUTCFullYear()}-${month}.jsonl`;
}
