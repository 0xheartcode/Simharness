import { createRng, fuzz, randomActionPolicy, run } from "@0xheartcode/simharness";
import { ActionMockAdapter } from "./mock_adapter.ts";
import { assert, assertStrictEquals } from "./assert.ts";

Deno.test("run: actionPolicy drives a discrete-action sim via act()", () => {
  const a = new ActionMockAdapter();
  const r = run(a, { seed: 1, ticks: 5, stopOnEnd: false, actionPolicy: () => "craft" });
  // no hero/enemies on this sim: the loosened core must not choke
  assertStrictEquals(r.final.enemies, undefined);
  assertStrictEquals(r.final.extra.acted.craft, 5);
  assertStrictEquals(r.invariantBreaks.length, 0);
});

Deno.test("randomActionPolicy: only ever returns a currently-legal action", () => {
  const a = new ActionMockAdapter();
  a.reset(1);
  const policy = randomActionPolicy(createRng(7));
  const legal = new Set(a.availableActions());
  for (let i = 0; i < 50; i++) {
    const act = policy(i, a.readState(), a);
    assert(act !== undefined && legal.has(act), `got ${act}`);
  }
});

Deno.test("fuzz: samples the action space and reports action coverage", () => {
  const res = fuzz(new ActionMockAdapter(), { seeds: 4, ticks: 40 });
  assertStrictEquals(res.ok, true);
  assert(res.coverage.actions, "action-mode fuzz reports action coverage");
  const acts = res.coverage.actions!;
  // over 4 seeds x 40 ticks the three actions should all get exercised
  assert(acts.craft > 0 && acts.sell > 0 && acts.wait > 0, JSON.stringify(acts));
});

Deno.test("fuzz: applies consumer invariants in action mode (with first-fail tick)", () => {
  const res = fuzz(new ActionMockAdapter(), {
    seeds: 1,
    ticks: 30,
    invariants: (s) => (s.tick > 5 ? ["ran too long"] : []),
  });
  assertStrictEquals(res.ok, false);
  const f = res.failures.find((x) => x.message.includes("ran too long"));
  assert(f && f.tick >= 0, JSON.stringify(res.failures));
});
