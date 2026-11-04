import { autoplay, resolveStrategy } from "@0xheartcode/simharness";
import type { Strategy } from "@0xheartcode/simharness/adapter";
import { MockAdapter, type MockExtra } from "./mock_adapter.ts";
import { assert, assertStrictEquals, assertThrows } from "./assert.ts";

Deno.test("autoplay: plays a run under the named strategy", () => {
  const a = new MockAdapter({ killOnFire: true, enemies: 3 });
  const r = autoplay(a, { seed: 1, ticks: 50, strategy: "aggressive" });
  // aggressive holds fire whenever an enemy exists, so killOnFire clears them.
  assertStrictEquals((r.final.enemies ?? []).length, 0);
  assert(r.final.extra.fired > 0);
});

Deno.test("autoplay: defaults to aggressive when no strategy is given", () => {
  const a = new MockAdapter();
  const r = autoplay(a, { seed: 2, ticks: 5 });
  assert(r.final.extra.fired > 0, "default strategy should fire at enemies");
});

Deno.test("autoplay: an unknown strategy throws (no silent fallback)", () => {
  const a = new MockAdapter();
  assertThrows(
    () => autoplay(a, { seed: 3, ticks: 5, strategy: "nope-not-real" }),
    'unknown strategy "nope-not-real"',
  );
});

Deno.test("autoplay: resolves a project strategy passed via strategies", () => {
  const a = new MockAdapter();
  // A project strategy that never fires; proves custom strategies are resolvable.
  const holdFire: Strategy<MockExtra> = () => ({});
  const r = autoplay(a, { seed: 3, ticks: 5, strategy: "holdFire", strategies: { holdFire } });
  assertStrictEquals(r.final.extra.fired, 0);
});

Deno.test("resolveStrategy: built-ins resolve and project strategies win on name clash", () => {
  assertStrictEquals(typeof resolveStrategy("aggressive"), "function");
  const custom: Strategy = () => ({});
  // override a built-in name
  assertStrictEquals(resolveStrategy("idle", { idle: custom }), custom);
  assertThrows(() => resolveStrategy("ghost"), 'unknown strategy "ghost"');
});

Deno.test("autoplay: idle strategy fires nothing", () => {
  const a = new MockAdapter();
  const r = autoplay(a, { seed: 4, ticks: 5, strategy: "idle" });
  assertStrictEquals(r.final.extra.fired, 0);
});
