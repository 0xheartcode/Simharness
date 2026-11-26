// Logical time (#24). A tick counter is the only clock. A Timeout counts ticks,
// not milliseconds, so a paused or slow process cannot change when it fires: it
// expires after exactly N tick() calls, the way etcd counts ElectionTick and
// HeartbeatTick rather than reading a monotonic clock. Nothing in core reads a
// wall clock.

import type { Tickable } from "./tickable.ts";

/** A monotonic logical clock, advanced one unit per tick. Register it in the Driver. */
export class TickClock implements Tickable {
  readonly name: string;
  #t: number;

  constructor(name = "clock", start = 0) {
    this.name = name;
    this.#t = start;
  }

  /** The current tick count. This is the only time source core code may read. */
  now(): number {
    return this.#t;
  }

  tick(): void {
    this.#t += 1;
  }

  /** Create a timeout that fires after exactly `ticks` more ticks of this clock. */
  timeout(ticks: number): Timeout {
    return new Timeout(this, ticks);
  }
}

/**
 * A deadline measured in ticks. Created at clock time T0 for N ticks, it is
 * expired once the clock has advanced by N, i.e. on exactly the Nth tick after
 * creation. N <= 0 is expired immediately.
 */
export class Timeout {
  readonly #clock: TickClock;
  readonly #deadline: number;

  constructor(clock: TickClock, ticks: number) {
    this.#clock = clock;
    this.#deadline = clock.now() + ticks;
  }

  /** True once the clock reaches the deadline tick. */
  expired(): boolean {
    return this.#clock.now() >= this.#deadline;
  }

  /** Ticks remaining until expiry (0 once expired). */
  remaining(): number {
    return Math.max(0, this.#deadline - this.#clock.now());
  }
}

/** An entry parked in a WaitList until its tick budget runs out. */
interface Waiter<T> {
  readonly item: T;
  remaining: number;
}

/**
 * A RequestWaitingList-style structure: park items for N ticks, and on the Nth
 * tick they expire, in the order they were added. Expiry is a pure function of
 * the tick sequence, so pending work times out identically on every replay.
 */
export class WaitList<T> implements Tickable {
  readonly name: string;
  #waiters: Waiter<T>[] = [];
  #expired: T[] = [];

  constructor(name = "waitlist") {
    this.name = name;
  }

  /** Park `item` to expire after `ticks` ticks (ticks <= 0 expires on the next tick). */
  add(item: T, ticks: number): void {
    this.#waiters.push({ item, remaining: Math.max(1, Math.floor(ticks)) });
  }

  /** How many items are still parked. */
  get pending(): number {
    return this.#waiters.length;
  }

  tick(): void {
    const survivors: Waiter<T>[] = [];
    for (const w of this.#waiters) {
      w.remaining -= 1;
      if (w.remaining <= 0) this.#expired.push(w.item);
      else survivors.push(w);
    }
    this.#waiters = survivors;
  }

  /** Take everything that has expired since the last drain, in add order. */
  drainExpired(): T[] {
    const out = this.#expired;
    this.#expired = [];
    return out;
  }
}
