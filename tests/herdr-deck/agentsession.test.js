import test from "node:test";
import assert from "node:assert/strict";
import {
  claudeSlug, transcriptPath, parsePidSession, sessionFromHistory, pickSession, summarizeTranscript,
  resumeArgv, resumeShellLine, isShell, resumePlan,
} from "../../dot_config/herdr-app/mods/deck/lib/agentsession.js";
import { emptyStore, reconcile, needsSummary, addSummary, attachSession, relink, resumeFailed, expireResumes, RESUME_MS } from "../../dot_config/herdr-app/mods/deck/lib/store.js";
import { boardNote, canResume, resuming } from "../../dot_config/herdr-app/mods/deck/lib/board.js";
import { planOp, parseOps } from "../../dot_config/herdr-app/mods/deck/lib/boardops.js";

const A = "1229b7eb-339d-4960-81c4-ae19fc4dd7d3";
const B = "03a95135-7f98-4b7b-b56c-e1342a757bdb";
const C = "593f1a36-2fcc-4ca5-80c4-4c6c60e79c96";
const DAY = 86400000;

const ob = (o = {}) => ({
  terminal: "t7", session: "100", status: "working", title: "t", cwd: "/x", repo: "chezmoi", root: "/x",
  branch: "fix/x", commitsAhead: 0, pr: null, ghError: null, claims: [], prompt: null,
  brief: null, replied: false, ...o,
});
const pid = (id, cwd = "/x") => ({ id, cwd, via: "pid" });

// ------------------------------------------------------------ session-id capture

test("Claude's project folder: every non-alphanumeric character becomes -", () => {
  assert.equal(claudeSlug("/Users/m/.herdr/worktrees/chezmoi/deck-x"), "-Users-m--herdr-worktrees-chezmoi-deck-x");
  assert.equal(transcriptPath("/h", "/a/b.c", A), `/h/.claude/projects/-a-b-c/${A}.jsonl`);
});

test("the pid file gives the exact session id and its cwd; anything else is null", () => {
  const text = JSON.stringify({ pid: 16461, sessionId: A, cwd: "/Users/m/chezmoi", kind: "interactive" });
  assert.deepEqual(parsePidSession(text), { id: A, cwd: "/Users/m/chezmoi", via: "pid" });
  assert.equal(parsePidSession("not json"), null);
  assert.equal(parsePidSession(JSON.stringify({ sessionId: "../../etc", cwd: "/x" })), null);
  assert.equal(parsePidSession(JSON.stringify({ sessionId: A, cwd: "relative" })), null);
  assert.equal(parsePidSession(null), null);
});

test("history fallback: two agents in one cwd are told apart by start time and brief", () => {
  const h = [
    { display: "old task", project: "/c", sessionId: C, timestamp: 50 },
    { display: "fix the deck board", project: "/c", sessionId: A, timestamp: 1000 },
    { display: "write the newsletter", project: "/c", sessionId: B, timestamp: 1200 },
    { display: "more on the deck", project: "/c", sessionId: A, timestamp: 1500 },
    { display: "elsewhere", project: "/other", sessionId: C, timestamp: 1600 },
  ].map((e) => JSON.stringify(e)).join("\n");
  assert.equal(sessionFromHistory(h, { cwd: "/c", after: 900, brief: "fix the deck board" }).id, A);
  assert.equal(sessionFromHistory(h, { cwd: "/c", after: 900, brief: "write the newsletter" }).id, B);
  // No brief: the newest active one that started after the terminal did.
  assert.equal(sessionFromHistory(h, { cwd: "/c", after: 900 }).id, A);
  assert.equal(sessionFromHistory(h, { cwd: "/c", after: 900, taken: new Set([A]) }).id, B);
  assert.equal(sessionFromHistory(h, { cwd: "/c", after: 900, before: 1100 }).id, A);
  assert.equal(sessionFromHistory(h, { cwd: "/nowhere" }), null);
  assert.equal(sessionFromHistory(h, { cwd: "/c", after: 900 }).via, "history");
});

test("a pid-file id wins over what the card had; a history guess never replaces a known id", () => {
  const hist = { id: B, cwd: "/x", via: "history" };
  assert.deepEqual(pickSession(pid(A), hist), pid(A));
  assert.deepEqual(pickSession(hist, pid(A)), pid(A));
  assert.deepEqual(pickSession(hist, null), hist);
  assert.deepEqual(pickSession(null, pid(A)), pid(A));
});

test("reconcile records the agent's session on its card while it runs, and follows a /clear", () => {
  let s = reconcile(emptyStore(), [ob({ agent: pid(A) })], 1);
  assert.deepEqual(s.issues[0].agent, pid(A));
  // A poll that could not read the pid file keeps the id.
  s = reconcile(s, [ob({ agent: null })], 2);
  assert.equal(s.issues[0].agent.id, A);
  // A new conversation in the same agent (/clear) is the id from then on.
  s = reconcile(s, [ob({ agent: pid(B) })], 3);
  assert.equal(s.issues[0].agent.id, B);
  assert.equal(s.issues.length, 1);
});

test("two cards in one cwd keep their own session ids", () => {
  const s = reconcile(emptyStore(), [
    ob({ terminal: "t1", session: "1", cwd: "/chezmoi", agent: pid(A, "/chezmoi") }),
    ob({ terminal: "t2", session: "2", cwd: "/chezmoi", agent: pid(B, "/chezmoi") }),
  ], 1);
  assert.deepEqual(s.issues.map((i) => [i.terminal, i.agent.id]), [["t1", A], ["t2", B]]);
});

// ------------------------------------------------------------ summary append

const line = (o) => JSON.stringify({ sessionId: A, timestamp: "2026-11-24T05:00:00.000Z", ...o });
const user = (text, ts) => line({ type: "user", message: { role: "user", content: text }, timestamp: ts });
const said = (text, ts, extra = []) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }, ...extra] }, timestamp: ts });
const tool = (name, ts) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name, input: {} }] }, timestamp: ts });
const result = (ts) => line({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] }, timestamp: ts });

test("summary from the last turn: what was done, that it finished, and the open question", () => {
  const t = [
    user("add resume to the deck", "2026-11-24T05:00:00Z"),
    tool("Bash", "2026-11-24T05:01:00Z"), result("2026-11-24T05:01:05Z"),
    said("I added a Resume button to ended cards. Tests pass. Should I also add a key for it?", "2026-11-24T05:02:00Z"),
  ].join("\n");
  const s = summarizeTranscript(t, A);
  assert.equal(s.done, "I added a Resume button to ended cards. Tests pass.");
  assert.equal(s.stopped, "Finished its turn and was waiting on you");
  assert.equal(s.question, "Should I also add a key for it?");
  assert.equal(s.lastAt, Date.parse("2026-11-24T05:02:00Z"));
});

test("a file name with a dot does not end the sentence", () => {
  const s = summarizeTranscript(said("Done. I wrote notes.txt with hello in it. I also noted PELICAN. Which colour for the shed?", "2026-11-24T05:00:00Z"), A);
  assert.equal(s.done, "Done. I wrote notes.txt with hello in it.");
  assert.equal(s.question, "Which colour for the shed?");
});

test("Claude's recap line is what was done when it came after the last prompt", () => {
  const t = [
    user("ship it", "2026-11-24T05:00:00Z"),
    said("Merged. Anything else?", "2026-11-24T05:01:00Z"),
    line({ type: "system", subtype: "away_summary", content: "Deck now resumes ended agents; PR #15 is open. Next: your review. (turn off recaps in /config)" }),
  ].join("\n");
  const s = summarizeTranscript(t, A);
  assert.equal(s.done, "Deck now resumes ended agents; PR #15 is open. Next: your review.");
  assert.equal(s.question, "Anything else?");
});

test("killed mid-turn: says which tool was running; a cut-off first line and other sessions are skipped", () => {
  const t = ['{"type":"assist', user("run the tests", "2026-11-24T05:00:00Z"), said("Running them now.", "2026-11-24T05:00:10Z"),
    tool("Bash", "2026-11-24T05:00:11Z"), JSON.stringify({ sessionId: B, type: "user", message: { content: "other chat" } })].join("\n");
  const s = summarizeTranscript(t, A);
  assert.equal(s.stopped, "Stopped mid-turn, running Bash");
  assert.equal(s.done, "Running them now.");
  assert.equal(s.question, null);
  const before = summarizeTranscript(user("start here", "2026-11-24T05:00:00Z"), A);
  assert.match(before.stopped, /^Stopped before answering: start here/);
  assert.equal(summarizeTranscript("", A), null);
});

test("on session end the card needs a summary; it is appended, timestamped, once per run, earlier ones kept", () => {
  let s = reconcile(emptyStore(), [ob({ agent: pid(A) })], 1000);
  const key = s.issues[0].key;
  assert.equal(needsSummary(s.issues[0]), false); // still running
  s = reconcile(s, [], 2000); // the claude process was killed
  const ended = s.issues[0];
  assert.equal(ended.observed, false);
  assert.equal(needsSummary(ended), true);
  assert.ok(s.log.some((e) => e.key === key && e.what === "agent session ended"));
  const sum = { done: "Built resume.", stopped: "Finished its turn and was waiting on you", question: "Merge?", lastAt: 1900 };
  s = addSummary(s, key, sum, 2100);
  assert.deepEqual(s.issues[0].summaries, [{ t: 2100, run: 1000, session: A, ...sum }]);
  assert.equal(needsSummary(s.issues[0]), false);
  assert.equal(addSummary(s, key, sum, 2200), s, "one summary per run");
  // Resumed, ran again, ended again: a second summary, the first kept.
  s = relink(s, key, "t7", "100", 3000);
  s = reconcile(s, [ob({ agent: pid(A) })], 4000);
  assert.equal(s.issues[0].observed, true);
  assert.equal(s.issues[0].summaries.length, 1);
  s = reconcile(s, [], 5000);
  s = addSummary(s, key, { ...sum, done: "Fixed review notes." }, 5100);
  assert.deepEqual(s.issues[0].summaries.map((x) => [x.run, x.done]), [[1000, "Built resume."], [4000, "Fixed review notes."]]);
});

test("a card without a session id gets one from history, never over a recorded one", () => {
  let s = reconcile(emptyStore(), [ob()], 1);
  s = reconcile(s, [], 2);
  const key = s.issues[0].key;
  assert.equal(needsSummary(s.issues[0]), false);
  s = attachSession(s, key, { id: A, cwd: "/x", via: "history" });
  assert.equal(s.issues[0].agent.id, A);
  assert.equal(attachSession(s, key, { id: B, cwd: "/x", via: "history" }), s);
});

// ------------------------------------------------------------ resume

test("resume relinks the card to a new terminal: the agent there keeps the same card", () => {
  let s = reconcile(emptyStore(), [ob({ terminal: "t23", session: "100", agent: pid(A) })], 1000);
  const key = s.issues[0].key;
  s = reconcile(s, [], 2000); // Herdr restarted: t23 is gone
  assert.equal(canResume(s.issues[0], 2000), true);
  s = relink(s, key, "t40", "555", 3000);
  assert.equal(resuming(s.issues[0], 3000), true);
  assert.equal(canResume(s.issues[0], 3000), false);
  assert.deepEqual(boardNote(s.issues[0], s.issues, 3000), { text: "Resuming…", tone: "work" });
  assert.match(s.log.at(-1).what, /resumed in t40 \(was t23\) by you/);
  s = reconcile(s, [ob({ terminal: "t40", session: "555", agent: pid(A) })], 4000);
  assert.equal(s.issues.length, 1);
  assert.equal(s.issues[0].key, key);
  assert.equal(s.issues[0].terminal, "t40");
  assert.equal(s.issues[0].observed, true);
  assert.equal(s.issues[0].resumedAt, null);
});

test("resume in the same shell: same terminal, same created time, same card", () => {
  let s = reconcile(emptyStore(), [ob({ agent: pid(A) })], 1000);
  s = reconcile(s, [], 2000);
  s = relink(s, s.issues[0].key, "t7", "100", 2500);
  s = reconcile(s, [ob({ agent: pid(A) })], 3000);
  assert.equal(s.issues.length, 1);
  assert.equal(s.issues[0].observed, true);
});

test("an ended card shows its summary; one with a session to resume stays a week, without one a day", () => {
  let s = reconcile(emptyStore(), [ob({ terminal: "t1", session: "1", agent: pid(A) }), ob({ terminal: "t2", session: "2" })], 1000);
  s = reconcile(s, [], 2000);
  const k1 = s.issues.find((i) => i.terminal === "t1").key;
  s = addSummary(s, k1, { done: "Did the thing.", stopped: "x", question: null, lastAt: null }, 2100);
  assert.deepEqual(boardNote(s.issues.find((i) => i.key === k1), s.issues, 2200), { text: "Did the thing.", tone: "muted" });
  s = addSummary(s, k1, { done: "y", stopped: "x", question: "Merge?", lastAt: null }, 2200); // same run: ignored
  s = reconcile(s, [], 1000 + 2 * DAY);
  assert.deepEqual(s.issues.map((i) => i.terminal), ["t1"]);
  s = reconcile(s, [], 1000 + 8 * DAY);
  assert.equal(s.issues.length, 0);
});

test("resume plan, argv and the shell line (quoted)", () => {
  assert.deepEqual(resumeArgv(A), ["claude", "--resume", A]);
  assert.equal(resumeShellLine(A, "/Users/m/it's here"), `cd -- '/Users/m/it'\\''s here' && claude --resume '${A}'`);
  assert.equal(isShell({ argv: ["-zsh"] }), true);
  assert.equal(isShell({ argv: ["/bin/zsh", "-li"] }), true);
  assert.equal(isShell({ argv: ["claude"], name: "2.1.331" }), false);
  assert.equal(isShell({ argv: ["vim", "x"] }), false);
  assert.equal(isShell(null), false);
  const ended = { id: "CH-3", observed: false, cwd: "/w", agent: { id: A, cwd: "/s" } };
  assert.deepEqual(resumePlan(ended), { id: A, cwd: "/s" });
  assert.match(resumePlan({ ...ended, observed: true }).error, /still running/);
  assert.match(resumePlan({ ...ended, agent: null }).error, /no Claude session/);
  assert.match(resumePlan({ ...ended, kind: "backlog" }).error, /backlog/);
});

test("herdr-board resume: parsed, only from the chat agent, only for an ended card with a session", () => {
  const [op] = parseOps(JSON.stringify({ id: "r1", t: 5, op: "resume", ref: "ch-3", from: "t9" }));
  assert.equal(op.op, "resume");
  const card = { key: "k", id: "CH-3", observed: false, agent: { id: A, cwd: "/s" } };
  assert.deepEqual(planOp(op, [card], "t9"), { issue: card });
  assert.match(planOp(op, [card], "t1").error, /only the deck chat agent/);
  assert.match(planOp(op, [{ ...card, observed: true }], "t9").error, /still running/);
  assert.match(planOp(op, [{ ...card, agent: null }], "t9").error, /no Claude session/);
  assert.match(planOp(op, [{ ...card, kind: "backlog" }], "t9").error, /backlog card/);
});

// ------------------------------------------------------------ resume never hangs (B-19)

test("a failed resume leaves the card retryable at once", () => {
  let s = reconcile(emptyStore(), [ob({ agent: pid(A) })], 1000);
  const key = s.issues[0].key;
  s = reconcile(s, [], 2000);
  s = relink(s, key, "t7", "100", 3000);
  assert.equal(canResume(s.issues[0], 3001), false);
  s = resumeFailed(s, key);
  assert.equal(s.issues[0].resumedAt, null);
  assert.equal(canResume(s.issues[0], 3001), true);
  assert.equal(resumeFailed(s, key), s);
});

test("a resume whose agent never shows up expires: Resume again, with a log line", () => {
  let s = reconcile(emptyStore(), [ob({ agent: pid(A) })], 1000);
  const key = s.issues[0].key;
  s = reconcile(s, [], 2000);
  s = relink(s, key, "t7", "100", 3000);
  assert.equal(expireResumes(s, 3000 + RESUME_MS - 1), s);
  assert.deepEqual(boardNote(s.issues[0], s.issues, 3000 + RESUME_MS - 1), { text: "Resuming…", tone: "work" });
  const t = expireResumes(s, 3000 + RESUME_MS);
  assert.equal(t.issues[0].resumedAt, null);
  assert.equal(canResume(t.issues[0], 3000 + RESUME_MS), true);
  assert.match(t.log.at(-1).what, /^resume failed: claude --resume did not come back within 30 s/);
  // Its agent is running but not polled yet (a slow cycle): left alone.
  assert.equal(expireResumes(s, 3000 + RESUME_MS, new Set(["t7"])), s);
  // A resume that worked is never touched.
  const live = reconcile(s, [ob({ agent: pid(A) })], 4000);
  assert.equal(expireResumes(live, 4000 + RESUME_MS * 2), live);
});

test("a card whose agent ran on another machine is refused with the reason", () => {
  const card = { id: "PR-8", observed: false, terminal: "dev/t5", cwd: "/home/m/health", agent: { id: A, cwd: "/home/m/health" } };
  assert.match(resumePlan(card).error, /ran on dev: Resume works only for agents on this computer/);
});
