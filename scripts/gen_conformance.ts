// Generate the cross-language conformance golden fixture from the TypeScript
// echo adapter, which is the reference implementation of protocol v0. Both the
// TS conformance test and the Rust adapter SDK check their output against this
// same file, so "both sides speak the same protocol" is a concrete, byte-level
// assertion rather than two parallel hand-written specs.
//
//   deno run --allow-write scripts/gen_conformance.ts

import { dispatch } from "../src/engine/protocol/dispatch.ts";
import type { Op, Request } from "../src/engine/protocol/types.ts";
import { EchoAdapter } from "../examples/echo/echo_adapter.ts";

const SEQUENCE: Array<{ v: number; id: number; op: Op; args: Record<string, unknown> }> = [
  { v: 0, id: 1, op: "hello", args: { protocol: 0 } },
  { v: 0, id: 2, op: "reset", args: { seed: 11 } },
  { v: 0, id: 3, op: "available_actions", args: {} },
  { v: 0, id: 4, op: "act", args: { action: "ping" } },
  { v: 0, id: 5, op: "read_state", args: {} },
  { v: 0, id: 6, op: "tick", args: {} },
  { v: 0, id: 7, op: "read_state", args: {} },
  { v: 0, id: 8, op: "deliver", args: { message: { from: "a", to: "b", kind: "x", payload: {} } } },
  { v: 0, id: 9, op: "reset", args: { seed: "nope" } },
  { v: 0, id: 10, op: "act", args: { action: 42 } },
  { v: 0, id: 11, op: "hello", args: { protocol: 9 } },
  { v: 1, id: 12, op: "read_state", args: {} },
  { v: 0, id: 13, op: "bye", args: {} },
];

const adapter = new EchoAdapter();
const pairs = SEQUENCE.map((req) => ({ request: req, response: dispatch(adapter, req as Request) }));

const path = new URL("../conformance/echo-golden.json", import.meta.url);
await Deno.mkdir(new URL("../conformance/", import.meta.url), { recursive: true });
await Deno.writeTextFile(path, JSON.stringify(pairs, null, 2) + "\n");
console.log(`wrote ${pairs.length} conformance pairs to conformance/echo-golden.json`);
