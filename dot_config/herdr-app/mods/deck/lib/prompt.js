// Reads what an agent is asking from its terminal screen. Pure; no herdr imports.

/** @typedef {"working"|"blocked"|"done"|"idle"} Status */
/**
 * `keys` are named keys for `hc keys` (TUI dialogs, status "blocked" only).
 * `reply` is set instead for a numbered list ending an unblocked agent's message:
 * keys is [] and Task 8 types `reply` with `hc send` (text + Enter).
 * @typedef {{ label: string, keys: string[], reply?: string }} PromptOption
 */
/** @typedef {{ kind: "permission"|"menu"|"question"|"none", text: string, options: PromptOption[] }} Prompt */

const NONE = Object.freeze({ kind: "none", text: "", options: [] });
const MAX_TEXT = 400;

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const OPTION = /^\s*❯?\s*(\d+)\.\s+(.+)$/;
const SOLID_SEP = /^\s*─{3,}\s*$/;
const ANY_SEP = /^\s*[─╌━┄┈-]{3,}\s*$/;
const BLANK = /^\s*$/;
// Lines Claude Code (and hc) draw below the real content.
const FOOTER = [
  /^\s*(Esc to cancel|Enter to (select|confirm)|esc to interrupt)/i,
  /ctx:\d+%/,
  /[⏵⏸]/u,
  /shift\+tab/i,
  /\/effort\s*$/,
  /Your login expires/,
  /^\[hc\]/,
];
const isFooter = (l) => FOOTER.some((re) => re.test(l));
const isFiller = (l) => BLANK.test(l) || ANY_SEP.test(l) || isFooter(l);
const PERMISSION_Q = /do you want to|proceed|allow/i;

/** @param {string} s */
const clip = (s) => (s.length <= MAX_TEXT ? s : "…" + s.slice(s.length - MAX_TEXT + 1));
const indentOf = (l) => l.length - l.trimStart().length;

/**
 * Index (exclusive) where the composer box begins: separator, input line(s), separator.
 * Returns lines.length when there is no composer box at the bottom.
 */
function cutComposer(lines) {
  let i = lines.length - 1;
  while (i >= 0 && (BLANK.test(lines[i]) || isFooter(lines[i]))) i--;
  if (i < 0 || !ANY_SEP.test(lines[i])) return lines.length;
  let j = i - 1;
  while (j >= 0 && !ANY_SEP.test(lines[j]) && i - j <= 8) j--;
  if (j < 0 || !ANY_SEP.test(lines[j])) return lines.length;
  const between = lines.slice(j + 1, i).filter((l) => !BLANK.test(l));
  if (!between.length || !between.every((l, k) => (k === 0 ? /^\s*❯/.test(l) : true))) return lines.length;
  return j;
}

/** Question text above the option block, back to the dialog's top separator. */
function textAbove(lines, top) {
  const out = [];
  for (let i = top - 1; i >= 0 && out.length < 14; i--) {
    const l = lines[i];
    if (SOLID_SEP.test(l)) break;
    if (BLANK.test(l) || ANY_SEP.test(l) || /^\s*Tip:/.test(l)) continue;
    out.unshift(l.trim());
  }
  return clip(out.join("\n"));
}

/**
 * Numbered options ending at `bottom`; null unless they run 1..n (n >= 2).
 * With `rejoin`, wrapped continuation lines are folded into the label (permission prompts);
 * otherwise deeper-indented lines are descriptions (AskUserQuestion menus) and dropped.
 */
function numberedBlock(lines, bottom, rejoin) {
  const numCol = (l) => l.indexOf(l.match(/\d+\./)[0]);
  const isCont = (l) => !BLANK.test(l) && !ANY_SEP.test(l) && !OPTION.test(l) && indentOf(l) >= 3;
  let s = bottom;
  while (s >= 0 && bottom - s < 4 && isCont(lines[s])) s--;
  if (s < 0 || !OPTION.test(lines[s])) return null;
  const col = numCol(lines[s]);
  const found = [];
  let top = bottom;
  let pending = [];
  for (let i = bottom; i >= 0; i--) {
    const l = lines[i];
    const m = l.match(OPTION);
    if (m && numCol(l) <= col + 1 && numCol(l) >= col - 1) {
      let label = m[2].trim();
      if (rejoin && /^(yes|no)\b/i.test(label) && pending.length) label += " " + pending.join(" ");
      found.unshift({ n: Number(m[1]), label });
      top = i;
      pending = [];
    } else if (BLANK.test(l) || ANY_SEP.test(l)) {
      pending = [];
    } else if (indentOf(l) >= col) {
      pending.unshift(l.trim()); // continuation or description, decided at its option
    } else break;
  }
  if (found.length < 2 || !found.every((o, k) => o.n === k + 1)) return null;
  return { top, options: found.map((o) => ({ label: o.label, keys: [String(o.n)] })) };
}

/** Unnumbered selection list (e.g. the trust dialog): lines under a ❯ marker, driven by arrow keys. */
function markerBlock(lines, bottom, sawConfirmFooter) {
  if (!sawConfirmFooter) return null;
  const rows = [];
  let top = bottom;
  for (let i = bottom; i >= 0; i--) {
    const l = lines[i];
    if (BLANK.test(l) || ANY_SEP.test(l) || indentOf(l) === 0) break;
    rows.unshift(l);
    top = i;
  }
  const sel = rows.findIndex((l) => /^\s*❯\s+\S/.test(l));
  if (rows.length < 2 || sel < 0) return null;
  const options = rows.map((l, i) => {
    const keys = [];
    for (let k = 0; k < Math.abs(i - sel); k++) keys.push(i > sel ? "down" : "up");
    keys.push("enter");
    return { label: l.replace(/^\s*❯?\s*/, "").trim(), keys };
  });
  return { top, options };
}

/** The agent's last message above the composer, or "" when there is none. */
function lastMessage(lines, bottom) {
  const out = [];
  for (let i = bottom; i >= 0; i--) {
    const l = lines[i];
    if (/^\s*❯/.test(l)) return "";
    if (/^\s*✻/.test(l) || BLANK.test(l) && !out.length) continue;
    if (/^\s*⏺/.test(l)) {
      out.unshift(l.replace(/^\s*⏺\s?/, ""));
      return clip(out.map((s) => s.replace(/^ {2}/, "").trimEnd()).join("\n").trim());
    }
    out.unshift(l);
  }
  return "";
}

/**
 * @param {string} screen raw `hc read` output
 * @param {Status} status
 * @returns {Prompt}
 */
export function parsePrompt(screen, status) {
  if (status === "working" || typeof screen !== "string") return { ...NONE, options: [] };
  const all = screen.replace(ANSI, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  const lines = all.slice(0, cutComposer(all));

  let bottom = lines.length - 1;
  let sawConfirmFooter = false;
  while (bottom >= 0 && isFiller(lines[bottom])) {
    if (/^\s*(Esc to cancel|Enter to)/i.test(lines[bottom])) sawConfirmFooter = true;
    bottom--;
  }
  if (bottom < 0) return { ...NONE, options: [] };

  const blocked = status === "blocked";
  const numbered = numberedBlock(lines, bottom, blocked);
  const block = numbered ?? (blocked ? markerBlock(lines, bottom, sawConfirmFooter) : null);
  if (block && blocked) {
    const text = textAbove(lines, block.top);
    const permission = PERMISSION_Q.test(text) || block.options.some((o) => /^(yes|no)\b/i.test(o.label));
    // A digit key selects 1-9 only; 10 and up get no key option.
    const options = numbered ? block.options.filter((o) => Number(o.keys[0]) <= 9) : block.options;
    return { kind: permission ? "permission" : "menu", text, options };
  }

  const text = lastMessage(lines, bottom);
  if (!text) return { ...NONE, options: [] };
  // An unblocked agent's trailing numbered list is answered by typing the number.
  const options = block ? block.options.map((o) => ({ label: o.label, keys: [], reply: o.keys[0] })) : [];
  return { kind: "question", text, options };
}

/**
 * Same kind, text and option labels in order. Task 8 re-parses right before pressing keys
 * and only sends the fresh parse's keys when this holds.
 * @param {Prompt} a
 * @param {Prompt} b
 */
export function samePrompt(a, b) {
  return (
    a.kind === b.kind &&
    a.text === b.text &&
    a.options.length === b.options.length &&
    a.options.every((o, i) => o.label === b.options[i].label)
  );
}
