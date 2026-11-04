import {
  createRng,
  firstLegal,
  fuzz,
  randomActionPolicy,
  replayActions,
  run,
  sequenceActions,
  shrinkActionTrace,
} from "@0xheartcode/simharness";
import { ActionMockAdapter, type ActionMockExtra } from "./mock_adapter.ts";
import type { GameState } from "@0xheartcode/simharness/adapter";
import { assert, assertEquals, assertStrictEquals } from "./assert.ts";

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

Deno.test("firstLegal: applies the first preferred action that is currently legal", () => {
  const a = new ActionMockAdapter();
  a.reset(1);
  // the mock's legal set while running is {craft, sell, wait}
  const policy = firstLegal(["gather", "sell", "wait"]); // gather illegal, sell is first legal
  assertStrictEquals(policy(0, a.readState(), a), "sell");
  // nothing preferred is legal => undefined
  assertStrictEquals(firstLegal(["gather", "mine"])(0, a.readState(), a), undefined);
});

Deno.test("sequenceActions: applies ids in order, stops or loops at the end", () => {
  const seq = sequenceActions(["gather", "gather", "craft"]);
  assertEquals([0, 1, 2, 3].map((t) => seq(t, undefined as never, undefined as never)), [
    "gather",
    "gather",
    "craft",
    undefined,
  ]);
  const loop = sequenceActions(["a", "b"], { loop: true });
  assertEquals([0, 1, 2, 3].map((t) => loop(t, undefined as never, undefined as never)), ["a", "b", "a", "b"]);
});

Deno.test("replayActions + sequenceActions drive a sim deterministically", () => {
  const a = new ActionMockAdapter();
  const r = run(a, { seed: 1, ticks: 3, stopOnEnd: false, actionPolicy: replayActions(["gather", "gather", "craft"]) });
  // gather, gather, craft => wood 0, planks 1
  assertStrictEquals(r.final.extra.acted.gather, 2);
  assertStrictEquals(r.final.extra.acted.craft, 1);
});

Deno.test("fuzz: samples the action space and reports action coverage", () => {
  const res = fuzz(new ActionMockAdapter(), { seeds: 4, ticks: 40 });
  assertStrictEquals(res.ok, true);
  assert(res.coverage.actions, "action-mode fuzz reports action coverage");
  const acts = res.coverage.actions!;
  // over 4 seeds x 40 ticks the three actions should all get exercised
  assert(acts.craft > 0 && acts.sell > 0 && acts.wait > 0, JSON.stringify(acts));
});

Deno.test("shrinkActionTrace: reduces a trace to a minimal reproducer", () => {
  const a = new ActionMockAdapter();
  const trace = ["wait", "craft", "wait", "sell", "wait", "craft"];
  const detect = (s: GameState<ActionMockExtra>) => ((s.extra.acted.sell ?? 0) >= 1 ? ["sold"] : []);
  const min = shrinkActionTrace(a, 1, trace, detect, "sold");
  assert(min.length < trace.length, "the trace shrank");
  assert(min.includes("sell"), "the decisive action is kept");
  assert(!min.includes("wait"), "no-op actions are removed");
  // the shrunk trace still reproduces the failure on a fresh replay
  a.reset(1);
  for (const act of min) {
    if (act) a.act(act);
    a.step(1 / 60);
  }
  assert((a.readState().extra.acted.sell ?? 0) >= 1, `replay of ${JSON.stringify(min)} should sell`);
});

Deno.test("fuzz: attaches a shrunk minimal action trace on an action-mode failure", () => {
  const res = fuzz(new ActionMockAdapter(), {
    seeds: 1,
    ticks: 40,
    invariants: (s) => ((s.extra.acted.sell ?? 0) >= 1 ? ["sold something"] : []),
  });
  assertStrictEquals(res.ok, false);
  const f = res.failures.find((x) => x.message === "sold something");
  assert(f && f.minTrace, "a minimal trace is attached");
  assert(f!.minTrace!.includes("sell"), "the minimal trace keeps the decisive action");
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
