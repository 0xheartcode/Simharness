// simharness: the game-agnostic contract. Any 2D game with a deterministic,
// render-separated sim implements SimAdapter; every harness tool (run, assert,
// autoplay, metrics, fuzz, ascii) is written against this, never the game.
//
// GameState is a tiny universal core: a controllable hero, a set of hostile
// entities, a phase string, a tick, plus a project-specific `extra` blob typed
// by the consumer. The harness core only ever touches the universal fields; all
// genre-specific state (resources, scores, inventory, etc.) lives in `extra`, so a
// tower-defense, a shmup and a roguelike all implement the same interface.

export interface InputState {
  move?: { x: number; y: number }; // -1..1, held until changed
  aimWorld?: { x: number; y: number }; // world-space aim target (game units)
  fire?: boolean; // held
  press?: string[]; // keys pressed THIS tick (edge-triggered)
  hold?: string[]; // keys held (replaces current held set)
}

/** The player-controlled unit, if the game has one. */
export interface HeroState {
  x: number;
  y: number;
  hp?: number;
  maxHp?: number;
  down?: boolean;
}

/** A hostile/neutral entity the strategies steer toward or shoot at. */
export interface EntityState {
  kind: string;
  x: number;
  y: number;
  hp?: number;
  id?: string;
}

/**
 * Universal run state + a game-specific `extra`. `TExtra` is whatever the
 * consumer's adapter puts there (a base's hp, resources, inventory, and the like); the
 * harness never reads it, but the consumer's asserts/metrics/invariants do, with
 * full typing via `SimAdapter<TExtra>` / `SimharnessConfig<TExtra>`.
 */
export interface GameState<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  tick: number;
  phase: string; // "running" means the run is live; anything else ends it
  hero?: HeroState;
  enemies: EntityState[];
  extra: TExtra;
}

export interface SimAdapter<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly name: string;
  /** Start a fresh, seeded run. `config` is typed per-adapter (hero class, difficulty, mode, ...). */
  reset(seed: number, config?: TConfig): void;
  step(dt: number): void;
  setInput(partial: InputState): void;
  readState(): GameState<TExtra>;
  snapshotAscii(): string;
  /** Optional: stage a situation for tests/metrics (e.g. open a door, spawn a wave, advance a phase). */
  debug?(action: string, arg?: unknown): void;
}

export type SimEvent = { tick: number; type: string; detail?: string };

/**
 * An autoplay policy: map observed state (and the adapter, for genre-specific
 * reads) to the input for this tick. Lives in the contract so a consumer can
 * declare `strategies` in its config without importing the harness tooling.
 */
export type Strategy<TExtra extends Record<string, unknown> = Record<string, unknown>> = (
  s: GameState<TExtra>,
  a: SimAdapter<TExtra>,
) => InputState;
