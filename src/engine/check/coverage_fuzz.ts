// Coverage-guided fuzzing over fault scripts (#42, integrated). Instead of
// sampling random fault profiles, it keeps a corpus of fault scripts and mutates
// the ones that reached new coverage, so the search compounds toward deep states
// a blind search would practically never reach. The input it mutates is an
// explicit fault script (applied by ScriptedDecisions), which gives it full
// control and locality: adding, removing, or tweaking one fault yields a related
// execution. The coverage signal is the set of distinct event types the run
// produced, plus the progress markers a SUT emits (`reached` stages).

import { checkInvariants, runScenario, type Scenario } from "../cli/scenario.ts";
import type { FaultKind, ScheduleEntry } from "../sim/decisions.ts";
import type { SimEvent } from "../core/run.ts";
import { createRng, type Rng } from "../../determinism.ts";

export interface CoverageFuzzOptions {
  seed: number;
  ticks: number;
  iterations: number;
  /** Maximum faults a script may grow to (default 12). */
  maxFaults?: number;
}

export interface CoverageFuzzResult {
  /** The failing fault script and its invariant breaks, if one was found. */
  bug: { faults: ScheduleEntry[]; breaks: string[] } | null;
  /** Scripts kept in the corpus (each reached new coverage). */
  corpus: number;
  /** Distinct coverage points reached. */
  coverage: number;
  iterations: number;
}

/** The coverage a run reached: distinct event types plus SUT `reached` stages. */
function coverageOf(events: readonly SimEvent[]): Set<string> {
  const cov = new Set<string>();
  for (const e of events) {
    cov.add(e.type);
    if (e.type === "reached") cov.add(`reached:${(e.detail as { stage: number }).stage}`);
  }
  return cov;
}

const FAULT_KINDS: FaultKind[] = ["drop", "partition", "delay"];

function randomFault(rng: Rng, ids: readonly string[], ticks: number): ScheduleEntry {
  const a = rng.pick(ids);
  const b = rng.pick(ids.filter((x) => x !== a));
  const action = rng.pick(FAULT_KINDS);
  const detail = action === "delay" ? { delay: 1 + rng.int(4) } : action === "drop" ? { dropRate: 1 } : undefined;
  const tick = 1 + rng.int(Math.max(1, ticks - 2));
  return detail ? { tick, action, targets: [a, b], detail } : { tick, action, targets: [a, b] };
}

function mutate(
  base: ScheduleEntry[],
  rng: Rng,
  ids: readonly string[],
  ticks: number,
  maxFaults: number,
): ScheduleEntry[] {
  const script = base.map((e) => ({ ...e }));
  const choice = rng.int(3);
  if ((choice === 0 && script.length < maxFaults) || script.length === 0) {
    script.push(randomFault(rng, ids, ticks));
  } else if (choice === 1) {
    script.splice(rng.int(script.length), 1);
  } else {
    script[rng.int(script.length)] = randomFault(rng, ids, ticks);
  }
  return script;
}

/** Coverage-guided fuzzing: keep fault scripts that reach new coverage, mutate from the corpus. */
export function coverageFuzz(scenario: Scenario, opts: CoverageFuzzOptions): CoverageFuzzResult {
  const rng = createRng(opts.seed);
  const ids = scenario.nodeIds;
  const maxFaults = opts.maxFaults ?? 12;
  const corpus: ScheduleEntry[][] = [[]];
  const seen = new Set<string>();

  const base = runScenario(scenario, { seed: 0, ticks: opts.ticks, profile: "quiet", faultScript: [] });
  for (const c of coverageOf(base.events)) seen.add(c);

  for (let it = 0; it < opts.iterations; it++) {
    const parent = corpus[rng.int(corpus.length)];
    const script = mutate(parent, rng, ids, opts.ticks, maxFaults);
    const run = runScenario(scenario, { seed: 0, ticks: opts.ticks, profile: "quiet", faultScript: script });
    const breaks = checkInvariants(scenario, run);
    if (breaks.length > 0) {
      return { bug: { faults: script, breaks }, corpus: corpus.length, coverage: seen.size, iterations: it + 1 };
    }
    let novel = false;
    for (const c of coverageOf(run.events)) {
      if (!seen.has(c)) {
        seen.add(c);
        novel = true;
      }
    }
    if (novel) corpus.push(script);
  }
  return { bug: null, corpus: corpus.length, coverage: seen.size, iterations: opts.iterations };
}

/** A blind baseline: random fault scripts with no coverage feedback or corpus. */
export function blindFuzz(scenario: Scenario, opts: CoverageFuzzOptions): CoverageFuzzResult {
  const rng = createRng(opts.seed);
  const ids = scenario.nodeIds;
  const maxFaults = opts.maxFaults ?? 12;
  for (let it = 0; it < opts.iterations; it++) {
    const script: ScheduleEntry[] = [];
    const count = 1 + rng.int(maxFaults);
    for (let i = 0; i < count; i++) script.push(randomFault(rng, ids, opts.ticks));
    const run = runScenario(scenario, { seed: 0, ticks: opts.ticks, profile: "quiet", faultScript: script });
    const breaks = checkInvariants(scenario, run);
    if (breaks.length > 0) return { bug: { faults: script, breaks }, corpus: 1, coverage: 0, iterations: it + 1 };
  }
  return { bug: null, corpus: 1, coverage: 0, iterations: opts.iterations };
}
