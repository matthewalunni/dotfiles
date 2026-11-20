// The registry contract behind views/chatblocks.js (block renderers) and
// views/chatcomposer.js (completions). The views import gpui-kit, so the pure
// registry in lib/chatregistry.js is what is tested here.
import test from "node:test";
import assert from "node:assert/strict";
import { createRegistry, BLOCK_TYPES } from "../../dot_config/herdr-app/mods/deck/lib/chatregistry.js";

test("BLOCK_TYPES: the six v1 block types", () => {
  assert.deepEqual([...BLOCK_TYPES].sort(), ["action", "approval", "deck", "divider", "github", "text"]);
});

test("register then run: the registered function gets the item and the extra arguments", () => {
  const r = createRegistry(() => "fallback");
  r.register("text", (block, cx, ctx) => `text:${block.text}:${cx}:${ctx.k}`);
  assert.equal(r.run("text", { text: "hi" }, "cx", { k: 1 }), "text:hi:cx:1");
  assert.deepEqual(r.kinds(), ["text"]);
  assert.equal(r.has("text"), true);
});

test("an unknown type runs the fallback with the type and the item, and does not throw", () => {
  const seen = [];
  const r = createRegistry((type, item, ...rest) => {
    seen.push([type, item, rest]);
    return "unknown";
  });
  assert.equal(r.run("nope", { type: "nope" }, "cx"), "unknown");
  assert.deepEqual(seen, [["nope", { type: "nope" }, ["cx"]]]);
  assert.equal(r.has("nope"), false);
  assert.equal(r.run(undefined, null), "unknown");
});

test("registering a type again replaces it", () => {
  const r = createRegistry(() => null);
  r.register("deck", () => "old");
  r.register("deck", () => "new");
  assert.equal(r.run("deck", {}), "new");
  assert.deepEqual(r.kinds(), ["deck"]);
});

test("a new type is used as soon as it is registered; kinds lists in registration order", () => {
  const r = createRegistry(() => "fallback");
  for (const t of BLOCK_TYPES) r.register(t, () => t);
  assert.equal(r.run("poll", {}), "fallback");
  r.register("poll", (b) => `poll ${b.q}`);
  assert.equal(r.run("poll", { q: "?" }), "poll ?");
  assert.deepEqual(r.kinds(), [...BLOCK_TYPES, "poll"]);
});

test("register refuses a bad type or a non-function", () => {
  const r = createRegistry(() => null);
  assert.throws(() => r.register("", () => 1), TypeError);
  assert.throws(() => r.register(3, () => 1), TypeError);
  assert.throws(() => r.register("x", "nope"), TypeError);
  assert.deepEqual(r.kinds(), []);
});

test("registries are independent", () => {
  const a = createRegistry(() => "a?");
  const b = createRegistry(() => "b?");
  a.register("t", () => "a");
  assert.equal(b.run("t", {}), "b?");
});
