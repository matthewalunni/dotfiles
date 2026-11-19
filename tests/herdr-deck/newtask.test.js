import test from "node:test";
import assert from "node:assert/strict";
import {
  repoChoices, defaultRepo, newTaskArgs, dialogKeyNewTask, submitTask, findFiled, REQUIRED, backlogExec, BACKLOG_SH,
  newTaskSubmit, startTask, oneAtATime, freshId, NO_TERMINAL_BACKLOG,
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

test("backlogExec: a login shell runs the script; the text is only positional args", () => {
  const argv = newTaskArgs({ title: "$(touch /tmp/x)", brief: "b `id` \"q\"", root: "/u/p/taskflow" });
  const ex = backlogExec(argv);
  assert.equal(BACKLOG_SH, 'exec "$HOME/.local/bin/herdr-backlog" "$@"');
  assert.deepEqual(ex, {
    cmd: "/bin/zsh",
    args: ["-lc", BACKLOG_SH, "herdr-backlog", "--title", "$(touch /tmp/x)", "--brief", "b `id` \"q\"", "--repo", "/u/p/taskflow", "--source", "you"],
  });
  assert.equal(ex.args[4], "$(touch /tmp/x)"); // its own element, never in the shell string
  assert.ok(!ex.args[1].includes("touch"));
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

test("dialog keys: ⌘↵ starts, esc cancels, tab / shift-tab move, enter", () => {
  for (const field of ["title", "brief", null]) {
    assert.equal(dialogKeyNewTask(kk("enter", { cmd: true }), field), "start");
    assert.equal(dialogKeyNewTask(kk("enter", { cmd: true, alt: true }), field), "backlog");
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

test("N opens a new task in Chat and Issues (list and board)", () => {
  for (const c of [ctx(), ctx({ mode: "board" }), ctx({ view: "chat" }), ctx({ hasIssue: false }), ctx({ backlog: true })]) {
    assert.deepEqual(keyAction(kk("n"), c), { type: "newTask" });
    assert.deepEqual(keyAction(kk("N", { shift: true }), c), { type: "newTask" });
  }
});

test("N does nothing while typing, with a dialog open, held, or on the issue page / PR tab", () => {
  assert.equal(keyAction(kk("n"), ctx({ typing: true })), null);
  assert.equal(keyAction(kk("n"), ctx({ dialog: true })), null);
  assert.equal(keyAction(kk("n"), ctx({ view: "chat", dialog: true })), null);
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

// ------------------------------------------------------------ v1.5: start now (⌘⇧N dialog)

test("newTaskSubmit: ⌘↵ starts, ⌥⌘↵ goes to the Backlog, a held key or a bare ⌥↵ never submits", () => {
  assert.equal(newTaskSubmit(kk("enter", { cmd: true })), "start");
  assert.equal(newTaskSubmit(kk("enter", { cmd: true, shift: true })), "start");
  assert.equal(newTaskSubmit(kk("enter", { cmd: true, alt: true })), "backlog");
  assert.equal(newTaskSubmit(kk("enter", { cmd: true, held: true })), null);
  assert.equal(newTaskSubmit(kk("enter", { cmd: true, alt: true, held: true })), null);
  assert.equal(newTaskSubmit(kk("enter")), null);
  // keyOf folds ⌥ into cmd; `mod` is ⌘/ctrl alone, so ⌥↵ without ⌘ is nothing
  assert.equal(newTaskSubmit(kk("enter", { cmd: true, alt: true, mod: false })), null);
  assert.equal(newTaskSubmit(kk("enter", { cmd: true, mod: true })), "start");
  assert.equal(newTaskSubmit(kk("s", { cmd: true })), null);
});

test("dialog keys: the Just a terminal checkbox toggles on space; letters stay text everywhere", () => {
  for (const key of ["s", "x", "m", "1", "n"]) {
    for (const field of ["title", "brief", "terminal", null]) {
      assert.equal(dialogKeyNewTask(kk(key), field), null, key + " in " + field);
    }
  }
  assert.equal(dialogKeyNewTask(kk("space"), "terminal"), "toggle");
  assert.equal(dialogKeyNewTask(kk("space", { held: true }), "terminal"), null);
  assert.equal(dialogKeyNewTask(kk("space"), "title"), null);
  assert.equal(dialogKeyNewTask(kk("space"), "brief"), null);
  assert.equal(dialogKeyNewTask(kk("tab"), "terminal"), "next");
  assert.equal(dialogKeyNewTask(kk("enter", { cmd: true }), "terminal"), "start");
});

/** A fake runStart runner (nothing real is created); calls are recorded in order. */
function starter({ have = ["/r/promptr", "/r/promptr/.git"], top = undefined, appeared = true, git = { code: 0, stdout: "", stderr: "" }, gate = null } = {}) {
  const calls = [];
  const io = {
    exists: async (name) => have.includes(name),
    toplevel: async (repo) => (top === undefined ? repo : top),
    appeared: async () => appeared,
    git: async (argv) => {
      calls.push(["git", argv]);
      if (gate) await gate;
      return git;
    },
    spaceNew: async (args) => void calls.push(["space.new", args]),
    select: (plan) => void calls.push(["select", plan.path]),
  };
  return { io, calls, did: (w) => calls.filter((c) => c[0] === w) };
}
const sform = (o = {}) => ({ id: "c0ffee12", title: "Fix login", brief: "The login button.", root: "/r/promptr", terminal: false, pendingWorktree: null, ...o });

test("startTask: worktree, space.new with claude and the brief + proof line, then the new space is selected", async () => {
  const f = starter();
  const next = await startTask(sform(), "/home/m", f.io);
  assert.equal(next.done, true);
  assert.equal(next.error, null);
  assert.deepEqual(f.calls.map((c) => c[0]), ["git", "space.new", "select"]);
  assert.deepEqual(f.did("git")[0][1], ["git", "-C", "/r/promptr", "worktree", "add", "-b", "fix-login", "/home/m/.herdr/worktrees/promptr/fix-login", "HEAD"]);
  assert.deepEqual(f.did("space.new")[0][1], {
    folder: "/home/m/.herdr/worktrees/promptr/fix-login", argv: ["claude"],
    task: "The login button.\n\nWhen you finish, use the herdr-proof skill.",
  });
  assert.deepEqual(f.did("select")[0][1], "/home/m/.herdr/worktrees/promptr/fix-login");
});

test("startTask: a repo that fails the safe check or the toplevel check shows the error, creates nothing, keeps the text", async () => {
  const cases = [
    [sform({ root: "/r/../etc" }), {}, /^Bad repo path: \/r\/\.\.\/etc/],
    [sform({ root: "/r/promptr" }), { have: [] }, /^Repo not found: \/r\/promptr/],
    [sform({ root: "/r/promptr" }), { have: ["/r/promptr"] }, /^Not a git repo: \/r\/promptr/],
    [sform({ root: "/r/promptr" }), { top: "/r" }, /^Not a repo's main folder: \/r\/promptr/],
    [sform({ root: "/r/promptr" }), { top: null }, /^Not a repo's main folder: \/r\/promptr/],
    [sform({ root: null }), {}, /^Choose a repo/],
  ];
  for (const [form, opt, re] of cases) {
    const f = starter(opt);
    const next = await startTask(form, "/home/m", f.io);
    assert.equal(next.done, false);
    assert.equal(next.busy, false);
    assert.match(next.error, re);
    assert.equal(next.title, form.title); assert.equal(next.brief, form.brief); assert.equal(next.root, form.root);
    assert.deepEqual(f.calls, [], "nothing created for " + form.root);
  }
});

test("startTask: title and brief are required; with Just a terminal only the title is", async () => {
  for (const form of [sform({ title: " " }), sform({ brief: "" })]) {
    const f = starter();
    const next = await startTask(form, "/home/m", f.io);
    assert.equal(next.error, REQUIRED);
    assert.deepEqual(f.calls, []);
  }
  const f = starter();
  const next = await startTask(sform({ terminal: true, title: "", brief: "" }), "/home/m", f.io);
  assert.equal(next.error, "A title is required");
  assert.deepEqual(f.calls, []);
});

test("startTask: Just a terminal is space.new with no argv and no task", async () => {
  const f = starter();
  const next = await startTask(sform({ terminal: true, title: "Poke around", brief: "" }), "/home/m", f.io);
  assert.equal(next.done, true);
  assert.deepEqual(f.did("space.new")[0][1], { folder: "/home/m/.herdr/worktrees/promptr/poke-around" });
  assert.equal(f.did("select").length, 1);
});

test("Just a terminal: ⌥⌘↵ (Add to Backlog) is disabled, nothing is filed", async () => {
  const { io, calls } = fakeIo({ code: 0, stdout: "", stderr: "" });
  const next = await submitTask(form({ terminal: true }), io, 50);
  assert.equal(next.done, false);
  assert.equal(next.error, NO_TERMINAL_BACKLOG);
  assert.equal(calls.run.length, 0);
});

test("startTask: the agent not appearing keeps the worktree for a ⌘↵ retry, which reuses it", async () => {
  const wt = "/home/m/.herdr/worktrees/promptr/fix-login";
  const f = starter({ appeared: false });
  const first = await startTask(sform(), "/home/m", f.io);
  assert.equal(first.done, false);
  assert.equal(first.error, "Worktree created at " + wt + ", but the agent didn't start — open it from Herdr or press ⌘↵ again");
  assert.deepEqual(first.pendingWorktree, { path: wt, branch: "fix-login" });
  assert.equal(f.did("select").length, 0);
  // the retry: the branch and the folder now exist, and they are this dialog's own
  const g = starter({ have: ["/r/promptr", "/r/promptr/.git", "fix-login", wt] });
  const again = await startTask({ ...sform(), pendingWorktree: first.pendingWorktree }, "/home/m", g.io);
  assert.equal(again.done, true);
  assert.deepEqual(g.did("git"), []);
  assert.equal(g.did("space.new")[0][1].folder, wt);
});

test("two quick ⌘↵ presses create one worktree (the busy guard)", async () => {
  let open;
  const gate = new Promise((r) => (open = r));
  const f = starter({ gate });
  const press = oneAtATime((form) => startTask(form, "/home/m", f.io));
  const a = press(sform());
  const b = press(sform());
  assert.equal(await b, null); // ignored while the first is in flight
  open();
  assert.equal((await a).done, true);
  assert.equal(f.did("git").length, 1);
  assert.equal(f.did("space.new").length, 1);
  // once it has finished, a press runs again
  const c = await press(sform({ title: "Other" }));
  assert.equal(c.done, true);
  assert.equal(f.did("git").length, 2);
});

test("oneAtATime: a throwing run frees the guard", async () => {
  const press = oneAtATime(async () => { throw new Error("boom"); });
  await assert.rejects(press(), /boom/);
  await assert.rejects(press(), /boom/);
});

test("freshId: random lowercase hex, different each time", () => {
  const a = freshId(), b = freshId();
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.notEqual(a, b);
});
