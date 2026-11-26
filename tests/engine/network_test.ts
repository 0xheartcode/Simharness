// #29: each fault (delay, drop, duplicate, partition) is demonstrable and
// seed-reproducible, same-tick messages deliver in send order, and heal lets a
// partitioned link recover.

import type { Message } from "../../src/engine/protocol/types.ts";
import { Cluster, type Node, type NodeDeps } from "../../src/engine/sim/cluster.ts";
import { type LinkConfig, SimulatedNetwork } from "../../src/engine/sim/network.ts";
import type { SimEvent } from "../../src/engine/core/run.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

/** A process that absorbs messages; the network's own events are the evidence. */
class Sink implements Node {
  readonly id: string;
  constructor(deps: NodeDeps) {
    this.id = deps.id;
  }
  tick(): void {}
  onMessage(_msg: Message): void {}
}

/** Build a 2-node cluster over a SimulatedNetwork, returning the cluster and the net handle. */
function net2(seed: number, links: Record<string, LinkConfig>): { c: Cluster; net: SimulatedNetwork } {
  let net!: SimulatedNetwork;
  const c = new Cluster(
    seed,
    ["a", "b"],
    (deps) => (net = new SimulatedNetwork(deps, links)),
    (deps) => new Sink(deps),
  );
  return { c, net };
}

const delivers = (e: readonly SimEvent[]) => e.filter((x) => x.type === "net.deliver");
const drops = (e: readonly SimEvent[]) => e.filter((x) => x.type === "net.drop");

Deno.test("SimulatedNetwork: delay holds a message for exactly N ticks", () => {
  const { c } = net2(1, { "a->b": { delay: 5 } });
  c.send({ from: "a", to: "b", kind: "m", payload: {} });
  c.run(10);
  const d = delivers(c.events);
  assertStrictEquals(d.length, 1);
  assertStrictEquals(d[0].tick, 5); // sent at tick 0, delay 5 -> delivered on tick 5
});

Deno.test("SimulatedNetwork: a certain drop never delivers", () => {
  const { c } = net2(1, { "a->b": { dropRate: 1 } });
  c.send({ from: "a", to: "b", kind: "m", payload: {} });
  c.run(5);
  assertStrictEquals(delivers(c.events).length, 0);
  assertStrictEquals(drops(c.events).length, 1);
  assertEquals((drops(c.events)[0].detail as { reason: string }).reason, "loss");
});

Deno.test("SimulatedNetwork: a certain duplicate delivers the message twice", () => {
  const { c } = net2(1, { "a->b": { duplicate: 1 } });
  c.send({ from: "a", to: "b", kind: "m", payload: {} });
  c.run(5);
  const d = delivers(c.events);
  assertStrictEquals(d.length, 2);
  assertEquals(d.map((x) => (x.detail as { dup: boolean }).dup), [false, true]);
});

Deno.test("SimulatedNetwork: a partitioned link drops everything", () => {
  const { c } = net2(1, { "a->b": { partitioned: true } });
  c.send({ from: "a", to: "b", kind: "m", payload: {} });
  c.run(5);
  assertStrictEquals(delivers(c.events).length, 0);
  assertEquals((drops(c.events)[0].detail as { reason: string }).reason, "partition");
});

Deno.test("SimulatedNetwork: same-tick messages deliver in send order", () => {
  const { c } = net2(1, { "a->b": { delay: 1 } });
  c.send({ from: "a", to: "b", kind: "first", payload: {} });
  c.send({ from: "a", to: "b", kind: "second", payload: {} });
  c.run(3);
  assertEquals(delivers(c.events).map((x) => (x.detail as { kind: string }).kind), ["first", "second"]);
});

Deno.test("SimulatedNetwork: heal lets a partitioned link recover", () => {
  const { c, net } = net2(1, {});
  net.partition("a", "b");
  c.send({ from: "a", to: "b", kind: "lost", payload: {} });
  c.run(2);
  assertStrictEquals(delivers(c.events).length, 0);
  net.heal();
  c.send({ from: "a", to: "b", kind: "ok", payload: {} });
  c.run(2);
  assertStrictEquals(delivers(c.events).length, 1);
  assertEquals((delivers(c.events)[0].detail as { kind: string }).kind, "ok");
});

Deno.test("SimulatedNetwork: clogUntil holds a message past its delay", () => {
  const { c } = net2(1, { "a->b": { delay: 1, clogUntil: 5 } });
  c.send({ from: "a", to: "b", kind: "m", payload: {} });
  c.run(6);
  const d = delivers(c.events);
  assertStrictEquals(d.length, 1);
  assertStrictEquals(d[0].tick, 5); // held to the clog tick, not delivered at tick 1
});

Deno.test("SimulatedNetwork: partition both ways blocks each direction", () => {
  const { c, net } = net2(1, {});
  net.partition("a", "b", true);
  c.send({ from: "a", to: "b", kind: "ab", payload: {} });
  c.send({ from: "b", to: "a", kind: "ba", payload: {} });
  c.run(3);
  assertStrictEquals(delivers(c.events).length, 0);
  assertStrictEquals(drops(c.events).length, 2);
});

Deno.test("SimulatedNetwork: a per-tick flip toggles the partition deterministically", () => {
  const { c, net } = net2(1, { "a->b": { flipProb: 1 } });
  c.run(3); // flipProb 1 toggles every tick
  const flips = c.events.filter((e) => e.type === "net.flip");
  assertStrictEquals(flips.length, 3);
  // three toggles from false -> partitioned ends true
  assertStrictEquals(net.link("a", "b").partitioned, true);
});

Deno.test("SimulatedNetwork: a seeded drop rate is reproducible and seed-dependent", () => {
  function run(seed: number): string {
    const { c } = net2(seed, { "a->b": { dropRate: 0.5 } });
    for (let i = 0; i < 40; i++) {
      c.send({ from: "a", to: "b", kind: `m${i}`, payload: {} });
      c.tick();
    }
    c.run(3);
    return JSON.stringify(c.events.filter((e) => e.type === "net.deliver" || e.type === "net.drop").map((e) => e.type));
  }
  assertStrictEquals(run(7), run(7)); // same seed -> identical loss pattern
  assert(run(7) !== run(99), "distinct seeds should give different loss patterns");
});
