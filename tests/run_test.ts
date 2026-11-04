import { run } from "@0xheartcode/simharness";
import { MockAdapter } from "./mock_adapter.ts";
import { assert, assertEquals, assertStrictEquals } from "./assert.ts";

Deno.test("run: steps for the full tick budget when the run stays live", () => {
  const a = new MockAdapter();
  const r = run(a, { seed: 1, ticks: 10, stopOnEnd: false });
  assertStrictEquals(r.final.tick, 10);
  assertStrictEquals(r.final.phase, "running");
});

Deno.test("run: stops early when phase leaves 'running' (stopOnEnd default)", () => {
  const a = new MockAdapter({ endAt: 4 });
  const r = run(a, { seed: 1, ticks: 100 });
  assertStrictEquals(r.final.phase, "over");
  assertStrictEquals(r.final.tick, 4);
  const phaseEv = r.events.find((e) => e.type === "phase");
  assert(phaseEv, "a phase event should fire when phase changes");
  assertStrictEquals(phaseEv!.detail, "over");
});

Deno.test("run: stopOnEnd=false keeps the loop going past the end", () => {
  const a = new MockAdapter({ endAt: 3 });
  let iterations = 0;
  const r = run(a, { seed: 1, ticks: 8, stopOnEnd: false, timeline: () => void iterations++ });
  assertStrictEquals(iterations, 8, "the loop must not break early when stopOnEnd is false");
  assertStrictEquals(r.final.phase, "over");
});

Deno.test("run: derives a 'clear' event when the enemy count drops", () => {
  const a = new MockAdapter({ killOnFire: true, enemies: 3 });
  const r = run(a, { seed: 1, ticks: 3, stopOnEnd: false, timeline: () => ({ fire: true }) });
  const clears = r.events.filter((e) => e.type === "clear");
  assertStrictEquals(clears.length, 3);
  assertStrictEquals(r.final.enemies.length, 0);
});

Deno.test("run: derives a 'hero-down' event on the transition to down", () => {
  const a = new MockAdapter({ bleed: 2 });
  const r = run(a, { seed: 1, ticks: 100 });
  const downs = r.events.filter((e) => e.type === "hero-down");
  assertStrictEquals(downs.length, 1, "hero-down fires exactly once, on the edge");
  assert(r.final.hero?.down);
});

Deno.test("run: forwards config to reset(seed, config)", () => {
  const a = new MockAdapter();
  run(a, { seed: 1, ticks: 1, stopOnEnd: false, config: { difficulty: "hard" } });
  assertEquals(a.receivedConfig, { difficulty: "hard" });
});

Deno.test("run: noReset keeps a pre-staged state", () => {
  const a = new MockAdapter();
  a.reset(1);
  a.debug("clear"); // stage: remove all enemies before the run
  const r = run(a, { seed: 99, ticks: 2, noReset: true, stopOnEnd: false });
  assertStrictEquals(r.final.enemies.length, 0, "noReset should not re-seed the adapter");
});

Deno.test("run: stopWhen halts as soon as the predicate holds", () => {
  const a = new MockAdapter();
  const r = run(a, { seed: 1, ticks: 100, stopOnEnd: false, stopWhen: (s) => s.tick >= 5 });
  assertStrictEquals(r.final.tick, 5);
});

Deno.test("run: records invariant breaks (deduped) without throwing", () => {
  const a = new MockAdapter();
  const r = run(a, {
    seed: 1,
    ticks: 4,
    stopOnEnd: false,
    invariants: (s) => (s.tick > 1 ? ["tick too high"] : []),
  });
  assert(r.invariantBreaks.length >= 1, "a break is recorded");
  assert(r.invariantBreaks.every((m) => m.includes("tick too high")));
});

Deno.test("run: no invariants => empty invariantBreaks", () => {
  const r = run(new MockAdapter(), { seed: 1, ticks: 3, stopOnEnd: false });
  assertEquals(r.invariantBreaks, []);
});

Deno.test("run: timeline receives tick, state and adapter", () => {
  const a = new MockAdapter();
  const seenTicks: number[] = [];
  run(a, {
    seed: 1,
    ticks: 3,
    stopOnEnd: false,
    timeline: (t, s, adapter) => {
      seenTicks.push(t);
      assertStrictEquals(adapter, a);
      assert(typeof s.tick === "number");
    },
  });
  assertEquals(seenTicks, [0, 1, 2]);
});
