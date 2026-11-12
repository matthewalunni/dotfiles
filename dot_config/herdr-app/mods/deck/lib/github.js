// Parsing of git and GitHub CLI output. Pure; no herdr imports.

/** @typedef {{ code: number, stdout: string, stderr: string }} ExecResult */
/** @typedef {{ name: string, status: "pass"|"fail"|"pending", detail: string }} Check */
/**
 * @typedef {{
 *   number: number, title: string, state: "OPEN"|"MERGED"|"CLOSED", url: string,
 *   review: string|null, checks: Check[], files: { path: string, add: number, del: number }[],
 *   additions: number, deletions: number, base: string, head: string, headSha: string|null, commits: number
 * }} Pr
 */

/** argv arrays the collector runs, in order. `<base>` is replaced by the resolved base branch. */
export const GIT_CMDS = [
  ["rev-parse", "--show-toplevel"],
  ["rev-parse", "--abbrev-ref", "HEAD"],
  ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
  ["rev-list", "--count", "<base>..HEAD"],
  ["status", "--porcelain", "--untracked-files=normal"],
];

export const PR_FIELDS =
  "number,title,state,url,reviewDecision,statusCheckRollup,files,additions,deletions,baseRefName,headRefName,commits,headRefOid";

const okOut = (r) => (r && r.code === 0 ? String(r.stdout ?? "").trim() : "");

/**
 * @param {{ toplevel: ExecResult, branch: ExecResult, base: ExecResult, ahead: ExecResult|null, status?: ExecResult|null }} out
 * @returns {{ repo: string|null, root: string|null, branch: string|null, base: string, commitsAhead: number|null, dirty: boolean }}
 */
export function parseGitState(out) {
  const root = okOut(out.toplevel);
  if (!root) return { repo: null, root: null, branch: null, base: "main", commitsAhead: null, dirty: false };
  const base = okOut(out.base).replace(/^origin\//, "") || "main";
  const n = out.ahead ? Number.parseInt(okOut(out.ahead), 10) : NaN;
  return {
    repo: root.split("/").filter(Boolean).pop() ?? null,
    root,
    branch: okOut(out.branch) || null,
    base,
    commitsAhead: Number.isFinite(n) ? n : null,
    // A failed or timed-out `git status` counts as clean (okOut is "" unless code 0).
    dirty: okOut(out.status ?? null) !== "",
  };
}

const PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const FAIL = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);

/** @returns {Check} */
function mapCheck(c) {
  if (c && c.state !== undefined && c.status === undefined) {
    // StatusContext: SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
    const state = String(c.state);
    const status = state === "SUCCESS" ? "pass" : state === "FAILURE" || state === "ERROR" ? "fail" : "pending";
    return { name: String(c.context ?? c.name ?? ""), status, detail: state.toLowerCase() };
  }
  // CheckRun: only a COMPLETED run has a verdict.
  const completed = c.status === "COMPLETED";
  const conclusion = String(c.conclusion ?? "");
  const status = completed ? (PASS.has(conclusion) ? "pass" : FAIL.has(conclusion) ? "fail" : "pending") : "pending";
  return { name: String(c.name ?? ""), status, detail: (completed ? conclusion : String(c.status ?? "")).toLowerCase() };
}

/**
 * @param {ExecResult} res output of `gh pr view <branch> --json PR_FIELDS`
 * @returns {{ pr: Pr|null, error: string|null }}
 */
export function parsePr(res) {
  const unavailable = { pr: null, error: "GitHub unavailable" };
  if (res.code !== 0) {
    return /no pull requests found/.test(res.stderr ?? "") ? { pr: null, error: null } : unavailable;
  }
  let j;
  try {
    j = JSON.parse(res.stdout);
  } catch {
    return unavailable;
  }
  if (!j || typeof j !== "object" || typeof j.number !== "number") return unavailable;
  return {
    pr: {
      number: j.number,
      title: j.title ?? "",
      state: j.state,
      url: j.url ?? "",
      review: j.reviewDecision || null,
      checks: (j.statusCheckRollup ?? []).map(mapCheck),
      files: (j.files ?? []).map((f) => ({ path: f.path, add: f.additions ?? 0, del: f.deletions ?? 0 })),
      additions: j.additions ?? 0,
      deletions: j.deletions ?? 0,
      base: j.baseRefName ?? "",
      head: j.headRefName ?? "",
      headSha: typeof j.headRefOid === "string" && /^[0-9a-f]{40}$/.test(j.headRefOid) ? j.headRefOid : null,
      commits: Array.isArray(j.commits) ? j.commits.length : 0,
    },
    error: null,
  };
}

/**
 * Parses a unified diff (`gh pr diff` / `git diff`). Binary files yield no hunks;
 * renames use the new path.
 * @param {string} text
 * @returns {{ path: string, add: number, del: number, hunks: { header: string, lines: { a: number|null, b: number|null, sign: " "|"+"|"-", code: string }[] }[] }[]}
 */
export function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let a = 0;
  let b = 0;
  for (const line of String(text).split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      file = { path: m ? m[2] : line.slice(11), add: 0, del: 0, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (line.startsWith("@@")) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!m) continue;
      a = Number(m[1]);
      b = Number(m[2]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      // File header section: only the new path matters.
      if (line.startsWith("rename to ")) file.path = line.slice(10);
      else if (line.startsWith("+++ b/")) file.path = line.slice(6).replace(/\t$/, "");
      continue;
    }
    const sign = line[0];
    if (sign === "+") {
      hunk.lines.push({ a: null, b: b++, sign: "+", code: line.slice(1) });
      file.add++;
    } else if (sign === "-") {
      hunk.lines.push({ a: a++, b: null, sign: "-", code: line.slice(1) });
      file.del++;
    } else if (sign === " " || line === "") {
      // A blank line inside a hunk is context whose trailing space was stripped,
      // except the final empty string after the diff's last newline.
      hunk.lines.push({ a: a++, b: b++, sign: " ", code: line.slice(1) });
    }
    // "\ No newline at end of file" and anything else: skipped.
  }
  // Drop a spurious trailing blank context line produced by the final newline.
  for (const f of files) for (const h of f.hunks) {
    const m = h.header.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    const oldN = m[1] === undefined ? 1 : Number(m[1]);
    const newN = m[2] === undefined ? 1 : Number(m[2]);
    const last = h.lines[h.lines.length - 1];
    if (last && last.sign === " " && last.code === "" &&
        h.lines.filter((l) => l.sign !== "+").length > oldN &&
        h.lines.filter((l) => l.sign !== "-").length > newN) h.lines.pop();
  }
  return files;
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * Merge only the head the person saw: `shown` (the store's headSha the screen
 * drew) must be a full SHA equal to `fresh` (GitHub's head right now).
 * @param {string|null|undefined} shown @param {string|null|undefined} fresh
 * @returns {{ ok: boolean, error: string|null }}
 */
export function headCheck(shown, fresh) {
  if (typeof shown !== "string" || !SHA.test(shown) || typeof fresh !== "string" || !SHA.test(fresh)) {
    return { ok: false, error: "unknown head commit" };
  }
  return shown === fresh ? { ok: true, error: null } : { ok: false, error: "Branch moved — review again" };
}

/**
 * Review soft gate: true unless the person has opened the diff for the PR's
 * current head (`issue.reviewedSha === issue.pr.headSha`). A push changes the
 * head, so an old review no longer counts.
 * @param {{ pr?: { headSha?: string|null }|null, reviewedSha?: string|null }|null} issue
 */
export function needsReviewGate(issue) {
  const head = issue?.pr?.headSha;
  if (typeof head !== "string" || !SHA.test(head)) return true;
  return issue?.reviewedSha !== head;
}
