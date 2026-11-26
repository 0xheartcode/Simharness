// Liveness checking (#36). Safety says nothing bad happens; liveness says
// something good eventually does. After a window of seeded faults this runs a
// recovery phase: heal the network, stop injecting faults and issuing new work,
// then tick a bounded number of steps and require the cluster to converge. A
// correct cluster converges within the bound; a wedged one (no progress after
// heal) trips the assert.

import { Cluster, type ProcessId } from "../sim/cluster.ts";
import { SimulatedNetwork } from "../sim/network.ts";
import { SimulationDecisions } from "../sim/decisions.ts";
import { faultProfile, Workload } from "../sim/workload.ts";
import type { Tickable } from "../core/tickable.ts";
import type { Scenario } from "../cli/scenario.ts";

export interface LivenessConfig {
  seed: number;
  /** Ticks of the fault phase (faults + client work). */
  faultTicks: number;
  /** Max ticks of the recovery phase to converge within. */
  healBound: number;
  /** Fault profile for the fault phase. */
  profile?: string;
}

export interface LivenessResult {
  converged: boolean;
  /** The tick convergence was observed (if it converged). */
  convergeTick?: number;
  faultTicks: number;
  /** Recovery ticks used. */
  healTicks: number;
}

/** All nodes hold structurally equal state. A reasonable default convergence test. */
export function allAgree(nodeStates: Record<ProcessId, unknown>): boolean {
  const values = Object.values(nodeStates).map((s) => JSON.stringify(s));
  return values.every((v) => v === values[0]);
}

/**
 * Run `scenario` under faults, then heal and quiesce and require convergence
 * within `healBound` ticks. `converged` reads the nodes' states each recovery
 * tick; it defaults to all nodes agreeing.
 */
export function runLiveness(
  scenario: Scenario,
  config: LivenessConfig,
  converged: (nodeStates: Record<ProcessId, unknown>) => boolean = allAgree,
): LivenessResult {
  let net!: SimulatedNetwork;
  let decisions!: SimulationDecisions;
  let workload: Workload | undefined;
  const profile = config.profile ?? scenario.defaultProfile ?? "partition-heavy";

  const cluster = new Cluster(
    config.seed,
    scenario.nodeIds,
    (deps) => (net = new SimulatedNetwork(deps)),
    (deps) => scenario.buildNode(deps),
    (deps) => {
      decisions = new SimulationDecisions(net, deps.ids, deps.entropy.rng, deps.clock, deps.log, faultProfile(profile));
      const controllers: Tickable[] = [decisions];
      if (scenario.requestGen) {
        workload = new Workload(
          deps.send,
          deps.entropy.rng,
          deps.clock,
          deps.log,
          scenario.requestGen,
          scenario.workload ?? {},
        );
        controllers.push(workload);
      }
      return controllers;
    },
  );

  // Fault phase: faults and client work run and (usually) diverge the cluster.
  cluster.run(config.faultTicks);

  // Recovery phase: no more faults, no more new work, network healed.
  decisions.quiesce();
  workload?.quiesce();
  net.heal();

  const states = (): Record<ProcessId, unknown> => {
    const s: Record<ProcessId, unknown> = {};
    for (const id of scenario.nodeIds) s[id] = cluster.node(id)?.state?.();
    return s;
  };

  if (converged(states())) {
    return { converged: true, convergeTick: cluster.step, faultTicks: config.faultTicks, healTicks: 0 };
  }
  for (let i = 1; i <= config.healBound; i++) {
    cluster.tick();
    if (converged(states())) {
      return { converged: true, convergeTick: cluster.step, faultTicks: config.faultTicks, healTicks: i };
    }
  }
  return { converged: false, faultTicks: config.faultTicks, healTicks: config.healBound };
}
