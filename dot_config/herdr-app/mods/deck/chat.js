// The deck's chat agent source. Herdr-bound: finds the `deck-chat` terminal,
// launches it, tails its Claude transcript into the shared chat log and sends it
// the person's messages. Pure parts: lib/chatsource.js, lib/chat.js, lib/chatpaths.js.
//
// Nothing here answers a trust modal: a new cwd or --add-dir stops Claude on a
// security prompt, and only the person may answer it (the view shows the trust
// note with an Open terminal button, openChatTerminal). Nothing is sent while
// the agent is blocked or its state is unknown (sendToChat).

import { terminals, agents, home, shared, setShared, notify, run } from "herdr";
import { sh, hcAct, appendLog, currentStore, readScreen, readScreenText } from "./data.js";
import { CHAT_NAME, CHAT_CWD, expandHome, projectDir, archiveFile } from "./lib/chatpaths.js";
import { parseTranscriptLine, appendBlocks, reviveChatLog, capChatLog } from "./lib/chat.js";
import { archiveLine, archiveBlocks, replayExec } from "./lib/chatarchive.js";
import { repoChoices } from "./lib/newtask.js";
import {
  findChatTerminal, newestBorn, advance, chatLaunch, listProjectFiles, parseFileList, sendArgs, tailExec, sizeExec,
  firstOffset, sessionSeen, sessionFloor, logFloor, keepFrom,
} from "./lib/chatsource.js";
import { chatAgent, matchOption, canSendToChat, SEND_BLOCKED, chatOpenCommand, contextPercent } from "./lib/chatview.js";

// No Node APIs here (no Buffer, process, require, setTimeout): the mod runtime has none.

export const CHAT_KEY = "deck.chat";

const TICK_MS = 1000;
// Another copy's tail is alive while its heartbeat is this fresh.
const STALE_MS = 5000;
const READ_MAX = 256 * 1024;
const T_READ = 5_000;
const T_LAUNCH = 15_000;

/** Tail state of the one live collector: the session file being read and where we are in it. */
let st = freshState();
function freshState() {
  // started: the first successful listing is done (files present then start at their END,
  //   unless the log has seen their session: those resume from 0, see firstOffset).
  // floor: on a resume, blocks older than this were shown before the log cap let them go.
  // replayed: this month's archive tail has been put back into the log (once).
  return { session: null, offset: 0, floor: null, started: false, replayed: false, busy: false, lastErr: "" };
}

const text = (r) => String(r?.stdout ?? "");

/** The shared log; rebuilt when persisted state lost its Set, empty when none. */
function currentLog() {
  return reviveChatLog(shared(CHAT_KEY));
}

/** Stores the log, capped (the shared copy is persisted and read every frame; the archive keeps all). */
function saveLog(log) {
  setShared(CHAT_KEY, capChatLog(log));
}

/** Puts the tail of this month's archive back into the log (not re-archived). @param {string} home */
async function replayArchive(home, now) {
  const ex = replayExec(archiveFile(home, now));
  const r = await sh(ex.cmd, ex.args, { timeout: T_READ });
  if (r.code !== 0) return;
  const log = currentLog();
  // Nothing older than the log already holds (it may be capped): those were shown before.
  const next = appendBlocks(log, keepFrom(archiveBlocks(text(r)), logFloor(log)), now);
  if (next !== log) saveLog(next);
}

/** One poll: find the current session file, read what is new, log and archive it. */
async function poll() {
  const h = home();
  const now = Date.now();
  if (!st.replayed) {
    st.replayed = true;
    await replayArchive(h, now);
  }

  const dir = projectDir(h, expandHome(CHAT_CWD, h));
  const ls = listProjectFiles(dir);
  const listed = await sh(ls.cmd, ls.args, { timeout: T_READ });
  if (listed.code !== 0) return;
  const name = newestBorn(parseFileList(text(listed)));
  const first = !st.started;
  if (!name) {
    st.started = true; // a file that appears later is new: read it from its start
    return;
  }
  const file = `${dir}/${name}`;
  const session = name.slice(0, -".jsonl".length);

  if (session !== st.session) {
    // A different file: /clear (or the first one). A file that appears after the
    // first listing reads from its start. One already there at the first listing
    // (the deck was closed, restarted or reloaded) resumes from 0 when the log has
    // seen its session, so what the agent wrote meanwhile is not lost (ids are
    // stable: what is already shown is dropped), and starts at its END when the
    // log never saw it (no replay of an old transcript). On /clear the old file's
    // unread trailing lines (only bridge-session/cost-state, spike §2) are dropped on purpose.
    const known = currentLog();
    const seen = sessionSeen(known, session);
    st.session = session;
    st.offset = 0;
    st.floor = seen ? sessionFloor(known, session) : null;
    if (first) {
      let size = 0;
      if (!seen) {
        const sx = sizeExec(file);
        const sz = await sh(sx.cmd, sx.args, { timeout: T_READ });
        size = Number(text(sz).trim());
        if (sz.code !== 0 || !Number.isFinite(size)) {
          st.session = null; // retry next tick rather than replaying from 0
          return;
        }
      }
      st.offset = firstOffset({ sessionSeen: seen, size });
    }
  }
  st.started = true;
  if (!findChatTerminal(terminals())) return;

  const ex = tailExec(file, st.offset + 1, READ_MAX);
  const r = await sh(ex.cmd, ex.args, { timeout: T_READ });
  if (r.code !== 0 || !text(r)) return;
  // Only whole lines count; a partial last line is read again next tick.
  const { lines, offset } = advance(text(r), st.offset, READ_MAX);
  st.offset = offset;
  if (!lines.length) return;

  const blocks = [];
  for (const line of lines) blocks.push(...parseTranscriptLine(line, session));
  const log = currentLog();
  const next = appendBlocks(log, keepFrom(blocks, st.floor), now);
  if (next === log) return;
  // What is new, taken before the cap (which keeps the length at CHAT_LOG_MAX).
  const added = next.blocks.slice(log.blocks.length);
  saveLog(next);
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
        st.lastErr = "";
      } catch (e) {
        // One bad tick must not stop the timer; tell the person once per distinct error.
        const msg = String(e?.message ?? e);
        if (msg !== st.lastErr) {
          st.lastErr = msg;
          try { notify({ title: "Deck chat could not read the transcript", body: msg, level: "warning" }); } catch {}
        }
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
 * Type a message into the chat agent (lib/chatsource.js sendArgs: hc send ... -- text).
 * Refused unless a fresh read of the agent says it is working, idle or done
 * (canSendToChat): hc send presses Enter, which on a permission menu or a trust
 * modal would pick an option.
 * @param {string} message @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function sendToChat(message) {
  if (typeof message !== "string" || !message.trim()) return { ok: false, error: "nothing to send" };
  if (message.includes("\0")) return { ok: false, error: "message contains a NUL character" };
  const agent = chatAgent(terminals(), agents());
  if (!agent) return { ok: false, error: "the chat agent is not running" };
  if (!canSendToChat(agent.status)) return { ok: false, error: SEND_BLOCKED };
  return hcAct(sendArgs(message), "send failed");
}

/** Shows the chat agent's terminal (a peek over the tab, lib/chatview.js chatOpenCommand). */
export function openChatTerminal() {
  const c = chatOpenCommand(findChatTerminal(terminals()));
  if (!c) return { ok: false, error: "the chat agent is not running" };
  run(c.name, c.args);
  return { ok: true, error: null };
}

/**
 * The chat agent now: its terminal state (lib/chatview.js chatAgent) and, while
 * it is blocked, the prompt on its screen (a permission prompt is only ever
 * read from a blocked agent). null when there is no live `deck-chat` terminal.
 * @returns {Promise<{ agent: {address: string, status: string|null, focused: boolean}, prompt: any }|null>}
 */
export async function chatPrompt() {
  const agent = chatAgent(terminals(), agents());
  if (!agent) return null;
  const prompt = agent.status === "blocked" ? await readScreen(CHAT_NAME, agent.status) : null;
  return { agent, prompt };
}

/** How full the chat agent's context window is (percent, from its status line), or null. */
export async function chatContext() {
  if (!findChatTerminal(terminals())) return null;
  return contextPercent(await readScreenText(CHAT_NAME));
}

/**
 * Answer the chat agent's prompt with `option`, only if a fresh read of its
 * screen still shows `shown`, the prompt the person saw (same rule as
 * data.js pressOption); the fresh option's keys are pressed (hc keys) or its
 * reply typed (hc send). A prompt that changed is never answered.
 * @param {import("./lib/prompt.js").PromptOption} option @param {import("./lib/prompt.js").Prompt} shown
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function answerChat(option, shown) {
  const agent = chatAgent(terminals(), agents());
  if (!agent) return { ok: false, error: "the chat agent is not running" };
  const fresh = agent.status && agent.status !== "working" ? await readScreen(CHAT_NAME, agent.status) : null;
  const match = matchOption(shown, fresh, option);
  if (!match) {
    notify({ title: "The chat agent's prompt changed — not answered", level: "info" });
    return { ok: false, error: "prompt changed" };
  }
  if (typeof match.reply === "string" && match.reply !== "") return hcAct(sendArgs(match.reply), "send failed");
  return hcAct(["keys", CHAT_NAME, ...match.keys], "keys failed");
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
    launching = launch()
      .catch((e) => ({ ok: false, error: String(e?.message ?? e ?? "could not start the chat agent") }))
      .finally(() => {
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
  // A fresh session every launch: resuming (--continue) is deliberately not done
  // yet; it is unverified against the newest-born transcript detection (see chatLaunch).
  const { cmd, args } = chatLaunch(repos, h);
  const r = await sh(cmd, args, { timeout: T_LAUNCH });
  if (r.code !== 0) return { ok: false, error: String(r.stderr || r.stdout || "could not start the chat agent").trim() };
  return { ok: true, error: null };
}
