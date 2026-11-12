import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePrompt } from "../../dot_config/herdr-app/mods/deck/lib/prompt.js";

const fx = (n) => readFileSync(new URL(`./fixtures/screen-${n}.txt`, import.meta.url), "utf8");

test("permission prompt mirrors every option with its own wording", () => {
  const p = parsePrompt(fx("permission"), "blocked");
  assert.equal(p.kind, "permission");
  assert.deepEqual(p.options, [
    { label: "Yes", keys: ["1"] },
    { label: "Yes, and always allow access to /private/tmp/deck-prompt/w from this project", keys: ["2"] },
    { label: "Yes, and switch to auto mode · auto mode handles these prompts for you", keys: ["3"] },
    { label: "No", keys: ["4"] },
  ]);
  assert.match(p.text, /touch hello\.txt/);
  assert.match(p.text, /Do you want to proceed\?/);
  assert.ok(p.text.length <= 400);
});

test("AskUserQuestion menu is kind menu, descriptions and mid-list separator tolerated", () => {
  const p = parsePrompt(fx("menu"), "blocked");
  assert.equal(p.kind, "menu");
  assert.deepEqual(p.options.map((o) => o.label), ["Red", "Green", "Blue", "Type something.", "Chat about this"]);
  assert.deepEqual(p.options.map((o) => o.keys), [["1"], ["2"], ["3"], ["4"], ["5"]]);
  assert.match(p.text, /Which color do you prefer\?/);
});

test("end-of-turn question carries the agent's last message", () => {
  const p = parsePrompt(fx("question"), "done");
  assert.equal(p.kind, "question");
  assert.match(p.text, /Want me to show what's in s1\.txt\?/);
  assert.deepEqual(p.options, []);
  assert.ok(p.text.length <= 400);
});

test("a numbered list the agent wrote at end of turn is a question, not a menu", () => {
  const p = parsePrompt(fx("choice-list"), "done");
  assert.equal(p.kind, "question");
  assert.match(p.text, /Which one do you want\?/);
  assert.match(p.text, /Driftwood/);
  assert.deepEqual(p.options, []);
});

test("working agent has no prompt, even with prompt-like text on screen", () => {
  assert.equal(parsePrompt(fx("working"), "working").kind, "none");
  assert.equal(parsePrompt(fx("permission"), "working").kind, "none");
});

test("an old numbered list in scrollback is stale", () => {
  const p = parsePrompt(fx("stale"), "done");
  assert.notEqual(p.kind, "permission");
  assert.notEqual(p.kind, "menu");
  assert.equal(p.kind, "question");
  assert.match(p.text, /Rivers carve/);
});

test("unnumbered trust dialog (Yes/No labels) is a permission driven by arrow keys", () => {
  const p = parsePrompt(fx("trust-dialog"), "blocked");
  assert.equal(p.kind, "permission");
  assert.deepEqual(p.options, [
    { label: "No, exit", keys: ["enter"] },
    { label: "Yes, I trust this folder", keys: ["down", "enter"] },
  ]);
  assert.match(p.text, /Is this a project you created or one you trust/);
});

test("strips ANSI escapes and handles empty input", () => {
  const colored = fx("permission").replace(/^( Do you want to proceed\?)/m, "\x1b[1m$1\x1b[0m").replace(/❯ 1\./, "\x1b[36m❯ 1.\x1b[0m");
  const p = parsePrompt(colored, "blocked");
  assert.equal(p.kind, "permission");
  assert.equal(p.options[0].label, "Yes");
  assert.equal(parsePrompt("", "blocked").kind, "none");
  assert.equal(parsePrompt("", "idle").kind, "none");
});
