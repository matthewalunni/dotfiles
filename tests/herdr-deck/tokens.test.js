import { test } from "node:test";
import assert from "node:assert/strict";
import { deckTokens } from "../../dot_config/herdr-app/mods/deck/lib/tokens.js";

test("empty theme falls back to Moss values", () => {
  assert.deepEqual(deckTokens({}), {
    bg: "#070906",
    chrome: "#0a0d08",
    panel: "#0f130d",
    raised: "#1a2116",
    line: "#2b3524",
    text: "#a4ac86",
    strong: "#dfe3cf",
    muted: "#8e9774",
    brand: "#7fa07f",
    hold: "#b5803a",
    holdInk: "#000000",
    holdBg: "#1a1209",
    work: "#b6ad90",
    ok: "#8fb38f",
    okBg: "#0a1a0a",
    nodata: "#a68a64",
    fail: "#b5564f",
    addBg: "#0a1a0a",
    delBg: "#582f0e",
  });
});

test("theme keys override", () => {
  assert.equal(deckTokens({ accent: "#123456" }).brand, "#123456");
  assert.equal(deckTokens({ deck_hold_bg: "#222222" }).holdBg, "#222222");
  assert.equal(deckTokens({ ansi1: "#111111" }).fail, "#111111");
});
