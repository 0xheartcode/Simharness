// The seeded fault scheduler (#31). One central decision-maker turns the seed
// into a tick-stamped, structured fault schedule: per tick it may inject a fault
// (isolate a node, partition a pair, delay a link, drop on a link) and it heals
// everything on a fixed interval. The schedule it emits is both replayable (same
// seed gives the same schedule) and readable on its own, so a failure can be
// understood from the schedule log without a debugger.

import type { ProcessId } from "./cluster.ts";
import type { LinkConfig } from "./network.ts";
import type { Tickable } from "../core/tickable.ts";
import type { TickClock } from "../core/clock.ts";
import type { EventLog } from "../core/run.ts";
import type { Rng } from "../../determinism.ts";

/** The network operations the scheduler needs; SimulatedNetwork satisfies it. */
export interface FaultInjector {
  partition(from: string, to: string, bothWays?: boolean): void;
  setLink(from: string, to: string, cfg: LinkConfig): void;
  heal(): void;
}

export type FaultKind = "isolate" | "partition" | "delay" | "drop";

/** One tick-stamped, structured entry in the fault schedule. */
export interface ScheduleEntry {
  tick: number;
  action: FaultKind | "heal";
  targets: string[];
  detail?: Record<string, unknown>;
}

export interface DecisionConfig {
  /** Per-tick probability of injecting a fault (0..1). */
  faultProb?: number;
  /** Heal every fault on this interval of ticks (0 = never heal). */
  healInterval?: number;
  /** Max delay (ticks) a delay fault adds. */
  maxDelay?: number;
  /** Drop rate a drop fault sets on a link. */
  dropRate?: number;
  /** Which fault kinds are allowed (default: all four). */
  faults?: readonly FaultKind[];
}

const ALL_FAULTS: readonly FaultKind[] = ["isolate", "partition", "delay", "drop"];

export class SimulationDecisions implements Tickable {
  readonly name: string;
  readonly #net: FaultInjector;
  readonly #ids: readonly ProcessId[];
  readonly #rng: Rng;
  readonly #clock: TickClock;
  readonly #log: EventLog;
  readonly #faultProb: number;
  readonly #healInterval: number;
  readonly #maxDelay: number;
  readonly #dropRate: number;
  readonly #faults: readonly FaultKind[];
  readonly #schedule: ScheduleEntry[] = [];

  constructor(
    net: FaultInjector,
    ids: readonly ProcessId[],
    rng: Rng,
    clock: TickClock,
    log: EventLog,
    config: DecisionConfig = {},
    name = "decisions",
  ) {
    this.name = name;
    this.#net = net;
    this.#ids = ids;
    this.#rng = rng;
    this.#clock = clock;
    this.#log = log;
    this.#faultProb = config.faultProb ?? 0.1;
    this.#healInterval = Math.max(0, Math.floor(config.healInterval ?? 0));
    this.#maxDelay = Math.max(1, Math.floor(config.maxDelay ?? 5));
    this.#dropRate = config.dropRate ?? 0.5;
    this.#faults = config.faults && config.faults.length > 0 ? config.faults : ALL_FAULTS;
  }

  /** The structured fault schedule emitted so far. Replayable and readable on its own. */
  get schedule(): readonly ScheduleEntry[] {
    return this.#schedule;
  }

  tick(): void {
    const tick = this.#clock.now();

    // Periodic heal first: a fault injected this same tick then persists.
    if (this.#healInterval > 0 && tick > 0 && tick % this.#healInterval === 0) {
      this.#net.heal();
      this.#emit({ tick, action: "heal", targets: [] });
    }

    if (!this.#rng.bool(this.#faultProb)) return;
    const kind = this.#rng.pick(this.#faults);
    switch (kind) {
      case "isolate":
        return this.#isolate(tick);
      case "partition":
        return this.#partitionPair(tick);
      case "delay":
        return this.#delayLink(tick);
      case "drop":
        return this.#dropLink(tick);
    }
  }

  #isolate(tick: number): void {
    const node = this.#rng.pick(this.#ids);
    for (const other of this.#ids) {
      if (other !== node) this.#net.partition(node, other, true);
    }
    this.#emit({ tick, action: "isolate", targets: [node] });
  }

  #partitionPair(tick: number): void {
    const [a, b] = this.#twoDistinct();
    if (a === undefined || b === undefined) return;
    this.#net.partition(a, b, true);
    this.#emit({ tick, action: "partition", targets: [a, b] });
  }

  #delayLink(tick: number): void {
    const [a, b] = this.#twoDistinct();
    if (a === undefined || b === undefined) return;
    const delay = 1 + this.#rng.int(this.#maxDelay);
    this.#net.setLink(a, b, { delay });
    this.#emit({ tick, action: "delay", targets: [a, b], detail: { delay } });
  }

  #dropLink(tick: number): void {
    const [a, b] = this.#twoDistinct();
    if (a === undefined || b === undefined) return;
    this.#net.setLink(a, b, { dropRate: this.#dropRate });
    this.#emit({ tick, action: "drop", targets: [a, b], detail: { dropRate: this.#dropRate } });
  }

  #twoDistinct(): [ProcessId | undefined, ProcessId | undefined] {
    if (this.#ids.length < 2) return [undefined, undefined];
    const a = this.#rng.pick(this.#ids);
    const rest = this.#ids.filter((x) => x !== a);
    return [a, this.#rng.pick(rest)];
  }

  #emit(entry: ScheduleEntry): void {
    this.#schedule.push(entry);
    this.#log.record("fault", entry as unknown as Record<string, unknown>);
  }
}
