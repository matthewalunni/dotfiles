import test from "node:test";
import assert from "node:assert/strict";
import { parseMachines } from "../../dot_config/herdr-app/mods/deck/lib/machines.js";

// Real `hc machine ls --json` with none added prints {"machines":[]}; entry fields below are assumed.
test("parses machines", () => {
  const out = JSON.stringify({ machines: [
    { name: "mac-mini", status: "online", agents: 2 },
    { name: "build-box", online: false } ] });
  assert.deepEqual(parseMachines(out, 0), [
    { name: "mac-mini", online: true, agents: 2 }, { name: "build-box", online: false, agents: 0 }]);
});
test("empty list", () => assert.deepEqual(parseMachines('{"machines":[]}', 0), []));
test("bad output means none", () => {
  assert.deepEqual(parseMachines("", 0), []);
  assert.deepEqual(parseMachines("not json", 0), []);
  assert.deepEqual(parseMachines('{"machines":[{"name":"mac-mini"}]}', 1), []);
  assert.deepEqual(parseMachines("null", 0), []);
  assert.deepEqual(parseMachines('{"machines":"x"}', 0), []);
});
