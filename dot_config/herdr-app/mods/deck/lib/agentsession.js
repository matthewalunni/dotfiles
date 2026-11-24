// A card's Claude session: which conversation its agent is (so an ended one can
// be resumed with `claude --resume <id>`), and a short summary of where it
// stopped, read from the transcript. Pure; no herdr imports.
//
// The id comes from Claude's own record of the running process,
// ~/.claude/sessions/<pid>.json ({ sessionId, cwd }), where pid is the
// terminal's foreground process: exact even when several cards share a cwd.
// history.jsonl is the fallback (cards from before this, or a pid file that
// could not be read), matched on the card's cwd, its start time and its brief.

/** @typedef {{ id: string, cwd: string, via: "pid"|"history" }} AgentSession */
/** @typedef {{ done: string, stopped: string, question: string|null, lastAt: number|null }} Summary */

const ID = /^[0-9a-fA-F-]{8,64}$/;

/** Claude's project folder name for a cwd: every character that is not a letter or digit becomes "-". */
export function claudeSlug(cwd) {
  return String(cwd ?? "").replace(/[^A-Za-z0-9]/g, "-");
}

/** Where Claude keeps the transcript of session `id` started in `cwd`. */
export function transcriptPath(home, cwd, id) {
  return `${home}/.claude/projects/${claudeSlug(cwd)}/${id}.jsonl`;
}

/**
 * The session in ~/.claude/sessions/<pid>.json, or null when the text is not one.
 * @param {string|null|undefined} text @returns {AgentSession|null}
 */
export function parsePidSession(text) {
  let o;
  try { o = JSON.parse(String(text ?? "")); } catch { return null; }
  if (!o || typeof o.sessionId !== "string" || !ID.test(o.sessionId)) return null;
  if (typeof o.cwd !== "string" || !o.cwd.startsWith("/")) return null;
  return { id: o.sessionId, cwd: o.cwd, via: "pid" };
}

const firstLine = (s) => String(s ?? "").trim().split("\n")[0].trim();
const WRAPPER = /^<hc\b[^>]*>([\s\S]*?)<\/hc>$/;
const unwrap = (t) => { const m = WRAPPER.exec(String(t).trim()); return m ? m[1] : String(t); };

/**
 * The session history.jsonl gives for an agent: entries whose project is the
 * card's cwd (or repo root), started at or after `after` (the terminal's
 * creation) and not after `before` (when the card was last seen). Among
 * several, the one whose first prompt is the card's brief wins, else the
 * newest. Sessions in `taken` (other cards') are skipped.
 * @param {string|null} history
 * @param {{ cwd: string, root?: string|null, after?: number|null, before?: number|null, brief?: string|null, taken?: Set<string> }} q
 * @returns {AgentSession|null}
 */
export function sessionFromHistory(history, q) {
  if (!history || !q?.cwd) return null;
  /** @type {Map<string, { first: number, last: number, display: string, project: string }>} */
  const seen = new Map();
  for (const raw of String(history).split("\n")) {
    if (!raw.trim()) continue;
    let e;
    try { e = JSON.parse(raw); } catch { continue; }
    if (!e || typeof e.sessionId !== "string" || !ID.test(e.sessionId)) continue;
    if (e.project !== q.cwd && (q.root == null || e.project !== q.root)) continue;
    const ts = Number(e.timestamp);
    if (!Number.isFinite(ts)) continue;
    const cur = seen.get(e.sessionId);
    if (!cur) seen.set(e.sessionId, { first: ts, last: ts, display: firstLine(unwrap(e.display ?? "")), project: e.project });
    else {
      if (ts < cur.first) Object.assign(cur, { first: ts, display: firstLine(unwrap(e.display ?? "")) });
      if (ts > cur.last) cur.last = ts;
    }
  }
  const brief = firstLine(q.brief);
  let best = null;
  for (const [id, s] of seen) {
    if (q.taken?.has(id)) continue;
    if (q.after != null && s.first < q.after) continue;
    if (q.before != null && s.first > q.before) continue;
    const score = [brief && s.display && brief.startsWith(s.display.slice(0, 200)) ? 1 : 0, s.last];
    if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) best = { id, s, score };
  }
  return best ? { id: best.id, cwd: best.s.project, via: "history" } : null;
}

/**
 * The session to keep on the card: a pid-file id always wins; otherwise the
 * one already recorded; a history guess only when there is nothing better.
 * @param {AgentSession|null|undefined} seen @param {AgentSession|null|undefined} prev
 * @returns {AgentSession|null}
 */
export function pickSession(seen, prev) {
  if (seen?.via === "pid") return seen;
  return prev ?? seen ?? null;
}

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

/** The text blocks of a message's content (a string, or an array of blocks). */
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

const isPrompt = (e) => {
  if (e.type !== "user" || e.isMeta || e.isSidechain) return false;
  const c = e.message?.content;
  if (Array.isArray(c) && c.some((b) => b?.type === "tool_result")) return false;
  const t = textOf(c).trim();
  return t !== "" && !t.startsWith("<command-") && !t.startsWith("<local-command") && !t.startsWith("<system-reminder>");
};

/** The first one or two sentences of `text`, for "what was done". */
function lead(text) {
  const flat = String(text).replace(/```[\s\S]*?```/g, " ").replace(/[#*`>|]/g, "").replace(/\s+/g, " ").trim();
  // A sentence ends at . ! ? followed by a space or the end ("notes.txt" does not end one).
  const parts = flat.split(/(?<=[.!?])\s+/).filter(Boolean);
  return clip(parts.slice(0, 2).join(" ").trim(), 280);
}

/** The last sentence that asks something, or null. */
function lastQuestion(text) {
  const flat = String(text).replace(/```[\s\S]*?```/g, " ").replace(/[#*`>]/g, "").replace(/\s+/g, " ").trim();
  const qs = flat.split(/(?<=[.!?])\s+/).filter((x) => x.endsWith("?"));
  return qs.length ? clip(qs[qs.length - 1].trim(), 220) : null;
}

/**
 * A short summary of where session `id` stopped, from the newest part of its
 * transcript (JSON lines; a cut-off first line is skipped). What was done:
 * Claude's recap line when it came after the last prompt, else the start of
 * its last reply. Where it stopped: finished its turn, mid-tool, or before
 * answering. The open question: the last question in its last reply.
 * null when the text holds no turn of this session.
 * @param {string|null|undefined} text @param {string} [id]
 * @returns {Summary|null}
 */
export function summarizeTranscript(text, id) {
  const entries = [];
  for (const raw of String(text ?? "").split("\n")) {
    if (!raw.trim()) continue;
    let e;
    try { e = JSON.parse(raw); } catch { continue; }
    if (!e || typeof e !== "object") continue;
    if (id && e.sessionId && e.sessionId !== id) continue;
    if (e.isSidechain) continue;
    entries.push(e);
  }
  const ts = (e) => { const n = Date.parse(e?.timestamp); return Number.isFinite(n) ? n : null; };
  let prompt = null, reply = null, recap = null, last = null;
  for (const e of entries) {
    if (isPrompt(e)) { prompt = e; recap = null; last = e; continue; }
    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      last = e;
      if (textOf(e.message.content).trim()) reply = e;
      continue;
    }
    if (e.type === "user") { last = e; continue; } // a tool result
    if (e.type === "system" && e.subtype === "away_summary" && typeof e.content === "string") recap = e;
  }
  if (!last) return null;
  const replyText = reply && (!prompt || entries.indexOf(reply) > entries.indexOf(prompt)) ? textOf(reply.message.content) : "";
  const recapText = recap ? String(recap.content).replace(/\s*\(turn off recaps[^)]*\)\s*$/i, "") : "";
  const done = recapText ? clip(recapText, 320) : replyText ? lead(replyText) : prompt ? "Started on: " + clip(textOf(prompt.message.content), 200) : "Nothing in the transcript yet";
  let stopped;
  const tools = last.type === "assistant" ? (last.message.content ?? []).filter((b) => b?.type === "tool_use").map((b) => b.name) : [];
  if (last === prompt) stopped = "Stopped before answering: " + clip(textOf(prompt.message.content), 160);
  else if (tools.length) stopped = "Stopped mid-turn, running " + tools.join(", ");
  else if (last.type === "user") stopped = "Stopped mid-turn, after a tool returned";
  else stopped = "Finished its turn and was waiting on you";
  return { done, stopped, question: replyText ? lastQuestion(replyText) : null, lastAt: ts(last) };
}

/** argv that resumes session `id` (in the cwd it was started in). */
export function resumeArgv(id) {
  return ["claude", "--resume", String(id)];
}

const q = (s) => "'" + String(s).replace(/'/g, `'\\''`) + "'";

/** The line typed into a live shell to resume: cd to the session's folder, then claude --resume. */
export function resumeShellLine(id, cwd) {
  return `cd -- ${q(cwd)} && claude --resume ${q(id)}`;
}

const SHELLS = new Set(["zsh", "bash", "fish", "sh", "nu", "dash", "ksh", "tcsh"]);

/** Whether a terminal's foreground process (hc's `foreground`) is a plain shell, safe to type into. */
export function isShell(fg) {
  const a0 = Array.isArray(fg?.argv) ? String(fg.argv[0] ?? "") : "";
  const name = (a0 || String(fg?.name ?? "")).split("/").pop().replace(/^-/, "");
  return SHELLS.has(name);
}

/**
 * Whether resuming `issue` is possible, and how: { id, cwd } or { error }.
 * @param {any} issue
 */
export function resumePlan(issue) {
  if (!issue || issue.kind === "backlog") return { error: "a backlog card has no agent to resume" };
  if (issue.observed !== false) return { error: `${issue.id}'s agent is still running` };
  const s = issue.agent;
  if (!s?.id) return { error: `${issue.id} has no Claude session recorded` };
  // A machine-qualified terminal (dev/t5) ran on another computer: its session lives there.
  if (String(issue.terminal ?? "").includes("/")) return { error: `${issue.id} ran on ${String(issue.terminal).split("/")[0]}: Resume works only for agents on this computer` };
  return { id: s.id, cwd: s.cwd || issue.cwd };
}
