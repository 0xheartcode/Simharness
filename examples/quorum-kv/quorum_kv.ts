// Phase-0 gate SUT: a quorum key-value store, three replicas, W=R=2 over N=3,
// driven entirely through the engine contract (reset / available_actions / act /
// tick / read_state / history / snapshot). This is the real non-game system the
// gate requires: it proves the generalized SimState (tick plus a discrete
// action space, no spatial fields) can host a replicated store under a seeded,
// lossy, reordering network, and that its safety invariant is checkable from
// read_state plus the client-visible history.
//
// Scope note: the simulated network here lives INSIDE the SUT on purpose. The
// phase-2 SimulatedNetwork seam (deliver / drain_outbox) externalizes it; the
// gate only needs to prove the state/action/history shape, so this internal
// network is throwaway proof scaffolding, not the phase-2 seam.

import type { Adapter } from "../../src/engine/protocol/adapter.ts";
import type { Capabilities, HistoryEntry, SimState } from "../../src/engine/protocol/types.ts";
import { createRng, type Rng } from "@0xheartcode/simharness";

export const REPLICAS = ["athens", "byzantium", "cyrene"] as const;
export type ReplicaId = (typeof REPLICAS)[number];
export const KEYS = ["x", "y"] as const;
const N = REPLICAS.length;
const DEFAULT_W = 2;
const DEFAULT_R = 2;

/** One stored value: last-writer-wins by `version` (the issuing op's global index). */
interface Versioned {
  value: number;
  version: number;
}

type MsgType = "write" | "write_ack" | "read" | "read_reply";

interface Msg {
  seq: number; // enqueue order, for deterministic tie-breaking
  deliverAt: number;
  from: ReplicaId;
  to: ReplicaId;
  type: MsgType;
  opId: number;
  key: string;
  value?: number;
  version?: number;
}

interface Pending {
  kind: "put" | "get";
  coordinator: ReplicaId;
  key: string;
  value?: number; // put only
  version: number; // put: the write version; get: the issuing op index
  acks: Set<ReplicaId>; // put only
  replies: Versioned[]; // get only
  done: boolean;
}

export interface QuorumKvConfig extends Record<string, unknown> {
  /** Probability a due message is dropped (0..1). */
  dropProb?: number;
  /** Max extra delivery delay in ticks (1..maxDelay). */
  maxDelay?: number;
  /** Write quorum size (default 2). Set to 1 to break W+R>N as a control. */
  w?: number;
  /** Read quorum size (default 2). Set to 1 to break W+R>N as a control. */
  r?: number;
}

export class QuorumKvAdapter implements Adapter {
  #rng: Rng = createRng(0);
  #tick = 0;
  #opSeq = 0;
  #msgSeq = 0;
  #dropProb = 0.3;
  #maxDelay = 3;
  #w = DEFAULT_W;
  #r = DEFAULT_R;
  #store: Record<ReplicaId, Record<string, Versioned>> = emptyStore();
  #net: Msg[] = [];
  #pending = new Map<number, Pending>();
  #history: HistoryEntry[] = [];

  hello(): Capabilities {
    return {
      name: "quorum-kv",
      protocol: 0,
      supportsActions: true,
      supportsNetwork: false, // the phase-0 network is internal; phase-2 flips this
      supportsStorage: false,
      supportsByteNetwork: false,
      deterministicConcurrency: true,
    };
  }

  reset(seed: number, config?: QuorumKvConfig): void {
    this.#rng = createRng(seed);
    this.#tick = 0;
    this.#opSeq = 0;
    this.#msgSeq = 0;
    this.#dropProb = clamp(config?.dropProb ?? 0.3, 0, 0.9);
    this.#maxDelay = Math.max(1, Math.floor(config?.maxDelay ?? 3));
    this.#w = clampInt(config?.w ?? DEFAULT_W, 1, N);
    this.#r = clampInt(config?.r ?? DEFAULT_R, 1, N);
    this.#store = emptyStore();
    this.#net = [];
    this.#pending = new Map();
    this.#history = [];
  }

  /** The client operation vocabulary: put every key to a small value set, and get every key. */
  availableActions(): readonly string[] {
    const actions: string[] = [];
    for (const key of KEYS) {
      for (const value of [1, 2, 3]) actions.push(`put:${key}:${value}`);
      actions.push(`get:${key}`);
    }
    return actions;
  }

  act(action: string): void {
    const parts = action.split(":");
    const kind = parts[0];
    const key = parts[1];
    if ((kind !== "put" && kind !== "get") || !KEYS.includes(key as typeof KEYS[number])) {
      throw new Error(`illegal action: ${action}`);
    }
    const opId = this.#opSeq++;
    const coordinator = this.#rng.pick(REPLICAS);

    if (kind === "put") {
      const value = Number(parts[2]);
      const version = opId; // op index is a global total order, so writes never tie
      this.#history.push({
        kind: "invoke",
        client: coordinator,
        op: action,
        value: { opId, kind, key, value, version },
        tick: this.#tick,
      });
      // The coordinator applies locally and counts as the first ack.
      this.#applyWrite(coordinator, key, value, version);
      const pending: Pending = {
        kind,
        coordinator,
        key,
        value,
        version,
        acks: new Set([coordinator]),
        replies: [],
        done: false,
      };
      this.#pending.set(opId, pending);
      for (const peer of REPLICAS) {
        if (peer === coordinator) continue;
        this.#send(coordinator, peer, { type: "write", opId, key, value, version });
      }
      this.#tryComplete(opId);
      return;
    }

    // get
    this.#history.push({
      kind: "invoke",
      client: coordinator,
      op: action,
      value: { opId, kind, key },
      tick: this.#tick,
    });
    const local = this.#store[coordinator][key] ?? { value: 0, version: -1 };
    const pending: Pending = {
      kind,
      coordinator,
      key,
      version: opId,
      acks: new Set(),
      replies: [{ value: local.value, version: local.version }],
      done: false,
    };
    this.#pending.set(opId, pending);
    for (const peer of REPLICAS) {
      if (peer === coordinator) continue;
      this.#send(coordinator, peer, { type: "read", opId, key });
    }
    this.#tryComplete(opId);
  }

  tick(): void {
    this.#tick += 1;
    const due: Msg[] = [];
    const rest: Msg[] = [];
    for (const m of this.#net) (m.deliverAt <= this.#tick ? due : rest).push(m);
    this.#net = rest;
    // Deterministic processing order, independent of array/Map insertion quirks.
    due.sort((a, b) => a.deliverAt - b.deliverAt || a.seq - b.seq);
    for (const m of due) {
      if (this.#rng.bool(this.#dropProb)) continue; // lost in transit
      this.#deliver(m);
    }
    // A delivery may have completed a quorum.
    for (const opId of this.#pending.keys()) this.#tryComplete(opId);
  }

  readState(): SimState {
    return {
      tick: this.#tick,
      phase: "running",
      extra: {
        store: canonicalStore(this.#store),
        inFlight: this.#net.length,
        pending: [...this.#pending.values()].filter((p) => !p.done).length,
      },
    };
  }

  history(): HistoryEntry[] {
    return this.#history;
  }

  snapshot(): unknown {
    return {
      tick: this.#tick,
      store: canonicalStore(this.#store),
      completedOps: this.#opSeq - [...this.#pending.values()].filter((p) => !p.done).length,
    };
  }

  // --- internals ---

  #send(from: ReplicaId, to: ReplicaId, body: Omit<Msg, "seq" | "deliverAt" | "from" | "to">): void {
    const delay = 1 + this.#rng.int(this.#maxDelay);
    this.#net.push({ seq: this.#msgSeq++, deliverAt: this.#tick + delay, from, to, ...body });
  }

  #applyWrite(replica: ReplicaId, key: string, value: number, version: number): void {
    const cur = this.#store[replica][key];
    if (!cur || version > cur.version) this.#store[replica][key] = { value, version };
  }

  #deliver(m: Msg): void {
    switch (m.type) {
      case "write":
        this.#applyWrite(m.to, m.key, m.value!, m.version!);
        this.#send(m.to, m.from, { type: "write_ack", opId: m.opId, key: m.key });
        return;
      case "write_ack": {
        const p = this.#pending.get(m.opId);
        if (p && p.kind === "put") p.acks.add(m.from);
        return;
      }
      case "read": {
        const v = this.#store[m.to][m.key] ?? { value: 0, version: -1 };
        this.#send(m.to, m.from, { type: "read_reply", opId: m.opId, key: m.key, value: v.value, version: v.version });
        return;
      }
      case "read_reply": {
        const p = this.#pending.get(m.opId);
        if (p && p.kind === "get") p.replies.push({ value: m.value!, version: m.version! });
        return;
      }
    }
  }

  #tryComplete(opId: number): void {
    const p = this.#pending.get(opId);
    if (!p || p.done) return;
    if (p.kind === "put" && p.acks.size >= this.#w) {
      p.done = true;
      this.#history.push({
        kind: "ok",
        client: p.coordinator,
        op: `put:${p.key}`,
        value: { opId, kind: "put", key: p.key, value: p.value, version: p.version },
        tick: this.#tick,
      });
    } else if (p.kind === "get" && p.replies.length >= this.#r) {
      p.done = true;
      const best = p.replies.reduce((a, b) => (b.version > a.version ? b : a));
      this.#history.push({
        kind: "ok",
        client: p.coordinator,
        op: `get:${p.key}`,
        value: { opId, kind: "get", key: p.key, value: best.value, version: best.version },
        tick: this.#tick,
      });
    }
  }
}

function emptyStore(): Record<ReplicaId, Record<string, Versioned>> {
  const s = {} as Record<ReplicaId, Record<string, Versioned>>;
  for (const r of REPLICAS) s[r] = {};
  return s;
}

/** Stable, sorted view of the cluster store for snapshots and state reads. */
function canonicalStore(
  store: Record<ReplicaId, Record<string, Versioned>>,
): Record<string, Record<string, Versioned>> {
  const out: Record<string, Record<string, Versioned>> = {};
  for (const r of [...REPLICAS].sort()) {
    out[r] = {};
    for (const key of Object.keys(store[r]).sort()) out[r][key] = store[r][key];
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function clampInt(n: number, lo: number, hi: number): number {
  return clamp(Math.floor(n), lo, hi);
}
