// #39: an existing SimAdapter runs through protocol v0 via the in-process SDK
// bridge, unchanged. Covers a realtime game (chase) and a discrete-action adapter.

import { fromSimAdapter } from "../../src/engine/sdk/bridge.ts";
import { inProcessChannel } from "../../src/engine/protocol/in_process.ts";
import type { SimState } from "../../src/engine/protocol/types.ts";
import { ChaseAdapter } from "../../examples/chase/chase_adapter.ts";
import { ActionMockAdapter } from "../mock_adapter.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

Deno.test("fromSimAdapter: a v1 game runs through protocol v0", () => {
  const ch = inProcessChannel(fromSimAdapter(new ChaseAdapter()));
  const hello = ch.request("hello", { protocol: 0 });
  assert(hello.ok);
  assertEquals((hello.result as { name: string }).name, "chase");
  assertEquals((hello.result as { supportsActions: boolean }).supportsActions, false);

  ch.request("reset", { seed: 7 });
  for (let i = 0; i < 5; i++) ch.request("tick");
  const state = ch.request("read_state");
  assert(state.ok);
  const s = state.result as SimState;
  assertStrictEquals(s.tick, 5); // five protocol ticks advanced the game five steps
  assert(s.hero !== undefined); // the spatial fields come through for a game
});

Deno.test("fromSimAdapter: driving through the bridge is deterministic by seed", () => {
  function run(seed: number): string {
    const ch = inProcessChannel(fromSimAdapter(new ChaseAdapter()));
    ch.request("reset", { seed });
    for (let i = 0; i < 20; i++) ch.request("tick");
    return JSON.stringify(ch.request("read_state"));
  }
  assertStrictEquals(run(3), run(3));
});

Deno.test("fromSimAdapter: a discrete-action adapter exposes the action seam", () => {
  const ch = inProcessChannel(fromSimAdapter(new ActionMockAdapter()));
  const hello = ch.request("hello", { protocol: 0 });
  assert(hello.ok);
  assertEquals((hello.result as { supportsActions: boolean }).supportsActions, true);
  ch.request("reset", { seed: 1 });
  const actions = ch.request("available_actions");
  assert(actions.ok);
  assert((actions.result as string[]).length > 0);
  const act = ch.request("act", { action: (actions.result as string[])[0] });
  assert(act.ok);
});

Deno.test("fromSimAdapter: snapshot carries the adapter's ascii view", () => {
  const ch = inProcessChannel(fromSimAdapter(new ChaseAdapter()));
  ch.request("reset", { seed: 1 });
  ch.request("tick");
  const snap = ch.request("snapshot");
  assert(snap.ok);
  assertStrictEquals(typeof (snap.result as { ascii: string }).ascii, "string");
});
