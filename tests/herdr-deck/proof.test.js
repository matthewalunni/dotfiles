import test from "node:test";
import assert from "node:assert/strict";
import { parseProofFile, buildClaims, mergeState, stampText } from "../../dot_config/herdr-app/mods/deck/lib/proof.js";

const openPr = { number: 1, title: "t", state: "OPEN", checks: [] };
const ci = (name, status) => ({ name, status, detail: "" });

test("parseProofFile tolerates bad input", () => {
  assert.deepEqual(parseProofFile(null), []);
  assert.deepEqual(parseProofFile("{nope"), []);
  assert.deepEqual(parseProofFile('{"claims":[{"evidence":"x"}]}'), []);
  assert.deepEqual(parseProofFile('{"claims":"x"}'), []);
  assert.deepEqual(parseProofFile("[]"), []);
  assert.deepEqual(parseProofFile("null"), []);
});

test("parseProofFile keeps valid claims", () => {
  const t = JSON.stringify({ claims: [{ claim: "A", evidence: "e", path: "a.png" }, { claim: "B" }, { claim: 3 }, null] });
  assert.deepEqual(parseProofFile(t), [{ claim: "A", path: "a.png" }, { claim: "B", path: null }]);
});

test("buildClaims orders CI first and maps verdicts", () => {
  const claims = buildClaims(
    [ci("build", "pass"), ci("lint", "fail"), ci("e2e", "pending")],
    [{ claim: "Has file", path: "a.png" }, { claim: "Missing", path: "b.png" }, { claim: "No path", path: null }],
    { "a.png": true, "b.png": false },
  );
  assert.deepEqual(claims.map((c) => [c.claim, c.verdict, c.source]), [
    ["build", "PASS", "ci"], ["lint", "FAIL", "ci"], ["e2e", "NO DATA", "ci"],
    ["Has file", "PASS", "agent"], ["Missing", "NO DATA", "agent"], ["No path", "NO DATA", "agent"],
  ]);
  assert.equal(claims[2].detail, "running");
  assert.equal(claims[3].path, "a.png");
});

test("all-pass CI plus existing agent file unlocks merge", () => {
  const claims = buildClaims([ci("build", "pass")], [{ claim: "Settings screen updated", path: "s.png" }], { "s.png": true });
  assert.deepEqual(mergeState(openPr, null, claims), { canMerge: true, showAnyway: false, reasons: [] });
  assert.equal(stampText(claims), "2 of 2");
});

test("missing evidence file locks merge", () => {
  const claims = buildClaims([ci("build", "pass")], [{ claim: "Settings screen updated", path: "s.png" }], { "s.png": false });
  assert.deepEqual(mergeState(openPr, null, claims), {
    canMerge: false, showAnyway: true, reasons: ["Settings screen updated: NO DATA"],
  });
});

test("failing and running CI reasons", () => {
  const claims = buildClaims([ci("lint", "fail"), ci("e2e", "pending")], [], {});
  assert.deepEqual(mergeState(openPr, null, claims).reasons, ["lint: failing", "e2e: still running"]);
});

test("no claims at all", () => {
  assert.deepEqual(mergeState(openPr, null, []), { canMerge: false, showAnyway: true, reasons: ["No proof or checks"] });
  assert.equal(stampText([]), "0 of 0");
});

test("no buttons when pr missing, closed, merged or gh errored", () => {
  const none = { canMerge: false, showAnyway: false, reasons: [] };
  const pass = [{ claim: "x", verdict: "PASS", source: "ci", path: null, detail: null }];
  assert.deepEqual(mergeState({ ...openPr, state: "MERGED" }, null, pass), none);
  assert.deepEqual(mergeState({ ...openPr, state: "CLOSED" }, null, []), none);
  assert.deepEqual(mergeState(null, null, pass), none);
  assert.deepEqual(mergeState(openPr, "gh failed", pass), none);
});

test("stampText counts PASS over total", () => {
  const c = (verdict) => ({ claim: "x", verdict, source: "ci", path: null, detail: null });
  assert.equal(stampText([c("PASS"), c("PASS"), c("FAIL")]), "2 of 3");
});
