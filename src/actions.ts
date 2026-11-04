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
