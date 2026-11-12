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

test("prototype-key paths never count as existing evidence", () => {
  for (const path of ["constructor", "toString", "__proto__"]) {
    const claims = buildClaims([], [{ claim: "x", path }], {});
    assert.equal(claims[0].verdict, "NO DATA");
    assert.equal(mergeState(openPr, null, claims).canMerge, false);
  }
});

test("parseProofFile drops unsafe paths but keeps the claim", () => {
  for (const path of ["/etc/passwd", "../x", "a/../../b", "~/x", "a\\..\\b", "a\nb", "a\0b"]) {
    const r = parseProofFile(JSON.stringify({ claims: [{ claim: "c", path }] }));
    assert.deepEqual(r, [{ claim: "c", path: null }], path);
  }
  assert.deepEqual(parseProofFile('{"claims":[{"claim":"c","path":"proof/a..b.png"}]}'), [{ claim: "c", path: "proof/a..b.png" }]);
});

test("parseProofFile drops empty or whitespace claims", () => {
  assert.deepEqual(parseProofFile('{"claims":[{"claim":""},{"claim":"  \\t"}]}'), []);
});

test("evidenceOpenArgs opens resolved evidence only with an explicit viewer", async () => {
  const { evidenceOpenArgs } = await import("../../dot_config/herdr-app/mods/deck/lib/proof.js");
  const root = "/real/repo";
  for (const ext of ["png", "jpg", "jpeg", "gif", "heic", "webp", "pdf", "PNG"]) {
    assert.deepEqual(evidenceOpenArgs(`/real/repo/proof/a.${ext}`, root), ["-a", "Preview", `/real/repo/proof/a.${ext}`]);
  }
  for (const ext of ["txt", "log", "md", "json"]) {
    assert.deepEqual(evidenceOpenArgs(`/real/repo/a.${ext}`, root), ["-e", `/real/repo/a.${ext}`]);
  }
  for (const ext of ["mp4", "mov", "m4v", "mp3", "wav", "m4a"]) {
    assert.deepEqual(evidenceOpenArgs(`/real/repo/x y/a.${ext}`, root), ["-a", "QuickTime Player", `/real/repo/x y/a.${ext}`]);
  }
  // Anything else, svg included, is only revealed in Finder.
  assert.deepEqual(evidenceOpenArgs("/real/repo/a.svg", root), ["-R", "/real/repo/a.svg"]);
  assert.deepEqual(evidenceOpenArgs("/real/repo/run.command", root), ["-R", "/real/repo/run.command"]);
  assert.deepEqual(evidenceOpenArgs("/real/repo/noext", root), ["-R", "/real/repo/noext"]);
  assert.deepEqual(evidenceOpenArgs("/real/repo/.png", root), ["-R", "/real/repo/.png"]);
  // Outside the resolved root, relative, or malformed: refused.
  assert.equal(evidenceOpenArgs("/real/repository/a.png", root), null);
  assert.equal(evidenceOpenArgs("/real/repo", root), null);
  assert.equal(evidenceOpenArgs("/etc/a.png", root), null);
  assert.equal(evidenceOpenArgs("real/repo/a.png", root), null);
  assert.equal(evidenceOpenArgs("/real/repo/../etc/a.png", root), null);
  assert.equal(evidenceOpenArgs("/real/repo/a\0.png", root), null);
  assert.equal(evidenceOpenArgs("/real/repo/a.png", ""), null);
  assert.equal(evidenceOpenArgs(null, root), null);
});

test("a .png symlink to a .command is judged by its resolved target", async () => {
  const { evidenceOpenArgs } = await import("../../dot_config/herdr-app/mods/deck/lib/proof.js");
  const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "deck-proof-"));
  try {
    mkdirSync(join(dir, "proof"));
    writeFileSync(join(dir, "proof", "run.command"), "#!/bin/sh\necho hi\n");
    symlinkSync("run.command", join(dir, "proof", "shot.png"));
    const realRoot = realpathSync(dir);
    const resolved = realpathSync(join(dir, "proof", "shot.png"));
    assert.deepEqual(evidenceOpenArgs(resolved, realRoot), ["-R", join(realRoot, "proof", "run.command")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
