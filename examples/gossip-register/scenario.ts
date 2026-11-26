// The gossip-register scenario: three nodes, a client workload that writes
// versioned values, a default fault profile, and a safety invariant checked from
// the client-visible adopt log. The invariant (adopted versions never go
// backwards per node) holds for the correct node and fails for the buggy one, so
// it is a real CI gate with teeth.

import type { Scenario, ScenarioRun } from "../../src/engine/cli/scenario.ts";
import { GossipNode } from "./gossip_node.ts";

const IDS = ["athens", "byzantium", "cyrene"] as const;

export function gossipScenario(opts: { buggy?: boolean; silent?: boolean } = {}): Scenario {
  return {
    name: "gossip-register",
    nodeIds: IDS,
    buildNode: (deps) => new GossipNode(deps, IDS, { gossipEvery: 3, buggy: opts.buggy ?? false, silent: opts.silent }),
    requestGen: (rng, tick) => ({
      from: "client",
      to: rng.pick(IDS),
      kind: "write",
      payload: { value: 1 + rng.int(9), version: tick },
    }),
    workload: { clientProb: 0.6, thinkTicks: 2 },
    defaultProfile: "partition-heavy",
    invariants: (run: ScenarioRun): string[] => {
      const last: Record<string, number> = {};
      const breaks: string[] = [];
      for (const e of run.events) {
        if (e.type !== "adopt") continue;
        const d = e.detail as { node: string; version: number };
        if (last[d.node] !== undefined && d.version < last[d.node]) {
          breaks.push(`node ${d.node} version regressed ${last[d.node]} -> ${d.version} at tick ${e.tick}`);
        }
        last[d.node] = d.version;
      }
      return breaks;
    },
    snapshot: (run) => run.nodeStates,
  };
}
