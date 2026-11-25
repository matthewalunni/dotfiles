import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL("../../dot_config/herdr-app/" + rel, import.meta.url), "utf8");

test("⌘⇧N is a global binding that opens deck-new, and nothing more specific takes it", () => {
  const keys = JSON.parse(read("keys.json"));
  assert.equal(keys.global["cmd-shift-n"], "mod.open:deck-new");
  for (const [section, map] of Object.entries(keys)) {
    if (section === "global") continue;
    assert.equal(map["cmd-shift-n"], undefined, "cmd-shift-n is also bound in " + section);
    assert.equal(map["cmd-N"], undefined, "cmd-N is also bound in " + section);
  }
});

test("main layout: only ⌥⌘1–4 (one per Deck view) and ⌘⇧J switch to the deck", () => {
  const keys = JSON.parse(read("keys.json"));
  assert.deepEqual(Object.keys(keys["layout:main"]).sort(), ["cmd-alt-1", "cmd-alt-2", "cmd-alt-3", "cmd-alt-4", "cmd-shift-j"]);
  // Numbered left to right, as the bar shows them: Terminal, Chat, Issues, Goals.
  assert.deepEqual([1, 2, 3, 4].map((n) => keys["layout:deck"]["cmd-alt-" + n]),
    ["deck.go:terminal", "deck.go:chat", "deck.go:issues", "deck.go:goals"]);
});

test("deck-new is an overlay mod that is never docked", () => {
  const m = JSON.parse(read("mods/deck-new/mod.json"));
  assert.equal(m.place, "none");
  assert.ok(m.overlay && typeof m.overlay === "object");
  assert.equal(m.overlay.kind, "popup");
});

test("deck-new opens Deck's own New task view (one dialog, no copied code)", () => {
  const src = read("mods/deck-new/main.js");
  assert.match(src, /mod:\s*"deck"/);
  assert.match(src, /view:\s*"newtask"/);
  assert.doesNotMatch(src, /from\s+"\.\.\//, "a mod can't import another mod's files");
});

test("deck layout: ⌘1–9 show agent 1–9 (through Deck, so the Terminal view comes up)", () => {
  const keys = JSON.parse(read("keys.json"));
  for (let n = 1; n <= 9; n++) assert.equal(keys["layout:deck"]["cmd-" + n], "deck.agent:" + n);
  // The main layout keeps ⌘1–9 for tabs.
  assert.equal(keys.global["cmd-1"], "tab.select:1");
});
