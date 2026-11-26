// Protocol v0: the versioned orchestrator-to-adapter contract.
//
// Spec: docs/adr/0003-protocol-v0.md. This module is the TypeScript reference
// for the envelope and the value shapes. The envelope { v, id, op, args } ->
// { v, id, ok, result | error } is fixed within v0; new behaviour is added as
// new `op` values that older adapters reject with `unsupported`.

/** The protocol version. Every request and response carries it as `v`. */
export const PROTOCOL_VERSION = 0 as const;

/** The operations an adapter may implement. Phase annotations are in the spec. */
export type Op =
  | "hello"
  | "reset"
  | "tick"
  | "read_state"
  | "available_actions"
  | "act"
  | "deliver"
  | "drain_outbox"
  | "history"
  | "snapshot"
  | "bye";

/** What a SUT advertises at `hello`. The orchestrator reads these to decide which seams to drive. */
export interface Capabilities {
  /** SUT name, for reports. */
  name: string;
  /** Must equal the orchestrator's PROTOCOL_VERSION. */
  protocol: number;
  /** `available_actions` / `act` are meaningful. */
  supportsActions: boolean;
  /** `deliver` / `drain_outbox` are meaningful (phase-2). */
  supportsNetwork: boolean;
  /** A simulated disk is used (phase-2). */
  supportsStorage: boolean;
  /** Can be driven at the byte seam (phase-7). */
  supportsByteNetwork: boolean;
  /** Safe for the interleaving-exploration tier (phase-7). */
  deterministicConcurrency: boolean;
}

/** The generalized simulation state: tick and discrete action-space first, spatial fields optional. */
export interface SimState {
  /** Logical tick, advanced only by `tick`. */
  tick: number;
  /** "running" keeps the run live; any other value ends it. */
  phase: string;
  /** SUT-specific state the checkers read. The core never interprets it. */
  extra: Record<string, unknown>;
  /** Spatial SUTs only (games); omit for non-spatial systems. */
  hero?: { x: number; y: number; hp?: number; maxHp?: number; down?: boolean };
  /** Spatial SUTs only (games); omit for non-spatial systems. */
  enemies?: { kind: string; x: number; y: number; hp?: number; id?: string }[];
}

/** A whole application message moved by the message-level network (ADR-002, phase-2). */
export interface Message {
  from: string;
  to: string;
  kind: string;
  payload: Record<string, unknown>;
}

/** A client-visible operation, recorded for the consistency checker (phase-4). */
export interface HistoryEntry {
  kind: "invoke" | "ok" | "fail";
  client: string;
  op: string;
  value?: unknown;
  tick: number;
}

/** Stable error codes carried by a failed response. */
export type ErrorCode = "protocol_mismatch" | "unsupported" | "bad_args" | "sut_error";

/** A request from the orchestrator to an adapter. */
export interface Request {
  v: number;
  id: number;
  op: Op;
  args: Record<string, unknown>;
}

/** A successful response. */
export interface OkResponse {
  v: number;
  id: number;
  ok: true;
  result: unknown;
}

/** A failed response. `error.code` is stable; other fields are free-form context. */
export interface ErrResponse {
  v: number;
  id: number;
  ok: false;
  error: { code: ErrorCode; [k: string]: unknown };
}

export type Response = OkResponse | ErrResponse;

/** Narrow a response to success. */
export function isOk(r: Response): r is OkResponse {
  return r.ok;
}
