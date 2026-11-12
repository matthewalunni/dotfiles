import test from "node:test";
import assert from "node:assert/strict";
import { issuePane, stepIssue, openPlan, issueFrom, backTarget } from "../../dot_config/herdr-app/mods/deck/lib/issuepage.js";

const iss = (key, o = {}) => ({ key, terminal: "t-" + key, observed: true, ...o });

test("issuePane: a live terminal shows, a gone one does not", () => {
  assert.equal(issuePane(iss("a")), "terminal");
  assert.equal(issuePane(iss("a", { observed: false })), "gone");
  assert.equal(issuePane(iss("a", { terminal: null })), "gone");
  assert.equal(issuePane(null), "gone");
});
test("unobserved issue opens the overview without agent.focus", () => {
  const p = openPlan(iss("a", { observed: false }), "board");
  assert.deepEqual(p, { sel: "a", from: "board", focus: null, child: "deck-issue", pane: "gone" });
});
test("observed issue opens and focuses its agent", () => {
  assert.deepEqual(openPlan(iss("a"), "list"), { sel: "a", from: "list", focus: "t-a", child: "deck-issue", pane: "terminal" });
});
test("board click opens", () => {
  // One click on a card opens the page (no select-then-open): the plan never depends on the selection.
  const p = openPlan(iss("b"), "board");
  assert.equal(p.child, "deck-issue");
  assert.equal(p.sel, "b");
  assert.equal(p.from, "board");
});
test("openPlan: an unknown from counts as the list; no issue is no plan", () => {
  assert.equal(openPlan(iss("a"), "nowhere").from, "list");
  assert.equal(openPlan(null, "board"), null);
});
test("stepIssue: j/k clamp at the first and last issue, no wrap", () => {
  const order = [iss("a"), iss("b"), iss("c")];
  assert.equal(stepIssue(order, "a", -1).key, "a");
  assert.equal(stepIssue(order, "c", 1).key, "c");
  assert.equal(stepIssue(order, "a", 1).key, "b");
  assert.equal(stepIssue(order, "c", -1).key, "b");
});
test("stepIssue: unknown key starts at the first; empty is null", () => {
  assert.equal(stepIssue([iss("a"), iss("b")], "zz", 1).key, "a");
  assert.equal(stepIssue([], "a", 1), null);
  assert.equal(stepIssue(undefined, "a", 1), null);
});
test("issueFrom: where the page was opened from", () => {
  assert.equal(issueFrom("deck-issues", "board", null), "board");
  assert.equal(issueFrom("deck-issues", "list", null), "list");
  assert.equal(issueFrom("deck-command", "board", null), "command");
  assert.equal(issueFrom("deck-terminal", "list", null), "terminal");
  // Already on the page (⌘⇧I back from its terminal, ⌘⇧J): keep where it came from.
  assert.equal(issueFrom("deck-issue", "list", "board"), "board");
  assert.equal(issueFrom("deck-issue", "list", null), "list");
});
test("backTarget: esc returns where the page came from", () => {
  assert.deepEqual(backTarget("board"), { child: "deck-issues", label: "← Board" });
  assert.deepEqual(backTarget("list"), { child: "deck-issues", label: "← Issues" });
  assert.deepEqual(backTarget("command"), { child: "deck-command", label: "← Command" });
  assert.deepEqual(backTarget("terminal"), { child: "deck-terminal", label: "← Terminal" });
  assert.deepEqual(backTarget(undefined), { child: "deck-issues", label: "← Issues" });
});
