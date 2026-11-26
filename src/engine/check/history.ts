// Client-visible history (#34): a Jepsen-style record of what clients actually
// observed. Each operation is an invoke followed by an ok, fail, or timeout, per
// client, tick-stamped. This is the input to every consistency checker and the
// artifact that says what the real system did, not what a model of it would do.

import type { HistoryEntry } from "../protocol/types.ts";

export type Outcome = "ok" | "fail" | "timeout";

/** One client operation with its invoke and completion, for the checkers. */
export interface HistoryOp {
  opId: number;
  client: string;
  /** The operation kind, for the model, e.g. "read" or "write". */
  op: string;
  input?: unknown;
  output?: unknown;
  invokeTick: number;
  completeTick?: number;
  outcome: Outcome | "pending";
}

/** Records client operations and exposes them both as a flat log and as ops. */
export class History {
  readonly #flat: HistoryEntry[] = [];
  readonly #ops = new Map<number, HistoryOp>();
  readonly #order: number[] = [];
  #next = 0;

  /** Record that `client` invoked `op` at `tick`. Returns the opId to complete later. */
  invoke(client: string, op: string, tick: number, input?: unknown): number {
    const opId = this.#next++;
    this.#ops.set(opId, { opId, client, op, input, invokeTick: tick, outcome: "pending" });
    this.#order.push(opId);
    this.#flat.push(entry("invoke", client, op, tick, input));
    return opId;
  }

  /** Complete a previously-invoked op. A second completion is ignored. */
  complete(opId: number, outcome: Outcome, tick: number, output?: unknown): void {
    const op = this.#ops.get(opId);
    if (!op || op.outcome !== "pending") return;
    op.outcome = outcome;
    op.completeTick = tick;
    op.output = output;
    this.#flat.push(entry(outcome === "ok" ? "ok" : "fail", op.client, op.op, tick, output));
  }

  /** The flat invoke/ok/fail log, in record order. */
  get entries(): readonly HistoryEntry[] {
    return this.#flat;
  }

  /** All operations, in invoke order. */
  ops(): HistoryOp[] {
    return this.#order.map((id) => this.#ops.get(id)!);
  }

  /** Only the operations that completed (ok/fail/timeout). */
  completed(): HistoryOp[] {
    return this.ops().filter((o) => o.outcome !== "pending");
  }

  /** Operations still outstanding (invoked, never completed). */
  pending(): HistoryOp[] {
    return this.ops().filter((o) => o.outcome === "pending");
  }
}

function entry(kind: HistoryEntry["kind"], client: string, op: string, tick: number, value: unknown): HistoryEntry {
  return value === undefined ? { kind, client, op, tick } : { kind, client, op, value, tick };
}
