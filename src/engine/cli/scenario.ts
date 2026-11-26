// A Scenario is a cluster system under test plus how to exercise it: the nodes,
// an optional client workload, a default fault profile, and invariants checked
// over a finished run. The CLI (cli.ts) runs a Scenario; runScenario here wires
// the cluster, the fault scheduler, and the workload into one deterministic run.

import type { ProcessId } from "../sim/cluster.ts";
import { Cluster, type Node, type NodeDeps } from "../sim/cluster.ts";
import { type DeliveryScheduler, SimulatedNetwork } from "../sim/network.ts";
import { type ScheduleEntry, ScriptedDecisions, SimulationDecisions } from "../sim/decisions.ts";
import { faultProfile, type RequestGen, Workload, type WorkloadConfig } from "../sim/workload.ts";
import type { Tickable } from "../core/tickable.ts";
import type { SimEvent } from "../core/run.ts";

/** The outcome of one scenario run: everything an invariant or a report needs. */
export interface ScenarioRun {
  scenario: string;
  seed: number;
  ticks: number;
  profile: string;
  events: readonly SimEvent[];
  schedule: readonly ScheduleEntry[];
  /** Each node's readable state at the end of the run (undefined if a node has no state()). */
  nodeStates: Record<ProcessId, unknown>;
}

/** A cluster system under test plus how to drive and check it. */
export interface Scenario {
  name: string;
  nodeIds: readonly ProcessId[];
  buildNode: (deps: NodeDeps) => Node;
  /** Client request generator; omit for a self-driving cluster. */
  requestGen?: RequestGen;
  workload?: WorkloadConfig;
  /** Default fault profile name when the CLI is not given one. */
  defaultProfile?: string;
  /** Return one message per broken invariant (empty means the run is correct). */
  invariants?: (run: ScenarioRun) => string[];
  /** A stable snapshot of the run for `snap` (defaults to the node states). */
  snapshot?: (run: ScenarioRun) => unknown;
}

export interface RunOptions {
  seed: number;
  ticks: number;
  profile: string;
  /** Apply only these fault indices (for shrinking); undefined applies all. */
  mask?: ReadonlySet<number>;
  /** Delivery-order scheduler (the interleaving explorer); undefined is send order. */
  scheduler?: DeliveryScheduler;
  /** Apply this explicit fault script instead of the seeded scheduler (the coverage fuzzer). */
  faultScript?: readonly ScheduleEntry[];
}

/** Build and run the scenario once, deterministically, and collect the result. */
export function runScenario(scenario: Scenario, opts: RunOptions): ScenarioRun {
  let net!: SimulatedNetwork;
  let decisions!: SimulationDecisions;

  const cluster = new Cluster(
    opts.seed,
    scenario.nodeIds,
    (deps) => {
      net = new SimulatedNetwork(deps);
      net.setScheduler(opts.scheduler);
      return net;
    },
    (deps) => scenario.buildNode(deps),
    (deps) => {
      const faultController: Tickable = opts.faultScript
        ? new ScriptedDecisions(net, deps.ids, deps.clock, deps.log, opts.faultScript)
        : (decisions = new SimulationDecisions(
          net,
          deps.ids,
          deps.entropy.rng,
          deps.clock,
          deps.log,
          faultProfile(opts.profile),
          opts.mask,
        ));
      const controllers: Tickable[] = [faultController];
      if (scenario.requestGen) {
        controllers.push(
          new Workload(deps.send, deps.entropy.rng, deps.clock, deps.log, scenario.requestGen, scenario.workload ?? {}),
        );
      }
      return controllers;
    },
  );

  cluster.run(opts.ticks);

  const nodeStates: Record<ProcessId, unknown> = {};
  for (const id of scenario.nodeIds) nodeStates[id] = cluster.node(id)?.state?.();

  return {
    scenario: scenario.name,
    seed: opts.seed,
    ticks: opts.ticks,
    profile: opts.profile,
    events: cluster.events,
    schedule: opts.faultScript ?? decisions.schedule,
    nodeStates,
  };
}

/** Check a run against its scenario's invariants; empty means it passed. */
export function checkInvariants(scenario: Scenario, run: ScenarioRun): string[] {
  return scenario.invariants ? scenario.invariants(run) : [];
}
