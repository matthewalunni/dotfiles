// The Chat view's pure parts: the chat agent's state, the approval card from a
// permission prompt, cards after agent messages, scrolling and keys. No herdr imports.
import { findChatTerminal } from "./chatsource.js";
import { samePrompt } from "./prompt.js";
import { cardsFor } from "./chat.js";

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

/** When the status became unknown (kept while it stays unknown), else null. */
export function nullSince(prev, status, now) {
  return status == null ? prev ?? now : null;
}

/** Whether an unknown status has lasted TRUST_MS: Claude is waiting on a trust modal. */
export function trustWaiting(status, since, now) {
  return status == null && since != null && now - since >= TRUST_MS;
}

const firstOf = (options, re) => options.find((o) => re.test(String(o.label ?? "")));

/**
 * The approval block for a permission prompt on the chat agent's screen, else
 * null. Approve is the first "Yes" option (else the first), Skip the first "No"
 * (else the last).
 * @param {import("./store.js").Prompt|null|undefined} prompt
 */
export function approvalFrom(prompt) {
  if (prompt?.kind !== "permission" || !prompt.options?.length) return null;
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
 * otherwise Enter or I puts the keyboard in the composer.
 * @param {{key: string, shift?: boolean, cmd?: boolean, held?: boolean}} ev
 * @param {{ approval: boolean, canAnswer: boolean }} ctx
 * @returns {"approve"|"skip"|"type"|"help"|null}
 */
export function chatViewKey(ev, ctx) {
  if (ev?.cmd || ev?.held) return null;
  const k = String(ev?.key ?? "").toLowerCase();
  if (ctx.approval && (k === "enter" || k === "escape")) {
    if (!ctx.canAnswer) return null;
    return k === "enter" ? "approve" : "skip";
  }
  if (k === "enter" || k === "i") return "type";
  if (k === "?" || (k === "/" && ev?.shift)) return "help";
  return null;
}
