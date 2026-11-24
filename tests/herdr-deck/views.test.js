import test from "node:test";
import assert from "node:assert/strict";
import { shownChild, takesFocus, ASK_MS, navChild } from "../../dot_config/herdr-app/mods/deck/lib/views.js";

test("shownChild: only in a deck layout", () => {
  assert.equal(shownChild("main", "deck-issues"), null);
  assert.equal(shownChild(null, "deck-issues"), null);
  assert.equal(shownChild("deck", "deck-issues"), "deck-issues");
  assert.equal(shownChild("deck", "deck-terminal"), "deck-terminal");
});
test("shownChild: a stale or missing view counts as Chat", () => {
  assert.equal(shownChild("deck", "deck-work"), "deck-chat");
  assert.equal(shownChild("deck", undefined), "deck-chat");
});
const C = "deck-chat";
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
test("Goals is a Deck view and a nav item", () => {
  assert.equal(shownChild("deck", "deck-goals"), "deck-goals");
  assert.equal(navChild("deck-goals"), "deck-goals");
});
test("navChild: the issue page underlines Issues", () => {
  assert.equal(navChild("deck-issue"), "deck-issues");
  assert.equal(navChild("deck-issues"), "deck-issues");
  assert.equal(navChild("deck-terminal"), "deck-terminal");
  assert.equal(navChild("deck-work"), "deck-chat");
  assert.equal(navChild(undefined), "deck-chat");
});

test("the Chat view is a Deck view and a nav item", () => {
  assert.equal(shownChild("deck", "deck-chat"), "deck-chat");
  assert.equal(navChild("deck-chat"), "deck-chat");
  assert.equal(takesFocus({ shown: "deck-issues", ask: null }, "deck-chat", null, "deck-chat", 0), true);
});

test("drawSig changes with the selection, view and store events, not otherwise", async () => {
  const { drawSig } = await import("../../dot_config/herdr-app/mods/deck/lib/views.js");
  const base = { layout: "deck", "deck.view": "deck-issue", "deck.selected": "a", "deck.store": { issues: [1, 2], log: [{ t: 5, key: "a" }] } };
  const sig = (o) => drawSig((k) => ({ ...base, ...o })[k]);
  assert.equal(sig({}), sig({}));
  assert.notEqual(sig({}), sig({ "deck.selected": "b" }));
  assert.notEqual(sig({}), sig({ "deck.view": "deck-issues" }));
  assert.notEqual(sig({}), sig({ layout: "main" }));
  assert.notEqual(sig({}), sig({ "deck.reviewSort": true })); // ⇧U / deck.review-sort redraws
  assert.notEqual(sig({}), sig({ "deck.store": { issues: [1, 2], log: [{ t: 5, key: "a" }, { t: 6, key: "b" }] } }));
  assert.equal(drawSig(() => undefined), drawSig(() => null));
});
