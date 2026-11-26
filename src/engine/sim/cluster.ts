// The multi-process cluster (#28): the structural jump past a single adapter. A
// cluster is a set of single-threaded processes that share one in-memory
// network. Each process registers a ProcessId; the network routes a message to
// the destination's onMessage(); an unknown destination is logged and dropped;
// the Driver ticks the processes in a fixed order.
//
// A process is GIVEN its network and clock at construction, never creating them,
// so a test can hand it simulated ones. A message send is non-blocking: the
// reply arrives later as a delivered message, not as a return value.

import type { Message } from "../protocol/types.ts";
import { Driver, type Tickable } from "../core/tickable.ts";
import { TickClock } from "../core/clock.ts";
import { createEntropy, type Entropy } from "../core/entropy.ts";
import { EventLog, type SimEvent } from "../core/run.ts";
import type { Rng } from "../../determinism.ts";

export type ProcessId = string;

/**
 * A single-threaded process in the cluster. The Driver ticks it (named by its
 * id); the network delivers to onMessage(). A node implements just these three
 * members, not the Tickable `name`, which the Cluster supplies from the id.
 */
export interface Node {
  readonly id: ProcessId;
  /** Periodic work (timers, heartbeats). Runs once per tick, in id order. */
  tick(): void;
  /** Handle one delivered message, synchronously, on the driver thread. May send more. */
  onMessage(msg: Message): void;
  /** Optional readable state, for snapshots and invariant checks. */
  state?(): unknown;
}

/** The in-memory network a cluster routes through. Implementations: DirectNetwork, SimulatedNetwork. */
export interface Network extends Tickable {
  /** Enqueue a message for later delivery. Never delivers synchronously. */
  send(msg: Message): void;
}

/** What a Network is built with: the registry to route into, the log, seeded entropy, and the clock. */
export interface NetworkDeps {
  registry: ReadonlyMap<ProcessId, Node>;
  log: EventLog;
  rng: Rng;
  clock: TickClock;
}

export type NetworkFactory = (deps: NetworkDeps) => Network;

/** What a node factory is handed: its id, the shared network, the clock, the log, and the entropy. */
export interface NodeDeps {
  id: ProcessId;
  net: Network;
  clock: TickClock;
  log: EventLog;
  entropy: Entropy;
}

/**
 * What a controller factory is handed. Controllers (fault schedulers, client
 * workloads) are ticked before the nodes each step, so a fault set or a client
 * request this tick is visible to the nodes that act this tick.
 */
export interface ControllerDeps {
  ids: readonly ProcessId[];
  clock: TickClock;
  log: EventLog;
  entropy: Entropy;
  /** Inject a message into the network from outside the cluster. */
  send: (msg: Message) => void;
}

/**
 * A cluster of processes over one network, driven deterministically. Tick order
 * is fixed: clock, then every node in id order, then the network delivers. A
 * message sent during a node tick or a message handler is queued and delivered
 * on a later tick, so handlers always run to completion before anything new
 * arrives.
 */
export class Cluster {
  readonly clock: TickClock;
  readonly entropy: Entropy;
  readonly log: EventLog;
  readonly #registry = new Map<ProcessId, Node>();
  readonly #network: Network;
  readonly #driver: Driver;

  constructor(
    seed: number,
    ids: readonly ProcessId[],
    networkFactory: NetworkFactory,
    buildNode: (deps: NodeDeps) => Node,
    buildControllers?: (deps: ControllerDeps) => readonly Tickable[],
  ) {
    this.clock = new TickClock();
    this.entropy = createEntropy(seed);
    this.log = new EventLog(this.clock);
    this.#network = networkFactory({
      registry: this.#registry,
      log: this.log,
      rng: this.entropy.rng,
      clock: this.clock,
    });
    const nodes = ids.map((id) =>
      buildNode({ id, net: this.#network, clock: this.clock, log: this.log, entropy: this.entropy })
    );
    for (const node of nodes) {
      if (this.#registry.has(node.id)) throw new Error(`duplicate ProcessId: ${node.id}`);
      this.#registry.set(node.id, node);
    }
    // Controllers are built after the network and nodes exist, so they can
    // capture the network and send into a populated cluster. They tick before
    // the nodes, so a fault set or a client request this tick is seen this tick.
    const controllers = buildControllers
      ? buildControllers({
        ids,
        clock: this.clock,
        log: this.log,
        entropy: this.entropy,
        send: (msg) => this.#network.send(msg),
      })
      : [];
    // Fixed order: clock, controllers, nodes in registration order, network.
    // Each node is ticked through a Tickable named by its id.
    const ticked: Tickable[] = nodes.map((n) => ({ name: n.id, tick: () => n.tick() }));
    this.#driver = new Driver([this.clock, ...controllers, ...ticked, this.#network]);
  }

  /** Ticks taken so far. */
  get step(): number {
    return this.#driver.step;
  }

  /** The event log entries so far. */
  get events(): readonly SimEvent[] {
    return this.log.entries;
  }

  /** Look up a process by id. */
  node(id: ProcessId): Node | undefined {
    return this.#registry.get(id);
  }

  /** Inject a message into the network from outside the cluster (a client send). */
  send(msg: Message): void {
    this.#network.send(msg);
  }

  /** Advance one tick. */
  tick(): void {
    this.#driver.tick();
  }

  /** Run exactly `ticks` ticks. */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.#driver.tick();
  }

  /** Run until `predicate` holds, at most `bound` ticks (throws past the bound). */
  runUntil(predicate: () => boolean, bound: number): number {
    return this.#driver.tickUntil(predicate, bound);
  }
}

/**
 * The simplest Network: every message is delivered on the next tick, in send
 * order, with no faults. Useful as a baseline and for cluster tests that are not
 * about the network. SimulatedNetwork (network.ts) adds the fault model.
 */
export class DirectNetwork implements Network {
  readonly name = "network";
  readonly #deps: NetworkDeps;
  #queue: { deliverAt: number; seq: number; msg: Message }[] = [];
  #seq = 0;

  constructor(deps: NetworkDeps) {
    this.#deps = deps;
  }

  send(msg: Message): void {
    this.#queue.push({ deliverAt: this.#deps.clock.now() + 1, seq: this.#seq++, msg });
  }

  tick(): void {
    const now = this.#deps.clock.now();
    const due = this.#queue.filter((e) => e.deliverAt <= now).sort((a, b) =>
      a.deliverAt - b.deliverAt || a.seq - b.seq
    );
    this.#queue = this.#queue.filter((e) => e.deliverAt > now);
    for (const e of due) this.#deliver(e.msg);
  }

  #deliver(msg: Message): void {
    const node = this.#deps.registry.get(msg.to);
    if (!node) {
      this.#deps.log.record("net.drop", { reason: "unknown_dest", to: msg.to, kind: msg.kind });
      return;
    }
    this.#deps.log.record("net.deliver", { from: msg.from, to: msg.to, kind: msg.kind });
    node.onMessage(msg);
  }
}

/** Factory for the baseline direct network. */
export const directNetwork: NetworkFactory = (deps) => new DirectNetwork(deps);
