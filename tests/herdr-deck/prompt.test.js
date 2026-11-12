import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePrompt, samePrompt } from "../../dot_config/herdr-app/mods/deck/lib/prompt.js";

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

const composer = "\n" + "─".repeat(60) + "\n❯ \n" + "─".repeat(60) + "\n  ctx:6%\n";

test("done agent: trailing numbered list is a question with typed replies, never digit keys", () => {
  const p = parsePrompt("⏺ Pick one:\n  1. Yes\n  2. No\n" + composer, "done");
  assert.equal(p.kind, "question");
  assert.deepEqual(p.options, [
    { label: "Yes", keys: [], reply: "1" },
    { label: "No", keys: [], reply: "2" },
  ]);
  assert.match(p.text, /Pick one/);
  assert.equal(parsePrompt("1. foo\n2. bar\n" + composer, "idle").kind, "none");
  assert.equal(parsePrompt(fx("permission"), "done").kind === "permission", false);
});

test("arrow keys are relative to the cursor row", () => {
  const screen = (sel) =>
    ["", " Pick a thing", "", ...["alpha", "beta", "gamma"].map((l, i) => (i === sel ? " ❯ " : "   ") + l), "", " Enter to confirm · Esc to cancel"].join("\n");
  assert.deepEqual(parsePrompt(screen(1), "blocked").options.map((o) => o.keys), [["up", "enter"], ["enter"], ["down", "enter"]]);
  assert.deepEqual(parsePrompt(screen(0), "blocked").options.map((o) => o.keys), [["enter"], ["down", "enter"], ["down", "down", "enter"]]);
});

test("samePrompt compares kind, text and labels only", () => {
  const a = parsePrompt(fx("permission"), "blocked");
  assert.ok(samePrompt(a, parsePrompt(fx("permission"), "blocked")));
  assert.ok(!samePrompt(a, parsePrompt(fx("menu"), "blocked")));
  assert.ok(!samePrompt(a, { ...a, text: "other" }));
  assert.ok(!samePrompt(a, { ...a, options: a.options.slice(1) }));
  assert.ok(samePrompt(a, { ...a, options: a.options.map((o) => ({ ...o, keys: ["x"] })) }));
});

test("wrapped permission labels are rejoined; menu descriptions are not", () => {
  const screen = ` Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for commands that start with
   npm run build in /x
   3. No

 Esc to cancel · Tab to amend`;
  const p = parsePrompt(screen, "blocked");
  assert.equal(p.options[1].label, "Yes, and don't ask again for commands that start with npm run build in /x");
  assert.deepEqual(p.options.map((o) => o.label).length, 3);
  assert.deepEqual(parsePrompt(fx("menu"), "blocked").options.map((o) => o.label).slice(0, 2), ["Red", "Green"]);
});

test("only ❯ marks a selection; a markdown blockquote list is not a menu", () => {
  const p = parsePrompt("⏺ Options\n> 1. a\n> 2. b\n" + composer, "blocked");
  assert.deepEqual(p.options, []);
  assert.notEqual(p.kind, "menu");
});

test("blocked menu: options 10 and up get no key option (one digit key only)", () => {
  const rows = Array.from({ length: 11 }, (_, n) => `${n === 0 ? "❯" : " "} ${n + 1}. pick ${n + 1}`);
  const screen = ["Pick a color", "", ...rows, "", "Enter to select · Esc to cancel"].join("\n");
  const p = parsePrompt(screen, "blocked");
  assert.equal(p.kind, "menu");
  assert.equal(p.options.length, 9);
  assert.deepEqual(p.options.at(-1), { label: "pick 9", keys: ["9"] });
  assert.ok(p.options.every((o) => o.keys.length === 1 && o.keys[0].length === 1));
});
