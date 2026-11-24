// Review cost ("needs-me" / "unattended") across the script, the inbox, the store, the views' order and the keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asReview, reviewOf, otherReview } from "../../dot_config/herdr-app/mods/deck/lib/review.js";
import { parseBacklog, mergeBacklog, markStarted } from "../../dot_config/herdr-app/mods/deck/lib/backlog.js";
import { emptyStore, reconcile, setReview, noteReviewPath } from "../../dot_config/herdr-app/mods/deck/lib/store.js";
import { groupIssues, matchesView } from "../../dot_config/herdr-app/mods/deck/lib/present.js";
import { boardColumns } from "../../dot_config/herdr-app/mods/deck/lib/board.js";
import { keyAction } from "../../dot_config/herdr-app/mods/deck/lib/keys.js";
import { newTaskArgs, dialogKeyNewTask, startTask } from "../../dot_config/herdr-app/mods/deck/lib/newtask.js";
import { parseOps, planOp } from "../../dot_config/herdr-app/mods/deck/lib/boardops.js";

const SCRIPT = new URL("../../dot_local/bin/executable_herdr-backlog", import.meta.url).pathname;
const BOARD = new URL("../../dot_local/bin/executable_herdr-board", import.meta.url).pathname;

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hr-")));
  const home = join(root, "home"); mkdirSync(home);
  const repo = join(root, "repo"); mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return { home, repo, inbox: join(home, ".local/state/herdr-deck/backlog.jsonl") };
}
const run = (s, args) => spawnSync("node", [SCRIPT, "--title", "T", "--brief", "b", ...args], { cwd: s.repo, encoding: "utf8", env: { PATH: process.env.PATH, HOME: s.home } });

test("asReview / reviewOf: two values, no value reads as needs-me", () => {
  assert.equal(asReview("needs-me"), "needs-me");
  assert.equal(asReview("Needs me"), "needs-me");
  assert.equal(asReview("unattended"), "unattended");
  assert.equal(asReview("Safe unattended"), "unattended");
  for (const bad of ["", null, undefined, "cheap", 1, {}]) assert.equal(asReview(bad), null);
  assert.equal(reviewOf({}), "needs-me");
  assert.equal(reviewOf({ review: "bogus" }), "needs-me");
  assert.equal(reviewOf({ review: "unattended" }), "unattended");
  assert.equal(otherReview({}), "unattended");
  assert.equal(otherReview({ review: "unattended" }), "needs-me");
});

test("herdr-backlog --review: files each kind, refuses anything else, omits it when left out", () => {
  const s = setup();
  let r = run(s, ["--review", "unattended"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "Filed B-? T (review: unattended)\n");
  r = run(s, ["--review", "needs-me"]);
  assert.equal(r.stdout, "Filed B-? T (review: needs-me)\n");
  r = run(s, []);
  assert.equal(r.stdout, "Filed B-? T\n");
  const lines = readFileSync(s.inbox, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((e) => e.review), ["unattended", "needs-me", undefined]);
  assert.deepEqual(parseBacklog(readFileSync(s.inbox, "utf8")).map(reviewOf), ["unattended", "needs-me", "needs-me"]);
  for (const bad of [["--review", "cheap"], ["--review", ""], ["--review"]]) {
    r = run(s, bad);
    assert.equal(r.status, 1, bad.join(" "));
    assert.match(r.stderr, /--review/);
  }
  assert.equal(readFileSync(s.inbox, "utf8").split("\n").filter(Boolean).length, 3);
});

test("the inbox: a bad review value is dropped (the card reads as needs-me); the card carries a good one", () => {
  const line = (o) => JSON.stringify({ id: o.id, title: "t", brief: "b", repo: "/r/p", createdAt: 1, ...o });
  const entries = parseBacklog([line({ id: "a", review: "unattended" }), line({ id: "b", review: "whatever" }), line({ id: "c" })].join("\n"));
  assert.deepEqual(entries.map((e) => e.review), ["unattended", undefined, undefined]);
  const s = mergeBacklog(emptyStore(), entries, 10);
  assert.deepEqual(s.issues.map((i) => [i.id, reviewOf(i)]), [["B-1", "unattended"], ["B-2", "needs-me"], ["B-3", "needs-me"]]);
});

const ob = (o = {}) => ({
  terminal: "t7", status: "working", title: "t", cwd: "/x", repo: "taskflow", root: "/x",
  branch: "fix/x", commitsAhead: 0, pr: null, ghError: null, claims: [], prompt: null, brief: null, replied: false, ...o,
});

test("setReview: any card, logged, kept across polls; same value or a bad one changes nothing", () => {
  let s = reconcile(emptyStore(), [ob()], 1);
  const key = s.issues[0].key;
  assert.equal(setReview(s, key, "needs-me", 2), s); // it already reads as needs-me
  assert.equal(setReview(s, key, "cheap", 2), s);
  assert.equal(setReview(s, "nope", "unattended", 2), s);
  s = setReview(s, key, "unattended", 2);
  assert.equal(s.issues[0].review, "unattended");
  assert.equal(s.log.at(-1).what, "review cost set to unattended by you");
  s = reconcile(s, [ob({ branch: "fix/y" })], 3);
  assert.equal(s.issues[0].review, "unattended");
  s = setReview(s, key, "needs-me", 4, "chat");
  assert.equal(s.issues[0].review, "needs-me");
  assert.equal(s.log.at(-1).what, "review cost set to needs me by chat");
  // a backlog card too
  let b = mergeBacklog(emptyStore(), parseBacklog(JSON.stringify({ id: "a", title: "t", brief: "b", repo: "/r/p", createdAt: 1 })), 5);
  b = setReview(b, "backlog|a", "unattended", 6);
  assert.equal(b.issues[0].review, "unattended");
});

test("a started card keeps its review cost: it waits at the worktree for the agent's card", () => {
  const entry = { id: "a", title: "t", brief: "b", repo: "/r/p", createdAt: 1, review: "unattended" };
  let s = mergeBacklog(emptyStore(), parseBacklog(JSON.stringify(entry)), 5);
  s = markStarted(s, "backlog|a", 6, "/h/.herdr/worktrees/p/t");
  assert.deepEqual(s.reviewPaths, { "/h/.herdr/worktrees/p/t": { review: "unattended", at: 6 } });
  // an agent elsewhere is not it
  s = reconcile(s, [ob({ terminal: "t1" })], 7);
  assert.equal(reviewOf(s.issues[0]), "needs-me");
  assert.ok(s.reviewPaths);
  // the agent in the worktree (even in a sub-folder) takes it, once
  s = reconcile(s, [ob({ terminal: "t1" }), ob({ terminal: "t2", root: null, cwd: "/h/.herdr/worktrees/p/t/src" })], 8);
  assert.equal(s.issues.find((i) => i.terminal === "t2").review, "unattended");
  assert.equal(s.reviewPaths, undefined);
  // needs-me is the default: nothing waits
  const n = noteReviewPath(emptyStore(), "/p", "needs-me", 1);
  assert.equal(n.reviewPaths, undefined);
  assert.equal(noteReviewPath(emptyStore(), "rel", "unattended", 1).reviewPaths, undefined);
  // one that never showed up is forgotten after a day
  const stale = reconcile(noteReviewPath(emptyStore(), "/gone", "unattended", 1), [], 2 * 86400000);
  assert.equal(stale.reviewPaths, undefined);
});

test("Start now passes the form to select (data.js notes its review cost there)", async () => {
  const seen = [];
  const form = { id: "ab", title: "T", brief: "b", root: "/r/p", review: "unattended" };
  const r = await startTask(form, "/h", {
    exists: async (n) => n === "/r/p" || n === "/r/p/.git", toplevel: async () => "/r/p", appeared: async () => true,
    git: async () => ({ code: 0 }), spaceNew: () => {}, select: (plan, f) => seen.push([plan.path, f.review]),
  });
  assert.equal(r.done, true);
  assert.deepEqual(seen, [["/h/.herdr/worktrees/p/t", "unattended"]]);
});

const card = (key, stage, o = {}) => ({ key, id: key, stage, repo: "p", ...o });

test("sorted by review cost: unattended first in each group and column; off by default", () => {
  const issues = [
    card("b1", "backlog", { kind: "backlog" }), card("b2", "backlog", { kind: "backlog", review: "unattended" }),
    card("b3", "backlog", { kind: "backlog", review: "needs-me" }), card("b4", "backlog", { kind: "backlog", review: "unattended" }),
    card("s1", "survey"), card("s2", "survey", { review: "unattended" }),
  ];
  const ids = (gs) => gs.map((g) => g.items.map((i) => i.key));
  assert.deepEqual(ids(groupIssues(issues, null)), [["b1", "b2", "b3", "b4"], ["s1", "s2"]]);
  assert.deepEqual(ids(groupIssues(issues, null, true)), [["b2", "b4", "b1", "b3"], ["s2", "s1"]]);
  const cols = (by) => boardColumns(issues, by).filter((c) => c.items.length).map((c) => c.items.map((i) => i.key));
  assert.deepEqual(cols(true), [["b2", "b4", "b1", "b3"], ["s2", "s1"]]);
  assert.deepEqual(cols(false), cols());
  // project order still comes first on the board (its lanes), review cost first in the list
  const two = [card("a", "backlog", { repo: "zed" , review: "unattended" }), card("b", "backlog", { repo: "abc" })];
  assert.deepEqual(boardColumns(two, true)[0].items.map((i) => i.key), ["b", "a"]);
  assert.deepEqual(groupIssues(two, null, true)[0].items.map((i) => i.key), ["a", "b"]);
});

test("the Safe unattended view: unattended cards not yet landed", () => {
  const f = { kind: "view", value: "unattended" };
  assert.equal(matchesView(card("a", "backlog", { kind: "backlog", review: "unattended" }), f), true);
  assert.equal(matchesView(card("a", "build", { review: "unattended" }), f), true);
  assert.equal(matchesView(card("a", "landed", { review: "unattended" }), f), false);
  assert.equal(matchesView(card("a", "backlog", { kind: "backlog" }), f), false);
  assert.equal(matchesView(card("a", "backlog", { kind: "backlog", review: "unattended", discarded: true }), f), false);
});

test("keys: U flips the selected card's review cost, ⇧U sorts (Issues only); never while typing or held", () => {
  const ctx = (o = {}) => ({ view: "issues", mode: "list", tab: "overview", typing: false, optionCount: 0, hasIssue: true, ...o });
  const u = (o = {}) => ({ key: "u", shift: false, cmd: false, ...o });
  assert.deepEqual(keyAction(u(), ctx()), { type: "review" });
  assert.deepEqual(keyAction(u(), ctx({ backlog: true })), { type: "review" });
  assert.deepEqual(keyAction(u(), ctx({ mode: "board" })), { type: "review" });
  assert.deepEqual(keyAction(u(), ctx({ view: "issue" })), { type: "review" });
  assert.equal(keyAction(u(), ctx({ hasIssue: false })), null);
  assert.equal(keyAction(u(), ctx({ typing: true })), null);
  assert.equal(keyAction(u({ held: true }), ctx()), null);
  assert.equal(keyAction(u({ cmd: true }), ctx()), null);
  assert.deepEqual(keyAction(u({ shift: true }), ctx()), { type: "reviewSort" });
  assert.deepEqual(keyAction(u({ shift: true }), ctx({ hasIssue: false, mode: "board" })), { type: "reviewSort" });
  assert.equal(keyAction(u({ shift: true }), ctx({ view: "issue" })), null);
  assert.equal(keyAction(u({ shift: true }), ctx({ view: "chat" })), null);
  assert.equal(keyAction(u({ shift: true, held: true }), ctx()), null);
});

test("New task dialog: Space on Safe unattended toggles it; the script gets --review only for unattended", () => {
  const sp = (o = {}) => ({ key: "space", shift: false, cmd: false, ...o });
  assert.equal(dialogKeyNewTask(sp(), "review"), "review");
  assert.equal(dialogKeyNewTask(sp({ held: true }), "review"), null);
  assert.equal(dialogKeyNewTask(sp(), "brief"), null);
  assert.equal(dialogKeyNewTask({ key: "tab", shift: false, cmd: false }, "review"), "next");
  const base = ["--title", "t", "--brief", "b", "--repo", "/r", "--source", "you"];
  assert.deepEqual(newTaskArgs({ title: "t", brief: "b", root: "/r" }), base);
  assert.deepEqual(newTaskArgs({ title: "t", brief: "b", root: "/r", review: null }), base);
  assert.deepEqual(newTaskArgs({ title: "t", brief: "b", root: "/r", review: "unattended" }), [...base, "--review", "unattended"]);
});

test("herdr-board review: the request is queued and planned for any live card", () => {
  const s = setup();
  const env = { PATH: process.env.PATH, HOME: s.home, HC_TERMINAL_ID: "chat", HERDR_BOARD_WAIT_MS: "1" };
  const r = spawnSync("node", [BOARD, "review", "B-1", "unattended"], { encoding: "utf8", env });
  assert.equal(r.status, 2, r.stderr); // queued; no Deck to answer here
  const [op] = parseOps(readFileSync(join(s.home, ".local/state/herdr-deck/board.jsonl"), "utf8"));
  assert.equal(op.op, "review"); assert.equal(op.review, "unattended");
  const issues = [{ key: "backlog|a", id: "B-1", kind: "backlog" }, { key: "k", id: "TF-1" }, { key: "backlog|d", id: "B-2", kind: "backlog", discarded: true }];
  assert.deepEqual(planOp(op, issues, "chat"), { issue: issues[0], review: "unattended" });
  assert.deepEqual(planOp({ ...op, ref: "TF-1", review: "needs-me" }, issues, "chat"), { issue: issues[1], review: "needs-me" });
  assert.match(planOp({ ...op, ref: "B-2" }, issues, "chat").error, /discarded/);
  assert.match(planOp({ ...op, review: "cheap" }, issues, "chat").error, /needs-me or unattended/);
  assert.match(planOp(op, issues, "other").error, /only the deck chat agent/);
  for (const bad of [["review", "B-1"], ["review", "B-1", "cheap"], ["review", "B-1", "unattended", "x"]]) {
    const b = spawnSync("node", [BOARD, ...bad], { encoding: "utf8", env });
    assert.equal(b.status, 1, bad.join(" "));
    assert.match(b.stderr, /needs-me or unattended/);
  }
  assert.ok(existsSync(s.inbox) === false);
});
