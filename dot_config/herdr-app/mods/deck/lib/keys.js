// Pure key map for the deck views. No herdr imports.

/**
 * @typedef {{ key: string, shift: boolean, cmd: boolean, held?: boolean }} Key  held: a key-repeat event
 * @typedef {{ view: "command"|"issues", mode: "list"|"board", tab: "overview"|"pr"|"changes",
 *   typing: boolean, optionCount: number, hasIssue: boolean }} KeyCtx
 */

const SHIFT_DIGIT = { "!": 1, "@": 2, "#": 3 };
const TABS = { 1: "overview", 2: "pr", 3: "changes" };

// Key repeat (a held key) only navigates.
const REPEATS = new Set(["move", "col", "file"]);

/**
 * @param {Key} ev @param {KeyCtx} ctx
 * @returns {object|null}
 */
export function keyAction(ev, ctx) {
  const a = action(ev, ctx);
  return a && ev?.held && !REPEATS.has(a.type) ? null : a;
}

function action(ev, ctx) {
  const raw = String(ev?.key ?? "");
  if (ev?.cmd) return null;
  const k = raw.toLowerCase();
  if (ctx.typing) return k === "escape" ? { type: "back" } : null;
  const shift = !!ev.shift;
  const issues = ctx.view === "issues";

  if (k === "escape") return { type: "back" };
  if (k === "?" || (k === "/" && shift)) return { type: "help" };
  if (k === "j" || k === "down") return { type: "move", dy: 1 };
  if (k === "k" || k === "up") return { type: "move", dy: -1 };
  if (k === "enter") return ctx.hasIssue ? { type: "open" } : null;
  if (k === "/") return issues ? { type: "filter" } : null;

  const tabN = SHIFT_DIGIT[raw] ?? (shift && TABS[k] ? Number(k) : 0);
  if (tabN) return issues && ctx.hasIssue ? { type: "tab", tab: TABS[tabN] } : null;

  if (/^[1-9]$/.test(k)) {
    if (shift) return null; // shift-4… is "$"…, never an option
    const n = Number(k);
    return ctx.hasIssue && n <= ctx.optionCount ? { type: "answer", n } : null;
  }

  if (issues && ctx.mode === "board") {
    if (k === "h") return { type: "col", dx: -1 };
    if (k === "l") return { type: "col", dx: 1 };
  }
  if (issues && ctx.tab === "changes" && ctx.hasIssue && !(shift && k === "p")) {
    if (k === "n") return { type: "file", d: 1 };
    if (k === "p") return { type: "file", d: -1 };
  }
  if (k === "v") return issues ? { type: "toggleMode" } : null;

  if (!ctx.hasIssue) return null;
  switch (k) {
    case "r": return { type: "reply" };
    case "t": return { type: "terminal" };
    case "p": return { type: "proof" };
    case "o": return { type: "github" };
    case "m": return shift ? { type: "mergeShip" } : { type: "merge" };
    default: return null;
  }
}
