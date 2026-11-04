// Generic CLI, driven by a project's SimharnessConfig. Game-agnostic: every
// command works through the SimAdapter; project-specific logic (staging,
// assertions, metrics, invariants) comes from the config. The run printout shows
// the universal core plus a flat dump of the game's `extra`.
//
// Flags (anywhere in argv): --json emits a single machine-readable JSON object
// and suppresses the human text (for run / autoplay / balance / fuzz).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { SimharnessConfig } from "./config";
import type { GameState, SimEvent } from "./adapter";
import { run } from "./run";
import { autoplay } from "./autoplay";
import { fuzz } from "./fuzz";
import { strategies } from "./strategies";

function emit(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function runPayload<T extends Record<string, unknown>>(seed: number, r: { final: GameState<T>; events: SimEvent[] }) {
  const f = r.final;
  return {
    seed,
    final: { tick: f.tick, phase: f.phase, hero: f.hero, enemies: f.enemies.length, extra: f.extra },
    events: r.events,
  };
}

function printRun<T extends Record<string, unknown>>(
  seed: number,
  r: { final: GameState<T>; events: SimEvent[] },
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
}

export function runCli<TExtra extends Record<string, unknown>>(
  config: SimharnessConfig<TExtra>,
  argv: string[] = process.argv.slice(2),
): void {
  const a = config.createAdapter();
  const pos = argv.filter((x) => !x.startsWith("--"));
  const flags = new Set(argv.filter((x) => x.startsWith("--")));
  const json = flags.has("--json");
  const cmd = pos[0] ?? "help";
  const num = (i: number, d: number): number => (pos[i] !== undefined ? +pos[i] : d);
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
      const r = run(a, { seed, ticks: num(2, 600), timeline: (_t, s) => strategies.aggressive(s, a) });
      if (json) emit(runPayload(seed, r));
      else printRun(seed, r);
      break;
    }
    case "ascii":
      stage(num(1, 1));
      console.log(a.snapshotAscii());
      break;
    case "autoplay": {
      const seed = num(1, 1);
      try {
        const r = autoplay(a, { seed, ticks: num(2, 2000), strategy: pos[3], strategies: config.strategies });
        if (json) emit(runPayload(seed, r));
        else printRun(seed, r);
      } catch (e) {
        if (json) emit({ error: (e as Error).message });
        else console.error((e as Error).message);
        process.exit(1);
      }
      break;
    }
    case "fuzz": {
      const seeds = num(1, 20), ticks = num(2, 600);
      const f = fuzz(a, { seeds, ticks, invariants: config.invariants });
      if (json) {
        emit({ ok: f.length === 0, seeds, ticks, failures: f });
      } else if (f.length) {
        console.error("FUZZ FAILURES:");
        f.forEach((x) => console.error("  " + x));
      } else {
        console.log(`fuzz OK: ${seeds} seeds x ${ticks} ticks, no invariant broke`);
      }
      if (f.length) process.exit(1);
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
    case "balance": {
      if (!config.metrics) {
        console.error("No metrics() in simharness.config");
        process.exit(2);
      }
      const m = config.metrics(a, { seeds: num(1, 8), ticks: num(2, 60 * 80) });
      if (json) {
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
  snap <seed>                       write/diff an ASCII snapshot (regression)
  --json                            machine-readable output (run/autoplay/fuzz/assert/balance)`);
  }
}
