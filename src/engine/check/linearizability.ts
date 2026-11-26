// Consistency checking (#35). Given a client-visible history, decide whether it
// is linearizable against a claimed model, starting with a single register. The
// search is Wing-Gong: repeatedly linearize an operation that could legally come
// next in real time, apply the model, and backtrack, with memoization on the
// remaining set and state. A violation plus its seed is a complete, replayable
// bug report, because availability is not correctness: a stale read after an
// acknowledged write is exactly what this distinguishes.

import type { HistoryOp } from "./history.ts";

/** The result of applying one operation to a model state. */
export interface ModelResult {
  /** False if the operation is impossible from this state (e.g. a read of the wrong value). */
  ok: boolean;
  state: unknown;
}

/** A sequential model the history is checked against. Pluggable for other consistency models. */
export interface Model {
  initial: unknown;
  /** Apply `op` to `state`; return whether it is legal and the resulting state. */
  apply(state: unknown, op: HistoryOp): ModelResult;
}

/** A single-register model: writes set the value, reads must return the current value. */
export const registerModel: Model = {
  initial: 0,
  apply(state, op) {
    if (op.op === "write") return { ok: true, state: op.input };
    return { ok: op.output === state, state };
  },
};

export interface LinViolation {
  message: string;
  /** The ok operations that could not be linearized, for the report. */
  ops: HistoryOp[];
}

/**
 * Check whether the ok operations in a history are linearizable against `model`.
 * Returns null if linearizable, or a violation. Failed and pending operations
 * are not treated as observed effects, so the input should be a history whose
 * writes complete (the common case for a correct run).
 */
export function checkLinearizable(ops: readonly HistoryOp[], model: Model = registerModel): LinViolation | null {
  const okOps = ops.filter((o) => o.outcome === "ok");
  const memo = new Set<string>();

  function search(remaining: HistoryOp[], state: unknown): boolean {
    if (remaining.length === 0) return true;
    const key = remaining.map((o) => o.opId).join(",") + "|" + JSON.stringify(state);
    if (memo.has(key)) return false;

    // An op may be linearized next only if it started no later than the earliest
    // completion among the remaining ops (it cannot jump ahead of an op that
    // already finished before it began).
    let minComplete = Infinity;
    for (const o of remaining) minComplete = Math.min(minComplete, o.completeTick ?? Infinity);

    for (const op of remaining) {
      if (op.invokeTick > minComplete) continue;
      const res = model.apply(state, op);
      if (!res.ok) continue;
      const rest = remaining.filter((o) => o.opId !== op.opId);
      if (search(rest, res.state)) return true;
    }

    memo.add(key);
    return false;
  }

  return search(okOps, model.initial) ? null : { message: "history is not linearizable", ops: okOps };
}
