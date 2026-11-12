// Board columns and navigation. Pure.

/** @typedef {import("./store.js").Issue} Issue */

const COLS = [
  ["holding", "Holding"], ["survey", "Survey"], ["build", "Build"],
  ["verify", "Verify"], ["landed", "Landed"],
];
const recency = (i) => i.holdingSince ?? i.lastSeen ?? 0;

/** @param {Issue[]} issues */
export function boardColumns(issues) {
  const live = (issues ?? []).filter((i) => !i.dismissed);
  return COLS.map(([stage, label]) => ({
    stage, label,
    items: live.filter((i) => i.stage === stage).sort((a, b) => recency(b) - recency(a)),
  }));
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * @param {{items: any[]}[]} cols @param {{col:number,row:number}} sel @param {{dx?:number,dy?:number}} act
 */
export function moveBoard(cols, sel, act) {
  let col = clamp(sel?.col ?? 0, 0, Math.max(0, cols.length - 1));
  let row = sel?.row ?? 0;
  const dx = act?.dx ?? 0;
  if (dx) {
    let c = col + dx;
    while (c >= 0 && c < cols.length && cols[c].items.length === 0) c += dx;
    if (c >= 0 && c < cols.length) col = c; // clamp at the edges: stay put
  }
  const len = cols[col]?.items.length ?? 0;
  row = len === 0 ? 0 : clamp(row + (act?.dy ?? 0), 0, len - 1);
  return { col, row };
}

/** @param {Issue[]} issues @param {string|null} currentKey @returns {Issue|null} */
export function nextHolding(issues, currentKey) {
  const h = (issues ?? []).filter((i) => i.stage === "holding" && !i.dismissed)
    .sort((a, b) => (a.holdingSince ?? 0) - (b.holdingSince ?? 0));
  if (!h.length) return null;
  const at = h.findIndex((i) => i.key === currentKey);
  return h[(at + 1) % h.length];
}

/** A stable colour per repo name from `palette` (deckTokens().repo): same name, same colour. */
export function repoColor(name, palette) {
  let h = 0;
  for (const ch of String(name ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

/**
 * A card's one status line: {text, tone} with tone "hold"|"work"|"fail"|"ok"|"muted".
 * @param {Issue} issue
 */
export function boardNote(issue) {
  if (issue.stage === "landed") return { text: "Merged", tone: "ok" };
  if (issue.stage === "holding") {
    const q = String(issue.prompt?.text ?? "").split("\n").map((l) => l.trim()).find(Boolean);
    return { text: q || "Waiting on you", tone: "hold" };
  }
  const failing = (issue.pr?.checks ?? []).filter((c) => c.status === "fail").length;
  if (failing) return { text: `${failing} check${failing === 1 ? "" : "s"} failing`, tone: "fail" };
  if (issue.status === "working") return { text: "Working…", tone: "work" };
  return { text: issue.stage[0].toUpperCase() + issue.stage.slice(1), tone: "muted" };
}

/** Clicking a card opens it only when it is already the stored selection (a fallback highlight doesn't count). */
export function cardClick(selKey, issueKey) {
  return selKey === issueKey ? "open" : "select";
}
