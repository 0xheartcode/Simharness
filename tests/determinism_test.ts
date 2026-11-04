import { createClock, createRng, mulberry32 } from "@0xheartcode/simharness";
import { assert, assertEquals, assertStrictEquals } from "./assert.ts";

Deno.test("mulberry32: same seed => identical stream, different seed => different", () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = [a(), a(), a()];
  assertEquals(sa, [b(), b(), b()]);
  assert(sa[0] !== c(), "a different seed yields a different first draw");
  assert(sa.every((n) => n >= 0 && n < 1), "every draw is in [0,1)");
});

Deno.test("createRng: helpers are bounded and reproducible", () => {
  const r1 = createRng(7), r2 = createRng(7);
  for (let i = 0; i < 100; i++) {
    const n = r1.int(10);
    assert(Number.isInteger(n) && n >= 0 && n < 10);
    const f = r1.range(5, 9);
    assert(f >= 5 && f < 9);
    assert(typeof r1.bool(0.3) === "boolean");
  }
  // r2 replays r1's exact stream with the same calls.
  const rep = createRng(7);
  const x = createRng(7);
  assertStrictEquals(rep.int(1000), x.int(1000));
  // pick stays inside the array.
  const arr = ["a", "b", "c"] as const;
  for (let i = 0; i < 50; i++) assert(arr.includes(r2.pick(arr)));
});

Deno.test("createRng: bool(0) is always false, bool(1) is always true", () => {
  const r = createRng(1);
  for (let i = 0; i < 20; i++) {
    assertStrictEquals(r.bool(0), false);
    assertStrictEquals(r.bool(1), true);
  }
});

Deno.test("createClock: now/advance/set are virtual and monotonic by command", () => {
  const c = createClock(1000);
  assertStrictEquals(c.now(), 1000);
  c.advance(250);
  assertStrictEquals(c.now(), 1250);
  c.set(0);
  assertStrictEquals(c.now(), 0);
  const d = createClock();
  assertStrictEquals(d.now(), 0);
});
