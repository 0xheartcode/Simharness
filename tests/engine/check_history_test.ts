// #34 + #35: the history records invoke/ok/fail well-formed, and the
// linearizability checker passes a correct register history, fails a stale read.

import { History, type HistoryOp } from "../../src/engine/check/history.ts";
import { checkLinearizable, registerModel } from "../../src/engine/check/linearizability.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

Deno.test("History: records a well-formed invoke/ok flat log", () => {
  const h = new History();
  const w = h.invoke("c1", "write", 1, 2);
  h.complete(w, "ok", 3);
  const r = h.invoke("c1", "read", 4);
  h.complete(r, "ok", 6, 2);
  assertEquals(h.entries.map((e) => e.kind), ["invoke", "ok", "invoke", "ok"]);
  assertStrictEquals(h.completed().length, 2);
  assertStrictEquals(h.pending().length, 0);
});

Deno.test("History: a double completion is ignored, and pending stays pending", () => {
  const h = new History();
  const w = h.invoke("c1", "write", 1, 5);
  h.complete(w, "ok", 2);
  h.complete(w, "fail", 3); // ignored
  const p = h.invoke("c1", "read", 4);
  assertStrictEquals(h.ops().find((o) => o.opId === w)!.outcome, "ok");
  assertStrictEquals(h.ops().find((o) => o.opId === p)!.outcome, "pending");
});

Deno.test("History: a stale-read-after-ack anomaly is visible in the raw history", () => {
  const h = new History();
  const w = h.invoke("c1", "write", 1, 2);
  h.complete(w, "ok", 2); // write of 2 acked at tick 2
  const r = h.invoke("c2", "read", 5); // read starts after the write acked
  h.complete(r, "ok", 7, 1); // but returns the old value 1
  const read = h.completed().find((o) => o.op === "read")!;
  const write = h.completed().find((o) => o.op === "write")!;
  assert(read.invokeTick > write.completeTick!); // real-time: read began after write acked
  assertStrictEquals(read.output, 1); // yet it saw the stale value
});

function op(
  opId: number,
  kind: "read" | "write",
  invokeTick: number,
  completeTick: number,
  value: number,
): HistoryOp {
  return {
    opId,
    client: "c",
    op: kind,
    input: kind === "write" ? value : undefined,
    output: kind === "read" ? value : undefined,
    invokeTick,
    completeTick,
    outcome: "ok",
  };
}

Deno.test("checkLinearizable: a correct register history passes", () => {
  const ops = [op(0, "write", 0, 2, 1), op(1, "read", 3, 5, 1)];
  assertStrictEquals(checkLinearizable(ops, registerModel), null);
});

Deno.test("checkLinearizable: concurrency allows either order", () => {
  // write[0,5] overlaps read[2,3]; read may be linearized before or after it
  assertStrictEquals(checkLinearizable([op(0, "write", 0, 5, 1), op(1, "read", 2, 3, 1)]), null);
  assertStrictEquals(checkLinearizable([op(0, "write", 0, 5, 1), op(1, "read", 2, 3, 0)]), null);
});

Deno.test("checkLinearizable: a stale read after an acked write fails", () => {
  // write of 2 completes at tick 2; a later read returns the old value 1
  const v = checkLinearizable([op(0, "write", 0, 2, 2), op(1, "read", 3, 5, 1)]);
  assert(v !== null);
  assertEquals(v.message, "history is not linearizable");
});

Deno.test("checkLinearizable: a non-monotonic read pair fails", () => {
  // write 1 commits, readA sees 1, then readB (strictly later) sees 0: impossible
  const v = checkLinearizable([
    op(0, "write", 0, 1, 1),
    op(1, "read", 2, 3, 1),
    op(2, "read", 4, 5, 0),
  ]);
  assert(v !== null);
});
