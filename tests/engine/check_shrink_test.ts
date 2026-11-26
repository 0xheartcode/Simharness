// #37: shrinking reduces a failing run to a minimal essential fault set, still
// failing and deterministic; the generic index shrinker is 1-minimal.

import { minimalRepro, shrinkIndices } from "../../src/engine/check/shrink.ts";
import { checkInvariants, runScenario } from "../../src/engine/cli/scenario.ts";
import { gossipScenario } from "../../examples/gossip-register/scenario.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

const PROFILE = "partition-heavy";
const TICKS = 120;

function firstFailingSeed(max = 40): number {
  const s = gossipScenario({ buggy: true });
  for (let seed = 0; seed < max; seed++) {
    if (checkInvariants(s, runScenario(s, { seed, ticks: TICKS, profile: PROFILE })).length > 0) return seed;
  }
  throw new Error("no failing seed found for the buggy scenario");
}

Deno.test("shrinkIndices: returns a 1-minimal set, deterministically", () => {
  assertEquals(shrinkIndices([0, 1, 2, 3, 4, 5], (k) => k.has(1) && k.has(4)), [1, 4]);
  assertEquals(shrinkIndices([0, 1, 2, 3], (k) => k.has(3)), [3]);
  assertEquals(shrinkIndices([0, 1, 2], () => true), []); // nothing is essential
});

Deno.test("minimalRepro: reduces a failing buggy run and the reduction still fails", () => {
  const scenario = gossipScenario({ buggy: true });
  const seed = firstFailingSeed();
  const failed = (r: ReturnType<typeof runScenario>) => checkInvariants(scenario, r).length > 0;
  const repro = minimalRepro(scenario, { seed, ticks: TICKS, profile: PROFILE }, failed);
  assert(repro !== null);
  assert(repro.mask.length <= repro.fullFaultCount);
  // the reduced fault set still reproduces the failure
  assert(failed(runScenario(scenario, { seed, ticks: TICKS, profile: PROFILE, mask: new Set(repro.mask) })));
  assert(repro.replay.includes(`replay ${seed}`));
});

Deno.test("minimalRepro: is deterministic", () => {
  const scenario = gossipScenario({ buggy: true });
  const seed = firstFailingSeed();
  const failed = (r: ReturnType<typeof runScenario>) => checkInvariants(scenario, r).length > 0;
  const a = minimalRepro(scenario, { seed, ticks: TICKS, profile: PROFILE }, failed);
  const b = minimalRepro(scenario, { seed, ticks: TICKS, profile: PROFILE }, failed);
  assertEquals(a!.mask, b!.mask);
});

Deno.test("minimalRepro: returns null when the run does not fail", () => {
  const scenario = gossipScenario(); // correct
  const repro = minimalRepro(
    scenario,
    { seed: 1, ticks: 100, profile: PROFILE },
    (r) => checkInvariants(scenario, r).length > 0,
  );
  assertStrictEquals(repro, null);
});
