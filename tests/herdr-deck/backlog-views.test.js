import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeBacklog, setPendingWorktree, discardBacklog, resolvePlan, runStart, inboxTail, previewPlan, backlogFiler,
} from "../../dot_config/herdr-app/mods/deck/lib/backlog.js";
import { emptyStore, dismiss, markReplied, updatePr, markReviewed } from "../../dot_config/herdr-app/mods/deck/lib/store.js";
import { groupIssues, matchesView, repoTelemetry, liveIssues, LIST_ORDER } from "../../dot_config/herdr-app/mods/deck/lib/present.js";
import { boardNote } from "../../dot_config/herdr-app/mods/deck/lib/board.js";
import { keyAction } from "../../dot_config/herdr-app/mods/deck/lib/keys.js";
import { dialogKey, mergeDialogAllowed } from "../../dot_config/herdr-app/mods/deck/lib/dialogkeys.js";

const ent = (id, o = {}) => ({ id, title: "Paywall A/B copy", brief: "Write two variants.", repo: "/r/promptr", source: "agent", from: null, createdAt: 5, ...o });
const withBacklog = (...entries) => mergeBacklog(emptyStore(), entries, 10);
const live = (o = {}) => ({ key: "t1|main", id: "PR-7", kind: undefined, terminal: "t1", stage: "survey", repo: "promptr", title: "Paywall copy test", observed: true, ...o });
const kk = (key, o = {}) => ({ key, shift: false, cmd: false, held: false, ...o });
const ctx = (o = {}) => ({ view: "issues", mode: "list", tab: "overview", typing: false, optionCount: 0, hasIssue: true, backlog: false, ...o });

// ------------------------------------------------------------ store guards

test("store mutators are no-ops on a backlog entry", () => {
  const s = withBacklog(ent("a"));
  const key = s.issues[0].key;
  assert.equal(dismiss(s, key, 20), s);
  assert.equal(markReplied(s, key, 20), s);
  assert.equal(updatePr(s, key, { pr: { number: 1, state: "OPEN", checks: [] }, ghError: null, claims: [] }, 20), s);
  assert.equal(markReviewed(s, key, "a".repeat(40)), s);
  // also by display id path: nothing matches a key that is not there
  assert.equal(s.issues[0].stage, "backlog");
});

// ------------------------------------------------------------ present

test("Backlog group first; discarded only under the Discarded filter", () => {
  assert.equal(LIST_ORDER[0], "backlog");
  let s = withBacklog(ent("a"), ent("b", { title: "Other" }));
  s = discardBacklog(s, "B-2", 20);
  const issues = [...s.issues, live()];
  assert.deepEqual(groupIssues(issues, null).map((g) => [g.stage, g.items.map((i) => i.id)]), [["backlog", ["B-1"]], ["survey", ["PR-7"]]]);
  const disc = { kind: "view", value: "discarded" };
  assert.deepEqual(groupIssues(issues, disc).flatMap((g) => g.items.map((i) => i.id)), ["B-2"]);
  assert.equal(matchesView(s.issues[1], { kind: "repo", value: "promptr" }), false);
  assert.equal(matchesView(s.issues[0], { kind: "repo", value: "promptr" }), true);
  assert.equal(matchesView(live(), disc), false);
});

test("telemetry and the in-flight list ignore backlog entries", () => {
  const s = withBacklog(ent("a", { repo: "/r/onlybacklog" }));
  const issues = [...s.issues, live()];
  assert.deepEqual(repoTelemetry(issues).map((r) => r.repo), ["promptr"]);
  assert.deepEqual(liveIssues(issues).map((i) => i.id), ["PR-7"]);
  assert.deepEqual(liveIssues(s.issues), []);
});

test("board card note: from the filer's issue when known, else the source", () => {
  const s = withBacklog(ent("a", { from: "t1" }), ent("b", { from: "t9" }));
  const filer = live();
  assert.deepEqual(boardNote(s.issues[0], [filer, ...s.issues]), { text: "from PR-7 · agent", tone: "muted" });
  assert.deepEqual(boardNote(s.issues[1], [filer, ...s.issues]), { text: "agent", tone: "muted" });
  assert.equal(backlogFiler(s.issues[0], [filer]), filer);
  assert.equal(backlogFiler(s.issues[1], [filer]), null);
});

// ------------------------------------------------------------ keys

test("X only on backlog", () => {
  assert.deepEqual(keyAction(kk("x"), ctx({ backlog: true })), { type: "discard" });
  assert.equal(keyAction(kk("x"), ctx()), null);
  assert.equal(keyAction(kk("x"), ctx({ view: "issue" })), null);
  assert.deepEqual(keyAction(kk("x"), ctx({ view: "issue", backlog: true })), { type: "discard" });
  assert.equal(keyAction(kk("x", { held: true }), ctx({ backlog: true })), null);
  assert.equal(keyAction(kk("x"), ctx({ backlog: true, typing: true })), null);
});

test("S only on backlog, never held; agent keys are off on a backlog entry", () => {
  assert.deepEqual(keyAction(kk("s"), ctx({ backlog: true })), { type: "start" });
  assert.deepEqual(keyAction(kk("S", { shift: true }), ctx({ backlog: true, mode: "board" })), { type: "start" });
  assert.equal(keyAction(kk("s"), ctx()), null);
  assert.equal(keyAction(kk("s", { held: true }), ctx({ backlog: true })), null);
  assert.equal(keyAction(kk("s", { cmd: true }), ctx({ backlog: true })), null);
  for (const key of ["r", "t", "p", "o", "m"]) assert.equal(keyAction(kk(key), ctx({ backlog: true })), null, key);
  assert.equal(keyAction(kk("m", { shift: true }), ctx({ backlog: true })), null);
  // navigation still works
  assert.deepEqual(keyAction(kk("j"), ctx({ backlog: true })), { type: "move", dy: 1 });
});

test("S then S starts, Enter does nothing", () => {
  const d = { kind: "start" };
  assert.equal(dialogKey(kk("s"), d), "confirm");
  assert.equal(dialogKey(kk("S", { shift: true }), d), "confirm");
  assert.equal(dialogKey(kk("enter"), d), null);
  assert.equal(dialogKey(kk("escape"), d), "cancel");
  assert.equal(dialogKey(kk("s", { held: true }), d), null);
  assert.equal(dialogKey(kk("s", { cmd: true }), d), null);
  for (const key of ["m", "y", "x", "space", "1"]) assert.equal(dialogKey(kk(key), d), null);
});

test("merge dialogs never open for a backlog entry", () => {
  const s = withBacklog(ent("a"));
  assert.equal(mergeDialogAllowed(s.issues[0]), false);
  assert.equal(mergeDialogAllowed({ ...s.issues[0], pr: { number: 1 } }), false);
  assert.equal(mergeDialogAllowed(live({ pr: { number: 3 } })), true);
  assert.equal(mergeDialogAllowed(live()), false);
  assert.equal(mergeDialogAllowed(null), false);
});

// ------------------------------------------------------------ start flow (fake runner)

/** A fake runner: `have` is the set of names exists() says yes to; calls are recorded in order. */
function fake({ have = ["/r/promptr", "/r/promptr/.git"], git = { code: 0, stdout: "", stderr: "" }, spaceThrows = null, existsThrows = null, top = undefined, appeared = true } = {}) {
  const calls = [];
  const io = {
    toplevel: async (repo) => (top === undefined ? repo : top),
    appeared: async (folder) => {
      calls.push(["appeared", folder]);
      return appeared;
    },
    exists: async (name) => {
      calls.push(["exists", name]);
      if (existsThrows && name === existsThrows) throw new Error("timed out");
      return have.includes(name);
    },
    git: async (argv) => {
      calls.push(["git", argv]);
      return git;
    },
    spaceNew: async (args) => {
      calls.push(["space.new", args]);
      if (spaceThrows) throw new Error(spaceThrows);
    },
    done: (plan) => calls.push(["done", plan.branch]),
  };
  return { io, calls, did: (what) => calls.filter((c) => c[0] === what) };
}

test("start: worktree, then space.new with claude and the task, then marked", async () => {
  const s = withBacklog(ent("a"));
  const f = fake({ have: ["/r/promptr", "/r/promptr/.git", "paywall-a-b-copy"] });
  const r = await runStart(s.issues[0], "/home/m", f.io);
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  const order = f.calls.filter((c) => c[0] !== "exists" && c[0] !== "appeared").map((c) => c[0]);
  assert.deepEqual(order, ["git", "space.new", "done"]);
  assert.deepEqual(f.did("git")[0][1], ["git", "-C", "/r/promptr", "worktree", "add", "-b", "paywall-a-b-copy-2", "/home/m/.herdr/worktrees/promptr/paywall-a-b-copy-2", "HEAD"]);
  assert.deepEqual(f.did("space.new")[0][1], {
    folder: "/home/m/.herdr/worktrees/promptr/paywall-a-b-copy-2", argv: ["claude"],
    task: "Write two variants.\n\nWhen you finish, use the herdr-proof skill.",
  });
  // the branch is asked about as a bare name, the path as an absolute path
  assert.ok(f.did("exists").some((c) => c[1] === "paywall-a-b-copy"));
  assert.ok(f.did("exists").some((c) => c[1] === "/home/m/.herdr/worktrees/promptr/paywall-a-b-copy-2"));
});

test("start: missing repo or not a git repo shows the error; space.new is not called", async () => {
  const s = withBacklog(ent("a"));
  for (const have of [[], ["/r/promptr"]]) {
    const f = fake({ have });
    const r = await runStart(s.issues[0], "/home/m", f.io);
    assert.equal(r.ok, false);
    assert.match(r.error, have.length ? /^Not a git repo: \/r\/promptr/ : /^Repo not found: \/r\/promptr/);
    assert.deepEqual(f.did("git"), []);
    assert.deepEqual(f.did("space.new"), []);
    assert.deepEqual(f.did("done"), []);
  }
});

test("start: git failure or space.new failure is returned and nothing is marked", async () => {
  const s = withBacklog(ent("a"));
  const g = fake({ git: { code: 128, stdout: "", stderr: "fatal: invalid reference: HEAD\n" } });
  const r1 = await runStart(s.issues[0], "/home/m", g.io);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /invalid reference: HEAD$/);
  assert.deepEqual(g.did("space.new"), []);
  assert.deepEqual(g.did("done"), []);

  const sp = fake({ spaceThrows: "no layout" });
  const r2 = await runStart(s.issues[0], "/home/m", sp.io);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /no layout/);
  assert.deepEqual(sp.did("done"), []);

  const ex = fake({ existsThrows: "/r/promptr/.git" });
  const r3 = await runStart(s.issues[0], "/home/m", ex.io);
  assert.equal(r3.ok, false);
  assert.match(r3.error, /timed out/);
  assert.deepEqual(ex.did("git"), []);
});

test("start: only a live backlog entry starts", async () => {
  let s = withBacklog(ent("a"));
  s = discardBacklog(s, "B-1", 20);
  const f = fake();
  assert.equal((await runStart(s.issues[0], "/home/m", f.io)).ok, false);
  assert.equal((await runStart(live(), "/home/m", f.io)).ok, false);
  assert.deepEqual(f.calls, []);
});

test("resolvePlan asks each name once and matches startPlan", async () => {
  const asked = [];
  const p = await resolvePlan({ id: "a", title: "Fix", brief: "b", root: "/r/x" }, "/h", async (n) => {
    asked.push(n);
    return ["/r/x", "/r/x/.git", "fix", "/h/.herdr/worktrees/x/fix-2"].includes(n);
  });
  assert.equal(p.branch, "fix-3");
  assert.equal(new Set(asked).size, asked.length);
});

test("previewPlan shows the first-choice branch and path", () => {
  const s = withBacklog(ent("a"));
  const p = previewPlan(s.issues[0], "/home/m");
  assert.equal(p.branch, "paywall-a-b-copy");
  assert.equal(p.path, "/home/m/.herdr/worktrees/promptr/paywall-a-b-copy");
});

// ------------------------------------------------------------ inbox tail

test("inboxTail keeps a short read whole and drops a cut-off first line", () => {
  const a = JSON.stringify(ent("a"));
  const b = JSON.stringify(ent("b"));
  assert.equal(inboxTail(a + "\n" + b + "\n", 1024), a + "\n" + b + "\n");
  const full = "x\"cut" + "\n" + b + "\n";
  assert.equal(inboxTail(full, Buffer.byteLength(full)), b + "\n");
  assert.equal(inboxTail("no newline at all", 10), "");
  assert.equal(inboxTail("", 10), "");
  // bytes, not characters: multi-byte characters count by their bytes
  const wide = "é".repeat(4) + "\n" + b;
  assert.equal(inboxTail(wide, Buffer.byteLength(wide)), b);
});

test("start: a toplevel that differs from the repo stops before git", async () => {
  const s = withBacklog(ent("a"));
  for (const top of ["/r", null]) {
    const f = fake({ top });
    const r = await runStart(s.issues[0], "/home/m", f.io);
    assert.equal(r.ok, false);
    assert.equal(r.error, "Not a repo's main folder: /r/promptr");
    assert.deepEqual(f.did("git"), []);
    assert.deepEqual(f.did("space.new"), []);
  }
});

test("start: no space appearing means no tombstone and a clear error", async () => {
  const f = fake({ appeared: false });
  const r = await runStart(withBacklog(ent("a")).issues[0], "/home/m", f.io);
  assert.equal(r.ok, false);
  assert.equal(r.error, "Worktree created at /home/m/.herdr/worktrees/promptr/paywall-a-b-copy, but the agent didn't start — open it from Herdr or press S again");
  assert.deepEqual(f.did("done"), []);
});

test("retry reuses only the worktree this entry left (pendingWorktree)", async () => {
  const wt = "/home/m/.herdr/worktrees/promptr/paywall-a-b-copy";
  const have = ["/r/promptr", "/r/promptr/.git", "paywall-a-b-copy", wt];
  const mine = { ...withBacklog(ent("a")).issues[0], pendingWorktree: { path: wt, branch: "paywall-a-b-copy" } };
  const f = fake({ have });
  const r = await runStart(mine, "/home/m", f.io);
  assert.equal(r.ok, true);
  assert.equal(r.plan.path, wt);
  assert.equal(r.plan.reuse, true);
  assert.deepEqual(f.did("git"), []);
  // a different entry with the same slug gets -2
  const g = fake({ have });
  const other = await runStart(withBacklog(ent("b")).issues[0], "/home/m", g.io);
  assert.equal(other.plan.branch, "paywall-a-b-copy-2");
  assert.equal(other.plan.reuse, false);
  // a failed start records the worktree
  const h = fake({ appeared: false });
  let rec = null;
  h.io.pending = (plan) => { rec = [plan.path, plan.branch]; };
  await runStart(withBacklog(ent("a")).issues[0], "/home/m", h.io);
  assert.deepEqual(rec, [wt, "paywall-a-b-copy"]);
  const st = setPendingWorktree(withBacklog(ent("a")), "B-1", { path: wt, branch: "x" });
  assert.deepEqual(st.issues[0].pendingWorktree, { path: wt, branch: "x" });
});
