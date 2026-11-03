// Autoplayer: play a full seeded run under a strategy (the "GM").
import { run, type RunResult } from "./run";
import { strategies } from "./strategies";
import type { SimAdapter } from "./adapter";

export function autoplay<TExtra extends Record<string, unknown>>(
  a: SimAdapter<TExtra>,
  o: { seed: number; ticks: number; strategy?: string },
): RunResult<TExtra> {
  const strat = strategies[o.strategy ?? "aggressive"] ?? strategies.aggressive;
  return run(a, { seed: o.seed, ticks: o.ticks, timeline: (_t, s) => strat(s, a) });
}
