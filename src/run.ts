// Deterministic run loop + event derivation (shared by every command).
// Generic over the consumer's `extra`; event derivation only inspects the
// universal core (phase, enemy count, hero down) so it works for any game.
import type { GameState, InputState, SimAdapter, SimEvent } from "./adapter";

export interface RunOpts<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
  seed: number;
  ticks: number;
  dt?: number;
  /** Typed run config forwarded to `reset(seed, config)` (hero class, difficulty, mode, ...). */
  config?: TConfig;
  noReset?: boolean; // keep a staged state (metrics/assert set up before running)
  stopOnEnd?: boolean; // default true
  timeline?: (t: number, s: GameState<TExtra>, a: SimAdapter<TExtra, TConfig>) => InputState | void;
  /** Pick a discrete action to apply each tick via adapter.act (the non-spatial counterpart to timeline). */
  actionPolicy?: (t: number, s: GameState<TExtra>, a: SimAdapter<TExtra, TConfig>) => string | void;
  /** Stop the run as soon as this returns true (checked after each step). */
  stopWhen?: (s: GameState<TExtra>) => boolean;
  /** Enforce invariants on this deterministic run; each returned message is recorded (deduped). */
  invariants?: (s: GameState<TExtra>) => string[];
}

/** The outcome of a run: the final state, the derived event log, and any invariant breaks. */
export interface RunResult<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  final: GameState<TExtra>;
  events: SimEvent[];
  invariantBreaks: string[];
}

export function run<
  TExtra extends Record<string, unknown>,
  TConfig extends Record<string, unknown> = Record<string, unknown>,
>(
  a: SimAdapter<TExtra, TConfig>,
  o: RunOpts<TExtra, TConfig>,
): RunResult<TExtra> {
  if (!o.noReset) a.reset(o.seed, o.config);
  const dt = o.dt ?? 1 / 60;
  const events: SimEvent[] = [];
  const breaks = new Set<string>();
  let prev = a.readState();
  for (let t = 0; t < o.ticks; t++) {
    const s = a.readState();
    const inp = o.timeline?.(t, s, a);
    if (inp) a.setInput(inp);
    const action = o.actionPolicy?.(t, s, a);
    if (action && a.act) a.act(action);
    a.step(dt);
    const now = a.readState();
    derive(prev, now, t, events);
    o.invariants?.(now).forEach((m) => breaks.add(`t${t}: ${m}`));
    prev = now;
    if (o.stopWhen?.(now)) break;
    if (o.stopOnEnd !== false && now.phase !== "running") break;
  }
  return { final: a.readState(), events, invariantBreaks: [...breaks] };
}

function derive<TExtra extends Record<string, unknown>>(
  p: GameState<TExtra>,
  n: GameState<TExtra>,
  t: number,
  ev: SimEvent[],
): void {
  const ne = n.enemies ?? [];
  const pe = p.enemies ?? [];
  if (ne.length < pe.length) {
    ev.push({ tick: t, type: "clear", detail: `-${pe.length - ne.length} enemies (${ne.length})` });
  }
  if (n.hero?.down && !p.hero?.down) ev.push({ tick: t, type: "hero-down" });
  if (n.phase !== p.phase) ev.push({ tick: t, type: "phase", detail: n.phase });
}
