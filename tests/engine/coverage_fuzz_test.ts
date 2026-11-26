// #42 integrated: coverage-guided fuzzing over fault scripts builds toward a
// cascade bug a blind search cannot reach in the same budget, and Scripted
// decisions replay an explicit fault script faithfully.

import { blindFuzz, coverageFuzz } from "../../src/engine/check/coverage_fuzz.ts";
import { checkInvariants, runScenario } from "../../src/engine/cli/scenario.ts";
import { runCli } from "../../src/engine/cli/cli.ts";
import type { ScheduleEntry } from "../../src/engine/sim/decisions.ts";
import { cascadeScenario } from "../../examples/cascade/scenario.ts";
import { MONITOR, SOURCES } from "../../examples/cascade/cascade.ts";
import { assert, assertEquals, assertStrictEquals, captureConsole } from "../assert.ts";

const TICKS = 24;

function allDrops(): ScheduleEntry[] {
  return SOURCES.map((s) => ({ tick: 1, action: "drop", targets: [s, MONITOR], detail: { dropRate: 1 } }));
}

Deno.test("cascade: no faults keeps the monitor at stage 0", () => {
  const run = runScenario(cascadeScenario(), { seed: 0, ticks: TICKS, profile: "quiet", faultScript: [] });
  assertEquals(checkInvariants(cascadeScenario(), run), []);
  assertStrictEquals((run.nodeStates[MONITOR] as { stage: number }).stage, 0);
});

Deno.test("cascade: silencing every source trips the full-cascade invariant (ScriptedDecisions replay)", () => {
  const run = runScenario(cascadeScenario(), { seed: 0, ticks: TICKS, profile: "quiet", faultScript: allDrops() });
  assert(checkInvariants(cascadeScenario(), run).length > 0, "all-drops must reach the full cascade");
});

Deno.test("coverageFuzz: builds toward the cascade bug", () => {
  const result = coverageFuzz(cascadeScenario(), { seed: 1, ticks: TICKS, iterations: 60000, maxFaults: 16 });
  assert(result.bug !== null, `coverage-guided fuzzing must find the cascade bug (coverage ${result.coverage})`);
  assert(result.bug.breaks[0].includes("full-cascade"));
  // the found script replays to the same failure
  const replay = runScenario(cascadeScenario(), {
    seed: 0,
    ticks: TICKS,
    profile: "quiet",
    faultScript: result.bug.faults,
  });
  assert(checkInvariants(cascadeScenario(), replay).length > 0);
});

Deno.test("blindFuzz: does not reach the cascade bug in the same budget", () => {
  const result = blindFuzz(cascadeScenario(), { seed: 1, ticks: TICKS, iterations: 60000, maxFaults: 16 });
  assertStrictEquals(result.bug, null);
});

Deno.test("coverageFuzz: is deterministic", () => {
  const a = coverageFuzz(cascadeScenario(), { seed: 2, ticks: TICKS, iterations: 5000 });
  const b = coverageFuzz(cascadeScenario(), { seed: 2, ticks: TICKS, iterations: 5000 });
  assertStrictEquals(a.iterations, b.iterations);
  assertStrictEquals(a.coverage, b.coverage);
});

Deno.test("cli fuzz --guided: reports the fault script it found and exits 1", () => {
  let code = -1;
  const { out } = captureConsole(() => {
    code = runCli(["fuzz", "1", "--guided", "--ticks", String(TICKS), "--iterations", "60000"], cascadeScenario());
  });
  assertStrictEquals(code, 1);
  assert(out.join("\n").includes("coverage-guided fuzzing found a fault script"), out.join("\n"));
});
