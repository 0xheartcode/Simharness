// #31: the fault scheduler turns a seed into a replayable, readable, structured
// fault schedule, and heals on its interval.

import type { Message } from "../../src/engine/protocol/types.ts";
import { Cluster, type Node, type NodeDeps } from "../../src/engine/sim/cluster.ts";
import { SimulatedNetwork } from "../../src/engine/sim/network.ts";
import { type DecisionConfig, type ScheduleEntry, SimulationDecisions } from "../../src/engine/sim/decisions.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

class Sink implements Node {
  readonly id: string;
  constructor(deps: NodeDeps) {
    this.id = deps.id;
  }
  tick(): void {}
  onMessage(_msg: Message): void {}
}

function runFaults(seed: number, config: DecisionConfig, ticks: number): ScheduleEntry[] {
  let decisions!: SimulationDecisions;
  let net!: SimulatedNetwork;
  const c = new Cluster(
    seed,
    ["a", "b", "c"],
    (deps) => (net = new SimulatedNetwork(deps)),
    (deps) => new Sink(deps),
    (deps) => [decisions = new SimulationDecisions(net, deps.ids, deps.entropy.rng, deps.clock, deps.log, config)],
  );
  c.run(ticks);
  return [...decisions.schedule];
}

Deno.test("SimulationDecisions: the same seed produces the same schedule", () => {
  const a = runFaults(7, { faultProb: 0.5, healInterval: 10 }, 60);
  const b = runFaults(7, { faultProb: 0.5, healInterval: 10 }, 60);
  assertEquals(a, b);
  assert(a.length > 0, "the run should have injected some faults");
});

Deno.test("SimulationDecisions: every entry is tick-stamped and structured", () => {
  const schedule = runFaults(3, { faultProb: 0.6 }, 40);
  const actions = new Set(["isolate", "partition", "delay", "drop", "heal"]);
  for (const e of schedule) {
    assert(actions.has(e.action), `unexpected action ${e.action}`);
    assert(typeof e.tick === "number" && e.tick > 0);
    assert(Array.isArray(e.targets));
  }
});

Deno.test("SimulationDecisions: heals on its interval", () => {
  const schedule = runFaults(1, { faultProb: 0.3, healInterval: 5 }, 22);
  const healTicks = schedule.filter((e) => e.action === "heal").map((e) => e.tick);
  assertEquals(healTicks, [5, 10, 15, 20]);
});

Deno.test("SimulationDecisions: restricting fault kinds is honored", () => {
  const schedule = runFaults(9, { faultProb: 0.8, faults: ["delay"] }, 40);
  const faultKinds = new Set(schedule.filter((e) => e.action !== "heal").map((e) => e.action));
  assertEquals([...faultKinds], ["delay"]);
  // a delay entry carries its delay in detail
  const delay = schedule.find((e) => e.action === "delay");
  assert(delay !== undefined && typeof delay.detail?.delay === "number");
});

Deno.test("SimulationDecisions: faultProb 0 injects nothing but still heals", () => {
  const schedule = runFaults(1, { faultProb: 0, healInterval: 4 }, 12);
  assert(schedule.every((e) => e.action === "heal"));
  assertStrictEquals(schedule.length, 3); // ticks 4, 8, 12
});
