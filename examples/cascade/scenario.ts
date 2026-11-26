// The cascade scenario: a monitor and K sources, no faults by default. The
// invariant is that the monitor never reaches the full-cascade stage. It holds
// with no faults and breaks only when drops silence the whole source prefix,
// which the coverage-guided fuzzer builds toward one stage at a time.

import type { Scenario, ScenarioRun } from "../../src/engine/cli/scenario.ts";
import { MONITOR, Monitor, Source, SOURCES } from "./cascade.ts";

export function cascadeScenario(): Scenario {
  const ids = [MONITOR, ...SOURCES];
  return {
    name: "cascade",
    nodeIds: ids,
    buildNode: (deps) => (deps.id === MONITOR ? new Monitor(deps) : new Source(deps)),
    defaultProfile: "quiet",
    invariants: (run: ScenarioRun): string[] => {
      const monitor = run.nodeStates[MONITOR] as { stage: number } | undefined;
      if (monitor && monitor.stage >= SOURCES.length) {
        return [`monitor reached the full-cascade stage ${monitor.stage} (all sources silenced)`];
      }
      return [];
    },
    snapshot: (run) => run.nodeStates,
  };
}
