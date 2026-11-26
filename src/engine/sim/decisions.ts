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
  /** Index among fault injections (not heals), for masking during shrinking. */
  index?: number;
  /** Whether this fault was applied to the network (false when masked out). */
  applied?: boolean;
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
  readonly #mask?: ReadonlySet<number>;
  #active = true;
  #faultIndex = 0;

  constructor(
    net: FaultInjector,
    ids: readonly ProcessId[],
    rng: Rng,
    clock: TickClock,
    log: EventLog,
    config: DecisionConfig = {},
    mask?: ReadonlySet<number>,
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
    this.#mask = mask;
  }

  /** The structured fault schedule emitted so far. Replayable and readable on its own. */
  get schedule(): readonly ScheduleEntry[] {
    return this.#schedule;
  }

  /** Whether fault index `i` is applied: masking drops its effect but never its RNG draws. */
  #allowed(i: number): boolean {
    return this.#mask === undefined || this.#mask.has(i);
  }

  /** Stop injecting faults and healing (for a liveness phase that lets the cluster settle). */
  quiesce(): void {
    this.#active = false;
  }

  tick(): void {
    if (!this.#active) return;
    const tick = this.#clock.now();

    // Periodic heal first: a fault injected this same tick then persists.
    if (this.#healInterval > 0 && tick > 0 && tick % this.#healInterval === 0) {
      this.#net.heal();
      this.#emit({ tick, action: "heal", targets: [] });
    }

    if (!this.#rng.bool(this.#faultProb)) return;
    const kind = this.#rng.pick(this.#faults);
    // The index is assigned and all target RNG is drawn regardless of the mask,
    // so masking a fault out changes only its effect, never the RNG stream.
    const index = this.#faultIndex++;
    const applied = this.#allowed(index);
    switch (kind) {
      case "isolate":
        return this.#isolate(tick, index, applied);
      case "partition":
        return this.#partitionPair(tick, index, applied);
      case "delay":
        return this.#delayLink(tick, index, applied);
      case "drop":
        return this.#dropLink(tick, index, applied);
    }
  }

  #isolate(tick: number, index: number, applied: boolean): void {
    const node = this.#rng.pick(this.#ids);
    if (applied) {
      for (const other of this.#ids) {
        if (other !== node) this.#net.partition(node, other, true);
      }
    }
    this.#emit({ tick, action: "isolate", targets: [node], index, applied });
  }

  #partitionPair(tick: number, index: number, applied: boolean): void {
    const [a, b] = this.#twoDistinct();
    if (a === undefined || b === undefined) return;
    if (applied) this.#net.partition(a, b, true);
    this.#emit({ tick, action: "partition", targets: [a, b], index, applied });
  }

  #delayLink(tick: number, index: number, applied: boolean): void {
    const [a, b] = this.#twoDistinct();
    if (a === undefined || b === undefined) return;
    const delay = 1 + this.#rng.int(this.#maxDelay);
    if (applied) this.#net.setLink(a, b, { delay });
    this.#emit({ tick, action: "delay", targets: [a, b], detail: { delay }, index, applied });
  }

  #dropLink(tick: number, index: number, applied: boolean): void {
    const [a, b] = this.#twoDistinct();
    if (a === undefined || b === undefined) return;
    if (applied) this.#net.setLink(a, b, { dropRate: this.#dropRate });
    this.#emit({ tick, action: "drop", targets: [a, b], detail: { dropRate: this.#dropRate }, index, applied });
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

/**
 * Applies an explicit, tick-stamped fault script to the network, instead of
 * generating faults from a seed. This is what the coverage-guided fuzzer mutates
 * (a structured input it has full control over), and it replays a schedule found
 * by the seeded scheduler faithfully.
 */
export class ScriptedDecisions implements Tickable {
  readonly name: string;
  readonly #net: FaultInjector;
  readonly #ids: readonly ProcessId[];
  readonly #clock: TickClock;
  readonly #log: EventLog;
  readonly #script: readonly ScheduleEntry[];
  #active = true;

  constructor(
    net: FaultInjector,
    ids: readonly ProcessId[],
    clock: TickClock,
    log: EventLog,
    script: readonly ScheduleEntry[],
    name = "decisions",
  ) {
    this.name = name;
    this.#net = net;
    this.#ids = ids;
    this.#clock = clock;
    this.#log = log;
    this.#script = script;
  }

  /** The script being applied (for reporting). */
  get schedule(): readonly ScheduleEntry[] {
    return this.#script;
  }

  /** Stop applying faults (for a liveness phase). */
  quiesce(): void {
    this.#active = false;
  }

  tick(): void {
    if (!this.#active) return;
    const tick = this.#clock.now();
    for (const entry of this.#script) {
      if (entry.tick === tick) this.#apply(entry);
    }
  }

  #apply(entry: ScheduleEntry): void {
    const [a, b] = entry.targets;
    switch (entry.action) {
      case "isolate":
        for (const other of this.#ids) {
          if (other !== a) this.#net.partition(a, other, true);
        }
        break;
      case "partition":
        if (b !== undefined) this.#net.partition(a, b, true);
        break;
      case "delay":
        if (b !== undefined) this.#net.setLink(a, b, { delay: (entry.detail?.delay as number) ?? 3 });
        break;
      case "drop":
        if (b !== undefined) this.#net.setLink(a, b, { dropRate: (entry.detail?.dropRate as number) ?? 0.5 });
        break;
      case "heal":
        this.#net.heal();
        break;
    }
    this.#log.record("fault", entry as unknown as Record<string, unknown>);
  }
}
