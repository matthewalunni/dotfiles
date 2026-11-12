import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBacklog } from "../../dot_config/herdr-app/mods/deck/lib/backlog.js";

const SCRIPT = new URL("../../dot_local/bin/executable_herdr-backlog", import.meta.url).pathname;
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hb-")));
  const home = join(root, "home"); mkdirSync(home);
  const repo = join(root, "repo"); mkdirSync(repo);
  git(repo, "init", "-q");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-qm", "init");
  return { root, home, repo, inbox: join(home, ".local/state/herdr-deck/backlog.jsonl") };
}
const run = (s, args, cwd, env = {}) =>
  spawnSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: s.home, ...env } });

test("files one parseable line with from and a hex id", () => {
  const s = setup();
  const r = run(s, ["--title", "Fix it", "--brief", "Do the thing"], s.repo, { HC_TERMINAL_ID: "term-7" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "Filed B-? Fix it\n");
  const text = readFileSync(s.inbox, "utf8");
  assert.equal(text.split("\n").filter(Boolean).length, 1);
  const [e] = parseBacklog(text);
  assert.match(e.id, /^[0-9a-f]{12}$/);
  assert.equal(e.title, "Fix it"); assert.equal(e.brief, "Do the thing");
  assert.equal(e.repo, s.repo); assert.equal(e.source, "agent"); assert.equal(e.from, "term-7");
  assert.ok(e.createdAt > 1e12);
  run(s, ["--title", "Two", "--brief", "b"], s.repo);
  assert.equal(parseBacklog(readFileSync(s.inbox, "utf8")).length, 2);
});

test("hostile title and brief are written verbatim and never executed", () => {
  const s = setup();
  const title = `a "q" 'x' $(touch ${s.root}/pwned) \`touch ${s.root}/pwned2\` \\n`;
  const brief = `line1\nline2 "q" $(touch ${s.root}/pwned3) ; rm -rf /`;
  const r = run(s, ["--title", title, "--brief", brief], s.repo);
  assert.equal(r.status, 0, r.stderr);
  const [e] = parseBacklog(readFileSync(s.inbox, "utf8"));
  assert.equal(e.title, title.trim()); assert.equal(e.brief, brief);
  for (const f of ["pwned", "pwned2", "pwned3"]) assert.equal(existsSync(join(s.root, f)), false);
  assert.equal(readFileSync(s.inbox, "utf8").split("\n").filter(Boolean).length, 1);
});

test("hostile repo path is stored verbatim", () => {
  const s = setup();
  const odd = join(s.root, 'we ird "$(x)\' repo'); mkdirSync(odd);
  git(odd, "init", "-q");
  const r = run(s, ["--title", "t", "--brief", "b", "--repo", odd], s.root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(parseBacklog(readFileSync(s.inbox, "utf8"))[0].repo, odd);
});

test("empty title or brief fails and writes nothing", () => {
  const s = setup();
  for (const args of [["--title", "  ", "--brief", "b"], ["--title", "t", "--brief", ""], ["--brief", "b"], ["--title", "t"]]) {
    const r = run(s, args, s.repo);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /herdr-backlog:/);
  }
  assert.equal(existsSync(s.inbox), false);
});

test("not a git repo fails", () => {
  const s = setup();
  const plain = join(s.root, "plain"); mkdirSync(plain);
  const r = run(s, ["--title", "t", "--brief", "b"], plain);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a git repo/);
  assert.equal(existsSync(s.inbox), false);
});

test("from a worktree it files against the main checkout", () => {
  const s = setup();
  const wt = join(s.root, "wt");
  git(s.repo, "worktree", "add", "-q", "-b", "side", wt);
  const sub = join(wt, "sub"); mkdirSync(sub);
  for (const cwd of [wt, sub]) {
    const r = run(s, ["--title", "t", "--brief", "b"], cwd);
    assert.equal(r.status, 0, r.stderr);
  }
  const entries = parseBacklog(readFileSync(s.inbox, "utf8"));
  assert.equal(entries.length, 2);
  for (const e of entries) assert.equal(e.repo, s.repo);
});

test("--repo pointing at a worktree also resolves to the main checkout; from is null without HC_TERMINAL_ID", () => {
  const s = setup();
  const wt = join(s.root, "wt2");
  git(s.repo, "worktree", "add", "-q", "-b", "side2", wt);
  const r = run(s, ["--title", "t", "--brief", "b", "--repo", wt], s.root);
  assert.equal(r.status, 0, r.stderr);
  const [e] = parseBacklog(readFileSync(s.inbox, "utf8"));
  assert.equal(e.repo, s.repo); assert.equal(e.from, null);
});

test("--source you files a hostile title verbatim (argv only) with from null", () => {
  const s = setup();
  const title = `Fix "quotes" 'x' $(touch ${s.root}/pwned) \`touch ${s.root}/pwned2\`\nsecond line`;
  const brief = `b1\nb2 $(touch ${s.root}/pwned3)`;
  const r = run(s, ["--title", title, "--brief", brief, "--repo", s.repo, "--source", "you"], s.root, { HC_TERMINAL_ID: "term-9" });
  assert.equal(r.status, 0, r.stderr);
  const [e] = parseBacklog(readFileSync(s.inbox, "utf8"));
  assert.equal(e.title, title); assert.equal(e.brief, brief);
  assert.equal(e.source, "you"); assert.equal(e.from, null); assert.equal(e.repo, s.repo);
  for (const f of ["pwned", "pwned2", "pwned3"]) assert.equal(existsSync(join(s.root, f)), false);
});

test("--source agent is the default; any other source is refused and writes nothing", () => {
  const s = setup();
  const ok = run(s, ["--title", "t", "--brief", "b", "--source", "agent"], s.repo, { HC_TERMINAL_ID: "term-1" });
  assert.equal(ok.status, 0, ok.stderr);
  const [e] = parseBacklog(readFileSync(s.inbox, "utf8"));
  assert.equal(e.source, "agent"); assert.equal(e.from, "term-1");
  const s2 = setup();
  for (const src of ["linear", "", "You", "you;rm"]) {
    const r = run(s2, ["--title", "t", "--brief", "b", "--source", src], s2.repo);
    assert.notEqual(r.status, 0, src);
    assert.match(r.stderr, /herdr-backlog: --source must be agent or you/);
  }
  const r = run(s2, ["--title", "t", "--brief", "b", "--source"], s2.repo);
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(s2.inbox), false);
});
