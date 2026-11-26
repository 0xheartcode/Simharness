// The trivial echo adapter: the smallest thing that satisfies protocol v0, used
// to prove a round-trip over both transports (the phase-0 conformance fixture).
//
// It records the last action it was told to `act`, and its state echoes that
// action plus the seed and a tick counter. No entropy, no clock: identical
// requests produce identical responses, which is exactly what the conformance
// test asserts across the in-process and stdio transports.

import type { Adapter } from "../../src/engine/protocol/adapter.ts";
import type { Capabilities, SimState } from "../../src/engine/protocol/types.ts";

export class EchoAdapter implements Adapter {
  #seed = 0;
  #tick = 0;
  #last: string | null = null;

  hello(): Capabilities {
    return {
      name: "echo",
      protocol: 0,
      supportsActions: true,
      supportsNetwork: false,
      supportsStorage: false,
      supportsByteNetwork: false,
      deterministicConcurrency: true,
    };
  }

  reset(seed: number): void {
    this.#seed = seed;
    this.#tick = 0;
    this.#last = null;
  }

  tick(): void {
    this.#tick += 1;
  }

  readState(): SimState {
    return {
      tick: this.#tick,
      phase: "running",
      extra: { seed: this.#seed, last: this.#last },
    };
  }

  availableActions(): readonly string[] {
    // A fixed, state-independent action vocabulary keeps the fixture trivial.
    return ["ping", "pong"];
  }

  act(action: string): void {
    this.#last = action;
  }
}
