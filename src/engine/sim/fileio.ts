// Simulated file IO with crash semantics (#30). A file is two byte arrays:
// `visible` holds every write, synced or not; `durable` holds only synced bytes.
// read and write use visible; sync() copies visible into durable; crash() resets
// visible back to durable, so writes made since the last sync are lost. This is
// what lets a write-ahead log or a checkpoint be tested across a crash before
// fsync, deterministically.
//
// The IO is asynchronous without a real clock: an operation returns a TickFuture
// immediately and completes after a fixed number of ticks, never blocking. A
// crash loses in-flight operations, the way a real crash loses unflushed IO.

import type { Tickable } from "../core/tickable.ts";

/** A value that becomes available after the IO completes on a later tick. Never blocks. */
export class TickFuture<T> {
  #ready = false;
  #value!: T;

  constructor(executor: (settle: (v: T) => void) => void) {
    executor((v) => {
      this.#ready = true;
      this.#value = v;
    });
  }

  /** True once the operation has completed. */
  get ready(): boolean {
    return this.#ready;
  }

  /** The completed value. Throws if read before the operation has completed. */
  value(): T {
    if (!this.#ready) throw new Error("TickFuture is not ready yet");
    return this.#value;
  }
}

export interface FileIOConfig {
  /** Ticks an operation takes to complete (default 1, minimum 1). */
  opDelay?: number;
}

interface PendingOp {
  remaining: number;
  complete: () => void;
}

export class SimulatedFileIO implements Tickable {
  readonly name: string;
  #visible: number[] = [];
  #durable: number[] = [];
  readonly #opDelay: number;
  #pending: PendingOp[] = [];

  constructor(name = "fileio", config: FileIOConfig = {}) {
    this.name = name;
    this.#opDelay = Math.max(1, Math.floor(config.opDelay ?? 1));
  }

  #schedule<T>(run: () => T): TickFuture<T> {
    let settle!: (v: T) => void;
    const future = new TickFuture<T>((s) => (settle = s));
    this.#pending.push({ remaining: this.#opDelay, complete: () => settle(run()) });
    return future;
  }

  /** Write `bytes` at `offset`, extending the file with zeros if needed. Applies on completion. */
  write(offset: number, bytes: readonly number[]): TickFuture<void> {
    return this.#schedule(() => {
      while (this.#visible.length < offset) this.#visible.push(0);
      for (let i = 0; i < bytes.length; i++) this.#visible[offset + i] = bytes[i] & 0xff;
    });
  }

  /** Read `len` bytes from `offset` of the visible file, captured at completion time. */
  read(offset: number, len: number): TickFuture<number[]> {
    return this.#schedule(() => this.#visible.slice(offset, offset + len));
  }

  /** Flush: copy visible into durable, so a later crash keeps these bytes. */
  sync(): TickFuture<void> {
    return this.#schedule(() => {
      this.#durable = this.#visible.slice();
    });
  }

  /** The visible file size at completion time. */
  size(): TickFuture<number> {
    return this.#schedule(() => this.#visible.length);
  }

  /** Shrink or zero-extend the visible file to `len`, applied on completion. */
  truncate(len: number): TickFuture<void> {
    return this.#schedule(() => {
      if (len < this.#visible.length) this.#visible.length = len;
      else while (this.#visible.length < len) this.#visible.push(0);
    });
  }

  /** Crash now: lose in-flight operations and every write since the last sync. Synchronous. */
  crash(): void {
    this.#pending = [];
    this.#visible = this.#durable.slice();
  }

  tick(): void {
    const survivors: PendingOp[] = [];
    const ready: PendingOp[] = [];
    for (const op of this.#pending) {
      op.remaining -= 1;
      (op.remaining <= 0 ? ready : survivors).push(op);
    }
    this.#pending = survivors;
    for (const op of ready) op.complete();
  }

  /** Inspect the current visible bytes synchronously (for tests and self-reads). */
  peekVisible(): number[] {
    return this.#visible.slice();
  }

  /** Inspect the current durable bytes synchronously. */
  peekDurable(): number[] {
    return this.#durable.slice();
  }
}
