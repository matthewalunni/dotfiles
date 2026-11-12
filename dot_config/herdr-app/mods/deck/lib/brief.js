// Finds an agent's "brief" (the first prompt it was given) in Claude Code's history.jsonl. Pure; no herdr imports.

const MAX = 280;
const WRAPPER = /^<hc\b[^>]*>([\s\S]*?)<\/hc>$/;

/** Strip the `<hc from="t1">…</hc>` wrapper `hc send` leaves in history. */
function unwrap(text) {
  const m = WRAPPER.exec(text.trim());
  return m ? m[1] : text;
}

function keep(text) {
  const t = text.trim();
  return t !== "" && !/^[\/!]/.test(t) && !/^\[Pasted text/.test(t) && !/^\[Image/.test(t);
}

/**
 * @param {string} historyJsonl contents of ~/.claude/history.jsonl
 * @param {{ cwd: string, root: string|null, after: number|null }} q
 * @returns {string|null}
 */
export function findBrief(historyJsonl, q) {
  /** @type {Map<string, { ts: number, display: string }>} first kept entry per session */
  const sessions = new Map();
  for (const raw of historyJsonl.split("\n")) {
    if (!raw.trim()) continue;
    let e;
    try { e = JSON.parse(raw); } catch { continue; }
    if (!e || typeof e.display !== "string" || typeof e.sessionId !== "string") continue;
    if (e.project !== q.cwd && (q.root == null || e.project !== q.root)) continue;
    const display = unwrap(e.display).trim();
    if (!keep(display)) continue;
    const ts = Number(e.timestamp);
    if (!Number.isFinite(ts)) continue;
    const cur = sessions.get(e.sessionId);
    if (!cur || ts < cur.ts) sessions.set(e.sessionId, { ts, display });
  }
  let best = null;
  for (const s of sessions.values()) {
    if (q.after != null && s.ts < q.after) continue;
    if (!best || s.ts > best.ts) best = s;
  }
  return best ? best.display.split("\n")[0].slice(0, MAX) : null;
}
