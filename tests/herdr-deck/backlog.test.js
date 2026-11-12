import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBacklog, mergeBacklog, branchSlug, startPlan, safeRepo, discardBacklog, restoreBacklog, markStarted,
} from "../../dot_config/herdr-app/mods/deck/lib/backlog.js";
import { emptyStore, reconcile } from "../../dot_config/herdr-app/mods/deck/lib/store.js";
import { boardColumns } from "../../dot_config/herdr-app/mods/deck/lib/board.js";
import { STAGE_LABEL } from "../../dot_config/herdr-app/mods/deck/lib/stage.js";

const DAY = 86400000;
const ent = (id, o = {}) => ({ id, title: "Fix login", brief: "Do it", repo: "/r/taskflow", source: "agent", from: null, createdAt: 5, ...o });
const line = (e) => JSON.stringify(e);
const backlog = (s) => s.issues.filter((i) => i.kind === "backlog");

test("parseBacklog skips bad lines", () => {
  const text = [line(ent("a1")), "not json", "", line({ id: "x" }), "[1]", line(ent("a2", { from: "t3" })), '{"id":"a3","title":"cut off'].join("\n");
  const out = parseBacklog(text);
  assert.deepEqual(out.map((e) => e.id), ["a1", "a2"]);
  assert.equal(out[1].from, "t3");
  assert.deepEqual(parseBacklog(""), []);
  assert.deepEqual(parseBacklog(null), []);
});

test("parseBacklog counts a duplicate id once", () => {
  assert.equal(parseBacklog([line(ent("a1")), line(ent("a1", { title: "other" }))].join("\n")).length, 1);
});

test("merge is idempotent and assigns B-n ids", () => {
  const es = [ent("a1"), ent("a2", { title: "Two" })];
  let s = mergeBacklog(emptyStore(), es, 10);
  assert.deepEqual(backlog(s).map((i) => i.id), ["B-1", "B-2"]);
  const again = mergeBacklog(s, es, 20);
  assert.deepEqual(backlog(again).map((i) => i.id), ["B-1", "B-2"]);
  s = mergeBacklog(again, [...es, ent("a3")], 30);
  assert.deepEqual(backlog(s).map((i) => i.id), ["B-1", "B-2", "B-3"]);
  const b = backlog(s)[0];
  assert.equal(b.stage, "backlog");
  assert.equal(b.title, "Fix login");
  assert.equal(b.root, "/r/taskflow");
  assert.equal(b.repo, "taskflow");
  assert.equal(b.source, "agent");
});

test("tombstones stick", () => {
  const es = [ent("a1"), ent("a2")];
  let s = mergeBacklog(emptyStore(), es, 10);
  s = markStarted(s, "B-1", 11);
  s = discardBacklog(s, "B-2", 12);
  assert.deepEqual(backlog(s).map((i) => [i.id, i.discarded]), [["B-2", true]]);
  s = mergeBacklog(s, es, 13);
  assert.deepEqual(backlog(s).map((i) => i.id), ["B-2"]);
  // a discarded entry expires after 7 days and still does not come back
  s = mergeBacklog(s, es, 12 + 7 * DAY + 1);
  assert.deepEqual(backlog(s), []);
  s = mergeBacklog(s, es, 12 + 8 * DAY);
  assert.deepEqual(backlog(s), []);
  // ids are never reused
  s = mergeBacklog(s, [ent("a9")], 12 + 9 * DAY);
  assert.deepEqual(backlog(s).map((i) => i.id), ["B-3"]);
});

test("discard then restore", () => {
  let s = mergeBacklog(emptyStore(), [ent("a1")], 10);
  s = discardBacklog(s, "B-1", 11);
  assert.equal(backlog(s)[0].discarded, true);
  s = restoreBacklog(s, "B-1");
  assert.equal(backlog(s)[0].discarded, false);
  s = mergeBacklog(s, [ent("a1")], 12);
  assert.equal(backlog(s).length, 1);
  assert.equal(discardBacklog(s, "nope", 1), s);
});

test("reconcile leaves backlog entries alone", () => {
  let s = mergeBacklog(emptyStore(), [ent("a1")], 10);
  s = discardBacklog(s, "B-2", 10);
  s = markStarted(mergeBacklog(s, [ent("a1"), ent("a2")], 10), "B-2", 10);
  const before = backlog(s);
  s = reconcile(s, [], 10 + 30 * DAY);
  assert.deepEqual(backlog(s), before);
  assert.equal(s.backlogTombs && Object.keys(s.backlogTombs).length, 1);
  const r = reconcile(s, [{
    terminal: "t1", status: "working", title: "t", cwd: "/x", repo: "taskflow", root: "/r/taskflow", branch: "b",
    commitsAhead: 0, pr: null, ghError: null, claims: [], prompt: null, brief: null, replied: false,
  }], 10 + 30 * DAY + 1);
  assert.deepEqual(r.issues.filter((i) => i.kind !== "backlog").map((i) => i.id), ["TF-1"]);
});

test("slug fallback", () => {
  assert.equal(branchSlug("Fix the Login bug!", "b-1"), "fix-the-login-bug");
  assert.equal(branchSlug("  ---  ", "b-7"), "task-b-7");
  assert.equal(branchSlug("🔥🔥", "B-7"), "task-b-7");
  assert.equal(branchSlug("a".repeat(80), "b-1").length, 40);
  assert.equal(branchSlug("x".repeat(39) + " tail", "b-1"), "x".repeat(39));
  assert.match(branchSlug("Ünïcode $(rm -rf) `x`\nnew", "b-1"), /^[a-z0-9-]+$/);
});

const entry = { id: "B-4", title: "Fix login", brief: "Make login work.", root: "/r/taskflow" };
const existsOf = (set) => (p) => set.has(p);

test("startPlan builds the worktree plan", () => {
  const p = startPlan(entry, "/Users/m", existsOf(new Set(["/r/taskflow", "/r/taskflow/.git"])));
  assert.equal(p.branch, "fix-login");
  assert.equal(p.path, "/Users/m/.herdr/worktrees/taskflow/fix-login");
  assert.deepEqual(p.argv, ["git", "-C", "/r/taskflow", "worktree", "add", "-b", "fix-login", p.path, "HEAD"]);
  assert.equal(p.task, "Make login work.\n\nWhen you finish, use the herdr-proof skill.");
});

test("startPlan appends -2, -3 on a collision", () => {
  const base = ["/r/taskflow", "/r/taskflow/.git"];
  let p = startPlan(entry, "/h", existsOf(new Set([...base, "fix-login"])));
  assert.equal(p.branch, "fix-login-2");
  p = startPlan(entry, "/h", existsOf(new Set([...base, "fix-login", "/h/.herdr/worktrees/taskflow/fix-login-2"])));
  assert.equal(p.branch, "fix-login-3");
  assert.equal(p.path, "/h/.herdr/worktrees/taskflow/fix-login-3");
});

test("startPlan reports a missing or non-git repo", () => {
  const gone = startPlan(entry, "/h", () => false);
  assert.match(gone.error, /\/r\/taskflow/);
  assert.equal(gone.argv, undefined);
  const notGit = startPlan(entry, "/h", existsOf(new Set(["/r/taskflow"])));
  assert.match(notGit.error, /git/i);
});

test("columns start with Backlog", () => {
  assert.equal(STAGE_LABEL.backlog, "Backlog");
  const s = mergeBacklog(emptyStore(), [ent("a1"), ent("a2")], 10);
  const d = discardBacklog(s, "B-2", 11);
  const cols = boardColumns([...d.issues, { key: "t|b", stage: "build", dismissed: false, lastSeen: 1, holdingSince: null }]);
  assert.deepEqual(cols.map((c) => c.stage), ["backlog", "holding", "survey", "build", "verify", "landed"]);
  assert.equal(cols[0].label, "Backlog");
  assert.deepEqual(cols[0].items.map((i) => i.id), ["B-1"]);
  assert.equal(cols[3].items.length, 1);
});

test(".. in repo is rejected", () => {
  for (const repo of ["/x/proj/..", "/x/./proj", "/x/../y", "rel/proj", "/", "/x//y", "/x/proj/."]) {
    assert.equal(safeRepo(repo), false, repo);
    assert.deepEqual(parseBacklog(line(ent("a", { repo }))), [], repo);
    assert.match(startPlan({ id: "a", title: "bin", brief: "b", root: repo }, "/h", () => true).error, /^Bad repo path/);
  }
  assert.equal(safeRepo("/x/proj/"), true);
  assert.equal(parseBacklog(line(ent("a"))).length, 1);
});

test("path stays inside worktrees", () => {
  const p = startPlan({ id: "a", title: "../../bin", brief: "b", root: "/x/proj" }, "/h", () => false);
  assert.match(p.error, /Repo not found/);
  const q = startPlan({ id: "a", title: "../../bin", brief: "b", root: "/x/proj" }, "/h", (n) => n === "/x/proj" || n === "/x/proj/.git");
  assert.equal(q.path, "/h/.herdr/worktrees/proj/bin");
  assert.ok(q.path.startsWith("/h/.herdr/worktrees/proj/"));
  assert.ok(!q.path.includes(".."));
});

test("tomb cap keeps old ids from coming back", () => {
  const tombs = {};
  for (let i = 0; i < 20000; i++) tombs["t" + i] = { state: "started", at: 1000 + i };
  const s = { ...emptyStore(), backlogTombs: tombs };
  const out = mergeBacklog(s, [ent("old", { createdAt: 500 }), ent("t5"), ent("fresh", { createdAt: 5000 })], 9000);
  assert.deepEqual(backlog(out).map((i) => i.entryId), ["fresh"]);
  // below the cap an old entry is still accepted
  const small = mergeBacklog({ ...emptyStore(), backlogTombs: { x: { state: "started", at: 1000 } } }, [ent("old", { createdAt: 500 })], 9000);
  assert.equal(backlog(small).length, 1);
});
