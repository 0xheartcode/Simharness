// Deterministic run loop + event derivation (shared by every command).
// Generic over the consumer's `extra`; event derivation only inspects the
// universal core (phase, enemy count, hero down) so it works for any game.
import type { GameState, InputState, SimAdapter, SimEvent } from "./adapter";

export interface RunOpts<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  seed: number;
  ticks: number;
  dt?: number;
  cls?: string;
  noReset?: boolean; // keep a staged state (metrics/assert set up before running)
  stopOnEnd?: boolean; // default true
  timeline?: (t: number, s: GameState<TExtra>, a: SimAdapter<TExtra>) => InputState | void;
}

/** The outcome of a run: the final state plus the derived event log. */
export interface RunResult<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  final: GameState<TExtra>;
  events: SimEvent[];
}

export function run<TExtra extends Record<string, unknown>>(
  a: SimAdapter<TExtra>,
  o: RunOpts<TExtra>,
): RunResult<TExtra> {
  if (!o.noReset) a.reset(o.seed, { cls: o.cls });
  const dt = o.dt ?? 1 / 60;
  const events: SimEvent[] = [];
  let prev = a.readState();
  for (let t = 0; t < o.ticks; t++) {
    const s = a.readState();
    const inp = o.timeline?.(t, s, a);
    if (inp) a.setInput(inp);
    a.step(dt);
    const now = a.readState();
    derive(prev, now, t, events);
    prev = now;
    if (o.stopOnEnd !== false && now.phase !== "running") break;
  }
  return { final: a.readState(), events };
}

function derive<TExtra extends Record<string, unknown>>(
  p: GameState<TExtra>,
  n: GameState<TExtra>,
  t: number,
  ev: SimEvent[],
): void {
  if (n.enemies.length < p.enemies.length) {
    ev.push({
      tick: t,
      type: "clear",
      detail: `-${p.enemies.length - n.enemies.length} enemies (${n.enemies.length})`,
    });
  }
  if (n.hero?.down && !p.hero?.down) ev.push({ tick: t, type: "hero-down" });
  if (n.phase !== p.phase) ev.push({ tick: t, type: "phase", detail: n.phase });
}
