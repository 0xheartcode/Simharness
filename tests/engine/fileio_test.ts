// #30: crash before sync loses the write; crash after sync keeps it; operations
// complete on ticks and never block.

import { SimulatedFileIO, TickFuture } from "../../src/engine/sim/fileio.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "../assert.ts";

Deno.test("SimulatedFileIO: write then crash before sync loses the write", () => {
  const f = new SimulatedFileIO();
  const w = f.write(0, [1, 2, 3]);
  f.tick(); // write completes into visible
  assert(w.ready);
  assertEquals(f.peekVisible(), [1, 2, 3]);
  assertEquals(f.peekDurable(), []); // never synced

  f.crash();
  assertEquals(f.peekVisible(), []); // visible reset to durable: write gone
});

Deno.test("SimulatedFileIO: write, sync, then crash keeps the write", () => {
  const f = new SimulatedFileIO();
  f.write(0, [1, 2, 3]);
  f.tick(); // write applied
  f.sync();
  f.tick(); // durable now holds the write
  assertEquals(f.peekDurable(), [1, 2, 3]);

  f.crash();
  assertEquals(f.peekVisible(), [1, 2, 3]); // survived the crash
});

Deno.test("SimulatedFileIO: operations complete only after opDelay ticks, never blocking", () => {
  const f = new SimulatedFileIO("wal", { opDelay: 2 });
  const w = f.write(0, [9]);
  assertStrictEquals(w.ready, false); // returned immediately, not yet applied
  f.tick();
  assertStrictEquals(w.ready, false); // one tick in, still pending
  f.tick();
  assertStrictEquals(w.ready, true); // completes on the 2nd tick
  assertEquals(f.peekVisible(), [9]);
});

Deno.test("SimulatedFileIO: a read reflects the visible file at completion time", () => {
  const f = new SimulatedFileIO();
  f.write(0, [1, 2, 3, 4]);
  f.tick();
  const r = f.read(1, 2);
  f.tick();
  assertEquals(r.value(), [2, 3]);
});

Deno.test("SimulatedFileIO: reading a future before it is ready throws", () => {
  const f = new SimulatedFileIO();
  const s = f.size();
  assertThrows(() => s.value(), "not ready");
  f.tick();
  assertStrictEquals(s.value(), 0);
});

Deno.test("SimulatedFileIO: truncate shrinks the visible file", () => {
  const f = new SimulatedFileIO();
  f.write(0, [1, 2, 3, 4, 5]);
  f.tick();
  f.truncate(3);
  f.tick();
  assertEquals(f.peekVisible(), [1, 2, 3]);
});

Deno.test("SimulatedFileIO: crash drops an in-flight write", () => {
  const f = new SimulatedFileIO();
  const w = f.write(0, [7, 7]);
  // crash while the write is still in flight (not yet ticked to completion)
  f.crash();
  f.tick();
  assertStrictEquals(w.ready, false); // the in-flight op was lost, never completes
  assertEquals(f.peekVisible(), []);
});

Deno.test("TickFuture: settles exactly once with its value", () => {
  let settle!: (v: number) => void;
  const fut = new TickFuture<number>((s) => (settle = s));
  assertStrictEquals(fut.ready, false);
  settle(42);
  assertStrictEquals(fut.ready, true);
  assertStrictEquals(fut.value(), 42);
});
