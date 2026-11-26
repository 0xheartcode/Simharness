// A gossip last-writer-wins register, as real cluster nodes (not an internal
// model): clients write (value, version) to any node, nodes periodically gossip
// their current (value, version) to peers, and a node adopts an incoming pair
// only when its version is newer. Under partitions and reordering, a correct
// node's adopted version never goes backwards; the `buggy` variant adopts every
// message, so a late gossip can move it backwards, which the scenario invariant
// catches.

import type { Message } from "../../src/engine/protocol/types.ts";
import type { Node, NodeDeps, ProcessId } from "../../src/engine/sim/cluster.ts";

export interface GossipOptions {
  gossipEvery: number;
  buggy?: boolean;
  /** Never gossip (a wedged node that cannot re-sync after a partition heals). */
  silent?: boolean;
}

export class GossipNode implements Node {
  readonly id: ProcessId;
  readonly #deps: NodeDeps;
  readonly #peers: ProcessId[];
  readonly #every: number;
  readonly #buggy: boolean;
  readonly #silent: boolean;
  #value = 0;
  #version = -1;

  constructor(deps: NodeDeps, allIds: readonly ProcessId[], opts: GossipOptions) {
    this.id = deps.id;
    this.#deps = deps;
    this.#peers = allIds.filter((x) => x !== deps.id);
    this.#every = Math.max(1, opts.gossipEvery);
    this.#buggy = opts.buggy ?? false;
    this.#silent = opts.silent ?? false;
  }

  tick(): void {
    if (this.#silent) return;
    if (this.#deps.clock.now() % this.#every !== 0) return;
    for (const peer of this.#peers) {
      this.#deps.net.send({
        from: this.id,
        to: peer,
        kind: "gossip",
        payload: { value: this.#value, version: this.#version },
      });
    }
  }

  onMessage(msg: Message): void {
    const value = msg.payload.value as number;
    const version = msg.payload.version as number;
    // Correct: adopt only strictly newer. Buggy: adopt everything.
    if (this.#buggy || version > this.#version) {
      this.#value = value;
      this.#version = version;
      this.#deps.log.record("adopt", { node: this.id, version, value, via: msg.kind });
    }
  }

  state(): unknown {
    return { value: this.#value, version: this.#version };
  }
}
