// #28: three processes exchange messages deterministically over one network;
// a send is non-blocking (the reply lands on a later tick); unknown destinations
// are dropped; duplicate ids are rejected.

import type { Message } from "../../src/engine/protocol/types.ts";
import { Cluster, directNetwork, type Node, type NodeDeps } from "../../src/engine/sim/cluster.ts";
import type { SimEvent } from "../../src/engine/core/run.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "../assert.ts";

const RING: Record<string, string> = { a: "b", b: "c", c: "a" };

/** Forwards a token to the next node in the ring, up to a hop limit. Purely reactive. */
class RingNode implements Node {
  readonly id: string;
  #deps: NodeDeps;
  #limit: number;
  constructor(deps: NodeDeps, limit: number) {
    this.id = deps.id;
    this.#deps = deps;
    this.#limit = limit;
  }
  tick(): void {} // no periodic work; everything happens on message delivery
  onMessage(msg: Message): void {
    const hops = (msg.payload.hops as number) ?? 0;
    this.#deps.log.record("visit", { node: this.id, hops });
    if (hops < this.#limit) {
      this.#deps.net.send({ from: this.id, to: RING[this.id], kind: "token", payload: { hops: hops + 1 } });
    }
  }
}

function visits(events: readonly SimEvent[]): { node: string; tick: number }[] {
  return events.filter((e) => e.type === "visit").map((e) => ({
    node: (e.detail as { node: string }).node,
    tick: e.tick,
  }));
}

function runRing(seed: number): { node: string; tick: number }[] {
  const c = new Cluster(seed, ["a", "b", "c"], directNetwork, (deps) => new RingNode(deps, 6));
  c.send({ from: "client", to: "a", kind: "token", payload: { hops: 0 } });
  c.run(10);
  return visits(c.events);
}

Deno.test("Cluster: a token circulates the ring in fixed order, one hop per tick", () => {
  const v = runRing(1);
  assertEquals(v.map((x) => x.node), ["a", "b", "c", "a", "b", "c", "a"]); // 7 visits (hops 0..6)
  // Reply-as-later-message: each forward is delivered on the NEXT tick, never the same one.
  for (let i = 1; i < v.length; i++) assertStrictEquals(v[i].tick, v[i - 1].tick + 1);
  assertStrictEquals(v[0].tick, 1); // first delivery is tick 1 (injected pre-run)
});

Deno.test("Cluster: the same seed reproduces the exchange exactly", () => {
  assertEquals(runRing(42), runRing(42));
});

Deno.test("Cluster: an unknown destination is logged and dropped, not delivered", () => {
  const c = new Cluster(1, ["a"], directNetwork, (deps) => new RingNode(deps, 1));
  c.send({ from: "client", to: "ghost", kind: "token", payload: { hops: 0 } });
  c.run(3);
  const drops = c.events.filter((e) => e.type === "net.drop");
  assertStrictEquals(drops.length, 1);
  assertEquals((drops[0].detail as { to: string }).to, "ghost");
  assertStrictEquals(c.events.filter((e) => e.type === "visit").length, 0);
});

Deno.test("Cluster: duplicate ProcessIds are rejected at construction", () => {
  assertThrows(
    () => new Cluster(1, ["a", "a"], directNetwork, (deps) => new RingNode(deps, 1)),
    "duplicate ProcessId",
  );
});

Deno.test("Cluster: runUntil stops on the predicate and reports ticks taken", () => {
  const c = new Cluster(1, ["a", "b", "c"], directNetwork, (deps) => new RingNode(deps, 6));
  c.send({ from: "client", to: "a", kind: "token", payload: { hops: 0 } });
  const taken = c.runUntil(() => c.events.filter((e) => e.type === "visit").length >= 3, 20);
  assertStrictEquals(taken, 3); // three visits land on ticks 1, 2, 3
  assertStrictEquals(c.step, 3);
});

Deno.test("Cluster: node() looks a process up by id", () => {
  const c = new Cluster(1, ["a", "b"], directNetwork, (deps) => new RingNode(deps, 1));
  assert(c.node("a") !== undefined);
  assertStrictEquals(c.node("a")!.id, "a");
  assertStrictEquals(c.node("z"), undefined);
});
