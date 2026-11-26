// A cascading-failure monitor whose bug needs a specific set of faults, so
// coverage-guided fuzzing can build toward it stage by stage while a blind
// search practically cannot. A monitor watches K sources that heartbeat every
// tick. It counts the sources that have gone silent, but only as a prefix from
// s0 (s0 must be down to count s1, and so on). When the whole prefix is down it
// enters the forbidden state. A source goes silent only if the link from it to
// the monitor is dropped, so reaching the forbidden state requires drops on a
// specific set of links; each additional correct drop advances one stage, which
// the monitor emits as coverage.

import type { Message } from "../../src/engine/protocol/types.ts";
import type { Node, NodeDeps, ProcessId } from "../../src/engine/sim/cluster.ts";

export const SOURCES = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;
export const MONITOR = "monitor";

export class Source implements Node {
  readonly id: ProcessId;
  readonly #deps: NodeDeps;
  constructor(deps: NodeDeps) {
    this.id = deps.id;
    this.#deps = deps;
  }
  tick(): void {
    this.#deps.net.send({ from: this.id, to: MONITOR, kind: "heartbeat", payload: {} });
  }
  onMessage(_msg: Message): void {}
}

export class Monitor implements Node {
  readonly id: ProcessId;
  readonly #deps: NodeDeps;
  #received = new Set<string>();
  #stage = 0;
  constructor(deps: NodeDeps) {
    this.id = deps.id;
    this.#deps = deps;
  }
  tick(): void {
    // Give heartbeats time to establish before judging anyone down, so startup
    // (no heartbeats delivered yet) is not mistaken for a cascade.
    if (this.#deps.clock.now() < 3) {
      this.#received.clear();
      return;
    }
    // Evaluate the heartbeats received since the last tick: a source is down if
    // its heartbeat did not arrive. Count the down prefix from s0.
    let prefix = 0;
    for (const source of SOURCES) {
      if (this.#received.has(source)) break;
      prefix += 1;
    }
    if (prefix > this.#stage) {
      this.#stage = prefix;
      this.#deps.log.record("reached", { stage: prefix });
    }
    this.#received.clear();
  }
  onMessage(msg: Message): void {
    if (msg.kind === "heartbeat") this.#received.add(msg.from);
  }
  state(): unknown {
    return { stage: this.#stage };
  }
}
