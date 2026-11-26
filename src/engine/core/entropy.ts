// Seeded entropy (#25). All randomness and all generated ids in a run come from
// one place, created from the seed and threaded through the components. There is
// no Math.random, no time-based id, no crypto randomness in core. Same seed ->
// identical decisions -> identical ids, which is the precondition for replay.
//
// The core RNG is the existing mulberry32 (src/determinism.ts), reused rather than
// reinvented. Ids are positional (a counter), so they are not only deterministic
// but stable across seeds, which keeps event-log diffs readable.

import { createRng, type Rng } from "../../determinism.ts";

/** Deterministic id generator: `${prefix}-0`, `${prefix}-1`, ... in creation order. */
export class IdGen {
  readonly #prefix: string;
  #n = 0;

  constructor(prefix = "id") {
    this.#prefix = prefix;
  }

  /** The next id. Strictly increasing and identical on every replay. */
  next(): string {
    const id = `${this.#prefix}-${this.#n}`;
    this.#n += 1;
    return id;
  }

  /** How many ids have been handed out. */
  get count(): number {
    return this.#n;
  }
}

/** The one entropy source for a run: a seeded RNG and a deterministic id generator. */
export interface Entropy {
  readonly rng: Rng;
  readonly ids: IdGen;
}

/** Build the run's sole entropy from a seed. Pass this into every component that needs randomness or ids. */
export function createEntropy(seed: number, idPrefix = "id"): Entropy {
  return { rng: createRng(seed), ids: new IdGen(idPrefix) };
}
