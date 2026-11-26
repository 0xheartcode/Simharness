// A byte-level channel (#42, the ADR-002 phase-7 seam), engine-integrated and
// tick-driven. The message-level network delivers whole messages, so a system
// under test's framing code never runs. This channel delivers a byte stream in
// seeded fragments that ignore frame boundaries, and can cut a fragment
// mid-stream, so framing runs under exactly the conditions that expose
// split-frame and mid-frame-death bugs. A framer that assumes one read is one
// frame breaks; a buffering framer survives.
//
// Determinism (ADR-005): chunk sizes and cuts come from the injected seeded RNG,
// bytes are ordered, and delivery is driven by ticks.

import type { Tickable } from "../core/tickable.ts";
import type { Rng } from "../../determinism.ts";

/** Receives raw byte chunks as the channel delivers them. */
export interface ByteSink {
  onBytes(chunk: Uint8Array): void;
}

export interface ByteChannelConfig {
  /** Maximum bytes delivered per tick (1..maxChunk). */
  maxChunk?: number;
  /** Probability a delivered chunk is cut (lost) mid-stream. */
  cutProb?: number;
}

/** Carries a byte stream to a sink in seeded fragments, one chunk per tick. */
export class SimulatedByteChannel implements Tickable {
  readonly name: string;
  readonly #sink: ByteSink;
  readonly #rng: Rng;
  readonly #maxChunk: number;
  readonly #cutProb: number;
  #buffer: number[] = [];

  constructor(sink: ByteSink, rng: Rng, config: ByteChannelConfig = {}, name = "bytechannel") {
    this.name = name;
    this.#sink = sink;
    this.#rng = rng;
    this.#maxChunk = Math.max(1, Math.floor(config.maxChunk ?? 3));
    this.#cutProb = config.cutProb ?? 0;
  }

  /** Enqueue bytes to be fragmented and delivered over the coming ticks. */
  send(bytes: Uint8Array): void {
    for (const b of bytes) this.#buffer.push(b);
  }

  /** Bytes still in flight. */
  get pending(): number {
    return this.#buffer.length;
  }

  tick(): void {
    if (this.#buffer.length === 0) return;
    const take = 1 + this.#rng.int(this.#maxChunk);
    const chunk = this.#buffer.splice(0, take);
    // A cut drops this chunk (bytes lost mid-stream), the byte-level fault.
    if (this.#cutProb > 0 && this.#rng.bool(this.#cutProb)) return;
    this.#sink.onBytes(new Uint8Array(chunk));
  }
}

/** Length-prefix encode frames into one byte stream (each frame: len byte then payload). */
export function encodeFrames(frames: readonly Uint8Array[]): Uint8Array {
  const out: number[] = [];
  for (const frame of frames) {
    out.push(frame.length & 0xff);
    for (const b of frame) out.push(b);
  }
  return new Uint8Array(out);
}

/** The correct framer: buffer bytes and parse complete length-prefixed frames. */
export class BufferedFramer implements ByteSink {
  #buffer: number[] = [];
  readonly #frames: Uint8Array[] = [];

  onBytes(chunk: Uint8Array): void {
    for (const b of chunk) this.#buffer.push(b);
    while (this.#buffer.length >= 1) {
      const len = this.#buffer[0];
      if (this.#buffer.length < 1 + len) break; // wait for the rest of the frame
      this.#frames.push(new Uint8Array(this.#buffer.slice(1, 1 + len)));
      this.#buffer.splice(0, 1 + len);
    }
  }

  frames(): readonly Uint8Array[] {
    return this.#frames;
  }
}

/** The naive framer: assume each delivered chunk is exactly one frame. Breaks under fragmentation. */
export class NaiveFramer implements ByteSink {
  readonly #frames: Uint8Array[] = [];

  onBytes(chunk: Uint8Array): void {
    if (chunk.length > 0) this.#frames.push(chunk.slice(1));
  }

  frames(): readonly Uint8Array[] {
    return this.#frames;
  }
}
