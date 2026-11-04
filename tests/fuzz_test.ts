import { fuzz } from "@0xheartcode/simharness";
import type { GameState } from "@0xheartcode/simharness/adapter";
import { MockAdapter, type MockExtra } from "./mock_adapter.ts";
import { assert, assertStrictEquals } from "./assert.ts";

Deno.test("fuzz: clean adapter reports ok with phase coverage", () => {
  const res = fuzz(new MockAdapter(), { seeds: 5, ticks: 20 });
  assertStrictEquals(res.ok, true);
  assertStrictEquals(res.failures.length, 0);
  // every seed stayed 'running' for the full 20 ticks => coverage reflects it
  assertStrictEquals(res.coverage.phases.running, 5);
  assertStrictEquals(res.coverage.maxTick, 20);
  assertStrictEquals(res.coverage.actions, undefined, "no action coverage for a movement-driven adapter");
});

Deno.test("fuzz: catches a NaN hero hp and records the first failing tick", () => {
  const res = fuzz(new MockAdapter({ nanAt: 2 }), { seeds: 3, ticks: 10 });
  assertStrictEquals(res.ok, false);
  const nan = res.failures.find((f) => f.message.includes("NaN hero hp"));
  assert(nan, "a NaN hp must be reported");
  assert(nan!.tick >= 0, "the failure carries the tick it first reproduces at");
});

Deno.test("fuzz: catches a thrown step() (tick -1)", () => {
  const res = fuzz(new MockAdapter({ throwAt: 1 }), { seeds: 2, ticks: 10 });
  const thrown = res.failures.find((f) => f.message.includes("threw boom"));
  assert(thrown, JSON.stringify(res.failures));
  assertStrictEquals(thrown!.tick, -1);
});

Deno.test("fuzz: applies consumer invariants", () => {
  const invariants = (s: GameState<MockExtra>) => (s.extra.count > 3 ? ["count ran away"] : []);
  const res = fuzz(new MockAdapter(), { seeds: 1, ticks: 10, invariants });
  assert(res.failures.some((f) => f.message.includes("count ran away")), JSON.stringify(res.failures));
});

Deno.test("fuzz: de-duplicates identical failures across ticks (earliest kept)", () => {
  const res = fuzz(new MockAdapter({ nanAt: 1 }), { seeds: 1, ticks: 20 });
  const nanLines = res.failures.filter((f) => f.message.includes("NaN hero hp"));
  assertStrictEquals(nanLines.length, 1);
});

Deno.test("fuzz: seedBase shifts the seed set", () => {
  // Distinct seedBase values must still run cleanly on a clean adapter.
  const a = fuzz(new MockAdapter(), { seeds: 2, ticks: 5, seedBase: 50 });
  assertStrictEquals(a.ok, true);
});
