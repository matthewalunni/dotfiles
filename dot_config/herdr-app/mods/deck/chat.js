// The deck's chat agent source. Herdr-bound: finds the `deck-chat` terminal,
// launches it, tails its Claude transcript into the shared chat log and sends it
// the person's messages. Pure parts: lib/chatsource.js, lib/chat.js, lib/chatpaths.js.
//
// Nothing here answers a trust modal: a new cwd or --add-dir stops Claude on a
// security prompt, and only the person may answer it (the view shows "waiting
// for trust confirmation").

import { terminals, home, shared, setShared } from "herdr";
import { sh, hcAct, appendLog, currentStore } from "./data.js";
import { CHAT_NAME, CHAT_CWD, expandHome, projectDir, archiveFile } from "./lib/chatpaths.js";
import { parseTranscriptLine, appendBlocks, emptyChatLog } from "./lib/chat.js";
import { archiveLine } from "./lib/chatarchive.js";
import { repoChoices } from "./lib/newtask.js";
import { findChatTerminal, newestBorn, splitComplete, chatLaunch, listProjectFiles, parseFileList } from "./lib/chatsource.js";

export const CHAT_KEY = "deck.chat";

const TICK_MS = 1000;
// Another copy's tail is alive while its heartbeat is this fresh.
const STALE_MS = 5000;
const READ_MAX = 256 * 1024;
const T_READ = 5_000;
const T_LAUNCH = 15_000;

// Fixed scripts; paths and numbers are positional arguments only.
const TAIL_SH = 'tail -c +"$2" "$1" | head -c "$3"';
const SIZE_SH = 'stat -f %z "$1"';

/** Tail state of the one live collector: the session file being read and where we are in it. */
let st = freshState();
function freshState() {
  return { session: null, offset: 0, started: false, busy: false };
}

const text = (r) => String(r?.stdout ?? "");

/** The shared log, or an empty one when none (or a copy without a Set) is there. */
function currentLog() {
  const l = /** @type {any} */ (shared(CHAT_KEY));
  return l && Array.isArray(l.blocks) && l.ids instanceof Set ? l : emptyChatLog();
}

/** Puts this month's archived blocks back into the log (not re-archived). @param {string} home */
async function replayArchive(home, now) {
  const r = await sh("/bin/cat", [archiveFile(home, now)], { timeout: T_READ });
  if (r.code !== 0) return;
  const blocks = [];
  for (const line of text(r).split("\n")) {
    if (!line) continue;
    try {
      const { at, ...block } = JSON.parse(line);
      if (block && typeof block.id === "string") blocks.push(block);
    } catch {}
  }
  const log = currentLog();
  const next = appendBlocks(log, blocks, now);
  if (next !== log) setShared(CHAT_KEY, next);
}

/** One poll: find the current session file, read what is new, log and archive it. */
async function poll() {
  const h = home();
  const now = Date.now();
  if (!st.started) await replayArchive(h, now);
  if (!findChatTerminal(terminals())) return;

  const dir = projectDir(h, expandHome(CHAT_CWD, h));
  const ls = listProjectFiles(dir);
  const listed = await sh(ls.cmd, ls.args, { timeout: T_READ });
  if (listed.code !== 0) return;
  const name = newestBorn(parseFileList(text(listed)));
  if (!name) return;
  const file = `${dir}/${name}`;
  const session = name.slice(0, -".jsonl".length);

  if (session !== st.session) {
    // A different file: /clear (or the first one). Fresh file reads from its start;
    // an existing file at the very first poll starts at its END (no replay).
    st.session = session;
    st.offset = 0;
    if (!st.started) {
      const sz = await sh("/bin/zsh", ["-lc", SIZE_SH, "size", file], { timeout: T_READ });
      const n = Number(text(sz).trim());
      if (sz.code !== 0 || !Number.isFinite(n)) {
        st.session = null; // retry next tick rather than replaying from 0
        return;
      }
      st.offset = n;
    }
  }
  st.started = true;

  const r = await sh("/bin/zsh", ["-lc", TAIL_SH, "tail", file, String(st.offset + 1), String(READ_MAX)], { timeout: T_READ });
  if (r.code !== 0 || !text(r)) return;
  const chunk = text(r);
  // Only whole lines count: a partial last line is read again next tick, so the
  // offset moves by the bytes of the complete lines alone (also safe when the
  // size cap cut a multi-byte character).
  const { lines, carry } = splitComplete(chunk, "");
  const used = Buffer.byteLength(chunk) - Buffer.byteLength(carry);
  // A single line over the cap would never complete: skip past what was read.
  st.offset += used > 0 ? used : Buffer.byteLength(chunk) >= READ_MAX ? READ_MAX : 0;
  if (!lines.length) return;

  const blocks = [];
  for (const line of lines) blocks.push(...parseTranscriptLine(line, session));
  const log = currentLog();
  const next = appendBlocks(log, blocks, now);
  if (next === log) return;
  setShared(CHAT_KEY, next);
  const added = next.blocks.slice(log.blocks.length);
  if (added.length) await appendLog(archiveFile(h, now), added.map((b) => archiveLine(b, now)).join("\n"));
}

/** Starts the 1 s tail (called from the bar's init). Returns the guard for stopChat. @param {any} cx */
export function startChat(cx) {
  const guard = { beat: 0 };
  const claim = () => {
    const g = globalThis.__deckChat;
    if (g === guard) return true;
    if (g && Date.now() - g.beat < STALE_MS) return false;
    globalThis.__deckChat = guard;
    st = freshState();
    return true;
  };
  const tick = (cx) => {
    if (!claim()) return;
    guard.beat = Date.now();
    if (st.busy) return;
    st.busy = true;
    cx.spawn(async () => {
      try {
        await poll();
      } catch {
        // A failed poll is no data; the next tick tries again.
      } finally {
        st.busy = false;
      }
    });
  };
  tick(cx);
  cx.timer.every(TICK_MS, tick);
  return guard;
}

/** From the bar's close(). @param {{beat: number}|null|undefined} guard */
export function stopChat(guard) {
  if (guard && globalThis.__deckChat === guard) globalThis.__deckChat = null;
}

/**
 * Type a message into the chat agent (hc send ... -- text; "--" so text starting
 * with "-" is text, not a flag).
 * @param {string} message @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function sendToChat(message) {
  if (typeof message !== "string" || !message.trim()) return { ok: false, error: "nothing to send" };
  if (message.includes("\0")) return { ok: false, error: "message contains a NUL character" };
  return hcAct(["send", CHAT_NAME, "--", message], "send failed");
}

let launching = null;

/**
 * Make sure the chat agent exists: launch it when no live `deck-chat` terminal is
 * there. It may then be waiting on a trust modal; this never answers one.
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export function ensureChat() {
  if (findChatTerminal(terminals())) return Promise.resolve({ ok: true, error: null });
  if (!launching) {
    launching = launch().finally(() => {
      launching = null;
    });
  }
  return launching;
}

async function launch() {
  const h = home();
  const made = await sh("/bin/mkdir", ["-p", expandHome(CHAT_CWD, h)], { timeout: T_READ });
  if (made.code !== 0) return { ok: false, error: String(made.stderr || "could not create the chat folder").trim() };
  const repos = repoChoices(currentStore().issues).map((r) => r.root);
  const { cmd, args } = chatLaunch(repos, h);
  const r = await sh(cmd, args, { timeout: T_LAUNCH });
  if (r.code !== 0) return { ok: false, error: String(r.stderr || r.stdout || "could not start the chat agent").trim() };
  return { ok: true, error: null };
}
