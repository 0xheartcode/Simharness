// Discrete-action helpers for non-realtime games (management, economy,
// turn-based). A sim that implements availableActions()/act() exposes an action
// space; these policies drive it the way strategies drive move/aim/fire.
import type { GameState, SimAdapter } from "./adapter";
import type { Rng } from "./determinism";

/** A per-tick action chooser: return an action id to apply via adapter.act, or nothing to skip. */
export type ActionPolicy<TExtra extends Record<string, unknown> = Record<string, unknown>> = (
  t: number,
  s: GameState<TExtra>,
  a: SimAdapter<TExtra>,
) => string | void;

/** Pick a uniformly random legal action each tick, seeded for determinism. */
export function randomActionPolicy<TExtra extends Record<string, unknown> = Record<string, unknown>>(
  rng: Rng,
): ActionPolicy<TExtra> {
  return (_t, _s, a) => {
    const acts = a.availableActions?.() ?? [];
    return acts.length ? acts[rng.int(acts.length)] : undefined;
  };
}

// ---- Porcelain: composable, declarative action policies over the raw seam ----

/** Each tick, apply the first of `preferred` that is currently legal (a priority policy). */
export function firstLegal<TExtra extends Record<string, unknown> = Record<string, unknown>>(
  preferred: readonly string[],
): ActionPolicy<TExtra> {
  return (_t, _s, a) => {
    const legal = new Set(a.availableActions?.() ?? []);
    return preferred.find((p) => legal.has(p));
  };
}

/** Apply `ids` in order, one per tick; past the end, stop (or loop when `opts.loop`). */
export function sequenceActions<TExtra extends Record<string, unknown> = Record<string, unknown>>(
  ids: readonly string[],
  opts: { loop?: boolean } = {},
): ActionPolicy<TExtra> {
  return (t) => (ids.length === 0 ? undefined : opts.loop ? ids[t % ids.length] : ids[t]);
}

/** Replay an explicit action trace, one action per tick (the counterpart used by shrinking). */
export function replayActions<TExtra extends Record<string, unknown> = Record<string, unknown>>(
  trace: readonly string[],
): ActionPolicy<TExtra> {
  return (t) => trace[t];
}

/**
 * Greedily reduce an action `trace` to a minimal subsequence that still triggers
 * `target` (a failure message) when replayed deterministically on a fresh adapter.
 * `detect` returns the failure messages for a state. Pure replay, no RNG, so the
 * result is a smallest reproducer you can hand back to `replayActions`.
 */
export function shrinkActionTrace<TExtra extends Record<string, unknown>>(
  a: SimAdapter<TExtra>,
  seed: number,
  trace: readonly string[],
  detect: (s: GameState<TExtra>) => string[],
  target: string,
  dt = 1 / 60,
): string[] {
  const reproduces = (cand: readonly string[]): boolean => {
    a.reset(seed);
    if (detect(a.readState()).includes(target)) return true;
    for (let t = 0; t < cand.length; t++) {
      if (cand[t]) a.act?.(cand[t]);
      a.step(dt);
      if (detect(a.readState()).includes(target)) return true;
    }
    return false;
  };
  let current = [...trace];
  if (!reproduces(current)) return current; // not deterministically reproducible: leave as-is
  let i = 0;
  while (i < current.length) {
    const candidate = current.slice(0, i).concat(current.slice(i + 1));
    if (reproduces(candidate)) current = candidate; // dropping i still fails: keep it dropped
    else i++;
  }
  return current;
}
