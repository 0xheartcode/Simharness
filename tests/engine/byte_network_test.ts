// #42 integrated: a byte-level channel fragments a stream across frame
// boundaries, exposing a split-frame bug in the naive framer that the buffering
// framer survives, and it can cut a fragment mid-stream.

import {
  BufferedFramer,
  type ByteChannelConfig,
  type ByteSink,
  encodeFrames,
  NaiveFramer,
  SimulatedByteChannel,
} from "../../src/engine/sim/byte_network.ts";
import { createRng } from "../../src/determinism.ts";
import { assert, assertEquals } from "../assert.ts";

const FRAMES: Uint8Array[] = [new Uint8Array([10, 11, 12]), new Uint8Array([20, 21]), new Uint8Array([30])];

function asNums(frames: readonly Uint8Array[]): number[][] {
  return frames.map((f) => Array.from(f));
}

/** Deliver the encoded frames through a seeded channel into one sink; drain. */
function deliver(sink: ByteSink, seed: number, config: ByteChannelConfig): void {
  const channel = new SimulatedByteChannel(sink, createRng(seed), config);
  channel.send(encodeFrames(FRAMES));
  let guard = 0;
  while (channel.pending > 0 && guard < 10_000) {
    channel.tick();
    guard += 1;
  }
}

Deno.test("byte channel: fragmentation breaks the naive framer, the buffering framer recovers all frames", () => {
  const buffered = new BufferedFramer();
  const naive = new NaiveFramer();
  deliver(buffered, 1, { maxChunk: 2 }); // 1..2 byte chunks: frames get split
  deliver(naive, 1, { maxChunk: 2 });
  assertEquals(asNums(buffered.frames()), asNums(FRAMES), "the buffering framer recovers every frame");
  assert(
    JSON.stringify(asNums(naive.frames())) !== JSON.stringify(asNums(FRAMES)),
    "the naive one-read-one-frame framer must be wrong under fragmentation",
  );
});

Deno.test("byte channel: whole-frame delivery hides the split-frame bug (message-level)", () => {
  // Hand the naive framer each frame as its own chunk, as a message-level network
  // would: it then looks correct, which is why the byte seam is needed.
  const naive = new NaiveFramer();
  for (const frame of FRAMES) {
    const chunk = new Uint8Array([frame.length, ...frame]);
    naive.onBytes(chunk);
  }
  assertEquals(asNums(naive.frames()), asNums(FRAMES));
});

Deno.test("byte channel: delivery is deterministic for a seed", () => {
  const a = new BufferedFramer();
  const b = new BufferedFramer();
  deliver(a, 7, { maxChunk: 2 });
  deliver(b, 7, { maxChunk: 2 });
  assertEquals(asNums(a.frames()), asNums(b.frames()));
});

Deno.test("byte channel: a mid-stream cut loses bytes", () => {
  // With a high cut rate the stream cannot be fully recovered: bytes are lost,
  // which is the mid-frame-death fault only a byte-level channel can inject.
  const buffered = new BufferedFramer();
  deliver(buffered, 3, { maxChunk: 2, cutProb: 0.5 });
  assert(buffered.frames().length < FRAMES.length, "cuts should lose at least one frame");
});
