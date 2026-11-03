// Fuzz: random seeds + chaotic inputs, asserting invariants never break.
// The harness checks only universal invariants (no NaN positions/hp, never
// throws); genre-specific invariants ("coreHp never exceeds max", "no negative
// resource") come from the consumer via `invariants(state)` in its config.
import { run } from "./run";
import { strategies } from "./strategies";
import type { GameState, SimAdapter } from "./adapter";

export interface FuzzOpts<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  seeds: number;
  ticks: number;
  /** Project invariants: return a message for each broken one (empty = OK). */
  invariants?: (s: GameState<TExtra>) => string[];
}

export function fuzz<TExtra extends Record<string, unknown>>(a: SimAdapter<TExtra>, o: FuzzOpts<TExtra>): string[] {
  const fails = new Set<string>();
  const check = (s: GameState<TExtra>, seed: number) => {
    if (s.hero && Number.isNaN(s.hero.hp as number)) fails.add(`seed ${seed}: NaN hero hp`);
    if (s.hero && (Number.isNaN(s.hero.x) || Number.isNaN(s.hero.y))) fails.add(`seed ${seed}: NaN hero pos`);
    for (const e of s.enemies) if (Number.isNaN(e.x) || Number.isNaN(e.y)) fails.add(`seed ${seed}: NaN enemy pos`);
    o.invariants?.(s).forEach((m) => fails.add(`seed ${seed}: ${m}`));
  };
  for (let i = 0; i < o.seeds; i++) {
    const seed = 1000 + i * 7;
    try {
      run(a, {
        seed,
        ticks: o.ticks,
        stopOnEnd: false,
        timeline: (_t, s) => {
          check(s, seed);
          return strategies.random(s, a);
        },
      });
      check(a.readState(), seed);
    } catch (e) {
      fails.add(`seed ${seed}: threw ${(e as Error).message}`);
    }
  }
  return [...fails];
}
