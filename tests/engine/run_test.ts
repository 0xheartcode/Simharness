// #26: the run loop fast-forwards ticks with no real time, and a seed reproduces
// both the final state and the event log byte for byte.

import type { SimContext } from "../../src/engine/core/run.ts";
import { Simulation } from "../../src/engine/core/run.ts";
import type { Tickable } from "../../src/engine/core/tickable.ts";
import type { Timeout } from "../../src/engine/core/clock.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

/** A component that, each tick, flips a seeded coin and records the outcome. */
class Coin implements Tickable {
  readonly name = "coin";
  heads = 0;
  constructor(private ctx: SimContext) {}
  tick(): void {
    const h = this.ctx.entropy.rng.bool();
    if (h) this.heads += 1;
    this.ctx.log.record("flip", { id: this.ctx.entropy.ids.next(), heads: h });
  }
}

function runCoins(seed: number, ticks: number): { heads: number; events: string } {
  let coin!: Coin;
  const sim = new Simulation(seed, (ctx) => {
    coin = new Coin(ctx);
    return [coin];
  });
  const r = sim.run(ticks);
  return { heads: coin.heads, events: JSON.stringify(r.events) };
}

Deno.test("Simulation: the same seed reproduces final state and event log exactly", () => {
  const a = runCoins(1234, 50);
  const b = runCoins(1234, 50);
  assertStrictEquals(a.heads, b.heads);
  assertStrictEquals(a.events, b.events);
});

Deno.test("Simulation: a different seed produces a different run", () => {
  const a = runCoins(1, 50);
  const b = runCoins(2, 50);
  assert(a.events !== b.events, "distinct seeds should diverge over 50 flips");
});

Deno.test("Simulation: events are tick-stamped in order, clock ticked first each step", () => {
  const sim = new Simulation(7, (ctx) => [new Coin(ctx)]);
  const r = sim.run(3);
  assertStrictEquals(r.tick, 3);
  assertEquals(r.events.map((e) => e.tick), [1, 2, 3]); // first tick is tick 1
});

Deno.test("Simulation: fast-forward runs 10k ticks with no real time elapsed", () => {
  let timeout!: Timeout;
  const sim = new Simulation(9, (ctx) => {
    timeout = ctx.clock.timeout(10_000);
    return [];
  });
  const start = Date.now();
  const r = sim.runUntil(() => timeout.expired(), 20_000);
  const elapsedMs = Date.now() - start;
  assertStrictEquals(r.tick, 10_000); // expired on exactly the 10,000th tick
  assert(elapsedMs < 5_000, `10k ticks should be near-instant, took ${elapsedMs}ms`);
});

Deno.test("EventLog: omits the detail field when none is given", () => {
  const sim = new Simulation(1, (ctx) => [{
    name: "bare",
    tick: () => ctx.log.record("beat"),
  }]);
  const r = sim.run(1);
  assertEquals(r.events, [{ tick: 1, type: "beat" }]);
});
