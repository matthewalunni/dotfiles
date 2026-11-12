import test from "node:test";
import assert from "node:assert/strict";
import {
  repoChoices, defaultRepo, newTaskArgs, dialogKeyNewTask, submitTask, findFiled, REQUIRED,
} from "../../dot_config/herdr-app/mods/deck/lib/newtask.js";
import { keyAction } from "../../dot_config/herdr-app/mods/deck/lib/keys.js";
import { boardNote } from "../../dot_config/herdr-app/mods/deck/lib/board.js";

const kk = (key, o = {}) => ({ key, shift: false, cmd: false, held: false, ...o });
const ctx = (o = {}) => ({ view: "issues", mode: "list", tab: "overview", typing: false, optionCount: 3, hasIssue: true, backlog: false, ...o });

// ------------------------------------------------------------ repo chips

const iss = (key, root, o = {}) => ({ key, root, repo: root ? root.split("/").pop() : null, ...o });

test("repoChoices: distinct roots of live issues and backlog entries, in order", () => {
  const issues = [
    iss("a", "/u/p/taskflow"),
    iss("b", "/u/p/repvault"),
    iss("c", "/u/p/taskflow"),
    iss("d", null),
    iss("e", "/u/p/readflow", { kind: "backlog" }),
    iss("f", "/u/p/gone", { dismissed: true }),
    iss("g", "/u/p/tossed", { kind: "backlog", discarded: true }),
    iss("h", "relative/path"),
  ];
  assert.deepEqual(repoChoices(issues), [
    { root: "/u/p/taskflow", name: "taskflow" },
    { root: "/u/p/repvault", name: "repvault" },
    { root: "/u/p/readflow", name: "readflow" },
  ]);
  assert.deepEqual(repoChoices(null), []);
});

test("repoChoices: a worktree folds into its repo", () => {
  const issues = [
    iss("a", "/u/.herdr/worktrees/taskflow/fix-thing"),
    iss("b", "/u/p/taskflow"),
    iss("c", "/u/p/readflow/.claude/worktrees/side"),
    iss("d", "/u/.herdr/worktrees/promptr/x"),
  ];
  assert.deepEqual(repoChoices(issues), [
    { root: "/u/p/taskflow", name: "taskflow" },
    { root: "/u/p/readflow", name: "readflow" },
    { root: "/u/.herdr/worktrees/promptr/x", name: "promptr" },
  ]);
});

test("defaultRepo: the selected issue's repo, else the first chip, else null", () => {
  const issues = [iss("a", "/u/p/taskflow"), iss("b", "/u/p/repvault"), iss("c", null)];
  assert.equal(defaultRepo(issues, "b"), "/u/p/repvault");
  assert.equal(defaultRepo(issues, "c"), "/u/p/taskflow");
  assert.equal(defaultRepo(issues, "nope"), "/u/p/taskflow");
  assert.equal(defaultRepo(issues, null), "/u/p/taskflow");
  assert.equal(defaultRepo([iss("w", "/u/p/readflow/.claude/worktrees/side")], "w"), "/u/p/readflow");
  assert.equal(defaultRepo([], null), null);
});

// ------------------------------------------------------------ argv

test("newTaskArgs: argv only, text verbatim", () => {
  const title = `a "q" 'x' $(touch /tmp/p) \`id\`\nline2`;
  const brief = "b1\nb2 ; rm -rf /";
  assert.deepEqual(newTaskArgs({ title, brief, root: "/u/p/taskflow" }),
    ["--title", title, "--brief", brief, "--repo", "/u/p/taskflow", "--source", "you"]);
});

test("newTaskArgs: empty title or brief is the required error", () => {
  for (const f of [
    { title: "", brief: "b", root: "/r" }, { title: "  \n ", brief: "b", root: "/r" },
    { title: "t", brief: "", root: "/r" }, { title: "t", brief: " \n", root: "/r" }, {},
  ]) assert.deepEqual(newTaskArgs(f), { error: REQUIRED });
  assert.equal(REQUIRED, "Title and brief are required");
  assert.deepEqual(newTaskArgs({ title: "t", brief: "b", root: "" }), { error: "Choose a repo" });
  assert.deepEqual(newTaskArgs({ title: "t", brief: "b", root: "rel" }), { error: "Choose a repo" });
  assert.match(newTaskArgs({ title: "t\0", brief: "b", root: "/r" }).error, /NUL/);
});

// ------------------------------------------------------------ dialog keys

test("dialog keys: letters, digits and shortcut keys only insert text", () => {
  for (const field of ["title", "brief"]) {
    for (const key of ["s", "x", "m", "1", "n", "j", "k", "r", "t", "v", "?", "/", "space", "backspace"]) {
      assert.equal(dialogKeyNewTask(kk(key), field), null, key + " in " + field);
      assert.equal(dialogKeyNewTask(kk(key, { shift: true }), field), null);
      assert.equal(dialogKeyNewTask(kk(key, { held: true }), field), null);
    }
  }
});

test("dialog keys: ⌘↵ submits, esc cancels, tab / shift-tab move, enter", () => {
  for (const field of ["title", "brief", null]) {
    assert.equal(dialogKeyNewTask(kk("enter", { cmd: true }), field), "submit");
    assert.equal(dialogKeyNewTask(kk("escape"), field), "cancel");
    assert.equal(dialogKeyNewTask(kk("tab"), field), "next");
    assert.equal(dialogKeyNewTask(kk("tab", { shift: true }), field), "prev");
  }
  assert.equal(dialogKeyNewTask(kk("enter"), "title"), "next");
  assert.equal(dialogKeyNewTask(kk("enter"), "brief"), null); // a newline
  assert.equal(dialogKeyNewTask(kk("enter", { shift: true }), "brief"), null);
  assert.equal(dialogKeyNewTask(kk("enter", { cmd: true, held: true }), "brief"), null); // a held key never submits
});

// ------------------------------------------------------------ filing

function fakeIo(result) {
  const calls = { run: [], reread: 0, select: [] };
  return {
    calls,
    io: {
      run: async (argv) => {
        calls.run.push(argv);
        if (result instanceof Error) throw result;
        return result;
      },
      reread: async () => {
        calls.reread++;
        return [{ id: "old", title: "T", brief: "B", source: "you", createdAt: 1 }, { id: "abc", title: "T", brief: "B", source: "you", createdAt: 100 }];
      },
      select: (id) => calls.select.push(id),
    },
  };
}
const form = (o = {}) => ({ title: "T", brief: "B", root: "/u/p/taskflow", error: null, busy: false, ...o });

test("submitTask: empty title or brief shows the required error and runs nothing", async () => {
  for (const f of [form({ title: "" }), form({ brief: "  " })]) {
    const { io, calls } = fakeIo({ code: 0, stdout: "", stderr: "" });
    const next = await submitTask(f, io, 50);
    assert.equal(next.error, "Title and brief are required");
    assert.equal(next.done, false);
    assert.equal(next.title, f.title); assert.equal(next.brief, f.brief);
    assert.equal(calls.run.length, 0); assert.equal(calls.reread, 0); assert.equal(calls.select.length, 0);
  }
});

test("submitTask: a script error (not a git repo) shows and keeps the text", async () => {
  const { io, calls } = fakeIo({ code: 1, stdout: "", stderr: "herdr-backlog: not a git repo: /Users/m/Desktop (use --repo PATH)\n" });
  const f = form({ title: "Keep me", brief: "And me", root: "/Users/m/Desktop" });
  const next = await submitTask(f, io, 50);
  assert.equal(next.done, false);
  assert.equal(next.busy, false);
  assert.equal(next.error, "not a git repo: /Users/m/Desktop (use --repo PATH)");
  assert.equal(next.title, "Keep me"); assert.equal(next.brief, "And me"); assert.equal(next.root, "/Users/m/Desktop");
  assert.deepEqual(calls.run, [["--title", "Keep me", "--brief", "And me", "--repo", "/Users/m/Desktop", "--source", "you"]]);
  assert.equal(calls.reread, 0); assert.equal(calls.select.length, 0);
});

test("submitTask: a runner that throws (timeout) is an error, text kept", async () => {
  const { io } = fakeIo(new Error("timed out"));
  const next = await submitTask(form(), io, 50);
  assert.equal(next.done, false);
  assert.match(next.error, /timed out/);
  assert.equal(next.title, "T");
});

test("submitTask: success re-reads the inbox at once and selects the new card", async () => {
  const { io, calls } = fakeIo({ code: 0, stdout: "Filed B-? T\n", stderr: "" });
  const next = await submitTask(form(), io, 50);
  assert.equal(next.done, true);
  assert.equal(next.error, null);
  assert.equal(calls.reread, 1);
  assert.deepEqual(calls.select, ["abc"]);
});

test("findFiled: the newest matching 'you' entry filed since the press", () => {
  const es = [
    { id: "a", title: "T", brief: "B", source: "you", createdAt: 10 },
    { id: "b", title: "T", brief: "B", source: "agent", createdAt: 60 },
    { id: "c", title: "T", brief: "B", source: "you", createdAt: 70 },
    { id: "d", title: "T", brief: "other", source: "you", createdAt: 80 },
  ];
  assert.equal(findFiled(es, { title: " T ", brief: "B" }, 50)?.id, "c");
  assert.equal(findFiled(es, { title: "T", brief: "B" }, 90), null);
});

// ------------------------------------------------------------ N

test("N opens a new task in Command and Issues (list and board)", () => {
  for (const c of [ctx(), ctx({ mode: "board" }), ctx({ view: "command" }), ctx({ hasIssue: false }), ctx({ backlog: true })]) {
    assert.deepEqual(keyAction(kk("n"), c), { type: "newTask" });
    assert.deepEqual(keyAction(kk("N", { shift: true }), c), { type: "newTask" });
  }
});

test("N does nothing while typing, with a dialog open, held, or on the issue page / PR tab", () => {
  assert.equal(keyAction(kk("n"), ctx({ typing: true })), null);
  assert.equal(keyAction(kk("n"), ctx({ dialog: true })), null);
  assert.equal(keyAction(kk("n"), ctx({ view: "command", dialog: true })), null);
  assert.equal(keyAction(kk("n", { held: true }), ctx()), null);
  assert.equal(keyAction(kk("n", { cmd: true }), ctx()), null);
  assert.equal(keyAction(kk("n"), ctx({ view: "issue" })), null);
  assert.deepEqual(keyAction(kk("n"), ctx({ tab: "changes" })), { type: "file", d: 1 }); // n is next file there
});

// ------------------------------------------------------------ card text

test("a card filed by you says 'you'", () => {
  const e = { kind: "backlog", key: "backlog|x", id: "B-1", source: "you", from: null };
  assert.deepEqual(boardNote(e, []), { text: "you", tone: "muted" });
  // Even with a filer terminal recorded, it is yours.
  const by = { key: "t1|main", id: "TY-3", terminal: "t1" };
  assert.deepEqual(boardNote({ ...e, from: "t1" }, [by]), { text: "you", tone: "muted" });
  assert.deepEqual(boardNote({ ...e, source: "agent", from: "t1" }, [by]), { text: "from TY-3 · agent", tone: "muted" });
});
