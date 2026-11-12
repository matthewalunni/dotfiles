// The New task dialog (views/newtask.js): its repo chips, the script's argv,
// its keys and the filing flow. Pure; no herdr imports. Filing runs the
// herdr-backlog script with argv only (never a shell), source "you".
import { safeRepo } from "./backlog.js";

export const REQUIRED = "Title and brief are required";
// A filed entry's createdAt is the script's clock, a little after the press.
const SINCE_SLACK_MS = 1000;

const baseName = (p) => String(p).replace(/\/+$/, "").split("/").pop() || "repo";

/**
 * Where an issue's root really belongs: a Claude worktree (<repo>/.claude/worktrees/<n>)
 * is its repo; a Herdr worktree (~/.herdr/worktrees/<repo>/<branch>) keeps its path
 * (the script resolves it) but is named after <repo>.
 * @param {string} root @returns {{root: string, name: string, wt: boolean}}
 */
function placeOf(root) {
  const claude = root.indexOf("/.claude/worktrees/");
  if (claude > 0) {
    const main = root.slice(0, claude);
    return { root: main, name: baseName(main), wt: false };
  }
  const m = /\/\.herdr\/worktrees\/([^/]+)\/[^/]+\/?$/.exec(root);
  if (m) return { root, name: m[1], wt: true };
  return { root: root.replace(/\/+$/, "") || root, name: baseName(root), wt: false };
}

const shown = (i) => !i.dismissed && !(i.kind === "backlog" && i.discarded);

/**
 * The dialog's repo chips: the distinct repo roots of the live issues and backlog
 * entries, first seen first. A Herdr worktree folds into a chip for its repo when
 * one is there.
 * @param {any[]|null|undefined} issues @returns {{root: string, name: string}[]}
 */
export function repoChoices(issues) {
  const places = (issues ?? []).filter((i) => i && shown(i) && safeRepo(i.root)).map((i) => placeOf(i.root));
  const mains = new Set(places.filter((p) => !p.wt).map((p) => p.name));
  const out = [];
  const seenRoot = new Set();
  const seenWt = new Set();
  for (const p of places) {
    if (p.wt) {
      if (mains.has(p.name) || seenWt.has(p.name)) continue;
      seenWt.add(p.name);
    } else if (seenRoot.has(p.root)) continue;
    seenRoot.add(p.root);
    out.push({ root: p.root, name: p.name });
  }
  return out;
}

/**
 * The repo the dialog opens on: the selected issue's (its chip), else the first chip, else null.
 * @param {any[]|null|undefined} issues @param {string|null|undefined} selKey
 * @returns {string|null}
 */
export function defaultRepo(issues, selKey) {
  const chips = repoChoices(issues);
  const sel = (issues ?? []).find((i) => i && i.key === selKey);
  if (sel && safeRepo(sel.root)) {
    const p = placeOf(sel.root);
    return (p.wt ? chips.find((c) => c.name === p.name)?.root : null) ?? p.root;
  }
  return chips[0]?.root ?? null;
}

/**
 * The herdr-backlog argv for the dialog's text, verbatim, or {error}.
 * @param {{title?: string, brief?: string, root?: string|null}} f
 * @returns {string[] | {error: string}}
 */
export function newTaskArgs(f) {
  const title = typeof f?.title === "string" ? f.title : "";
  const brief = typeof f?.brief === "string" ? f.brief : "";
  if (!title.trim() || !brief.trim()) return { error: REQUIRED };
  const root = typeof f?.root === "string" ? f.root : "";
  if (!root.startsWith("/")) return { error: "Choose a repo" };
  if ((title + brief + root).includes("\0")) return { error: "The text contains a NUL character" };
  return ["--title", title, "--brief", brief, "--repo", root, "--source", "you"];
}

/**
 * The script runs through a login shell, so its PATH has node and $HOME is the
 * user's (Herdr's exec PATH has neither ~/.local/bin nor, reliably, Homebrew).
 * The shell string is fixed: the text travels only as positional arguments ("$@").
 */
export const BACKLOG_SH = 'exec "$HOME/.local/bin/herdr-backlog" "$@"';

/** exec(cmd, args) for herdr-backlog with `argv` (from newTaskArgs). @param {string[]} argv */
export function backlogExec(argv) {
  return { cmd: "/bin/zsh", args: ["-lc", BACKLOG_SH, "herdr-backlog", ...argv] };
}

/**
 * What a key does in the dialog. `field` is the input that has the keyboard
 * ("title" | "brief"), or null. Everything not listed is text for the input:
 * no Deck shortcut ever runs from here. ⌘↵ adds (a held key never does), esc
 * cancels, Tab / Shift-Tab move between fields, Enter in Title moves to Brief;
 * Enter in Brief is a newline.
 * @param {{key: string, shift: boolean, cmd: boolean, held?: boolean}} ev
 * @param {"title"|"brief"|null} field
 * @returns {"submit"|"cancel"|"next"|"prev"|null}
 */
export function dialogKeyNewTask(ev, field) {
  const k = String(ev?.key ?? "").toLowerCase();
  if (k === "enter" && ev?.cmd) return ev.held ? null : "submit";
  if (ev?.cmd) return null;
  if (k === "escape") return ev?.held ? null : "cancel";
  if (k === "tab") return ev?.shift ? "prev" : "next";
  if (k === "enter" && field === "title" && !ev?.shift) return "next";
  return null;
}

/**
 * The newest "you" entry with this title and brief filed at or after `since` (ms), or null.
 * @param {any[]} entries @param {{title: string, brief: string}} f @param {number} since
 */
export function findFiled(entries, f, since) {
  const title = String(f?.title ?? "").trim();
  const brief = String(f?.brief ?? "");
  let best = null;
  for (const e of entries ?? []) {
    if (e?.source !== "you" || e.title !== title || e.brief !== brief || !(e.createdAt >= since)) continue;
    if (!best || e.createdAt >= best.createdAt) best = e;
  }
  return best;
}

/** The script's message: its last stderr line without the "herdr-backlog: " prefix. */
function scriptError(r) {
  const lines = String(r?.stderr || r?.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.pop();
  if (!last) return `herdr-backlog failed (exit ${r?.code ?? "?"})`;
  return last.replace(/^herdr-backlog:\s*/, "");
}

/**
 * ⌘↵ / Add to Backlog. Runs the script (`io.run(argv)`, timed by the caller)
 * only when the text is complete; on success re-reads the inbox at once
 * (`io.reread()` → the parsed entries) and selects the new card (`io.select(id)`).
 * Returns the dialog's next state: `done` closes it; otherwise `error` shows and
 * the text is kept as typed.
 * @template {{title: string, brief: string, root: string|null}} F
 * @param {F} form
 * @param {{ run: (argv: string[]) => Promise<{code: number, stdout?: string, stderr?: string}>,
 *   reread: () => Promise<any[]>, select: (entryId: string) => void }} io
 * @param {number} now when it was pressed (ms)
 * @returns {Promise<F & {error: string|null, busy: false, done: boolean}>}
 */
export async function submitTask(form, io, now) {
  const fail = (error) => ({ ...form, error, busy: /** @type {false} */ (false), done: false });
  const argv = newTaskArgs(form);
  if (!Array.isArray(argv)) return fail(argv.error);
  let r;
  try {
    r = await io.run(argv);
  } catch (e) {
    return fail("herdr-backlog: " + String(e?.message ?? e ?? "failed"));
  }
  if (!r || r.code !== 0) return fail(scriptError(r));
  let entries = [];
  try {
    entries = (await io.reread()) ?? [];
  } catch {
    entries = []; // filed; the next collector cycle shows it
  }
  const hit = findFiled(entries, form, now - SINCE_SLACK_MS);
  if (hit) io.select(hit.id);
  return { ...form, error: null, busy: /** @type {false} */ (false), done: true };
}
