// #23: the Driver ticks components in a fixed order, nothing advances between
// ticks, and tickUntil fails loud rather than sleeping or giving up.

import { Driver, type Tickable, TickBudgetExceeded } from "../../src/engine/core/tickable.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "../assert.ts";

/** A component that records the global tick order into a shared log when ticked. */
class Recorder implements Tickable {
  constructor(readonly name: string, private log: string[]) {}
  ticks = 0;
  tick(): void {
    this.ticks += 1;
    this.log.push(this.name);
  }
}

Deno.test("Driver: ticks every component once per step, in registration order", () => {
  const log: string[] = [];
  const a = new Recorder("a", log);
  const b = new Recorder("b", log);
  const c = new Recorder("c", log);
  const d = new Driver([a, b, c]);
  assertEquals(d.order, ["a", "b", "c"]);

  d.tick();
  d.tick();
  assertStrictEquals(d.step, 2);
  assertStrictEquals(a.ticks, 2);
  assertStrictEquals(b.ticks, 2);
  assertStrictEquals(c.ticks, 2);
  // Fixed order, every step: a b c, a b c.
  assertEquals(log, ["a", "b", "c", "a", "b", "c"]);
});

Deno.test("Driver: a component does not advance between ticks", () => {
  const log: string[] = [];
  const a = new Recorder("a", log);
  const d = new Driver([a]);
  assertStrictEquals(a.ticks, 0); // construction does not tick
  d.tick();
  assertStrictEquals(a.ticks, 1);
  // Reading state, inspecting the driver, time passing in the test: none of it ticks.
  assertStrictEquals(d.step, 1);
  assertStrictEquals(a.ticks, 1);
});

Deno.test("Driver: tickUntil returns the ticks taken and stops as soon as the predicate holds", () => {
  const log: string[] = [];
  const a = new Recorder("a", log);
  const d = new Driver([a]);
  const taken = d.tickUntil(() => a.ticks >= 3, 10);
  assertStrictEquals(taken, 3);
  assertStrictEquals(a.ticks, 3);
});

Deno.test("Driver: tickUntil returns 0 when the predicate already holds", () => {
  const d = new Driver([new Recorder("a", [])]);
  assertStrictEquals(d.tickUntil(() => true, 5), 0);
  assertStrictEquals(d.step, 0);
});

Deno.test("Driver: tickUntil throws TickBudgetExceeded instead of looping forever", () => {
  const d = new Driver([new Recorder("a", [])]);
  assertThrows(() => d.tickUntil(() => false, 4), "bound of 4");
  // The error is typed so callers can distinguish it from a SUT error.
  let caught: unknown;
  try {
    d.tickUntil(() => false, 2);
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof TickBudgetExceeded);
  assertStrictEquals((caught as TickBudgetExceeded).bound, 2);
});

Deno.test("Driver: an empty component set still advances the step counter", () => {
  const d = new Driver([]);
  d.tick();
  assertStrictEquals(d.step, 1);
  assertEquals(d.order, []);
});
