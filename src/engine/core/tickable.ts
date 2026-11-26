// The deterministic heart (#23). One small interface, Tickable, and a
// single-threaded Driver that advances every registered component in a FIXED
// order, one logical step at a time. Nothing in the simulation advances between
// ticks (the Tickloom invariant), so a run is a pure function of its seed and
// its tick sequence.
//
// This generalizes the single-adapter.step(dt) to an ordered set of ticked
// components: processes, networks, fileIO, and clients all become Tickables the
// Driver steps in the same order every run.

/** Anything the Driver can advance by one logical tick. */
export interface Tickable {
  /** A stable name, used in ordering diagnostics and reports. */
  readonly name: string;
  /** Advance exactly one logical tick. Never reads a wall clock or unseeded RNG. */
  tick(): void;
}

/** Thrown when tickUntil runs past its bound without the predicate holding. */
export class TickBudgetExceeded extends Error {
  constructor(public readonly bound: number) {
    super(`tickUntil exceeded its bound of ${bound} ticks without the predicate holding`);
    this.name = "TickBudgetExceeded";
  }
}

/**
 * Drives a fixed, ordered set of components. Each `tick()` advances every
 * component once, in registration order, then increments the step counter. The
 * order never changes within a run, which is what makes the run reproducible.
 */
export class Driver {
  readonly #components: readonly Tickable[];
  #step = 0;

  constructor(components: readonly Tickable[]) {
    this.#components = [...components];
  }

  /** The number of ticks taken so far. */
  get step(): number {
    return this.#step;
  }

  /** The component order the Driver ticks in, for diagnostics. */
  get order(): readonly string[] {
    return this.#components.map((c) => c.name);
  }

  /** Advance one logical step: tick every component once, in order. */
  tick(): void {
    for (const c of this.#components) c.tick();
    this.#step += 1;
  }

  /**
   * Tick until `predicate` holds, at most `bound` ticks. Returns the number of
   * ticks taken (0 if the predicate already held). Throws TickBudgetExceeded if
   * the bound is reached first: there is no silent give-up, and no sleeping.
   */
  tickUntil(predicate: () => boolean, bound: number): number {
    let taken = 0;
    while (!predicate()) {
      if (taken >= bound) throw new TickBudgetExceeded(bound);
      this.tick();
      taken += 1;
    }
    return taken;
  }
}
