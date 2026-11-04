// Autoplay policies. Each maps observed state -> input for the tick. They use
// only the universal core (hero + enemies), so they are game-agnostic; a project
// that needs genre-specific behaviour (e.g. "retreat to base") registers its own
// strategies in its config and references state via `extra`.
import type { GameState, Strategy } from "./adapter";

export type { Strategy };

function nearest(s: GameState): { x: number; y: number } | null {
  if (!s.hero || !s.enemies.length) return null;
  let b = s.enemies[0];
  let bd = Infinity;
  for (const e of s.enemies) {
    const d = (e.x - s.hero.x) ** 2 + (e.y - s.hero.y) ** 2;
    if (d < bd) {
      bd = d;
      b = e;
    }
  }
  return { x: b.x, y: b.y };
}
function toward(tx: number, ty: number, s: GameState): { x: number; y: number } {
  if (!s.hero) return { x: 0, y: 0 };
  const dx = tx - s.hero.x, dy = ty - s.hero.y, l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}
const here = (s: GameState): { x: number; y: number } => (s.hero ? { x: s.hero.x, y: s.hero.y } : { x: 0, y: 0 });
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

export const strategies: Record<string, Strategy> = {
  idle: () => ({}),
  // charge the nearest enemy, guns blazing
  aggressive: (s) => {
    const e = nearest(s);
    return { move: e ? toward(e.x, e.y, s) : { x: 0, y: 0 }, fire: !!e, aimWorld: e ?? here(s) };
  },
  // hold position, shoot whatever comes into range
  turtle: (s) => {
    const e = nearest(s);
    return { move: { x: 0, y: 0 }, fire: !!e, aimWorld: e ?? here(s) };
  },
  // chaos: random movement + random macro keys, for fuzzing input handling
  random: (s) => ({
    move: { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 },
    fire: Math.random() < 0.7,
    aimWorld: nearest(s) ?? here(s),
    press: Math.random() < 0.12 ? [pick(["e", "q", "f", "b", "r", "g", " "])] : undefined,
  }),
};

/** An ability a composed strategy presses off cooldown. */
export interface AbilitySpec<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  /** Key to press (edge-triggered) when off cooldown. */
  key: string;
  /** Press once every N ticks (the cooldown). */
  everyTicks: number;
  /** Tick offset, so several abilities need not all fire on the same tick. */
  offset?: number;
  /** Only fire when this holds (e.g. an enemy is in range). */
  when?: (s: GameState<TExtra>) => boolean;
}

/**
 * Compose a base strategy with declared abilities fired off cooldown, replacing
 * magic-number tick-modulo keypress math. The ability keys merge into `press`.
 */
export function withAbilities<TExtra extends Record<string, unknown> = Record<string, unknown>>(
  base: Strategy<TExtra>,
  abilities: readonly AbilitySpec<TExtra>[],
): Strategy<TExtra> {
  return (s, a) => {
    const inp = base(s, a);
    const press = [...(inp.press ?? [])];
    for (const ab of abilities) {
      const rel = s.tick - (ab.offset ?? 0);
      if (ab.everyTicks > 0 && rel >= 0 && rel % ab.everyTicks === 0 && (!ab.when || ab.when(s))) press.push(ab.key);
    }
    return press.length ? { ...inp, press } : inp;
  };
}
