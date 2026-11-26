// Workloads and fault profiles (#32). A Workload is a closed-loop client issuer:
// it generates seeded client requests against the cluster, one at a time, with a
// think-time cooldown so it buffers rather than flooding. Fault profiles are
// named presets of the fault scheduler (DecisionConfig), selectable by name, so
// a scenario is "this workload under this fault profile at this seed" and is
// fully reproducible.

import type { Message } from "../protocol/types.ts";
import type { Tickable } from "../core/tickable.ts";
import type { TickClock } from "../core/clock.ts";
import type { EventLog } from "../core/run.ts";
import type { Rng } from "../../determinism.ts";
import type { DecisionConfig } from "./decisions.ts";

/** Produce the next client request (or null to issue nothing this time). */
export type RequestGen = (rng: Rng, tick: number) => Message | null;

export interface WorkloadConfig {
  /** Probability of issuing on an eligible (not-cooling-down) tick. */
  clientProb?: number;
  /** Cooldown ticks after an issue before the next one (closed-loop think time). */
  thinkTicks?: number;
}

/** A single closed-loop client. Several clients are several Workloads. */
export class Workload implements Tickable {
  readonly name: string;
  readonly #send: (msg: Message) => void;
  readonly #rng: Rng;
  readonly #clock: TickClock;
  readonly #log: EventLog;
  readonly #gen: RequestGen;
  readonly #clientProb: number;
  readonly #thinkTicks: number;
  #cooldown = 0;
  #issued = 0;
  #active = true;

  constructor(
    send: (msg: Message) => void,
    rng: Rng,
    clock: TickClock,
    log: EventLog,
    gen: RequestGen,
    config: WorkloadConfig = {},
    name = "workload",
  ) {
    this.name = name;
    this.#send = send;
    this.#rng = rng;
    this.#clock = clock;
    this.#log = log;
    this.#gen = gen;
    this.#clientProb = config.clientProb ?? 0.5;
    this.#thinkTicks = Math.max(0, Math.floor(config.thinkTicks ?? 1));
  }

  /** How many requests this client has issued. */
  get issued(): number {
    return this.#issued;
  }

  /** Stop issuing new requests (for a liveness phase that lets outstanding work drain). */
  quiesce(): void {
    this.#active = false;
  }

  tick(): void {
    if (!this.#active) return;
    if (this.#cooldown > 0) {
      this.#cooldown -= 1;
      return;
    }
    if (!this.#rng.bool(this.#clientProb)) return;
    const msg = this.#gen(this.#rng, this.#clock.now());
    if (!msg) return;
    this.#send(msg);
    this.#log.record("client.request", { from: msg.from, to: msg.to, kind: msg.kind });
    this.#issued += 1;
    this.#cooldown = this.#thinkTicks;
  }
}

/** Named fault profiles: presets of the fault scheduler, selectable from the CLI. */
export const FAULT_PROFILES: Readonly<Record<string, DecisionConfig>> = {
  quiet: { faultProb: 0 },
  "latency-spike": { faultProb: 0.3, faults: ["delay"], maxDelay: 8, healInterval: 12 },
  "partition-heavy": { faultProb: 0.25, faults: ["isolate", "partition"], healInterval: 15 },
  "reorg-storm": { faultProb: 0.5, faults: ["drop", "partition"], dropRate: 0.6, healInterval: 8 },
};

/** Resolve a fault profile by name, erroring (not defaulting) on an unknown one. */
export function faultProfile(name: string): DecisionConfig {
  const profile = FAULT_PROFILES[name];
  if (!profile) {
    throw new Error(`unknown fault profile: ${name} (have: ${Object.keys(FAULT_PROFILES).join(", ")})`);
  }
  return profile;
}
