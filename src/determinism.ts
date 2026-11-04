// Determinism toolkit. The contract requires bit-identical runs from a seed,
// but shipped no tools for it, so every adapter re-pinned Date.now and seeded
// Math.random by hand. These helpers make determinism a one-liner: seed a Rng in
// reset(), read a virtual Clock instead of the wall clock, advance it in step().

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** A uniformly chosen element (undefined for an empty array). */
  pick<T>(arr: readonly T[]): T;
  /** True with probability p (default 0.5). */
  bool(p?: number): boolean;
}

/** mulberry32: a tiny, fast, well-distributed seeded PRNG returning a float in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded RNG with convenience helpers. Same seed + same call sequence => identical stream. */
export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
    range: (min: number, max: number) => min + next() * (max - min),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    bool: (p = 0.5) => next() < p,
  };
}

/** A virtual clock: read `now()` in step() instead of Date.now(), and advance it yourself. */
export interface Clock {
  /** Milliseconds since the clock's start. */
  now(): number;
  /** Advance the clock by `ms`. */
  advance(ms: number): void;
  /** Set the clock to an absolute `ms`. */
  set(ms: number): void;
}

export function createClock(startMs = 0): Clock {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}
