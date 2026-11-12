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
