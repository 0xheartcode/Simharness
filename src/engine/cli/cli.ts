// The cluster orchestrator CLI (#33). Generalizes the single-adapter commands to
// a cluster scenario: run / replay / fuzz / assert / snap / metrics. Long-form
// flags, seed-first failure output, and fuzz returns a nonzero code with the
// offending seed so it works as a CI gate. runCli returns the exit code; a thin
// binary wrapper turns that into Deno.exit.

import { checkInvariants, runScenario, type Scenario, type ScenarioRun } from "./scenario.ts";
import { snapshot } from "../core/snapshot.ts";
import { minimalRepro } from "../check/shrink.ts";

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
      const shrink = values["no-shrink"] !== true;
      for (let seed = 0; seed < seeds; seed++) {
        const run = runScenario(scenario, { seed, ticks, profile });
        const breaks = checkInvariants(scenario, run);
        if (breaks.length > 0) {
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
        log(`clean: scenario=${scenario.name} seed=${seed} holds; nothing to explain`);
        return 0;
      }
      const repro = minimalRepro(scenario, { seed, ticks, profile }, (r) => checkInvariants(scenario, r).length > 0);
      const tail = run.events.slice(-20);
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
        "usage: <run|replay|fuzz|assert|snap|metrics|explain> [seed] [--ticks N] [--seeds N] [--profile NAME] [--json]",
      );
      return 2;
  }
}
