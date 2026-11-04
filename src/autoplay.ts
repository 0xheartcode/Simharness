// Autoplayer: play a full seeded run under a strategy (the "GM").
import { run, type RunResult } from "./run";
import { strategies } from "./strategies";
import type { GameState, SimAdapter, Strategy } from "./adapter";

export interface AutoplayOpts<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
  seed: number;
  ticks: number;
  /** Strategy name to resolve against the built-ins + `strategies` (default "aggressive"). */
  strategy?: string;
  /** Extra named strategies (e.g. a project's `config.strategies`), merged over the built-ins. */
  strategies?: Record<string, Strategy<TExtra>>;
  /** Enforce invariants on this run (recorded in `RunResult.invariantBreaks`). */
  invariants?: (s: GameState<TExtra>) => string[];
  /** Typed run config forwarded to `reset(seed, config)`. */
  config?: TConfig;
}

/**
 * Resolve a strategy by name against the built-ins plus any extras. Throws on an
 * unknown name (never silently falls back) so a typo or missing project strategy
 * is a loud error, not the wrong policy run quietly.
 */
export function resolveStrategy<TExtra extends Record<string, unknown>>(
  name: string,
  extra?: Record<string, Strategy<TExtra>>,
): Strategy<TExtra> {
  const all: Record<string, Strategy<TExtra>> = {
    ...(strategies as unknown as Record<string, Strategy<TExtra>>),
    ...(extra ?? {}),
  };
  const strat = all[name];
  if (!strat) {
    throw new Error(`unknown strategy "${name}" (available: ${Object.keys(all).sort().join(", ")})`);
  }
  return strat;
}

export function autoplay<
  TExtra extends Record<string, unknown>,
  TConfig extends Record<string, unknown> = Record<string, unknown>,
>(
  a: SimAdapter<TExtra, TConfig>,
  o: AutoplayOpts<TExtra, TConfig>,
): RunResult<TExtra> {
  const strat = resolveStrategy<TExtra>(o.strategy ?? "aggressive", o.strategies);
  return run(a, {
    seed: o.seed,
    ticks: o.ticks,
    timeline: (_t, s) => strat(s, a),
    invariants: o.invariants,
    config: o.config,
  });
}
