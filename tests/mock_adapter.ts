// A controllable SimAdapter for the harness's own unit tests. It is
// deliberately scriptable: a test asks for an adapter that kills an enemy on
// fire, bleeds the hero, ends the run at a given tick, or injects a NaN / throw,
// and then drives it through run()/fuzz()/the CLI to assert the harness reacts.
import type { EntityState, GameState, InputState, SimAdapter } from "@0xheartcode/simharness/adapter";

export interface MockExtra extends Record<string, unknown> {
  count: number;
  fired: number;
}

export interface MockOpts {
  /** Number of enemies to spawn on reset (default 3). */
  enemies?: number;
  /** Remove one enemy whenever `fire` is held (drives the "clear" event). */
  killOnFire?: boolean;
  /** Subtract this much hero hp each tick (drives hero-down / phase). */
  bleed?: number;
  /** Force phase "over" when tick reaches this value. */
  endAt?: number;
  /** Set hero hp to NaN at this tick (drives a fuzz failure). */
  nanAt?: number;
  /** Throw from step() at this tick (drives the fuzz try/catch). */
  throwAt?: number;
}

export class MockAdapter implements SimAdapter<MockExtra> {
  readonly name = "mock";
  tick = 0;
  phase = "running";
  hero = { x: 0, y: 0, hp: 5, maxHp: 5, down: false };
  enemies: EntityState[] = [];
  private count = 0;
  private fired = 0;
  private input: InputState = {};
  private staged = 0;

  constructor(private opts: MockOpts = {}) {}

  reset(seed: number, _opts?: Record<string, unknown>): void {
    this.tick = 0;
    this.phase = "running";
    this.hero = { x: 0, y: 0, hp: 5, maxHp: 5, down: false };
    const n = this.opts.enemies ?? 3;
    this.enemies = Array.from({ length: n }, (_v, i) => ({ kind: "creep", id: `e${i}`, x: seed + i, y: i, hp: 1 }));
    this.count = 0;
    this.fired = 0;
    this.input = {};
    this.staged = 0;
  }

  setInput(partial: InputState): void {
    this.input = { ...this.input, ...partial };
  }

  step(_dt: number): void {
    if (this.phase !== "running") return;
    this.tick++;
    this.count++;
    if (this.opts.throwAt === this.tick) throw new Error("boom");
    if (this.input.fire) {
      this.fired++;
      if (this.opts.killOnFire && this.enemies.length) this.enemies.pop();
    }
    if (this.opts.bleed) this.hero.hp -= this.opts.bleed;
    if (this.opts.nanAt === this.tick) this.hero.hp = NaN;
    if ((this.opts.endAt !== undefined && this.tick >= this.opts.endAt) || this.hero.hp <= 0) {
      if (this.hero.hp <= 0) {
        this.hero.hp = 0;
        this.hero.down = true;
      }
      this.phase = "over";
    }
  }

  readState(): GameState<MockExtra> {
    return {
      tick: this.tick,
      phase: this.phase,
      hero: { ...this.hero },
      enemies: this.enemies.map((e) => ({ ...e })),
      extra: { count: this.count, fired: this.fired },
    };
  }

  snapshotAscii(): string {
    return `mock tick ${this.tick} phase ${this.phase} enemies ${this.enemies.length}\n@${
      ".".repeat(this.enemies.length)
    }`;
  }

  debug(action: string, _arg?: unknown): void {
    if (action === "stage") this.staged++;
    if (action === "spawn") this.enemies.push({ kind: "creep", id: `s${this.enemies.length}`, x: 9, y: 9, hp: 1 });
    if (action === "clear") this.enemies = [];
  }

  /** Exposed so a test can assert staging ran. */
  get stagedCount(): number {
    return this.staged;
  }
}
