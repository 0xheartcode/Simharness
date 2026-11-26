// #32: a workload issues seeded client requests against the cluster with think
// time, reproducibly; fault profiles resolve by name and error on unknown ones.

import type { Message } from "../../src/engine/protocol/types.ts";
import { Cluster, type Node, type NodeDeps } from "../../src/engine/sim/cluster.ts";
import { SimulatedNetwork } from "../../src/engine/sim/network.ts";
import { SimulationDecisions } from "../../src/engine/sim/decisions.ts";
import { FAULT_PROFILES, faultProfile, Workload, type WorkloadConfig } from "../../src/engine/sim/workload.ts";
import type { SimEvent } from "../../src/engine/core/run.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "../assert.ts";

class Sink implements Node {
  readonly id: string;
  received = 0;
  constructor(deps: NodeDeps) {
    this.id = deps.id;
  }
  tick(): void {}
  onMessage(_msg: Message): void {
    this.received += 1;
  }
}

function runWorkload(seed: number, config: WorkloadConfig, ticks: number, profile = "quiet"): SimEvent[] {
  let net!: SimulatedNetwork;
  const c = new Cluster(
    seed,
    ["a", "b", "c"],
    (deps) => (net = new SimulatedNetwork(deps)),
    (deps) => new Sink(deps),
    (deps) => [
      new SimulationDecisions(net, deps.ids, deps.entropy.rng, deps.clock, deps.log, faultProfile(profile)),
      new Workload(
        deps.send,
        deps.entropy.rng,
        deps.clock,
        deps.log,
        (rng) => ({ from: "client", to: rng.pick(deps.ids), kind: "get", payload: {} }),
        config,
      ),
    ],
  );
  c.run(ticks);
  return [...c.events];
}

Deno.test("Workload: issues seeded client requests against the cluster", () => {
  const events = runWorkload(1, { clientProb: 1, thinkTicks: 0 }, 10);
  const reqs = events.filter((e) => e.type === "client.request");
  assert(reqs.length > 0, "the workload should issue requests");
  // some of them reached a node (net.deliver after a request)
  assert(events.some((e) => e.type === "net.deliver"));
});

Deno.test("Workload: think time spaces requests out (closed loop)", () => {
  const events = runWorkload(1, { clientProb: 1, thinkTicks: 2 }, 9);
  const reqTicks = events.filter((e) => e.type === "client.request").map((e) => e.tick);
  // clientProb 1 + thinkTicks 2 -> issue, cool 2, issue: one every 3 ticks
  for (let i = 1; i < reqTicks.length; i++) assert(reqTicks[i] - reqTicks[i - 1] >= 3);
});

Deno.test("Workload: the same seed reproduces the request stream", () => {
  const a = runWorkload(5, { clientProb: 0.5, thinkTicks: 1 }, 30, "latency-spike");
  const b = runWorkload(5, { clientProb: 0.5, thinkTicks: 1 }, 30, "latency-spike");
  assertEquals(
    a.filter((e) => e.type === "client.request").map((e) => e.tick),
    b.filter((e) => e.type === "client.request").map((e) => e.tick),
  );
});

Deno.test("Workload: a generator that returns null issues nothing", () => {
  let net!: SimulatedNetwork;
  const c = new Cluster(
    1,
    ["a", "b"],
    (deps) => (net = new SimulatedNetwork(deps)),
    (deps) => new Sink(deps),
    (deps) => [
      new SimulationDecisions(net, deps.ids, deps.entropy.rng, deps.clock, deps.log, faultProfile("quiet")),
      new Workload(deps.send, deps.entropy.rng, deps.clock, deps.log, () => null, { clientProb: 1, thinkTicks: 0 }),
    ],
  );
  c.run(10);
  assertStrictEquals(c.events.filter((e) => e.type === "client.request").length, 0);
});

Deno.test("faultProfile: resolves the named presets", () => {
  assertStrictEquals(faultProfile("quiet").faultProb, 0);
  assert(faultProfile("reorg-storm").faults?.includes("drop"));
  assertEquals(Object.keys(FAULT_PROFILES).sort(), ["latency-spike", "partition-heavy", "quiet", "reorg-storm"]);
});

Deno.test("faultProfile: errors on an unknown profile instead of defaulting", () => {
  assertThrows(() => faultProfile("nope"), "unknown fault profile");
});
