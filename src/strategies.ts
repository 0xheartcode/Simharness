// Autoplay policies. Each maps observed state -> input for the tick. They use
// only the universal core (hero + enemies), so they are game-agnostic; a project
// that needs genre-specific behaviour (e.g. "retreat to base") registers its own
// strategies in its config and references state via `extra`.
import type { GameState, InputState, SimAdapter } from "./adapter";

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

export type Strategy = (s: GameState, a: SimAdapter) => InputState;

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
