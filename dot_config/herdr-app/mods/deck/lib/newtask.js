// The New task dialog (views/newtask.js, also opened from anywhere by ⌘⇧N
// through the deck-new mod): its repo chips, the script's argv, its keys, the
// filing flow and the Start now flow. Pure; no herdr imports. Filing runs the
// herdr-backlog script through a fixed login-shell string (zsh -lc), the text as
// positional args only, source "you". Start now is backlog.js runStart.
import { safeRepo, runStart, spaceNewArgs } from "./backlog.js";

export { spaceNewArgs };

export const REQUIRED = "Title and brief are required";
export const TITLE_REQUIRED = "A title is required";
export const NO_TERMINAL_BACKLOG = "Terminals don't go to the Backlog";
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
 * Which finish a key press asks for: ⌘↵ "start" (Start now), ⌥⌘↵ "backlog"
 * (Add to Backlog), else null. A held (repeating) key never submits. `cmd` is
 * keyOf's (⌘, ctrl or ⌥); `mod`, when given, is ⌘ / ctrl alone, so a bare ⌥↵
 * is nothing.
 * @param {{key: string, cmd: boolean, alt?: boolean, mod?: boolean, held?: boolean}} ev
 * @returns {"start"|"backlog"|null}
 */
export function newTaskSubmit(ev) {
  if (String(ev?.key ?? "").toLowerCase() !== "enter" || !ev?.cmd || ev?.held) return null;
  if (ev.mod === false) return null;
  return ev.alt ? "backlog" : "start";
}

/**
 * What a key does in the dialog. `field` is the control that has the keyboard
 * ("title" | "brief" | "terminal": the Just a terminal checkbox), or null.
 * Everything not listed is text for the input: no Deck shortcut ever runs from
 * here. ⌘↵ starts and ⌥⌘↵ adds to the Backlog (newTaskSubmit; a held key never
 * does), esc cancels, Tab / Shift-Tab move between fields, Enter in Title moves
 * to Brief; Enter in Brief is a newline; Space on the checkbox toggles it.
 * @param {{key: string, shift: boolean, cmd: boolean, alt?: boolean, mod?: boolean, held?: boolean}} ev
 * @param {"title"|"brief"|"terminal"|null} field
 * @returns {"start"|"backlog"|"cancel"|"next"|"prev"|"toggle"|null}
 */
export function dialogKeyNewTask(ev, field) {
  const k = String(ev?.key ?? "").toLowerCase();
  if (k === "enter" && ev?.cmd) return newTaskSubmit(ev);
  if (ev?.cmd) return null;
  if (k === "escape") return ev?.held ? null : "cancel";
  if (k === "tab") return ev?.shift ? "prev" : "next";
  if (k === "enter" && field === "title" && !ev?.shift) return "next";
  if ((k === "space" || k === " ") && field === "terminal") return ev?.held ? null : "toggle";
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
  if (/** @type {any} */ (form).terminal) return fail(NO_TERMINAL_BACKLOG);
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

// ---------------------------------------------------------------- start now

/** A fresh entry id for a Start now (only the branch name's fallback uses it): 8 hex digits. */
export function freshId() {
  return Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
}

/**
 * Runs `fn` only when no earlier call is still in flight; a call made meanwhile
 * returns null at once (two quick ⌘↵ presses make one worktree).
 * @template {any[]} A @template R
 * @param {(...a: A) => Promise<R>} fn @returns {(...a: A) => Promise<R|null>}
 */
export function oneAtATime(fn) {
  let busy = false;
  return async (...a) => {
    if (busy) return null;
    busy = true;
    try {
      return await fn(...a);
    } finally {
      busy = false;
    }
  };
}

/**
 * ⌘↵ / Start now: the backlog Start's path (runStart: the safe repo check,
 * rev-parse --show-toplevel, git worktree add -b, space.new, the agent appeared)
 * for an entry-like object made from the dialog's text, then `io.select(plan)`
 * (switch to the new space). No second confirm: Matt typed it and pressed ⌘↵.
 * A start that made the worktree but lost the agent returns `pendingWorktree`,
 * so the next ⌘↵ from the same dialog reuses that worktree.
 * Returns the dialog's next state: `done` closes it; otherwise `error` shows
 * and the text is kept.
 * @template {{id: string, title: string, brief: string, root: string|null, terminal?: boolean, pendingWorktree?: {path: string, branch: string}|null}} F
 * @param {F} form @param {string} home
 * @param {Omit<Parameters<typeof runStart>[2], "done"|"pending"|"again"> & { select: (plan: any) => void }} io
 * @returns {Promise<F & {error: string|null, busy: false, done: boolean}>}
 */
export async function startTask(form, home, io) {
  const fail = (error, extra = {}) => ({ ...form, ...extra, error, busy: /** @type {false} */ (false), done: false });
  const terminal = Boolean(form?.terminal);
  const title = typeof form?.title === "string" ? form.title : "";
  const brief = typeof form?.brief === "string" ? form.brief : "";
  if (!title.trim()) return fail(terminal ? TITLE_REQUIRED : REQUIRED);
  if (!terminal && !brief.trim()) return fail(REQUIRED);
  if (typeof form?.root !== "string" || !form.root.startsWith("/")) return fail("Choose a repo");
  if ((title + brief + form.root).includes("\0")) return fail("The text contains a NUL character");
  const entry = {
    kind: "new", id: form.id, title: title.trim(), brief, root: form.root, terminal,
    pendingWorktree: form.pendingWorktree ?? null,
  };
  let pending = null;
  let r;
  try {
    r = await runStart(entry, home, {
      ...io,
      pending: (plan) => { pending = { path: plan.path, branch: plan.branch }; },
      again: "press ⌘↵ again",
      done: (plan) => io.select(plan),
    });
  } catch (e) {
    r = { ok: false, error: String(e?.message ?? e ?? "failed") };
  }
  if (!r.ok) return fail(r.error ?? "Could not start", pending ? { pendingWorktree: pending } : {});
  return { ...form, error: null, busy: /** @type {false} */ (false), done: true };
}
