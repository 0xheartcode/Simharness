// Fuzz: random seeds + chaotic inputs, asserting invariants never break.
// For an action game it varies move/fire via strategies.random; for a sim that
// exposes a discrete-action seam (availableActions/act) it samples the real
// action space instead, so fuzz is meaningful off the movement path. Reports
// coverage (final-phase distribution, tick spread, action counts) and, per
// failure, the earliest tick it reproduces at.
import { run } from "./run";
import { strategies } from "./strategies";
import { randomActionPolicy } from "./actions";
import { createRng } from "./determinism";
import type { GameState, SimAdapter } from "./adapter";

export interface FuzzOpts<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  seeds: number;
  ticks: number;
  /** First seed to use; seeds are seedBase + i*7 (default 1000). */
  seedBase?: number;
  /** Project invariants: return a message for each broken one (empty = OK). */
  invariants?: (s: GameState<TExtra>) => string[];
}

export interface FuzzFailure {
  seed: number;
  message: string;
  /** Earliest tick the failure reproduces at (minimal tick budget); -1 for a thrown step(). */
  tick: number;
}

export interface FuzzResult {
  ok: boolean;
  seeds: number;
  ticks: number;
  failures: FuzzFailure[];
  /** Final-phase distribution, the tick spread reached, and (action mode) how often each action fired. */
  coverage: { phases: Record<string, number>; minTick: number; maxTick: number; actions?: Record<string, number> };
}

export function fuzz<TExtra extends Record<string, unknown>>(
  a: SimAdapter<TExtra>,
  o: FuzzOpts<TExtra>,
): FuzzResult {
  const failures: FuzzFailure[] = [];
  const seen = new Set<string>(); // dedupe identical (seed, message) across ticks
  const phases: Record<string, number> = {};
  const actionMode = typeof a.availableActions === "function" && typeof a.act === "function";
  const actionCounts: Record<string, number> = {};
  let minTick = Infinity;
  let maxTick = 0;

  const record = (seed: number, message: string, tick: number): void => {
    const key = `${seed}:${message}`;
    if (seen.has(key)) return; // keep the earliest tick only
    seen.add(key);
    failures.push({ seed, message, tick });
  };
  const check = (s: GameState<TExtra>, seed: number, tick: number): void => {
    if (s.hero && Number.isNaN(s.hero.hp as number)) record(seed, "NaN hero hp", tick);
    if (s.hero && (Number.isNaN(s.hero.x) || Number.isNaN(s.hero.y))) record(seed, "NaN hero pos", tick);
    for (const e of s.enemies ?? []) if (Number.isNaN(e.x) || Number.isNaN(e.y)) record(seed, "NaN enemy pos", tick);
    o.invariants?.(s).forEach((m) => record(seed, m, tick));
  };

  for (let i = 0; i < o.seeds; i++) {
    const seed = (o.seedBase ?? 1000) + i * 7;
    try {
      if (actionMode) {
        const policy = randomActionPolicy<TExtra>(createRng(seed));
        run(a, {
          seed,
          ticks: o.ticks,
          stopOnEnd: false,
          actionPolicy: (t, s, aa) => {
            check(s, seed, t);
            const act = policy(t, s, aa);
            if (act) actionCounts[act] = (actionCounts[act] ?? 0) + 1;
            return act;
          },
        });
      } else {
        run(a, {
          seed,
          ticks: o.ticks,
          stopOnEnd: false,
          timeline: (t, s) => {
            check(s, seed, t);
            return strategies.random(s, a);
          },
        });
      }
      const final = a.readState();
      check(final, seed, final.tick);
      phases[final.phase] = (phases[final.phase] ?? 0) + 1;
      minTick = Math.min(minTick, final.tick);
      maxTick = Math.max(maxTick, final.tick);
    } catch (e) {
      record(seed, `threw ${(e as Error).message}`, -1);
    }
  }

  return {
    ok: failures.length === 0,
    seeds: o.seeds,
    ticks: o.ticks,
    failures,
    coverage: {
      phases,
      minTick: minTick === Infinity ? 0 : minTick,
      maxTick,
      ...(actionMode ? { actions: actionCounts } : {}),
    },
  };
}
