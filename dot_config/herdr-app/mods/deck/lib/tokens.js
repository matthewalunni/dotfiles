// Pure color tokens for Deck. No herdr imports, so node can test it.
// Maps Herdr theme() keys onto Deck roles; falls back to Earthcode Moss.

const MOSS = {
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
  okBg: "#132013",
  nodata: "#a68a64",
  fail: "#b5564f",
  addBg: "#0a1a0a",
  delBg: "#582f0e",
};

// Repo identity colours (fixed, not theme-mapped): a repo keeps its colour everywhere.
const REPO = ["#f2a65a", "#ef6f6c", "#4fc1a6", "#6f9ceb", "#9bcf7a", "#b58be0", "#e0c56a", "#6fc4d8"];

// token -> theme key
const KEYS = {
  bg: "background",
  chrome: "chrome",
  panel: "surface",
  raised: "raised",
  line: "border",
  text: "muted",
  strong: "foreground",
  muted: "dim",
  brand: "accent",
  hold: "blocked",
  holdInk: "solid_foreground",
  holdBg: "deck_hold_bg",
  work: "working",
  ok: "done",
  okBg: "deck_ok_bg",
  nodata: "unknown",
  fail: "ansi1",
  addBg: "deck_add_bg",
  delBg: "deck_del_bg",
};

export function deckTokens(theme = {}) {
  const out = {};
  for (const [token, key] of Object.entries(KEYS)) {
    out[token] = theme?.[key] || MOSS[token];
  }
  out.repo = REPO;
  return out;
}
