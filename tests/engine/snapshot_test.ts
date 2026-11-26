// #27: snapshots are byte-stable regardless of key order, and the structured
// diff points at the first divergence deterministically.

import { snapshot, snapshotEqual, structuredDiff } from "../../src/engine/core/snapshot.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

Deno.test("snapshot: equal values serialize identically regardless of key order", () => {
  const a = { b: 1, a: { y: 2, x: 1 }, c: [3, 2, 1] };
  const b = { c: [3, 2, 1], a: { x: 1, y: 2 }, b: 1 };
  assertStrictEquals(snapshot(a), snapshot(b));
});

Deno.test("snapshot: array order is preserved (it is state, not noise)", () => {
  assert(snapshot([1, 2, 3]) !== snapshot([3, 2, 1]));
});

Deno.test("structuredDiff: returns null for structurally equal values", () => {
  assertStrictEquals(structuredDiff({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), null);
  assert(snapshotEqual({ x: { y: 1 } }, { x: { y: 1 } }));
});

Deno.test("structuredDiff: locates the first divergence by sorted key order", () => {
  const d = structuredDiff({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, c: 3 });
  assertEquals(d, { path: "$.b", left: 2, right: 9 });
});

Deno.test("structuredDiff: reports a path into nested objects and arrays", () => {
  const left = { store: { athens: { x: 1 }, byzantium: { x: 2 } } };
  const right = { store: { athens: { x: 1 }, byzantium: { x: 5 } } };
  assertEquals(structuredDiff(left, right), { path: "$.store.byzantium.x", left: 2, right: 5 });

  const arrDiff = structuredDiff({ log: [{ t: 1 }, { t: 2 }] }, { log: [{ t: 1 }, { t: 7 }] });
  assertEquals(arrDiff, { path: "$.log[1].t", left: 2, right: 7 });
});

Deno.test("structuredDiff: a missing key or length change is a divergence", () => {
  assertEquals(structuredDiff({ a: 1 }, { a: 1, b: 2 }), { path: "$.b", left: undefined, right: 2 });
  assertEquals(structuredDiff([1, 2], [1, 2, 3]), { path: "$[2]", left: undefined, right: 3 });
  // A primitive vs an object at the same path is a divergence at that path.
  assertEquals(structuredDiff({ a: 1 }, { a: { nested: true } }), {
    path: "$.a",
    left: 1,
    right: { nested: true },
  });
});

Deno.test("snapshot: usable as a golden regression anchor", () => {
  const golden = snapshot({ tick: 3, store: { k: { value: 1, version: 2 } } });
  const same = snapshot({ store: { k: { version: 2, value: 1 } }, tick: 3 });
  assertStrictEquals(same, golden); // reordered but equal state matches the golden
});
