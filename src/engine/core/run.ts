// The fast-forward run loop and the replay guarantee (#26). A Simulation wires
// the clock, the seeded entropy, an event log, and a built set of components
// into one Driver, then runs ticks as fast as the CPU allows: no real time
// elapses, so a simulated 10,000-tick timeout is 10,000 iterations, not a wall
// delay. The output of a run is a final tick plus a tick-stamped event log, and
// re-running a seed reproduces both exactly.

import { Driver, type Tickable } from "./tickable.ts";
import { TickClock } from "./clock.ts";
import { createEntropy, type Entropy } from "./entropy.ts";

/** One recorded event, stamped with the tick it happened on. */
export interface SimEvent {
  tick: number;
  type: string;
  detail?: unknown;
}

/** The append-only, tick-stamped log a run produces. Components record into it. */
export class EventLog {
  readonly #clock: TickClock;
  readonly #events: SimEvent[] = [];

  constructor(clock: TickClock) {
    this.#clock = clock;
  }

  /** Append an event at the current tick. `detail` is omitted from the entry when undefined. */
  record(type: string, detail?: unknown): void {
    this.#events.push(
      detail === undefined ? { tick: this.#clock.now(), type } : { tick: this.#clock.now(), type, detail },
    );
  }

  /** The events recorded so far, in order. */
  get entries(): readonly SimEvent[] {
    return this.#events;
  }
}

/** What a component factory is handed: the run's clock, entropy, and event log. */
export interface SimContext {
  clock: TickClock;
  entropy: Entropy;
  log: EventLog;
}

/** The result of a run: the final tick and the full event log. */
export interface RunResult {
  tick: number;
  events: readonly SimEvent[];
}

/**
 * A single deterministic run. Construct it with a seed and a `build` that wires
 * the components from the context; the clock is always ticked first, so a
 * component that reads `clock.now()` during its tick sees the current tick. Two
 * Simulations with the same seed and the same `build` produce identical logs.
 */
export class Simulation {
  readonly clock: TickClock;
  readonly entropy: Entropy;
  readonly log: EventLog;
  readonly #driver: Driver;

  constructor(seed: number, build: (ctx: SimContext) => Tickable[]) {
    this.clock = new TickClock();
    this.entropy = createEntropy(seed);
    this.log = new EventLog(this.clock);
    const components = build({ clock: this.clock, entropy: this.entropy, log: this.log });
    this.#driver = new Driver([this.clock, ...components]);
  }

  /** Ticks taken so far. */
  get step(): number {
    return this.#driver.step;
  }

  /** Run exactly `ticks` ticks (fast-forward, no real time). */
  run(ticks: number): RunResult {
    for (let i = 0; i < ticks; i++) this.#driver.tick();
    return this.result();
  }

  /** Run until `predicate` holds, at most `bound` ticks (throws TickBudgetExceeded past the bound). */
  runUntil(predicate: () => boolean, bound: number): RunResult {
    this.#driver.tickUntil(predicate, bound);
    return this.result();
  }

  /** The current result snapshot (final tick + event log). */
  result(): RunResult {
    return { tick: this.clock.now(), events: this.log.entries };
  }
}
