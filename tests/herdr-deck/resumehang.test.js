// B-19: Resume must never stay "Resuming…" on screen. Each way a resume ends
// (back, failed, timed out) has to (1) leave the card in a state the button
// reads as done or retryable-with-a-reason, and (2) move drawSig, because a
// Deck view only redraws when drawSig changes (views/focus.js keepFresh).
import test from "node:test";
import assert from "node:assert/strict";
import { emptyStore, reconcile, relink, resumeFailed, expireResumes, RESUME_MS } from "../../dot_config/herdr-app/mods/deck/lib/store.js";
import { canResume, resumeState, pruneClicks, CLICK_MS } from "../../dot_config/herdr-app/mods/deck/lib/board.js";
import { drawSig, RESUME_CLICKS_KEY } from "../../dot_config/herdr-app/mods/deck/lib/views.js";

const A = "1229b7eb-339d-4960-81c4-ae19fc4dd7d3";
const ob = (o = {}) => ({
  terminal: "t7", session: "100", status: "idle", title: "t", cwd: "/x", repo: "chezmoi", root: "/x",
  branch: "fix/x", commitsAhead: 0, pr: null, ghError: null, claims: [], prompt: null,
  brief: null, replied: false, agent: { id: A, cwd: "/x", via: "pid" }, ...o,
});
/** An ended card with a session to resume, and its key. */
function ended() {
  let s = reconcile(emptyStore(), [ob()], 1000);
  const key = s.issues[0].key;
  s = reconcile(s, [], 2000);
  return { s, key };
}
const sigOf = (store, extra = {}) => drawSig((k) => (k === "deck.store" ? store : extra[k] ?? null));

// ------------------------------------------------------------ redraw (the root cause)

test("drawSig moves when a resumed card's agent is back, even with no new log line", () => {
  const { s, key } = ended();
  const linked = relink(s, key, "t7", "100", 3000);
  const back = reconcile(linked, [ob()], 4000);
  assert.equal(back.issues[0].observed, true);
  // The bug: same issue count, same log: the frame kept "Resuming…".
  assert.equal(back.log.length, linked.log.length);
  assert.notEqual(sigOf(back), sigOf(linked));
});

test("drawSig moves when a resume fails, and when a click starts or ends", () => {
  const { s, key } = ended();
  assert.notEqual(sigOf(resumeFailed(s, key, "Session not found")), sigOf(s));
  assert.notEqual(sigOf(s, { [RESUME_CLICKS_KEY]: { [key]: 5000 } }), sigOf(s, { [RESUME_CLICKS_KEY]: {} }));
});

// ------------------------------------------------------------ failure leaves a reason, retryable

test("a resume that fails before relinking still records why, and the card stays retryable", () => {
  const { s, key } = ended();
  const f = resumeFailed(s, key, "Session not found: no transcript for 1229b7eb");
  assert.equal(f.issues[0].resumeError, "Session not found: no transcript for 1229b7eb");
  assert.equal(f.issues[0].resumedAt, null);
  assert.match(f.log.at(-1).what, /resume failed: Session not found/);
  assert.equal(canResume(f.issues[0], 6000), true);
  assert.deepEqual(resumeState(f.issues[0], {}, 6000), { kind: "ready", error: "Session not found: no transcript for 1229b7eb" });
});

test("a failure after relinking clears Resuming… at once, with the reason", () => {
  const { s, key } = ended();
  const linked = relink(s, key, "t7", "100", 3000);
  assert.deepEqual(resumeState(linked.issues[0], {}, 3001), { kind: "pending" });
  const f = resumeFailed(linked, key, "claude --resume did not start in t7");
  assert.deepEqual(resumeState(f.issues[0], {}, 3002), { kind: "ready", error: "claude --resume did not start in t7" });
});

test("the next try clears the old reason; so does the agent coming back", () => {
  const { s, key } = ended();
  const f = resumeFailed(s, key, "boom");
  assert.equal(relink(f, key, "t7", "100", 3000).issues[0].resumeError, null);
  const back = reconcile(relink(f, key, "t7", "100", 3000), [ob()], 4000);
  assert.equal(back.issues[0].resumeError ?? null, null);
  assert.equal(resumeState(back.issues[0], {}, 4001), null);
});

test("a resume whose agent never shows up times out with a reason", () => {
  const { s, key } = ended();
  const linked = relink(s, key, "t7", "100", 3000);
  const t = expireResumes(linked, 3000 + RESUME_MS);
  assert.equal(t.issues[0].resumedAt, null);
  assert.match(t.issues[0].resumeError, /did not come back/);
  assert.equal(resumeState(t.issues[0], {}, 3000 + RESUME_MS).kind, "ready");
});

// ------------------------------------------------------------ the click itself is bounded

test("a click reads Resuming… until it ends, and never longer than CLICK_MS", () => {
  const { s, key } = ended();
  const i = s.issues[0];
  assert.deepEqual(resumeState(i, { [key]: 10_000 }, 10_001), { kind: "pending" });
  assert.deepEqual(resumeState(i, { [key]: 10_000 }, 10_000 + CLICK_MS - 1), { kind: "pending" });
  // No answer at all (the click's task was dropped): ready again, not stuck.
  assert.equal(resumeState(i, { [key]: 10_000 }, 10_000 + CLICK_MS).kind, "ready");
  assert.equal(resumeState(i, null, 10_001).kind, "ready");
});

test("pruneClicks drops clicks past CLICK_MS (the collector does it, so views redraw)", () => {
  const c = { a: 1000, b: 1000 + CLICK_MS };
  assert.equal(pruneClicks(c, 1000 + CLICK_MS - 1), c);
  assert.deepEqual(pruneClicks(c, 1000 + CLICK_MS), { b: 1000 + CLICK_MS });
  assert.deepEqual(pruneClicks(null, 5), {});
});

test("no Resume for a running card, a backlog card, or a card with no session", () => {
  const live = reconcile(emptyStore(), [ob()], 1000).issues[0];
  assert.equal(resumeState(live, {}, 2000), null);
  assert.equal(resumeState({ kind: "backlog", key: "b", observed: false }, {}, 2000), null);
  const { s } = ended();
  assert.equal(resumeState({ ...s.issues[0], agent: null }, {}, 2000), null);
});
