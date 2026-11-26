// The message-level simulated network (#29, ADR-002). Per directed link it can
// delay, drop, duplicate, partition, and clog messages. Surviving messages go
// into a priority queue stamped with a delivery tick and an incrementing
// sequence number, so same-tick messages deliver in send order and nothing
// moves until tick() delivers everything due. All fault decisions come from the
// seeded RNG, so a gray failure (asymmetric delay, selective drop) is a
// replayable scenario.

import type { Message } from "../protocol/types.ts";
import type { Network, NetworkDeps, NetworkFactory } from "./cluster.ts";

/** Fault configuration for one directed link (from -> to). */
export interface LinkConfig {
  /** Base delivery delay in ticks (default 1, minimum 1). */
  delay?: number;
  /** Per-message drop probability, 0..1. */
  dropRate?: number;
  /** Per-message duplicate probability, 0..1 (delivers the message twice). */
  duplicate?: number;
  /** While true, every message on this link is dropped. */
  partitioned?: boolean;
  /** Hold deliveries on this link until at least this tick. */
  clogUntil?: number;
  /** Per-tick probability of toggling `partitioned` (dynamic partitions). */
  flipProb?: number;
}

interface Queued {
  deliverAt: number;
  seq: number;
  msg: Message;
  dup: boolean;
}

/** A due message as seen by a delivery scheduler (no internals exposed). */
export interface DueMessage {
  from: string;
  to: string;
  kind: string;
  seq: number;
}

/**
 * Decides the order the due messages are delivered in on a tick. Given the due
 * messages (already in the default deliverAt/seq order), it returns a
 * permutation of their indices. The interleaving explorer uses this to make the
 * delivery order a choice point; the default is identity (send order).
 */
export type DeliveryScheduler = (due: readonly DueMessage[]) => readonly number[];

export class SimulatedNetwork implements Network {
  readonly name = "network";
  readonly #deps: NetworkDeps;
  readonly #links = new Map<string, LinkConfig>();
  #queue: Queued[] = [];
  #seq = 0;
  #scheduler: DeliveryScheduler | undefined;

  constructor(deps: NetworkDeps, links: Record<string, LinkConfig> = {}) {
    this.#deps = deps;
    for (const [key, cfg] of Object.entries(links)) this.#links.set(key, { ...cfg });
  }

  /** Install a delivery-order scheduler (the interleaving explorer uses this). */
  setScheduler(scheduler: DeliveryScheduler | undefined): void {
    this.#scheduler = scheduler;
  }

  #key(from: string, to: string): string {
    return `${from}->${to}`;
  }

  /** The config for a directed link (an empty, healthy link if none is set). */
  link(from: string, to: string): LinkConfig {
    return this.#links.get(this.#key(from, to)) ?? {};
  }

  /** Merge config into a directed link. */
  setLink(from: string, to: string, cfg: LinkConfig): void {
    const key = this.#key(from, to);
    this.#links.set(key, { ...this.#links.get(key), ...cfg });
  }

  /** Partition a link (optionally both directions). */
  partition(from: string, to: string, bothWays = false): void {
    this.setLink(from, to, { partitioned: true });
    if (bothWays) this.setLink(to, from, { partitioned: true });
  }

  /** Clear every transient fault condition (partition, clog) on all links. */
  heal(): void {
    for (const cfg of this.#links.values()) {
      cfg.partitioned = false;
      cfg.clogUntil = undefined;
    }
    this.#deps.log.record("net.heal");
  }

  send(msg: Message): void {
    const c = this.link(msg.from, msg.to);
    if (c.partitioned) {
      this.#deps.log.record("net.drop", { reason: "partition", from: msg.from, to: msg.to, kind: msg.kind });
      return;
    }
    if (c.dropRate && this.#deps.rng.bool(c.dropRate)) {
      this.#deps.log.record("net.drop", { reason: "loss", from: msg.from, to: msg.to, kind: msg.kind });
      return;
    }
    this.#enqueue(msg, c, false);
    if (c.duplicate && this.#deps.rng.bool(c.duplicate)) this.#enqueue(msg, c, true);
  }

  #enqueue(msg: Message, c: LinkConfig, dup: boolean): void {
    const now = this.#deps.clock.now();
    let deliverAt = now + Math.max(1, Math.floor(c.delay ?? 1));
    if (c.clogUntil !== undefined && c.clogUntil > deliverAt) deliverAt = c.clogUntil;
    this.#queue.push({ deliverAt, seq: this.#seq++, msg, dup });
  }

  tick(): void {
    this.#maybeFlipPartitions();
    const now = this.#deps.clock.now();
    const due = this.#queue.filter((e) => e.deliverAt <= now).sort((a, b) =>
      a.deliverAt - b.deliverAt || a.seq - b.seq
    );
    this.#queue = this.#queue.filter((e) => e.deliverAt > now);
    const order = this.#scheduler
      ? this.#scheduler(due.map((e) => ({ from: e.msg.from, to: e.msg.to, kind: e.msg.kind, seq: e.seq })))
      : due.map((_, i) => i);
    for (const i of order) this.#deliver(due[i]);
  }

  #maybeFlipPartitions(): void {
    // Sorted key order keeps the RNG draw sequence deterministic.
    for (const key of [...this.#links.keys()].sort()) {
      const cfg = this.#links.get(key)!;
      if (cfg.flipProb && this.#deps.rng.bool(cfg.flipProb)) {
        cfg.partitioned = !cfg.partitioned;
        this.#deps.log.record("net.flip", { link: key, partitioned: cfg.partitioned });
      }
    }
  }

  #deliver(e: Queued): void {
    const node = this.#deps.registry.get(e.msg.to);
    if (!node) {
      this.#deps.log.record("net.drop", { reason: "unknown_dest", to: e.msg.to, kind: e.msg.kind });
      return;
    }
    this.#deps.log.record("net.deliver", { from: e.msg.from, to: e.msg.to, kind: e.msg.kind, dup: e.dup });
    node.onMessage(e.msg);
  }
}

/** A NetworkFactory for a SimulatedNetwork with the given per-link config. */
export function simulatedNetwork(links: Record<string, LinkConfig> = {}): NetworkFactory {
  return (deps: NetworkDeps) => new SimulatedNetwork(deps, links);
}
