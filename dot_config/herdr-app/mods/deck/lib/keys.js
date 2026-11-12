// Pure key map for the deck views. No herdr imports.

/**
 * @typedef {{ key: string, shift: boolean, cmd: boolean, held?: boolean }} Key  held: a key-repeat event
 * @typedef {{ view: "command"|"issues"|"issue", mode: "list"|"board", tab: "overview"|"changes",
 *   typing: boolean, optionCount: number, hasIssue: boolean, backlog?: boolean }} KeyCtx
 *   backlog: the selected issue is a (not discarded) backlog entry: only S (start,
 *   which opens the confirm) and X (discard) act on it; the agent keys are off.
 *   tab "changes": the Pull request tab (its file list and diff)
 *   view "issue": the issue page (overview + live thread). j/k step issues,
 *   esc while typing leaves the reply box ("leave"), then goes back.
 */

// Two tabs: ⇧1 Overview, ⇧2 Pull request.
const SHIFT_DIGIT = { "!": 1, "@": 2 };
const TABS = { 1: "overview", 2: "pr" };

// Key repeat (a held key) only navigates.
const REPEATS = new Set(["move", "col", "file", "step"]);

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
  const page = ctx.view === "issue";
  if (ctx.typing) return k === "escape" ? { type: page ? "leave" : "back" } : null;
  const shift = !!ev.shift;
  const issues = ctx.view === "issues";
  const detail = issues || page; // the views that draw the issue detail

  if (k === "escape") return { type: "back" };
  if (k === "?" || (k === "/" && shift)) return { type: "help" };
  if (k === "j" || k === "down") return page ? { type: "step", d: 1 } : { type: "move", dy: 1 };
  if (k === "k" || k === "up") return page ? { type: "step", d: -1 } : { type: "move", dy: -1 };
  if (k === "enter") return ctx.hasIssue && !page ? { type: "open" } : null;
  if (k === "/") return issues ? { type: "filter" } : null;

  const tabN = SHIFT_DIGIT[raw] ?? (shift && TABS[k] ? Number(k) : 0);
  if (tabN) return detail && ctx.hasIssue ? { type: "tab", tab: TABS[tabN] } : null;

  if (/^[1-9]$/.test(k)) {
    if (shift) return null; // shift-4… is "$"…, never an option
    const n = Number(k);
    return ctx.hasIssue && n <= ctx.optionCount ? { type: "answer", n } : null;
  }

  if (issues && ctx.mode === "board") {
    if (k === "h") return { type: "col", dx: -1 };
    if (k === "l") return { type: "col", dx: 1 };
  }
  if (detail && ctx.tab === "changes" && ctx.hasIssue && !(shift && k === "p")) {
    if (k === "n") return { type: "file", d: 1 };
    if (k === "p") return { type: "file", d: -1 };
  }
  if (k === "v") return issues ? { type: "toggleMode" } : null;

  if (!ctx.hasIssue) return null;
  if (ctx.backlog) {
    if (k === "s") return { type: "start" };
    if (k === "x") return { type: "discard" };
    return null;
  }
  switch (k) {
    case "r": return { type: "reply" };
    case "t": return { type: "terminal" };
    case "p": return { type: "proof" };
    case "o": return { type: "github" };
    case "m": return shift ? { type: "mergeShip" } : { type: "merge" };
    default: return null;
  }
}
