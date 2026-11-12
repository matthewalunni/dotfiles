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
