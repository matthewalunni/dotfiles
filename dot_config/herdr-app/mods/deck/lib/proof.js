// Proof claims (CI checks + agent-written proof file) and the merge lock. Pure; no herdr imports.

/** @typedef {{ name: string, status: "pass"|"fail"|"pending", detail: string }} Check */
/** @typedef {{ number: number, title: string, state: "OPEN"|"MERGED"|"CLOSED", checks: Check[] }} Pr */
/** @typedef {{ claim: string, verdict: "PASS"|"FAIL"|"NO DATA", source: "ci"|"agent", path: string|null, detail: string|null }} Claim */

/** Evidence paths must be non-empty, repo-relative: no absolute/~, no ".." segment, no NUL/newline. */
function safePath(p) {
  if (typeof p !== "string" || !p) return null;
  if (p.startsWith("/") || p.startsWith("~") || /[\0\r\n]/.test(p)) return null;
  if (p.split(/[\\/]/).includes("..")) return null;
  return p;
}

/**
 * Parse the agent's proof file: {claims:[{claim, evidence, path}]}.
 * Anything malformed yields []; entries without a string `claim` are dropped.
 * @param {string|null} text
 * @returns {{ claim: string, path: string|null }[]}
 */
export function parseProofFile(text) {
  if (typeof text !== "string") return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.claims)) return [];
  const out = [];
  for (const c of data.claims) {
    if (!c || typeof c !== "object" || typeof c.claim !== "string" || !c.claim.trim()) continue;
    out.push({ claim: c.claim, path: safePath(c.path) });
  }
  return out;
}

/**
 * CI claims first, then agent claims. Agent claims are PASS only with an existing evidence file; never FAIL.
 * @param {Check[]} checks
 * @param {{ claim: string, path: string|null }[]} agentClaims
 * @param {Record<string, boolean>} exists
 * @returns {Claim[]}
 */
export function buildClaims(checks, agentClaims, exists) {
  /** @type {Claim[]} */
  const claims = [];
  for (const c of checks ?? []) {
    if (c.status === "pass") claims.push({ claim: c.name, verdict: "PASS", source: "ci", path: null, detail: c.detail || null });
    else if (c.status === "fail") claims.push({ claim: c.name, verdict: "FAIL", source: "ci", path: null, detail: c.detail || null });
    else claims.push({ claim: c.name, verdict: "NO DATA", source: "ci", path: null, detail: "running" });
  }
  for (const a of agentClaims ?? []) {
    const ok = typeof a.path === "string" && !!exists && Object.hasOwn(exists, a.path) && exists[a.path] === true;
    claims.push({ claim: a.claim, verdict: ok ? "PASS" : "NO DATA", source: "agent", path: a.path ?? null, detail: null });
  }
  return claims;
}

/**
 * The merge lock. Merge unlocks only for an OPEN PR with at least one claim, all PASS.
 * @param {Pr|null} pr
 * @param {string|null} ghError
 * @param {Claim[]} claims
 * @returns {{ canMerge: boolean, showAnyway: boolean, reasons: string[] }}
 */
export function mergeState(pr, ghError, claims) {
  if (!pr || pr.state !== "OPEN" || ghError) return { canMerge: false, showAnyway: false, reasons: [] };
  if (claims.length > 0 && claims.every((c) => c.verdict === "PASS")) {
    return { canMerge: true, showAnyway: false, reasons: [] };
  }
  if (claims.length === 0) return { canMerge: false, showAnyway: true, reasons: ["No proof or checks"] };
  const reasons = [];
  for (const c of claims) {
    if (c.verdict === "PASS") continue;
    if (c.source === "agent") reasons.push(`${c.claim}: NO DATA`);
    else if (c.verdict === "FAIL") reasons.push(`${c.claim}: failing`);
    else reasons.push(`${c.claim}: still running`);
  }
  return { canMerge: false, showAnyway: true, reasons };
}

/** @param {Claim[]} claims */
export function stampText(claims) {
  return `${claims.filter((c) => c.verdict === "PASS").length} of ${claims.length}`;
}

// How an evidence file opens: only ever with a named viewer, never the
// file's default handler, so a click can't run anything. Images and PDFs in
// Preview, text in TextEdit, media in QuickTime; anything else (svg too) is
// only revealed in Finder.
const VIEWERS = [
  [["png", "jpg", "jpeg", "gif", "heic", "webp", "pdf"], ["-a", "Preview"]],
  [["txt", "log", "md", "json"], ["-e"]],
  [["mp4", "mov", "m4v", "mp3", "wav", "m4a"], ["-a", "QuickTime Player"]],
];

/**
 * `open` arguments for an evidence file. `resolved` must already be the file's
 * realpath (symlinks followed) and `realRoot` the repo root's realpath: the
 * type comes from the resolved name, and anything not strictly inside the
 * root is refused (null).
 * @param {string|null} resolved @param {string|null} realRoot
 * @returns {string[]|null}
 */
export function evidenceOpenArgs(resolved, realRoot) {
  if (typeof resolved !== "string" || typeof realRoot !== "string" || !realRoot.startsWith("/")) return null;
  if (!resolved.startsWith("/") || /[\0\r\n]/.test(resolved) || resolved.split("/").includes("..")) return null;
  const root = realRoot.replace(/\/+$/, "");
  if (!root || !resolved.startsWith(root + "/")) return null;
  const name = resolved.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const viewer = VIEWERS.find(([exts]) => exts.includes(ext));
  return viewer ? [...viewer[1], resolved] : ["-R", resolved];
}
