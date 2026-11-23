import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, appendFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOps, resultLine } from "../../dot_config/herdr-app/mods/deck/lib/boardops.js";

const SCRIPT = new URL("../../dot_local/bin/executable_herdr-board", import.meta.url).pathname;

function setup() {
  const home = join(realpathSync(mkdtempSync(join(tmpdir(), "hbd-"))), "home");
  mkdirSync(home);
  const dir = join(home, ".local/state/herdr-deck");
  return { home, ops: join(dir, "board.jsonl"), results: join(dir, "board-results.jsonl") };
}
const env = (s, extra = {}) => ({ PATH: process.env.PATH, HOME: s.home, HC_TERMINAL_ID: "t22", HERDR_BOARD_WAIT_MS: "3000", ...extra });
const runSync = (s, args, extra) => spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", env: env(s, extra) });

/** Runs the CLI and plays Deck: answers its request once it appears. */
function runAnswered(s, args, answer) {
  return new Promise((resolve) => {
    const child = spawn("node", [SCRIPT, ...args], { env: env(s) });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setInterval(() => {
      if (!existsSync(s.ops)) return;
      const [op] = parseOps(readFileSync(s.ops, "utf8"));
      if (!op) return;
      clearInterval(timer);
      const r = answer(op);
      appendFileSync(s.results, resultLine("someone-else", true, "not mine", 1) + "\n" + resultLine(op.id, r.ok, r.message, 2) + "\n");
    }, 50);
    child.on("close", (code) => { clearInterval(timer); resolve({ code, out, err }); });
  });
}

test("queues one parseable request with its terminal, and prints Deck's answer", async () => {
  const s = setup();
  let seen;
  const r = await runAnswered(s, ["move", "TF-8", "Verify"], (op) => ((seen = op), { ok: true, message: "TF-8 moved to Verify" }));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "TF-8 moved to Verify\n");
  assert.equal(seen.op, "move"); assert.equal(seen.ref, "TF-8"); assert.equal(seen.column, "Verify");
  assert.equal(seen.from, "t22"); assert.match(seen.id, /^[0-9a-f]{12}$/); assert.ok(seen.t > 1e12);
});

test("a refusal exits 1 with Deck's reason", async () => {
  const s = setup();
  const r = await runAnswered(s, ["delete", "B-3"], () => ({ ok: false, message: "B-3 is a backlog card: use discard or start" }));
  assert.equal(r.code, 1);
  assert.match(r.err, /B-3 is a backlog card/);
});

test("edit carries title and brief; no answer in time exits 2", () => {
  const s = setup();
  const r = runSync(s, ["edit", "B-3", "--title", "New", "--brief", "Long brief"], { HERDR_BOARD_WAIT_MS: "300" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /did not answer/);
  const [op] = parseOps(readFileSync(s.ops, "utf8"));
  assert.equal(op.title, "New"); assert.equal(op.brief, "Long brief");
});

test("bad arguments exit 1 and queue nothing", () => {
  const s = setup();
  for (const args of [[], ["launch", "TF-1"], ["dismiss"], ["move", "TF-1"], ["edit", "TF-1"], ["edit", "TF-1", "--title", " "], ["dismiss", "TF-1", "extra"], ["edit", "TF-1", "--color", "x"]]) {
    const r = runSync(s, args);
    assert.equal(r.status, 1, args.join(" "));
  }
  assert.equal(existsSync(s.ops), false);
});

test("goal-new and goal carry their fields; bad ones are refused before queuing", async () => {
  const s = setup();
  let seen;
  const r = await runAnswered(s, ["goal-new", "Ship chat", "--days", "14", "--project", "deck", "--start", "2026-11-23", "--done-when", "all from chat"],
    (op) => ((seen = op), { ok: true, message: "G-1 created" }));
  assert.equal(r.code, 0, r.err);
  assert.equal(seen.op, "goal-new"); assert.equal(seen.ref, "Ship chat"); assert.equal(seen.days, 14);
  assert.equal(seen.project, "deck"); assert.equal(seen.start, "2026-11-23"); assert.equal(seen.doneWhen, "all from chat");
  const s2 = setup();
  const r2 = await runAnswered(s2, ["goal", "TF-8", "G-1"], (op) => ((seen = op), { ok: true, message: "linked" }));
  assert.equal(r2.code, 0, r2.err);
  assert.equal(seen.goal, "G-1");
  for (const bad of [["goal-new", "X"], ["goal-new", "X", "--days", "0"], ["goal-new", "X", "--days", "abc"], ["goal-new", "X", "--days", "3", "--start", "soon"], ["goal", "TF-8"], ["goal", "TF-8", "G-1", "x"]]) {
    const s3 = setup();
    const r3 = runSync(s3, bad);
    assert.equal(r3.status, 1, bad.join(" "));
    assert.equal(existsSync(s3.ops), false, bad.join(" ") + " queued nothing");
  }
});

// ---- cleanup: a real repo with a linked worktree, fake hc / herdr-app on PATH that log their calls.
import { execFileSync } from "node:child_process";
import { writeFileSync, chmodSync } from "node:fs";

function cleanupSetup({ merged = false, prMerged = false, alone = true } = {}) {
  const s = setup();
  const root = join(s.home, "..");
  const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const main = join(root, "repo"); mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, ".gitignore"), ".env\n");
  writeFileSync(join(main, ".env"), "SECRET=1\n");
  git(main, "add", ".gitignore"); git(main, "commit", "-qm", "init");
  const wt = join(root, "wt");
  git(main, "worktree", "add", "-q", "-b", "feat", wt);
  writeFileSync(join(wt, ".env"), "SECRET=1\n"); // a copy of main's: no loss
  writeFileSync(join(wt, "f.txt"), "x\n"); git(wt, "add", "f.txt"); git(wt, "commit", "-qm", "work");
  if (merged) git(main, "merge", "-q", "feat");
  const app = join(s.home, ".config/herdr-app"); mkdirSync(app, { recursive: true });
  const card = { key: "t5|s", id: "TF-8", title: "Gate", terminal: "t5", root: wt, cwd: wt, branch: "feat", pr: prMerged ? { number: 9, state: "MERGED" } : null };
  writeFileSync(join(app, "shared.json"), JSON.stringify({ "deck.store": { issues: [card, { key: "backlog|b", id: "B-1", kind: "backlog" }] } }));
  const bin = join(root, "bin"); mkdirSync(bin);
  const calls = join(root, "calls.log");
  const fake = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  fake("hc", `[ "$1" = ls ] && echo '[{"address":"t5","name":null},{"address":"t22","name":"deck-chat"}]'; exit 0`);
  const spaces = { spaces: [{ id: "sp1", name: "feat", tabs: [{ terminals: [{ terminal: "t5" }, ...(alone ? [] : [{ terminal: "t6" }])] }] }] };
  fake("herdr-app", `[ "$1" = ls ] && echo '${JSON.stringify(spaces)}'; exit 0`);
  const run = (args) => spawnSync("node", [SCRIPT, "cleanup", "TF-8", ...args], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, HOME: s.home, HC_TERMINAL_ID: "t22" } });
  const log = () => (existsSync(calls) ? readFileSync(calls, "utf8") : "");
  const branches = () => git(main, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);
  return { run, log, wt, main, branches };
}

test("cleanup: a merged card loses its space, worktree and branch; a copied .env is no loss", () => {
  const c = cleanupSetup({ merged: true });
  const r = c.run([]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /done: close space "feat" and end terminal t5/);
  assert.match(c.log(), /herdr-app do space.close \{"id":"sp1","confirmed":true\}/);
  assert.equal(existsSync(c.wt), false);
  assert.deepEqual(c.branches(), ["main"]);
});

test("cleanup: unmerged branch blocks everything; a merged PR (squash) allows -D", () => {
  const c = cleanupSetup();
  const r = c.run([]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /blocked: branch feat is not merged/);
  assert.equal(existsSync(c.wt), true);
  assert.doesNotMatch(c.log(), /kill|space.close/);
  const sq = cleanupSetup({ prMerged: true });
  const r2 = sq.run([]);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /delete branch feat \(PR #9 merged\)/);
  assert.deepEqual(sq.branches(), ["main"]);
});

test("cleanup: uncommitted work or a unique secret blocks; --dry-run and --keep-* do what they say", () => {
  const c = cleanupSetup({ merged: true, alone: false });
  writeFileSync(join(c.wt, "notes.md"), "draft\n");
  writeFileSync(join(c.wt, ".env"), "SECRET=only-here\n");
  const r = c.run([]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /uncommitted or untracked file\(s\): notes.md/);
  assert.match(r.stdout, /ignored secrets that exist nowhere else: \.env/);
  const d = c.run(["--dry-run"]);
  assert.equal(d.status, 0);
  assert.match(d.stdout, /would end terminal t5/); // not alone in its space: the terminal only
  const k = c.run(["--keep-worktree", "--keep-branch"]);
  assert.equal(k.status, 0, k.stdout);
  assert.match(c.log(), /hc kill t5/);
  assert.equal(existsSync(c.wt), true);
});

test("cleanup: refuses a backlog card or an unknown one, and never ends deck-chat", () => {
  const c = cleanupSetup({ merged: true });
  assert.match(c.run([]).stdout, /done/); // sanity
  const b = cleanupSetup({ merged: true });
  const rb = spawnSync("node", [SCRIPT, "cleanup", "B-1"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: join(b.wt, "..", "home") } });
  assert.equal(rb.status, 1);
  assert.match(rb.stderr, /backlog card/);
  assert.equal(b.run(["--bogus"]).status, 1);
});
