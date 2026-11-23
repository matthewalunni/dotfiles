import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyGoals, dayStart, parseDay, shortDay, newGoal, findGoal, linkCard, linkStarted, syncGoals, goalStatus, roadmap,
} from "../../dot_config/herdr-app/mods/deck/lib/goals.js";

const DAY = 86_400_000;
const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).getTime();
const NOW = at(11, 23, 15); // a Monday

const card = (o) => ({ key: "k-" + o.id, id: o.id, title: "t " + o.id, stage: "build", observed: true, createdAt: at(11, 20), landedAt: null, ...o });
const make = (title, opts = {}, g = emptyGoals(), now = NOW) => newGoal(g, { title, days: 14, ...opts }, now);

test("shortDay names the month by hand (herdr's runtime ignores locale options)", () => {
  assert.equal(shortDay(at(11, 23)), "Nov 23");
  assert.equal(shortDay(at(1, 5)), "Jan 5");
});

test("dayStart and parseDay are local midnights; bad dates are null", () => {
  assert.equal(dayStart(NOW), new Date(2026, 10, 23).getTime());
  assert.equal(parseDay("2026-11-10"), new Date(2026, 10, 10).getTime());
  for (const bad of ["2026-13-01", "2026-02-30", "11/10/2026", "", "abc", null]) assert.equal(parseDay(bad), null, String(bad));
});

test("newGoal: G-1, G-2; starts today by default; end is start + days", () => {
  const a = make("Ship chat", { project: "deck", doneWhen: "all from chat" });
  assert.equal(a.goal.id, "G-1");
  assert.equal(a.goal.start, dayStart(NOW));
  assert.equal(a.goal.end, dayStart(NOW) + 14 * DAY);
  assert.equal(a.goal.project, "deck");
  assert.equal(a.goal.doneWhen, "all from chat");
  assert.deepEqual(a.goal.tasks, []);
  const b = make("Second", { start: "2026-11-10", days: 3 }, a.goals);
  assert.equal(b.goal.id, "G-2");
  assert.equal(b.goal.start, parseDay("2026-11-10"));
  assert.equal(b.goals.goals.length, 2);
});

test("newGoal refuses a bad title, days or start and leaves goals alone", () => {
  const g = emptyGoals();
  for (const opts of [{ title: "  " }, { days: 0 }, { days: 121 }, { days: 2.5 }, { days: "abc" }, { start: "2026-13-40" }]) {
    const r = newGoal(g, { title: "x", days: 14, ...opts }, NOW);
    assert.ok(r.error, JSON.stringify(opts));
    assert.equal(r.goals, undefined);
  }
});

test("findGoal: by id, any case", () => {
  const { goals } = make("A");
  assert.equal(findGoal(goals, "g-1")?.title, "A");
  assert.equal(findGoal(goals, "G-9"), null);
});

test("linkCard: adds the card; a card belongs to one goal; none unlinks", () => {
  let g = make("B", {}, make("A").goals).goals;
  const c = card({ id: "D-1" });
  let r = linkCard(g, "G-1", c, NOW);
  assert.equal(r.goal.id, "G-1");
  assert.deepEqual(r.goals.goals[0].tasks.map((t) => t.ref), ["k-D-1"]);
  assert.equal(r.goals.goals[0].tasks[0].startedAt, c.createdAt);
  r = linkCard(r.goals, "g-2", c, NOW);
  assert.deepEqual(r.goals.goals.map((x) => x.tasks.length), [0, 1]);
  r = linkCard(r.goals, "none", c, NOW);
  assert.equal(r.goal, null);
  assert.deepEqual(r.goals.goals.map((x) => x.tasks.length), [0, 0]);
  assert.match(linkCard(r.goals, "G-7", c, NOW).error, /G-7/);
});

test("linkCard: a backlog card has not started yet", () => {
  const { goals } = make("A");
  const r = linkCard(goals, "G-1", { key: "backlog|e1", id: "B-1", title: "t", kind: "backlog", createdAt: at(11, 1) }, NOW);
  assert.equal(r.goals.goals[0].tasks[0].startedAt, null);
});

test("syncGoals: records landing once and keeps it after the card is gone", () => {
  let g = linkCard(make("A").goals, "G-1", card({ id: "D-1" }), NOW).goals;
  assert.equal(syncGoals(g, [card({ id: "D-1" })], NOW), g, "unchanged is the same object");
  const landed = card({ id: "D-1", title: "renamed", stage: "landed", landedAt: at(11, 22) });
  g = syncGoals(g, [landed], NOW);
  assert.equal(g.goals[0].tasks[0].landedAt, at(11, 22));
  assert.equal(g.goals[0].tasks[0].title, "renamed");
  const later = syncGoals(g, [], NOW + 10 * DAY);
  assert.equal(later, g);
  assert.equal(later.goals[0].tasks[0].landedAt, at(11, 22));
});

test("syncGoals: a started backlog card's worktree becomes its agent's card", () => {
  let g = linkCard(make("A").goals, "G-1", { key: "backlog|e1", id: "B-1", title: "t", kind: "backlog" }, NOW).goals;
  g = linkStarted(g, "backlog|e1", "/wt/fix-x");
  assert.equal(g.goals[0].tasks[0].ref, "path:/wt/fix-x");
  g = syncGoals(g, [card({ id: "C-4", root: "/wt/fix-x", createdAt: at(11, 23, 9) })], NOW);
  assert.equal(g.goals[0].tasks[0].ref, "k-C-4");
  assert.equal(g.goals[0].tasks[0].id, "C-4");
  assert.equal(g.goals[0].tasks[0].startedAt, at(11, 23, 9));
});

test("syncGoals: adds backlog cards filed with a goal, once", () => {
  const g0 = make("A").goals;
  const b = { key: "backlog|e2", id: "B-2", title: "filed", kind: "backlog", goal: "g-1", createdAt: at(11, 21) };
  const g = syncGoals(g0, [b, { ...b, key: "backlog|e3", id: "B-3", goal: "G-9" }], NOW);
  assert.deepEqual(g.goals[0].tasks.map((t) => t.id), ["B-2"]);
  assert.equal(syncGoals(g, [b], NOW), g);
});

test("syncGoals: a --goal backlog card taken off its goal stays off", () => {
  const b = { key: "backlog|e2", id: "B-2", title: "filed", kind: "backlog", goal: "G-1", createdAt: at(11, 21) };
  let g = syncGoals(make("A").goals, [b], NOW);
  g = linkCard(g, "none", b, NOW).goals;
  assert.equal(syncGoals(g, [b], NOW).goals[0].tasks.length, 0);
});

test("syncGoals: a card that leaves the board without landing leaves its goal; a started backlog card waits", () => {
  let g = make("A").goals;
  const gone = card({ id: "D-1" });
  const disc = { key: "backlog|e3", id: "B-3", title: "d", kind: "backlog" };
  const started = { key: "backlog|e4", id: "B-4", title: "s", kind: "backlog" };
  const landed = card({ id: "D-2", stage: "landed", landedAt: at(11, 22) });
  for (const c of [gone, disc, started, landed]) g = linkCard(g, "G-1", c, NOW).goals;
  g = syncGoals(g, [landed, { ...disc, discarded: true }], NOW, { e4: { state: "started", at: NOW } });
  assert.deepEqual(g.goals[0].tasks.map((t) => t.id), ["B-4", "D-2"]);
  g = syncGoals(g, [], NOW + 30 * DAY, { e4: { state: "started", at: NOW } });
  assert.deepEqual(g.goals[0].tasks.map((t) => t.id), ["B-4", "D-2"], "landed stays; started waits for its agent");
});

const goalWith = (tasks, o = {}) => ({ id: "G-1", title: "A", project: null, start: dayStart(at(11, 13)), end: dayStart(at(11, 13)) + 14 * DAY, doneWhen: "", createdAt: at(11, 13), tasks, ...o });
const task = (o) => ({ ref: "r", id: "X", title: "x", addedAt: at(11, 13), startedAt: at(11, 21), landedAt: null, ...o });
const live = [{ stage: "build" }];

test("goalStatus follows the spec's table", () => {
  assert.equal(goalStatus(goalWith([task({ landedAt: at(11, 20) })]), [], NOW).status, "Done");
  assert.equal(goalStatus(goalWith([task({})], { end: dayStart(at(11, 20)) }), live, NOW).status, "Out of time");
  assert.equal(goalStatus(goalWith([task({ startedAt: at(11, 14) })]), [], NOW).status, "Stalled");
  assert.equal(goalStatus(goalWith([task({})]), [], NOW).status, "Shaping", "recent start: not stalled");
  assert.equal(goalStatus(goalWith([]), [], NOW).status, "Shaping", "no tasks");
  const fresh = goalWith([task({ startedAt: null, addedAt: NOW })], { createdAt: NOW, start: dayStart(NOW) });
  assert.equal(goalStatus(fresh, [], NOW).status, "Shaping", "a new goal of backlog cards is not stalled");
  const half = [task({ landedAt: at(11, 22) }), task({}), task({}), task({})];
  assert.equal(goalStatus(goalWith(half), live, NOW).status, "At risk", "71% used, 25% landed");
  const most = [task({ landedAt: at(11, 22) }), task({ landedAt: at(11, 21) }), task({})];
  assert.equal(goalStatus(goalWith(most), live, NOW).status, "On track");
});

test("roadmap: grouped by project, fractions in range, live agents, empty goals", () => {
  let g = make("Chat", { project: "deck", start: "2026-11-10", days: 18 }).goals;
  g = make("Spaces", { project: "herdr", start: "2026-11-13" }, g).goals;
  g = make("Empty", { project: "deck" }, g).goals;
  const d1 = card({ id: "D-1", stage: "holding" });
  const d2 = card({ id: "D-2", stage: "landed", landedAt: at(11, 18) });
  g = linkCard(g, "G-1", d1, NOW).goals;
  g = linkCard(g, "G-1", d2, NOW).goals;
  g = syncGoals(g, [d1, d2], NOW);
  const m = roadmap(g, [d1, d2], NOW);
  assert.equal(m.from, parseDay("2026-11-09"), "Monday on or before the earliest start");
  assert.ok(m.days >= 28);
  assert.deepEqual(m.groups.map((x) => [x.project, x.rows.map((r) => r.id)]), [["deck", ["G-1", "G-3"]], ["herdr", ["G-2"]]]);
  const r1 = m.groups[0].rows[0];
  assert.equal(r1.done, 1);
  assert.equal(r1.total, 2);
  assert.equal(r1.landed.length, 1);
  assert.deepEqual(r1.agents.map((a) => [a.id, a.hold]), [["D-1", true]]);
  for (const r of m.groups.flatMap((x) => x.rows)) {
    for (const f of [r.startFrac, r.endFrac, r.usedFrac, ...r.landed]) assert.ok(f >= 0 && f <= 1, r.id + " " + f);
  }
  const empty = m.groups[0].rows[1];
  assert.equal(empty.total, 0);
  assert.equal(empty.status, "Shaping");
});

test("roadmap: goals that ended over two weeks ago are hidden and don't stretch the window", () => {
  let g = make("Old", { start: "2025-11-03", days: 10 }).goals;
  g = make("Now", { start: "2026-11-16" }, g).goals;
  const m = roadmap(g, [], NOW);
  assert.deepEqual(m.groups.flatMap((x) => x.rows.map((r) => r.id)), ["G-2"]);
  assert.equal(m.hidden, 1);
  assert.equal(m.from, parseDay("2026-11-16"));
  assert.ok(m.days <= 91);
  const far = make("Far", { start: "2027-06-01", days: 60 }, g).goals;
  assert.ok(roadmap(far, [], NOW).days <= 91, "window is capped");
});
