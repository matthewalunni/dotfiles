import test from "node:test";
import assert from "node:assert/strict";
import { shownChild, takesFocus, ASK_MS, navChild } from "../../dot_config/herdr-app/mods/deck/lib/views.js";

test("shownChild: only in a deck layout", () => {
  assert.equal(shownChild("main", "deck-issues"), null);
  assert.equal(shownChild(null, "deck-issues"), null);
  assert.equal(shownChild("deck", "deck-issues"), "deck-issues");
  assert.equal(shownChild("deck", "deck-terminal"), "deck-terminal");
});
test("shownChild: a stale or missing view counts as Command", () => {
  assert.equal(shownChild("deck", "deck-work"), "deck-command");
  assert.equal(shownChild("deck", undefined), "deck-command");
});
const C = "deck-command";
test("takesFocus: on the first draw and on each return, not while it stays", () => {
  assert.equal(takesFocus({ shown: null, ask: null }, C, null, C, 0), true);
  assert.equal(takesFocus({ shown: C, ask: null }, C, null, C, 0), false);
  assert.equal(takesFocus({ shown: "deck-issues", ask: null }, C, null, C, 0), true);
  assert.equal(takesFocus({ shown: C, ask: null }, "deck-issues", null, C, 0), false);
  assert.equal(takesFocus({ shown: C, ask: null }, null, null, C, 0), false);
});
test("takesFocus: a new, recent show request for it counts once", () => {
  const ask = { child: C, at: 1000 };
  assert.equal(takesFocus({ shown: C, ask: null }, C, ask, C, 1100), true);
  assert.equal(takesFocus({ shown: C, ask }, C, ask, C, 1200), false); // already seen
  assert.equal(takesFocus({ shown: C, ask: null }, C, ask, C, 1000 + ASK_MS), false); // stale
  assert.equal(takesFocus({ shown: C, ask: null }, C, { child: "deck-issues", at: 1000 }, C, 1100), false);
  assert.equal(takesFocus({ shown: C, ask: null }, "deck-issues", ask, C, 1100), false);
});
test("shownChild: the issue page is a Deck view", () => {
  assert.equal(shownChild("deck", "deck-issue"), "deck-issue");
});
test("navChild: the issue page underlines Issues", () => {
  assert.equal(navChild("deck-issue"), "deck-issues");
  assert.equal(navChild("deck-issues"), "deck-issues");
  assert.equal(navChild("deck-terminal"), "deck-terminal");
  assert.equal(navChild("deck-work"), "deck-command");
  assert.equal(navChild(undefined), "deck-command");
});
