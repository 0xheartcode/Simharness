// The in-process TypeScript adapter SDK (#39). It lets an existing single-adapter
// SimAdapter run through protocol v0 unchanged, so the existing tooling adapts
// onto the engine instead of being rewritten. The state shapes already line up:
// the generalized SimState is GameState with the spatial fields optional, so the
// bridge is thin and keeps the walk-the-real-code guarantee (it calls the real
// adapter, never a copy of it).

import type { GameState, SimAdapter } from "@0xheartcode/simharness/adapter";
import type { Adapter } from "../protocol/adapter.ts";
import type { Capabilities, SimState } from "../protocol/types.ts";

export interface BridgeOptions {
  /** The dt passed to the adapter's step() for one protocol tick (default 1). */
  dt?: number;
  /** Advertised deterministicConcurrency capability (default true). */
  deterministicConcurrency?: boolean;
}

/** Wrap a v1-style SimAdapter as a protocol v0 Adapter driven in-process. */
export function fromSimAdapter<E extends Record<string, unknown>>(
  sim: SimAdapter<E>,
  opts: BridgeOptions = {},
): Adapter {
  const dt = opts.dt ?? 1;

  const bridge: Adapter = {
    hello(): Capabilities {
      return {
        name: sim.name,
        protocol: 0,
        supportsActions: typeof sim.availableActions === "function",
        supportsNetwork: false,
        supportsStorage: false,
        supportsByteNetwork: false,
        deterministicConcurrency: opts.deterministicConcurrency ?? true,
      };
    },
    reset(seed, config) {
      sim.reset(seed, config);
    },
    readState(): SimState {
      const s = sim.readState() as GameState<E>;
      const out: SimState = { tick: s.tick, phase: s.phase, extra: s.extra };
      if (s.hero) out.hero = s.hero;
      if (s.enemies) out.enemies = s.enemies;
      return out;
    },
    tick() {
      sim.step(dt);
    },
    snapshot() {
      return { ascii: sim.snapshotAscii() };
    },
  };

  if (sim.availableActions) bridge.availableActions = () => sim.availableActions!();
  if (sim.act) bridge.act = (action) => sim.act!(action);

  return bridge;
}
