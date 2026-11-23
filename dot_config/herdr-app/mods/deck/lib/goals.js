// Goals: what the agents' work adds up to. A goal has a time box (start..end)
// and the cards linked to it; the Goals view draws them as a Gantt roadmap.
// Deck alone writes them (shared key GOALS_KEY). Pure; no herdr imports.
import { projectOrder } from "./present.js";
import { STAGE_LABEL } from "./stage.js";

export const GOALS_KEY = "deck.goals";

const DAY = 86_400_000;
const MAX_DAYS = 120;
/** No live agent and nothing started or landed for this long: Stalled. */
const STALL_MS = 3 * DAY;
/** Time box used minus share landed above this: At risk. */
const RISK_GAP = 0.2;
const MIN_WINDOW = 28;

/** @typedef {{ ref: string, id: string, title: string, addedAt: number, startedAt: number|null, landedAt: number|null }} Task */
/** @typedef {{ id: string, title: string, project: string|null, start: number, end: number, doneWhen: string, createdAt: number, tasks: Task[] }} Goal */
/** @typedef {{ goals: Goal[], counter: number }} Goals */

/** @returns {Goals} */
export function emptyGoals() {
  return { goals: [], counter: 0 };
}

/** A goals value read from shared state: anything malformed is empty. @param {unknown} v @returns {Goals} */
export function asGoals(v) {
  const g = /** @type {any} */ (v);
  return g && Array.isArray(g.goals) && Number.isFinite(g.counter) ? g : emptyGoals();
}

/** Local midnight of the day `ms` falls on. @param {number} ms */
export function dayStart(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const addDays = (ms, n) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};

/** "YYYY-MM-DD" as a local midnight, or null when it is not a real date. @param {unknown} s */
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const t = new Date(y, mo, d);
  return t.getFullYear() === y && t.getMonth() === mo && t.getDate() === d ? t.getTime() : null;
}

// Herdr's JS runtime ignores toLocaleDateString options: names by hand.
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Nov 23" for a day. @param {number} ms */
export function shortDay(ms) {
  const d = new Date(ms);
  return MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate();
}

/**
 * A new goal G-<n>: `days` long (a whole number, 1..120) from `start`
 * ("YYYY-MM-DD", default today).
 * @param {Goals} g @param {{ title: string, project?: string|null, days: unknown, start?: string|null, doneWhen?: string|null }} f @param {number} now
 * @returns {{ goals: Goals, goal: Goal } | { error: string }}
 */
export function newGoal(g, f, now) {
  const title = String(f?.title ?? "").trim();
  if (!title) return { error: "a goal needs a title" };
  const days = Number(f?.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return { error: `--days must be a whole number from 1 to ${MAX_DAYS}` };
  let start = dayStart(now);
  if (f?.start != null && String(f.start).trim()) {
    const s = parseDay(f.start);
    if (s == null) return { error: `--start "${f.start}" is not a date like 2026-11-23` };
    start = s;
  }
  const counter = (g?.counter ?? 0) + 1;
  const project = typeof f?.project === "string" && f.project.trim() ? f.project.trim() : null;
  const goal = {
    id: "G-" + counter, title, project, start, end: addDays(start, days),
    doneWhen: String(f?.doneWhen ?? "").trim(), createdAt: now, tasks: [],
  };
  return { goals: { goals: [...(g?.goals ?? []), goal], counter }, goal };
}

/** @param {Goals} g @param {string} ref @returns {Goal|null} */
export function findGoal(g, ref) {
  const up = String(ref ?? "").trim().toUpperCase();
  return (g?.goals ?? []).find((x) => x.id.toUpperCase() === up) ?? null;
}

const isBacklog = (i) => i?.kind === "backlog";

/** @param {any} issue @param {number} now @returns {Task} */
function taskFor(issue, now) {
  return {
    ref: issue.key, id: issue.id, title: issue.title ?? "", addedAt: now,
    startedAt: isBacklog(issue) ? null : issue.createdAt ?? null,
    landedAt: issue.stage === "landed" ? issue.landedAt ?? now : null,
  };
}

const without = (goal, ref) => ({ ...goal, tasks: goal.tasks.filter((t) => t.ref !== ref) });

/**
 * Puts the card on goal `ref` (off any other goal: one goal per card), or
 * takes it off every goal when `ref` is "none".
 * @param {Goals} g @param {string} ref @param {any} issue @param {number} now
 * @returns {{ goals: Goals, goal: Goal|null } | { error: string }}
 */
export function linkCard(g, ref, issue, now) {
  const none = String(ref ?? "").trim().toLowerCase() === "none";
  const target = none ? null : findGoal(g, ref);
  if (!none && !target) return { error: `no goal ${ref} (goals: ${(g?.goals ?? []).map((x) => x.id).join(", ") || "none yet"})` };
  const goals = g.goals.map((x) => {
    const off = without(x, issue.key);
    return target && x.id === target.id ? { ...off, tasks: [...off.tasks, taskFor(issue, now)] } : off;
  });
  return { goals: { ...g, goals }, goal: target ? goals.find((x) => x.id === target.id) ?? null : null };
}

/** A backlog card was started in worktree `path`: its task waits for that agent's card. @param {Goals} g @param {string} backlogKey @param {string} path */
export function linkStarted(g, backlogKey, path) {
  if (!path || !(g?.goals ?? []).some((x) => x.tasks.some((t) => t.ref === backlogKey))) return g;
  return { ...g, goals: g.goals.map((x) => ({ ...x, tasks: x.tasks.map((t) => (t.ref === backlogKey ? { ...t, ref: "path:" + path } : t)) })) };
}

const atPath = (i, path) => !isBacklog(i) && (i.root === path || (typeof i.cwd === "string" && (i.cwd === path || i.cwd.startsWith(path + "/"))));

/**
 * Brings goals up to date with the board: a `path:` task becomes the card of
 * the agent working there; id, title and start follow the card; landing is
 * recorded once (and kept after the card leaves the board); backlog cards
 * filed with a goal join it. Returns `g` itself when nothing changed.
 * @param {Goals} g @param {any[]} issues @param {number} now @returns {Goals}
 */
export function syncGoals(g, issues, now) {
  const list = issues ?? [];
  const byKey = new Map(list.map((i) => [i.key, i]));
  const linked = new Set((g?.goals ?? []).flatMap((x) => x.tasks.map((t) => t.ref)));
  let changed = false;
  const goals = (g?.goals ?? []).map((goal) => {
    let tasks = goal.tasks.map((t) => {
      const issue = t.ref.startsWith("path:") ? list.find((i) => atPath(i, t.ref.slice(5))) : byKey.get(t.ref);
      if (!issue) return t;
      const next = {
        ...t, ref: issue.key, id: issue.id ?? t.id, title: issue.title ?? t.title,
        startedAt: t.startedAt ?? (isBacklog(issue) ? null : issue.createdAt ?? null),
        landedAt: t.landedAt ?? (issue.stage === "landed" ? issue.landedAt ?? now : null),
      };
      const same = Object.keys(next).every((k) => next[k] === t[k]);
      if (!same) changed = true;
      return same ? t : next;
    });
    for (const i of list) {
      if (!isBacklog(i) || i.discarded || linked.has(i.key) || !i.goal) continue;
      if (String(i.goal).trim().toUpperCase() !== goal.id.toUpperCase()) continue;
      tasks = [...tasks, taskFor(i, now)];
      linked.add(i.key);
      changed = true;
    }
    return tasks === goal.tasks ? goal : { ...goal, tasks };
  });
  return changed ? { ...g, goals } : g;
}

/**
 * Status, first match: Done, Out of time, Stalled, Shaping, At risk, On track.
 * `live` = the goal's cards with an agent running now.
 * @param {Goal} goal @param {any[]} live @param {number} now
 * @returns {{ status: string, tone: "ok"|"hold"|"fail"|"muted"|"work" }}
 */
export function goalStatus(goal, live, now) {
  const total = goal.tasks.length;
  const done = goal.tasks.filter((t) => t.landedAt != null).length;
  if (total > 0 && done === total) return { status: "Done", tone: "muted" };
  if (now > goal.end) return { status: "Out of time", tone: "fail" };
  const last = Math.max(0, ...goal.tasks.flatMap((t) => [t.startedAt ?? 0, t.landedAt ?? 0]));
  if (total > 0 && !(live ?? []).length && now - last >= STALL_MS) return { status: "Stalled", tone: "fail" };
  if (done === 0) return { status: "Shaping", tone: "work" };
  if (usedOf(goal, now) - done / total > RISK_GAP) return { status: "At risk", tone: "hold" };
  return { status: "On track", tone: "ok" };
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const usedOf = (goal, now) => clamp01((now - goal.start) / Math.max(1, goal.end - goal.start));

/** Monday on or before `ms` (local). */
const monday = (ms) => addDays(dayStart(ms), -((new Date(ms).getDay() + 6) % 7));

/**
 * The Gantt model: a window of whole days from the Monday on or before the
 * earliest goal start (or today), at least four weeks and through every end
 * plus three days; rows grouped by project (project order), each with its bar
 * and dots as fractions of the window.
 * @param {Goals} g @param {any[]} issues @param {number} now
 */
export function roadmap(g, issues, now) {
  const goals = g?.goals ?? [];
  const from = monday(Math.min(dayStart(now), ...goals.map((x) => x.start)));
  const last = Math.max(addDays(dayStart(now), 3), ...goals.map((x) => addDays(x.end, 3)));
  const days = Math.max(MIN_WINDOW, Math.round((last - from) / DAY));
  const span = addDays(from, days) - from;
  const frac = (ms) => clamp01((ms - from) / span);
  const byKey = new Map((issues ?? []).map((i) => [i.key, i]));

  const rows = goals.map((goal) => {
    const cards = goal.tasks.map((t) => byKey.get(t.ref)).filter(Boolean);
    const live = cards.filter((i) => !isBacklog(i) && i.observed !== false && i.stage !== "landed" && !i.dismissed);
    const st = goalStatus(goal, live, now);
    const landed = goal.tasks.filter((t) => t.landedAt != null);
    return {
      id: goal.id, title: goal.title, project: goal.project, status: st.status, tone: st.tone,
      done: landed.length, total: goal.tasks.length, doneWhen: goal.doneWhen,
      start: goal.start, end: goal.end, startFrac: frac(goal.start), endFrac: frac(goal.end),
      landed: landed.map((t) => frac(t.landedAt)), usedFrac: usedOf(goal, now),
      daysLeft: Math.ceil((goal.end - now) / DAY),
      agents: live.map((i) => ({ id: i.id, key: i.key, what: STAGE_LABEL[i.stage] ?? i.stage, hold: i.stage === "holding" })),
    };
  });
  const projects = [...new Set(rows.map((r) => r.project))].sort(projectOrder);
  const groups = projects.map((project) => ({ project, rows: rows.filter((r) => r.project === project) }));
  return { from, days, now: frac(now), groups };
}

