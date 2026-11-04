import { flatten, groupBy, seedAssert, summarize } from "@0xheartcode/simharness";
import { assert, assertEquals, assertStrictEquals } from "./assert.ts";

Deno.test("summarize: descriptive stats over a sample", () => {
  const s = summarize([1, 2, 3, 4]);
  assertStrictEquals(s.n, 4);
  assertStrictEquals(s.min, 1);
  assertStrictEquals(s.max, 4);
  assertStrictEquals(s.mean, 2.5);
  assertStrictEquals(s.median, 2.5);
  // odd-length median takes the middle element
  assertStrictEquals(summarize([5, 1, 3]).median, 3);
  assert(s.stdev > 1.1 && s.stdev < 1.2);
});

Deno.test("summarize: empty sample is all NaN", () => {
  const s = summarize([]);
  assertStrictEquals(s.n, 0);
  assert(Number.isNaN(s.mean) && Number.isNaN(s.p95));
});

Deno.test("seedAssert: passes across all seeds, else names the failures", () => {
  const ok = seedAssert("even", [2, 4, 6], (s) => s % 2 === 0);
  assertStrictEquals(ok.ok, true);
  assert(ok.msg!.includes("held across 3 seeds"));
  const bad = seedAssert("small", [1, 2, 9, 10], (s) => s < 5);
  assertStrictEquals(bad.ok, false);
  assert(bad.msg!.includes("2/4") && bad.msg!.includes("9"));
});

Deno.test("groupBy: buckets items by a dimension", () => {
  const g = groupBy([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }], (x) => x.k);
  assertStrictEquals(g.a.length, 2);
  assertStrictEquals(g.b.length, 1);
});

Deno.test("flatten: nested dimensional metrics become dotted keys", () => {
  const flat = flatten({ floor1: { avgCore: 3, deaths: 0 }, winRate: 0.9, tags: ["x"] });
  assertEquals(flat, { "floor1.avgCore": 3, "floor1.deaths": 0, winRate: 0.9, tags: ["x"] });
});
