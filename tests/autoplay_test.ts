import { autoplay } from "@0xheartcode/simharness";
import { MockAdapter } from "./mock_adapter.ts";
import { assert, assertStrictEquals } from "./assert.ts";

Deno.test("autoplay: plays a run under the named strategy", () => {
  const a = new MockAdapter({ killOnFire: true, enemies: 3 });
  const r = autoplay(a, { seed: 1, ticks: 50, strategy: "aggressive" });
  // aggressive holds fire whenever an enemy exists, so killOnFire clears them.
  assertStrictEquals(r.final.enemies.length, 0);
  assert(r.final.extra.fired > 0);
});

Deno.test("autoplay: defaults to aggressive when no strategy is given", () => {
  const a = new MockAdapter();
  const r = autoplay(a, { seed: 2, ticks: 5 });
  assert(r.final.extra.fired > 0, "default strategy should fire at enemies");
});

Deno.test("autoplay: an unknown strategy falls back to aggressive", () => {
  const a = new MockAdapter();
  const r = autoplay(a, { seed: 3, ticks: 5, strategy: "nope-not-real" });
  assert(r.final.extra.fired > 0);
});

Deno.test("autoplay: idle strategy fires nothing", () => {
  const a = new MockAdapter();
  const r = autoplay(a, { seed: 4, ticks: 5, strategy: "idle" });
  assertStrictEquals(r.final.extra.fired, 0);
});
