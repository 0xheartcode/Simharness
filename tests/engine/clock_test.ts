// #24: a Timeout expires on exactly the Nth tick, time is purely logical, and a
// WaitList expires parked work deterministically in add order.

import { Driver } from "../../src/engine/core/tickable.ts";
import { TickClock, Timeout, WaitList } from "../../src/engine/core/clock.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

Deno.test("TickClock: now() advances one unit per tick, from the start value", () => {
  const clock = new TickClock("clock", 5);
  assertStrictEquals(clock.now(), 5);
  clock.tick();
  clock.tick();
  assertStrictEquals(clock.now(), 7);
});

Deno.test("Timeout: expires on exactly the Nth tick, not the (N-1)th", () => {
  const clock = new TickClock();
  const t = clock.timeout(3);
  assertStrictEquals(t.expired(), false);
  assertStrictEquals(t.remaining(), 3);
  clock.tick(); // 1
  assertStrictEquals(t.expired(), false);
  clock.tick(); // 2
  assertStrictEquals(t.expired(), false);
  assertStrictEquals(t.remaining(), 1);
  clock.tick(); // 3 -> expires exactly here
  assertStrictEquals(t.expired(), true);
  assertStrictEquals(t.remaining(), 0);
  clock.tick(); // stays expired
  assertStrictEquals(t.expired(), true);
});

Deno.test("Timeout: a zero or negative budget is already expired", () => {
  const clock = new TickClock();
  assertStrictEquals(new Timeout(clock, 0).expired(), true);
  assertStrictEquals(clock.timeout(-2).expired(), true);
});

Deno.test("Timeout: driven by the Driver, it fires on the step the predicate needs", () => {
  const clock = new TickClock();
  const d = new Driver([clock]);
  const t = clock.timeout(5);
  const taken = d.tickUntil(() => t.expired(), 100);
  assertStrictEquals(taken, 5);
  assertStrictEquals(clock.now(), 5);
});

Deno.test("WaitList: items expire on their Nth tick, in add order", () => {
  const clock = new TickClock();
  const w = new WaitList<string>();
  const d = new Driver([clock, w]); // clock first, then the waitlist: fixed order
  w.add("a", 2);
  w.add("b", 1);
  w.add("c", 2);
  assertStrictEquals(w.pending, 3);

  d.tick(); // b (1) expires now; a and c drop to 1
  assertEquals(w.drainExpired(), ["b"]);
  assertStrictEquals(w.pending, 2);

  d.tick(); // a and c expire, in add order
  assertEquals(w.drainExpired(), ["a", "c"]);
  assertStrictEquals(w.pending, 0);
});

Deno.test("WaitList: the same tick sequence expires the same items every run", () => {
  function run(): string[] {
    const clock = new TickClock();
    const w = new WaitList<number>();
    const d = new Driver([clock, w]);
    for (let i = 0; i < 5; i++) w.add(i, (i % 3) + 1);
    const order: number[] = [];
    for (let step = 0; step < 4; step++) {
      d.tick();
      order.push(...w.drainExpired());
    }
    return order.map(String);
  }
  assert(JSON.stringify(run()) === JSON.stringify(run()));
  assertEquals(run(), ["0", "3", "1", "4", "2"]);
});
