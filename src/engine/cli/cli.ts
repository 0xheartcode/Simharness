// The cluster orchestrator CLI (#33). Generalizes the single-adapter commands to
// a cluster scenario: run / replay / fuzz / assert / snap / metrics. Long-form
// flags, seed-first failure output, and fuzz returns a nonzero code with the
// offending seed so it works as a CI gate. runCli returns the exit code; a thin
// binary wrapper turns that into Deno.exit.

import { checkInvariants, runScenario, type Scenario, type ScenarioRun } from "./scenario.ts";
import { snapshot } from "../core/snapshot.ts";
import { minimalRepro } from "../check/shrink.ts";
import { exploreSchedules } from "../check/schedule_explore.ts";
import { coverageFuzz } from "../check/coverage_fuzz.ts";

interface Flags {
  positionals: string[];
  values: Record<string, string | true>;
}

function parseArgs(argv: readonly string[]): Flags {
  const positionals: string[] = [];
  const values: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values[key] = next;
        i++;
      } else {
        values[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, values };
}

function int(v: string | true | undefined, fallback: number): number {
  if (typeof v !== "string") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function faultCount(run: ScenarioRun): number {
  return run.schedule.filter((e) => e.action !== "heal").length;
}

function countEvents(run: ScenarioRun, type: string): number {
  return run.events.filter((e) => e.type === type).length;
}

/**
 * The broken-invariant fields for a JSON report: the first (the signal), a
 * capped sample, and the total count. Capping keeps the envelope lean for an
 * agent when one bug trips a long cascade of related violations.
 */
function invariantFields(breaks: string[]) {
  return { invariant: breaks[0], invariants: breaks.slice(0, 5), invariantCount: breaks.length };
}

/**
 * The shrunk fault schedule as structured fields, for the JSON report envelope.
 * When shrinking is off or finds no minimal set, every field is null so the
 * shape stays stable for a parser.
 */
function reproFields(
  scenario: Scenario,
  opts: { seed: number; ticks: number; profile: string },
  shrink: boolean,
) {
  const repro = shrink ? minimalRepro(scenario, opts, (r) => checkInvariants(scenario, r).length > 0) : null;
  return repro
    ? { minimalSchedule: repro.appliedFaults, essentialFaults: repro.mask.length, totalFaults: repro.fullFaultCount }
    : { minimalSchedule: null, essentialFaults: null, totalFaults: null };
}

/** Run one scenario CLI invocation. Returns the process exit code. */
export function runCli(argv: readonly string[], scenario: Scenario): number {
  const { positionals, values } = parseArgs(argv);
  const cmd = positionals[0];
  const ticks = int(values.ticks, 200);
  const seeds = int(values.seeds, 50);
  const profile = typeof values.profile === "string" ? values.profile : scenario.defaultProfile ?? "quiet";
  const json = values.json === true;
  const log = (o: unknown) => console.log(typeof o === "string" ? o : JSON.stringify(o));

  switch (cmd) {
    case "run": {
      const seed = int(positionals[1], 0);
      const run = runScenario(scenario, { seed, ticks, profile });
      const breaks = checkInvariants(scenario, run);
      if (json) {
        log({ cmd: "run", seed, ticks, profile, faults: faultCount(run), breaks });
      } else {
        log(`run scenario=${scenario.name} seed=${seed} ticks=${ticks} profile=${profile}`);
        log(
          `  faults=${faultCount(run)} delivers=${countEvents(run, "net.deliver")} requests=${
            countEvents(run, "client.request")
          }`,
        );
        log(breaks.length === 0 ? "  invariants OK" : `  invariants FAIL: ${breaks[0]}`);
      }
      return breaks.length === 0 ? 0 : 1;
    }

    case "replay": {
      const seed = int(positionals[1], 0);
      const a = runScenario(scenario, { seed, ticks, profile });
      const b = runScenario(scenario, { seed, ticks, profile });
      const identical = JSON.stringify(a.events) === JSON.stringify(b.events);
      if (!identical) {
        log(`NONDETERMINISM seed=${seed}: event logs differ across replays`);
        return 1;
      }
      log(`replay scenario=${scenario.name} seed=${seed} deterministic=yes`);
      log(`  fault schedule (${a.schedule.length} entries):`);
      for (const e of a.schedule) {
        log(`    tick=${e.tick} ${e.action} ${e.targets.join(",")}${e.detail ? " " + JSON.stringify(e.detail) : ""}`);
      }
      return 0;
    }

    case "fuzz": {
      if (values.guided === true) {
        const iterations = int(values.iterations, 20000);
        const seed = int(positionals[1], 0);
        const result = coverageFuzz(scenario, { seed, ticks, iterations });
        if (result.bug) {
          if (json) {
            log({
              v: 1,
              report: "fuzz-failure",
              mode: "guided",
              scenario: scenario.name,
              seed,
              ticks,
              profile,
              ...invariantFields(result.bug.breaks),
              // The guided fuzzer searches fault scripts directly, so the
              // breaking schedule is the reproduction (there is no seed to
              // replay); handed to the agent as minimalSchedule.
              minimalSchedule: result.bug.faults,
              foundAtIteration: result.iterations,
              coverage: result.coverage,
            });
            return 1;
          }
          log(`FAIL: coverage-guided fuzzing found a fault script that breaks an invariant: ${result.bug.breaks[0]}`);
          log(`  found at iteration ${result.iterations} (coverage ${result.coverage}); faults:`);
          for (const e of result.bug.faults) {
            log(
              `    tick=${e.tick} ${e.action} ${e.targets.join(",")}${e.detail ? " " + JSON.stringify(e.detail) : ""}`,
            );
          }
          return 1;
        }
        if (json) {
          log({
            v: 1,
            report: "fuzz-pass",
            mode: "guided",
            scenario: scenario.name,
            seed,
            ticks,
            profile,
            iterations: result.iterations,
            coverage: result.coverage,
          });
          return 0;
        }
        log(
          `ok: coverage-guided fuzzing ran ${result.iterations} iterations, coverage ${result.coverage}, no invariant broken`,
        );
        return 0;
      }
      const shrink = values["no-shrink"] !== true;
      for (let seed = 0; seed < seeds; seed++) {
        const run = runScenario(scenario, { seed, ticks, profile });
        const breaks = checkInvariants(scenario, run);
        if (breaks.length > 0) {
          if (json) {
            log({
              v: 1,
              report: "fuzz-failure",
              mode: "seeded",
              scenario: scenario.name,
              seed,
              ticks,
              profile,
              ...invariantFields(breaks),
              ...reproFields(scenario, { seed, ticks, profile }, shrink),
              reproduce: `explain ${seed} --ticks ${ticks} --profile ${profile}`,
            });
            return 1;
          }
          log(`FAIL seed=${seed} profile=${profile} ticks=${ticks}: ${breaks[0]}`);
          log(`  reproduce with: replay ${seed} --ticks ${ticks} --profile ${profile}`);
          if (shrink) {
            const repro = minimalRepro(
              scenario,
              { seed, ticks, profile },
              (r) => checkInvariants(scenario, r).length > 0,
            );
            if (repro) {
              log(`  minimal repro: ${repro.mask.length} of ${repro.fullFaultCount} faults are essential:`);
              for (const e of repro.appliedFaults) {
                log(
                  `    tick=${e.tick} ${e.action} ${e.targets.join(",")}${
                    e.detail ? " " + JSON.stringify(e.detail) : ""
                  }`,
                );
              }
            }
          }
          return 1;
        }
      }
      if (json) {
        log({ v: 1, report: "fuzz-pass", mode: "seeded", scenario: scenario.name, seeds, ticks, profile });
        return 0;
      }
      log(`ok: ${seeds} seeds x ${ticks} ticks, profile=${profile}, no invariant violated`);
      return 0;
    }

    case "assert": {
      const seed = int(positionals[1], 0);
      const run = runScenario(scenario, { seed, ticks, profile });
      const breaks = checkInvariants(scenario, run);
      if (breaks.length > 0) {
        log(`FAIL seed=${seed}: ${breaks.join("; ")}`);
        return 1;
      }
      log(`ok: seed=${seed} invariants hold`);
      return 0;
    }

    case "snap": {
      const seed = int(positionals[1], 0);
      const run = runScenario(scenario, { seed, ticks, profile });
      const state = scenario.snapshot ? scenario.snapshot(run) : run.nodeStates;
      log(snapshot(state));
      return 0;
    }

    case "explain": {
      const seed = int(positionals[1], 0);
      const run = runScenario(scenario, { seed, ticks, profile });
      const breaks = checkInvariants(scenario, run);
      if (breaks.length === 0) {
        if (json) {
          log({ v: 1, report: "clean", scenario: scenario.name, seed, ticks, profile });
          return 0;
        }
        log(`clean: scenario=${scenario.name} seed=${seed} holds; nothing to explain`);
        return 0;
      }
      const repro = minimalRepro(scenario, { seed, ticks, profile }, (r) => checkInvariants(scenario, r).length > 0);
      const tail = run.events.slice(-20);
      if (json) {
        log({
          v: 1,
          report: "failure",
          scenario: scenario.name,
          seed,
          ticks,
          profile,
          ...invariantFields(breaks),
          minimalSchedule: repro ? repro.appliedFaults : null,
          essentialFaults: repro ? repro.mask.length : null,
          totalFaults: repro ? repro.fullFaultCount : null,
          events: tail,
          eventsShown: tail.length,
          eventsTotal: run.events.length,
          reproduce: `explain ${seed} --ticks ${ticks} --profile ${profile}`,
        });
        return 1;
      }
      log("=== simharness failure report ===");
      log(`scenario: ${scenario.name}`);
      log(`seed: ${seed}   ticks: ${ticks}   profile: ${profile}`);
      log(`invariant: ${breaks[0]}`);
      if (repro) {
        log("");
        log(`minimal fault schedule (${repro.mask.length} of ${repro.fullFaultCount} faults essential):`);
        for (const e of repro.appliedFaults) {
          log(`  tick=${e.tick} ${e.action} ${e.targets.join(",")}${e.detail ? " " + JSON.stringify(e.detail) : ""}`);
        }
      }
      log("");
      log(`event log (last ${tail.length} of ${run.events.length}):`);
      for (const e of tail) log(`  tick=${e.tick} ${e.type}${e.detail ? " " + JSON.stringify(e.detail) : ""}`);
      log("");
      log(`reproduce: explain ${seed} --ticks ${ticks} --profile ${profile}`);
      return 1;
    }

    case "explore": {
      const seed = int(positionals[1], 0);
      const maxRuns = int(values["max-runs"], 2000);
      const result = exploreSchedules(scenario, { seed, ticks, profile, maxRuns });
      if (result.violation) {
        log(`FAIL seed=${seed}: a delivery order breaks an invariant: ${result.violation.breaks[0]}`);
        log(`  found after ${result.runs} schedules; reproduce path: [${result.violation.path.join(",")}]`);
        return 1;
      }
      log(
        `ok: seed=${seed} explored ${result.runs} delivery schedules, ${profile} profile${
          result.exhausted ? " (space exhausted)" : " (bound reached)"
        }, no reordering breaks an invariant`,
      );
      return 0;
    }

    case "metrics": {
      let faults = 0, delivers = 0, requests = 0;
      for (let seed = 0; seed < seeds; seed++) {
        const run = runScenario(scenario, { seed, ticks, profile });
        faults += faultCount(run);
        delivers += countEvents(run, "net.deliver");
        requests += countEvents(run, "client.request");
      }
      const summary = {
        seeds,
        ticks,
        profile,
        avgFaults: faults / seeds,
        avgDelivers: delivers / seeds,
        avgRequests: requests / seeds,
      };
      log(json ? summary : `metrics over ${seeds} seeds: ${JSON.stringify(summary)}`);
      return 0;
    }

    default:
      log(
        "usage: <run|replay|fuzz|assert|snap|metrics|explain|explore> [seed] [--ticks N] [--seeds N] [--profile NAME] [--json]",
      );
      return 2;
  }
}
