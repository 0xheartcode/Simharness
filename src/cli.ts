// Generic CLI, driven by a project's SimharnessConfig. Game-agnostic: every
// command works through the SimAdapter; project-specific logic (staging,
// assertions, metrics, invariants) comes from the config. The run printout shows
// the universal core plus a flat dump of the game's `extra`.
//
// Flags (anywhere in argv): --json emits a single machine-readable JSON object
// and suppresses the human text (for run / autoplay / balance / fuzz).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { SimharnessConfig } from "./config";
import { run, type RunResult } from "./run";
import { autoplay } from "./autoplay";
import { fuzz } from "./fuzz";
import { strategies } from "./strategies";
import { diffMetrics, formatDiff } from "./baseline";

const VALUE_FLAGS = new Set(["against", "tolerance", "config"]);

/** Parse `--config '<json>'` into an object (throws on invalid JSON). */
function parseConfigFlag(v: string | true | undefined): Record<string, unknown> | undefined {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v) as Record<string, unknown>;
  } catch {
    throw new Error(`--config is not valid JSON: ${v}`);
  }
}

/** Resolve a baseline name to a file path (`<name>` -> `.simharness-baseline/<name>.json`; a path/`.json` is used as-is). */
function baselinePath(name: string): string {
  return name.includes("/") || name.endsWith(".json") ? name : `.simharness-baseline/${name}.json`;
}

function emit(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function runPayload<T extends Record<string, unknown>>(seed: number, r: RunResult<T>) {
  const f = r.final;
  return {
    seed,
    final: { tick: f.tick, phase: f.phase, hero: f.hero, enemies: f.enemies.length, extra: f.extra },
    events: r.events,
    invariantBreaks: r.invariantBreaks,
  };
}

function printRun<T extends Record<string, unknown>>(
  seed: number,
  r: RunResult<T>,
): void {
  const f = r.final;
  console.log(
    JSON.stringify(
      {
        seed,
        tick: f.tick,
        phase: f.phase,
        hero: f.hero,
        enemies: f.enemies.length,
        ...(f.extra as Record<string, unknown>),
      },
      null,
      2,
    ),
  );
  console.log("events (last 12):");
  for (const e of r.events.slice(-12)) console.log(`  t${e.tick}  ${e.type}  ${e.detail ?? ""}`);
  if (r.invariantBreaks.length) {
    console.error(`INVARIANT BREAKS (${r.invariantBreaks.length}):`);
    r.invariantBreaks.forEach((m) => console.error("  " + m));
  }
}

export function runCli<TExtra extends Record<string, unknown>>(
  config: SimharnessConfig<TExtra>,
  argv: string[] = process.argv.slice(2),
): void {
  const a = config.createAdapter();
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const tkn = argv[i];
    if (!tkn.startsWith("--")) {
      pos.push(tkn);
      continue;
    }
    const eq = tkn.indexOf("=");
    const key = tkn.slice(2, eq >= 0 ? eq : undefined);
    if (eq >= 0) flags[key] = tkn.slice(eq + 1);
    else if (VALUE_FLAGS.has(key) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
    else flags[key] = true;
  }
  const json = flags.json === true;
  const cmd = pos[0] ?? "help";
  const num = (i: number, d: number): number => (pos[i] !== undefined ? +pos[i] : d);
  let runConfig: Record<string, unknown> | undefined;
  try {
    runConfig = parseConfigFlag(flags.config);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  const stage = (seed: number): void => {
    if (config.stage) config.stage(a, seed);
    else {
      a.reset(seed);
      for (let i = 0; i < 30; i++) a.step(1 / 60);
    }
  };

  switch (cmd) {
    case "run": {
      const seed = num(1, 1);
      const r = run(a, {
        seed,
        ticks: num(2, 600),
        timeline: (_t, s) => strategies.aggressive(s, a),
        invariants: config.invariants,
        config: runConfig,
      });
      if (json) emit(runPayload(seed, r));
      else printRun(seed, r);
      if (r.invariantBreaks.length) process.exit(1);
      break;
    }
    case "ascii":
      stage(num(1, 1));
      console.log(a.snapshotAscii());
      break;
    case "autoplay": {
      const seed = num(1, 1);
      try {
        const r = autoplay(a, {
          seed,
          ticks: num(2, 2000),
          strategy: pos[3],
          strategies: config.strategies,
          invariants: config.invariants,
          config: runConfig,
        });
        if (json) emit(runPayload(seed, r));
        else printRun(seed, r);
        if (r.invariantBreaks.length) process.exit(1);
      } catch (e) {
        if (json) emit({ error: (e as Error).message });
        else console.error((e as Error).message);
        process.exit(1);
      }
      break;
    }
    case "fuzz": {
      const seeds = num(1, 20), ticks = num(2, 600);
      const res = fuzz(a, { seeds, ticks, invariants: config.invariants });
      if (json) {
        emit(res);
      } else if (!res.ok) {
        console.error("FUZZ FAILURES:");
        res.failures.forEach((x) => console.error(`  seed ${x.seed} @t${x.tick}: ${x.message}`));
      } else {
        console.log(
          `fuzz OK: ${seeds} seeds x ${ticks} ticks, no invariant broke (phases: ${
            JSON.stringify(res.coverage.phases)
          })`,
        );
      }
      if (!res.ok) process.exit(1);
      break;
    }
    case "assert": {
      if (!config.asserts) {
        console.error("No asserts() in simharness.config");
        process.exit(2);
      }
      const res = config.asserts(a);
      const ok = res.every((r) => r.ok);
      if (json) {
        emit({ ok, asserts: res });
      } else {
        for (const r of res) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.msg ? "  (" + r.msg + ")" : ""}`);
        console.log(ok ? "ALL PASS" : "FAILURES");
      }
      process.exit(ok ? 0 : 1);
      break; // unreachable (process.exit does not return); satisfies no-fallthrough
    }
    case "baseline": {
      if (!config.metrics) {
        console.error("No metrics() in simharness.config");
        process.exit(2);
      }
      if (pos[1] !== "save") {
        console.error("usage: simharness baseline save [name] [seeds] [ticks]");
        process.exit(2);
      }
      const m = config.metrics(a, { seeds: num(3, 8), ticks: num(4, 60 * 80) });
      const file = baselinePath(pos[2] ?? "default");
      const slash = file.lastIndexOf("/");
      if (slash > 0) mkdirSync(file.slice(0, slash), { recursive: true });
      writeFileSync(file, JSON.stringify(m.summary, null, 2) + "\n");
      if (json) emit({ saved: file, summary: m.summary });
      else console.log(`baseline: WROTE ${file}`);
      break;
    }
    case "balance": {
      if (!config.metrics) {
        console.error("No metrics() in simharness.config");
        process.exit(2);
      }
      const m = config.metrics(a, { seeds: num(1, 8), ticks: num(2, 60 * 80) });
      const against = flags.against;
      if (typeof against === "string") {
        const file = baselinePath(against);
        if (!existsSync(file)) {
          console.error(`baseline not found: ${file} (create it with 'baseline save')`);
          process.exit(2);
        }
        const base = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
        const tol = typeof flags.tolerance === "string" ? +flags.tolerance : 10;
        const diff = diffMetrics(base, m.summary, tol);
        if (json) emit(diff);
        else formatDiff(diff).forEach((l) => console.log(l));
        if (diff.regressed) process.exit(1);
      } else if (json) {
        emit(m.summary);
      } else {
        console.log(JSON.stringify(m.summary, null, 2));
        m.rows.forEach((r) => console.log("  " + r));
      }
      break;
    }
    case "snap": {
      const seed = num(1, 1);
      stage(seed);
      const snap = a.snapshotAscii();
      mkdirSync(".simharness-snap", { recursive: true });
      const file = `.simharness-snap/${a.name}-seed-${seed}.txt`;
      if (existsSync(file)) {
        const old = readFileSync(file, "utf8");
        if (old === snap) {
          console.log(`snap ${seed}: MATCH`);
          break;
        }
        const oa = old.split("\n"), na = snap.split("\n");
        let diff = 0;
        for (let i = 0; i < Math.max(oa.length, na.length); i++) if (oa[i] !== na[i]) diff++;
        console.log(`snap ${seed}: CHANGED (${diff} lines differ)`);
        process.exit(1);
      }
      writeFileSync(file, snap);
      console.log(`snap ${seed}: WROTE ${file}`);
      break;
    }
    default:
      console.log(`simharness: game-agnostic AI dev harness (adapter: ${a.name})
Usage: simharness <cmd> [--json]   (needs a simharness.config.ts in the cwd)
  run <seed> [ticks]                autoplay a run, print final state + events
  ascii <seed>                      staged scene -> ASCII board snapshot
  autoplay <seed> [ticks] [strat]   strat = a built-in or a config strategy
  fuzz [seeds] [ticks]              random inputs, assert invariants (CI gate)
  assert                            project assertions (CI gate)
  balance [seeds] [ticks]           project balance metrics
  balance --against <name> [--tolerance <pct>]   diff metrics vs a saved baseline (CI gate)
  baseline save [name] [seeds] [ticks]           save current metrics as a baseline
  snap <seed>                       write/diff an ASCII snapshot (regression)
  --json                            machine-readable output (run/autoplay/fuzz/assert/balance/baseline)`);
  }
}
