import { fuzz } from "@0xheartcode/simharness";
import type { GameState } from "@0xheartcode/simharness/adapter";
import { MockAdapter, type MockExtra } from "./mock_adapter.ts";
import { assert, assertStrictEquals } from "./assert.ts";

Deno.test("fuzz: clean adapter reports no failures", () => {
  const fails = fuzz(new MockAdapter(), { seeds: 5, ticks: 20 });
  assertStrictEquals(fails.length, 0);
});

Deno.test("fuzz: catches a NaN hero hp", () => {
  const fails = fuzz(new MockAdapter({ nanAt: 2 }), { seeds: 3, ticks: 10 });
  assert(fails.length > 0, "a NaN hp must be reported");
  assert(fails.some((f) => f.includes("NaN hero hp")), fails.join(" | "));
});

Deno.test("fuzz: catches a thrown step()", () => {
  const fails = fuzz(new MockAdapter({ throwAt: 1 }), { seeds: 2, ticks: 10 });
  assert(fails.some((f) => f.includes("threw boom")), fails.join(" | "));
});

Deno.test("fuzz: applies consumer invariants", () => {
  const invariants = (s: GameState<MockExtra>) => (s.extra.count > 3 ? ["count ran away"] : []);
  const fails = fuzz(new MockAdapter(), { seeds: 1, ticks: 10, invariants });
  assert(fails.some((f) => f.includes("count ran away")), fails.join(" | "));
});

Deno.test("fuzz: de-duplicates identical failures across ticks", () => {
  // nanAt makes every post-trigger check report the same message; the Set in
  // fuzz() must collapse it to one line per seed.
  const fails = fuzz(new MockAdapter({ nanAt: 1 }), { seeds: 1, ticks: 20 });
  const nanLines = fails.filter((f) => f.includes("NaN hero hp"));
  assertStrictEquals(nanLines.length, 1);
});
