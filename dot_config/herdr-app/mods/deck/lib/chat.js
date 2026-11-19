// Pure chat logic: Claude Code transcript lines to typed blocks. No herdr imports.

// Split a shell command into words, honouring single/double quotes and
// backslash escapes. Pure string work: nothing is expanded or executed.
function shellWords(s) {
  const out = [];
  let cur = "";
  let has = false;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

const PR_VERBS = { merge: "merged", create: "opened", close: "closed", view: "viewed", comment: "commented on", review: "reviewed", checks: "checked", diff: "diffed", ready: "readied" };

export function summarizeAction(command) {
  if (typeof command !== "string") return null;
  const w = shellWords(command.trim());
  if (!w.length) return null;
  const [head, sub, ...rest] = w;
  if (head === "hc") {
    const target = rest[0] && !rest[0].startsWith("-") ? rest[0] : null;
    if (sub === "send") {
      const dd = rest.indexOf("--");
      const detail = dd >= 0 ? rest.slice(dd + 1).join(" ") : rest.slice(1).join(" ");
      return { verb: "sent", target, detail };
    }
    if (sub === "keys") return { verb: "pressed", target, detail: rest.slice(1).join(" ") };
    if (sub === "read") return { verb: "read", target, detail: "" };
    if (sub === "wait") return { verb: "waited", target, detail: "" };
    return null;
  }
  if (head === "herdr-backlog") {
    const args = w.slice(1);
    const i = args.indexOf("--title");
    const detail = i >= 0 && args[i + 1] !== undefined ? args[i + 1] : "";
    return { verb: "filed", target: null, detail };
  }
  if (head === "gh" && sub === "pr" && rest.length) {
    const target = rest.slice(1).find((a) => !a.startsWith("-")) ?? null;
    return { verb: PR_VERBS[rest[0]] ?? rest[0], target, detail: "" };
  }
  return null;
}

function stripHc(s) {
  return s.replace(/^\s*<hc from="[^"]*">/, "").replace(/<\/hc>\s*$/, "");
}

export function parseTranscriptLine(line, session) {
  try {
    if (typeof line !== "string" || !line.trim()) return [];
    const r = JSON.parse(line);
    if (!r || typeof r !== "object" || r.isSidechain === true || r.isMeta === true) return [];
    if (typeof r.uuid !== "string" || !r.uuid) return [];
    const base = { id: `${session}:${r.uuid}`, session, t: Date.parse(r.timestamp) || 0 };

    if (r.type === "system") {
      return r.subtype === "compact_boundary" ? [{ ...base, type: "divider", kind: "compacted" }] : [];
    }
    const content = r.message?.content;
    if (r.type === "user") {
      if (r.isCompactSummary === true || typeof content !== "string") return [];
      if (content.startsWith("<command-name>") || content.startsWith("<local-command-")) return [];
      const text = stripHc(content);
      return text ? [{ ...base, type: "text", role: "user", text }] : [];
    }
    if (r.type === "assistant") {
      const c = Array.isArray(content) ? content[0] : null;
      if (!c) return [];
      if (c.type === "text") {
        return typeof c.text === "string" && c.text ? [{ ...base, type: "text", role: "agent", text: c.text }] : [];
      }
      if (c.type === "tool_use" && c.name === "Bash") {
        const a = summarizeAction(c.input?.command);
        return a ? [{ ...base, type: "action", ...a }] : [];
      }
    }
    return [];
  } catch {
    return [];
  }
}

/** @typedef {{ blocks: object[], ids: Set<string>, session: string|null }} ChatLog */

/** @returns {ChatLog} */
export function emptyChatLog() {
  return { blocks: [], ids: new Set(), session: null };
}

/**
 * Append new blocks, skipping any whose id is already present (replays after a
 * restart or /clear). A block from a different session than the log's current
 * one is preceded by a "cleared" divider. Returns the same object when nothing
 * is new. Never mutates `log`.
 * @param {ChatLog} log @param {Array<{id: string, session: string}>} blocks @param {number} now
 * @returns {ChatLog}
 */
export function appendBlocks(log, blocks, now) {
  let out = null;
  for (const b of blocks) {
    if ((out ?? log).ids.has(b.id)) continue;
    if (!out) out = { blocks: [...log.blocks], ids: new Set(log.ids), session: log.session };
    if (out.session !== null && b.session !== out.session) {
      const id = `${b.session}:cleared`;
      if (!out.ids.has(id)) {
        out.blocks.push({ id, session: b.session, t: now, type: "divider", kind: "cleared" });
        out.ids.add(id);
      }
    }
    out.blocks.push(b);
    out.ids.add(b.id);
    out.session = b.session;
  }
  return out ?? log;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Cards for the deck issue keys and PR references mentioned in `text`, in order
 * of first appearance, without duplicates. Keys match as whole words; a PR is
 * written `#N` or `PR N`.
 * @param {string} text @param {Array<{key: string, pr: {number: number}|null}>} issues
 */
export function cardsFor(text, issues) {
  if (typeof text !== "string" || !text) return [];
  const found = [];
  for (const issue of issues) {
    const m = new RegExp(`(?<![\\w-])${escapeRe(issue.key)}(?![\\w-])`).exec(text);
    if (m) found.push({ at: m.index, card: { type: "deck", issueKey: issue.key } });
  }
  for (const m of text.matchAll(/(?:#|\bPR\s+)(\d+)\b/g)) {
    const number = Number(m[1]);
    const owner = issues.find((i) => i.pr?.number === number);
    found.push({ at: m.index, card: { type: "github", number, issueKey: owner ? owner.key : null } });
  }
  found.sort((a, b) => a.at - b.at);
  const seen = new Set();
  const out = [];
  for (const { card } of found) {
    const k = card.type === "deck" ? `d:${card.issueKey}` : `g:${card.number}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(card);
  }
  return out;
}
