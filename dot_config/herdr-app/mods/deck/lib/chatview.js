// The Chat view's pure parts: the chat agent's state, the approval card from a
// permission prompt, cards after agent messages, scrolling and keys. No herdr imports.
import { findChatTerminal } from "./chatsource.js";
import { samePrompt } from "./prompt.js";
import { cardsFor } from "./chat.js";
import { CHAT_NAME } from "./chatpaths.js";
import { repoChoices } from "./newtask.js";

const STATUSES = new Set(["working", "blocked", "done", "idle"]);

/** How long an unknown status lasts before the view says a trust modal is waiting. */
export const TRUST_MS = 4000;

/**
 * The live `deck-chat` terminal: its address, status (agents() first, else the
 * terminal's own; anything unknown is null) and whether it has the keyboard
 * (false when agents() does not list it). null when there is none.
 * @param {any[]} terminals terminals() @param {any[]|null|undefined} agents agents()
 * @returns {{ address: string, status: "working"|"blocked"|"done"|"idle"|null, focused: boolean }|null}
 */
export function chatAgent(terminals, agents) {
  const address = findChatTerminal(terminals);
  if (!address) return null;
  const a = (agents ?? []).find((x) => x && x.address === address);
  const t = (terminals ?? []).find((x) => x && x.address === address);
  const raw = a?.status ?? t?.status ?? null;
  return { address, status: STATUSES.has(raw) ? raw : null, focused: Boolean(a?.focused) };
}

/**
 * Whether the Chat view should start the chat agent now: it is shown (every
 * stack child inits when the layout loads, hidden ones too), no chat agent is
 * live, and it has not tried yet (the Start button covers a failed try).
 * @param {{ shown: boolean, agent: object|null, tried: boolean }} s
 */
export function shouldAutoStart({ shown, agent, tried }) {
  return Boolean(shown && !agent && !tried);
}

/** Why a message is not sent while the chat agent is on a prompt (or its state is unknown). */
export const SEND_BLOCKED = "answer the chat agent's prompt first";

/**
 * Whether a message may be typed into the chat agent: only while it is
 * working, idle or done. Blocked (a permission menu: Enter would pick the
 * highlighted option, a digit a numbered one) or unknown (a trust modal, or
 * not started yet) never.
 * @param {unknown} status
 */
export function canSendToChat(status) {
  return status === "working" || status === "idle" || status === "done";
}

/** Whether the composer holds its text instead of sending: an approval card or the trust note is showing. */
export function composerLocked({ approval, trust }) {
  return Boolean(approval || trust);
}

/**
 * What following the transcript keys on: the last drawn block's id and the
 * rows under it (the approval card, the trust note, the thinking row). Not the row count:
 * at the draw cap new blocks leave it unchanged.
 * @param {{ lastId: string|null|undefined, approval: boolean, trust: boolean, thinking?: boolean }} s
 */
export function followKey({ lastId, approval, trust, thinking = false }) {
  return `${lastId ?? ""}|${approval ? "a" : ""}|${trust ? "t" : ""}|${thinking ? "w" : ""}`;
}

/** What the view's redraw check compares for the shared chat log: its length and last block id (the log is capped). */
export function logMark(raw) {
  const blocks = Array.isArray(raw?.blocks) ? raw.blocks : [];
  return `${blocks.length}:${blocks.at(-1)?.id ?? ""}`;
}

/** Whether to scroll to the bottom: the first draw, or something new while the reader is at the bottom (`away` 0). */
export function followScroll(prev, next, away) {
  if (prev == null) return true;
  return next !== prev && away === 0;
}

/** The command a viewer runs (`run(name, args)`) to show the chat agent's terminal: a peek over the tab. */
export function chatOpenCommand(address) {
  return address ? { name: "terminal.peek", args: { terminal: address } } : null;
}

/** The shell command that attaches any terminal to the chat agent (ctrl+\ detaches). */
export const CHAT_ATTACH = `hc attach ${CHAT_NAME}`;

/** The note while Claude waits on its trust modal; only the person answers it. */
export const TRUST_NOTE =
  `Claude is asking whether to trust its folder. Open its terminal to answer (or run ${CHAT_ATTACH} in any terminal); Deck never answers it.`;

/**
 * The working folders to try `gh pr view N` in: each distinct repo root on
 * the board, in order (lib/newtask.js repoChoices); one try without a folder when there is none.
 * @param {any[]} issues @returns {(string|null)[]}
 */
export function prCwds(issues) {
  const roots = repoChoices(issues).map((r) => r.root);
  return roots.length ? roots : [null];
}

/** When the status became unknown (kept while it stays unknown), else null. */
export function nullSince(prev, status, now) {
  return status == null ? prev ?? now : null;
}

/** Whether an unknown status has lasted TRUST_MS: Claude is waiting on a trust modal. */
export function trustWaiting(status, since, now) {
  return status == null && since != null && now - since >= TRUST_MS;
}

const firstOf = (options, re) => options.find((o) => re.test(String(o.label ?? "")));

/** Menu options that open a text field in the terminal (the composer stays locked meanwhile): not offered. */
const TYPE_OPTION = /^type something\.?$/i;

/**
 * A question menu (AskUserQuestion) as a block: the question as the title, the
 * tab bar of a several-question form ("←  ☐ A  ☐ B  ✔ Submit  →") as the
 * subtitle, every option but "Type something." as a button. Box rules ("│ ") are dropped.
 * @param {import("./prompt.js").Prompt} prompt
 */
function menuFrom(prompt) {
  const lines = String(prompt.text ?? "").split("\n").map((l) => l.replace(/^\s*│\s?/, "").trim()).filter(Boolean);
  const tabs = lines.find((l) => /^←.*→$/.test(l)) ?? "";
  const question = lines.filter((l) => l !== tabs).join(" ");
  const options = prompt.options.filter((o) => !TYPE_OPTION.test(String(o.label ?? "").trim()));
  if (!options.length) return null;
  return {
    id: "approval",
    type: "approval",
    menu: true,
    title: question || "The chat agent asks",
    subtitle: tabs.replace(/^←\s*|\s*→$/g, "").replace(/\s{2,}/g, " · "),
    options,
    approve: null,
    skip: null,
    prompt,
  };
}

/**
 * The block for a prompt on the chat agent's screen, else null. A permission
 * prompt: Approve is the first "Yes" option (else the first), Skip the first
 * "No" (else the last). A question menu: menuFrom.
 * @param {import("./store.js").Prompt|null|undefined} prompt
 */
export function approvalFrom(prompt) {
  if (!prompt?.options?.length) return null;
  if (prompt.kind === "menu") return menuFrom(prompt);
  if (prompt.kind !== "permission") return null;
  const lines = String(prompt.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const options = prompt.options;
  const approve = firstOf(options, /^yes\b/i) ?? options[0];
  const skip = firstOf(options, /^no\b/i) ?? options.at(-1);
  return {
    id: "approval",
    type: "approval",
    title: lines[0] ?? "Permission needed",
    subtitle: lines.slice(1).join(" · "),
    approve,
    skip: skip === approve ? null : skip,
    prompt,
  };
}

/**
 * The option to press on a fresh read: only when it still shows the prompt the
 * person saw (samePrompt) and the option can still be pressed (keys) or typed (reply).
 * @returns {import("./prompt.js").PromptOption|null}
 */
export function matchOption(shown, fresh, option) {
  if (!shown || !fresh || !option || !samePrompt(shown, fresh)) return null;
  const m = fresh.options.find((o) => o.label === option.label);
  if (!m) return null;
  const isReply = typeof option.reply === "string" && option.reply !== "";
  if (isReply) return typeof m.reply === "string" && m.reply !== "" ? m : null;
  return Array.isArray(m.keys) && m.keys.length ? m : null;
}

/** One line of at most `n` characters, with an ellipsis when cut. */
export function clipDetail(s, n = 120) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

/**
 * How far the wheel has taken the transcript above its bottom (pixels, never
 * below 0). `dy` > 0 scrolls toward the top. 0 means "at the bottom: follow".
 */
export function wheelAway(away, dy) {
  const next = away + (Number.isFinite(dy) ? dy : 0);
  return next > 0 ? next : 0;
}

/** The last `max` blocks, and how many earlier ones are not drawn. */
export function recentBlocks(blocks, max) {
  const hidden = Math.max(0, blocks.length - max);
  return { shown: hidden ? blocks.slice(hidden) : blocks, hidden };
}

/**
 * The blocks to draw: each agent text block followed by the deck and GitHub
 * cards for what it mentions (derived now, never stored), ids from the block.
 * @param {any[]} blocks @param {any[]} issues
 */
export function attachCards(blocks, issues) {
  const out = [];
  for (const b of blocks) {
    out.push(b);
    if (b?.type !== "text" || b.role !== "agent") continue;
    for (const c of cardsFor(b.text, issues)) {
      out.push({ id: `${b.id}:${c.type}:${c.type === "deck" ? c.issueKey : c.number}`, ...c });
    }
  }
  return out;
}

/**
 * A key while the Chat view itself (not the composer) has the keyboard.
 * Enter approves and esc skips a shown approval (only when it can be answered);
 * on a question menu (ctx.menu: its option count) digit N picks option N, and
 * Enter / esc do nothing; otherwise Enter or I puts the keyboard in the composer.
 * @param {{key: string, shift?: boolean, cmd?: boolean, held?: boolean}} ev
 * N opens a new task (nothing while a Deck dialog is open: ctx.dialog).
 * @param {{ approval: boolean, canAnswer: boolean, dialog?: boolean, menu?: number }} ctx
 * @returns {"approve"|"skip"|"type"|"help"|"newTask"|`pick:${number}`|null}
 */
export function chatViewKey(ev, ctx) {
  if (ev?.cmd || ev?.held) return null;
  const k = String(ev?.key ?? "").toLowerCase();
  if (ctx.approval && ctx.menu) {
    if (/^[1-9]$/.test(k) && Number(k) <= ctx.menu) return ctx.canAnswer ? `pick:${k}` : null;
    if (k === "enter" || k === "escape") return null;
  }
  if (ctx.approval && (k === "enter" || k === "escape")) {
    if (!ctx.canAnswer) return null;
    return k === "enter" ? "approve" : "skip";
  }
  if (k === "n") return ctx.dialog ? null : "newTask";
  if (k === "enter" || k === "i") return "type";
  if (k === "?" || (k === "/" && ev?.shift)) return "help";
  return null;
}

/**
 * The key of the terminal that has the focus: its space, tab, terminal and agent.
 * Null when none does (a mod pane such as the chat's own block, or no focus at all).
 * @param {{ space?: string, tab?: string, terminal?: string|null, agent?: string|null }|null|undefined} f herdr focused()
 * @returns {string|null}
 */
export function terminalFocusKey(f) {
  if (!f || !(f.terminal || f.agent)) return null;
  return [f.space ?? "", f.tab ?? "", f.terminal ?? "", f.agent ?? ""].join("|");
}

/**
 * A click on the sidebar's Spaces or Agents moves the focus to another terminal;
 * the Chat view answers by opening the Terminal view. This tells a move from
 * noise: focus on a mod pane (the chat block) keeps the baseline and never jumps,
 * the first terminal focus only records it, and the chat agent's own terminal
 * (a peek of it) is ignored.
 * @param {string|null} prevKey the last terminal focus key seen
 * @param {{ space?: string, tab?: string, terminal?: string|null, agent?: string|null }|null|undefined} f herdr focused()
 * @returns {{ key: string|null, jump: boolean }}
 */
export function focusJump(prevKey, f) {
  const key = terminalFocusKey(f);
  if (key === null) return { key: prevKey, jump: false };
  return { key, jump: prevKey !== null && key !== prevKey };
}

/** How long a sent message shows "thinking" before the agent's status says it is working. */
export const PENDING_MS = 15000;

/**
 * Whether the chat shows the agent thinking: its status is working, or a
 * message went out less than PENDING_MS ago and the status has not caught up
 * yet (herdr's status lags the send). Never while it is blocked on a prompt
 * (the approval card shows) or its status is unknown (the trust note).
 * @param {{ status: string|null|undefined, sentAt: number|null, now: number }} s
 */
export function isThinking({ status, sentAt, now }) {
  if (status === "working") return true;
  if (status === "blocked" || status == null) return false;
  return sentAt != null && now - sentAt >= 0 && now - sentAt < PENDING_MS;
}

/** The thinking row's label: "Thinking" and one to three dots, stepping every 400 ms. */
export function thinkingLabel(now) {
  return "Thinking" + ".".repeat((Math.floor(now / 400) % 3) + 1);
}

/**
 * `text` as HTML that shows it literally (for a selectable TextView.html):
 * & < > " ' escaped, newlines as <br>. The person's own words are not markdown.
 * @param {unknown} text
 */
export function plainHtml(text) {
  const esc = String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return `<span>${esc.replace(/\r?\n/g, "<br>")}</span>`;
}

/**
 * How full the chat agent's context window is, from the `ctx:N%` its status
 * line prints at the bottom of its screen (the last one: older ones may sit in
 * the history above). null when the screen shows none.
 * @param {unknown} screen `hc read` output
 */
export function contextPercent(screen) {
  const text = String(screen ?? "").replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "");
  const all = [...text.matchAll(/\bctx:(\d{1,3})%/g)];
  if (!all.length) return null;
  const n = Number(all.at(-1)[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** At or above this, the context meter warns (time to /compact or /clear). */
export const CONTEXT_WARN = 80;

/** The composer's context meter: its text and whether it warns; null when unknown. @param {number|null} pct */
export function contextLabel(pct) {
  if (pct == null) return null;
  return { text: `context ${pct}%`, warn: pct >= CONTEXT_WARN };
}
