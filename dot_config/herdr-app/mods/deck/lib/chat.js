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
