import test from "node:test";
import assert from "node:assert/strict";
import { createSharedMemo } from "../../dot_config/herdr-app/mods/deck/lib/sharedmemo.js";

test("sharedMemo: one read per key per job; the next job reads again", async () => {
  const reads = [];
  let v = 1;
  const m = createSharedMemo((k) => (reads.push(k), { k, v }));
  const a = m.get("deck.store");
  assert.equal(m.get("deck.store"), a);
  m.get("deck.chat");
  assert.deepEqual(reads, ["deck.store", "deck.chat"]);
  v = 2;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(m.get("deck.store").v, 2);
  assert.deepEqual(reads, ["deck.store", "deck.chat", "deck.store"]);
});

test("sharedMemo: clear() makes the next get read again in the same job", () => {
  let v = 1;
  const m = createSharedMemo(() => v, { later: () => {} });
  assert.equal(m.get("x"), 1);
  v = 2;
  assert.equal(m.get("x"), 1);
  m.clear();
  assert.equal(m.get("x"), 2);
});

test("sharedMemo: a memo older than maxAge reads again even if the job never ended", () => {
  let v = 1;
  let t = 0;
  const m = createSharedMemo(() => v, { later: () => {}, now: () => t, maxAge: 50 });
  assert.equal(m.get("x"), 1);
  v = 2;
  t = 50;
  assert.equal(m.get("x"), 1);
  t = 51;
  assert.equal(m.get("x"), 2);
});
