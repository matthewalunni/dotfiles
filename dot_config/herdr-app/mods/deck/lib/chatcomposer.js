// The Chat composer's pure parts: what a key does, the @ / completion word
// being typed, and the text actually sent. No herdr imports.
import { mentionName } from "./chat.js";

/** The v1 `/` completions: Claude Code's own context commands. */
export const SLASH_COMMANDS = Object.freeze(["/compact", "/clear"]);

const MAX_CHOICES = 8;

/**
 * The completion word at the end of `text`, or null: `@word` after a space or
 * at the start (an agent), or `/word` as the whole message (a command).
 * @param {unknown} text
 * @returns {{ trigger: "@"|"/", query: string, start: number }|null}
 */
export function completionQuery(text) {
  if (typeof text !== "string" || !text) return null;
  const slash = /^\/([\w-]*)$/.exec(text);
  if (slash) return { trigger: "/", query: slash[1], start: 0 };
  const at = /(^|\s)@([\w.-]*)$/.exec(text);
  if (at) return { trigger: "@", query: at[2], start: at.index + at[1].length };
  return null;
}

/** `text` with its completion word `q` replaced by `choice` and a space. */
export function applyCompletion(text, q, choice) {
  return String(text).slice(0, q.start) + choice + " ";
}

/**
 * Choices (with or without the trigger) whose name starts with `query`, ignoring
 * case, each written with the trigger; at most 8, no duplicates.
 * @param {unknown[]} list @param {string} trigger @param {string} query
 * @returns {string[]}
 */
export function filterChoices(list, trigger, query) {
  const q = String(query ?? "").toLowerCase();
  const out = [];
  for (const item of list ?? []) {
    if (typeof item !== "string" || !item) continue;
    const name = item.startsWith(trigger) ? item.slice(trigger.length) : item;
    const full = trigger + name;
    if (!name || !name.toLowerCase().startsWith(q) || out.includes(full)) continue;
    out.push(full);
    if (out.length === MAX_CHOICES) break;
  }
  return out;
}

/**
 * What a key does while the composer has the keyboard. null: the key is the
 * input's (text, Shift+Enter's newline, cursor moves): never a Deck shortcut.
 * @param {{key: string, shift?: boolean, cmd?: boolean, held?: boolean}} ev
 * @param {boolean} popup whether the completion list is open
 * @returns {"send"|"leave"|"up"|"down"|"pick"|"close"|null}
 */
export function composerKey(ev, popup) {
  const k = String(ev?.key ?? "").toLowerCase();
  if (ev?.cmd) return null;
  if (popup && (k === "up" || k === "down")) return k;
  if (ev?.held) return null; // a held key only moves through the list
  if (k === "escape") return popup ? "close" : "leave";
  if (popup && (k === "tab" || (k === "enter" && !ev?.shift))) return "pick";
  if (k === "enter" && !ev?.shift) return "send";
  return null;
}

/** The list index `d` steps from `at` in a list of `n`, wrapping. */
export function stepPick(at, d, n) {
  if (n <= 0) return 0;
  return (((Math.min(at, n - 1) + d) % n) + n) % n;
}

/**
 * The `@` choices: the names cardsFor matches (lib/chat.js mentionName), for
 * every issue on the board that is not discarded or dismissed.
 * @param {any[]} issues
 */
export function agentChoices(issues) {
  return (issues ?? []).filter((i) => i && !i.discarded && !i.dismissed).map(mentionName).filter(Boolean);
}

/**
 * `before` when `after` is `before` with exactly one newline (and the indent
 * an editor may add after it) inserted anywhere, else null: the newline an
 * Enter put in before the composer saw it.
 * @param {unknown} before @param {unknown} after @returns {string|null}
 */
export function undoEnterNewline(before, after) {
  if (typeof before !== "string" || typeof after !== "string" || after.length <= before.length) return null;
  let p = 0;
  while (p < before.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return /^\n[ \t]*$/.test(after.slice(p, after.length - s)) ? before : null;
}

/**
 * What the input's submit event (an Enter that reached the input) does.
 * `changedJustNow`: the last change came with this Enter, so a newline it
 * inserted is undone (`before` is the text before that change, `popBefore`
 * the completion list then). `recentKey`: the key handler already handled
 * this Enter. With a list open, Enter picks; it never sends a half-typed word.
 * @param {{ text: string, before: string|null, changedJustNow: boolean, popBefore: any, pop: any, recentKey: boolean }} s
 * @returns {{ do: "ignore"|"pick"|"send", text: string, list?: any }}
 */
export function submitPlan({ text, before, changedJustNow, popBefore, pop, recentKey }) {
  const restored = changedJustNow ? undoEnterNewline(before, text) : null;
  const base = restored ?? text;
  if (recentKey) return { do: "ignore", text: base };
  const list = restored != null ? popBefore : pop;
  if (list) return { do: "pick", text: base, list };
  return { do: "send", text: base };
}

/** The text to send: trailing whitespace (an Enter's newline) dropped; "" when blank. */
export function outgoing(text) {
  const s = typeof text === "string" ? text.replace(/\s+$/, "") : "";
  return s.trim() ? s : "";
}
