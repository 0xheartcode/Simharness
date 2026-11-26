// Failure to minimal repro (#37). A violation comes with a seed and a full fault
// schedule, but most of those faults are noise. Shrinking removes faults while
// the failure persists, leaving the smallest set that still breaks the system.
// Because masking a fault drops its effect without disturbing the RNG stream
// (see SimulationDecisions), a shrunk run reproduces the same client behavior as
// the original, so the reduction is faithful. The reduction is deterministic.

import { runScenario, type Scenario, type ScenarioRun } from "../cli/scenario.ts";
import type { ScheduleEntry } from "../sim/decisions.ts";

export interface MinimalRepro {
  seed: number;
  ticks: number;
  profile: string;
  /** The reduced set of faults that still reproduces the failure. */
  appliedFaults: ScheduleEntry[];
  /** The fault indices that remain, sorted. */
  mask: number[];
  /** How many faults the full run applied, for context. */
  fullFaultCount: number;
  /** A one-command replay of the (full) failing run. */
  replay: string;
}

/**
 * 1-minimal shrink: drop indices one at a time while `stillFails` holds, until
 * no single further removal keeps the failure. Deterministic: indices are tried
 * in ascending order and the first productive removal is taken.
 */
export function shrinkIndices(
  indices: readonly number[],
  stillFails: (keep: ReadonlySet<number>) => boolean,
): number[] {
  let current = new Set(indices);
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of [...current].sort((a, b) => a - b)) {
      const candidate = new Set(current);
      candidate.delete(i);
      if (stillFails(candidate)) {
        current = candidate;
        changed = true;
        break;
      }
    }
  }
  return [...current].sort((a, b) => a - b);
}

/**
 * Reduce a failing run to the smallest fault set that still fails. Returns null
 * if the run does not actually fail under `failed`.
 */
export function minimalRepro(
  scenario: Scenario,
  opts: { seed: number; ticks: number; profile: string },
  failed: (run: ScenarioRun) => boolean,
): MinimalRepro | null {
  const full = runScenario(scenario, opts);
  if (!failed(full)) return null;

  const faultIndices = full.schedule.filter((e) => e.applied).map((e) => e.index!);
  const mask = shrinkIndices(
    faultIndices,
    (keep) => failed(runScenario(scenario, { ...opts, mask: keep })),
  );
  const minRun = runScenario(scenario, { ...opts, mask: new Set(mask) });

  return {
    seed: opts.seed,
    ticks: opts.ticks,
    profile: opts.profile,
    appliedFaults: minRun.schedule.filter((e) => e.applied),
    mask,
    fullFaultCount: faultIndices.length,
    replay: `replay ${opts.seed} --ticks ${opts.ticks} --profile ${opts.profile}`,
  };
}
