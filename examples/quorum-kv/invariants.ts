// The quorum-KV safety invariant, checked from the client-visible history alone
// (exactly what the contract's `history()` exposes): a completed read never
// returns a value older than a write that completed before the read began.
//
// This is the property W + R > N buys: any read quorum intersects any completed
// write quorum, so a get that starts after a put commits must observe a version
// at least as new as that put. Loss, delay, reorder, and partition may leave an
// op pending forever, but a pending op is not "completed", so it never violates
// the property. If this invariant breaks, the universal contract is hosting the
// system faithfully enough to catch a real distributed-systems bug.

import type { HistoryEntry } from "../../src/engine/protocol/types.ts";

interface OpRecord {
  opId: number;
  kind: "put" | "get";
  key: string;
  value?: number;
  version: number;
}

interface CompletedPut {
  key: string;
  version: number;
  completeTick: number;
}

interface CompletedGet {
  key: string;
  version: number;
  invokeTick: number;
}

/** Return one message per broken invariant; an empty array means the history is safe. */
export function checkQuorumInvariants(history: HistoryEntry[]): string[] {
  const invokeTick = new Map<number, number>();
  const puts: CompletedPut[] = [];
  const gets: CompletedGet[] = [];

  for (const e of history) {
    const rec = e.value as OpRecord | undefined;
    if (!rec || typeof rec.opId !== "number") continue;
    if (e.kind === "invoke") {
      invokeTick.set(rec.opId, e.tick);
    } else if (e.kind === "ok") {
      if (rec.kind === "put") {
        puts.push({ key: rec.key, version: rec.version, completeTick: e.tick });
      } else {
        gets.push({ key: rec.key, version: rec.version, invokeTick: invokeTick.get(rec.opId) ?? e.tick });
      }
    }
  }

  const breaks: string[] = [];
  for (const g of gets) {
    for (const p of puts) {
      if (p.key !== g.key) continue;
      // The put committed before this get started: the get must not read older.
      if (p.completeTick <= g.invokeTick && g.version < p.version) {
        breaks.push(
          `stale read on key "${g.key}": get started at tick ${g.invokeTick} returned version ${g.version}, ` +
            `but put version ${p.version} had completed at tick ${p.completeTick}`,
        );
      }
    }
  }
  return breaks;
}
