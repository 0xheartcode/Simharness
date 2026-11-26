// The in-process adapter interface. A SUT implements this; the orchestrator
// drives it either directly (in-process transport) or behind the stdio line
// protocol. The two transports carry the same operations with the same shapes.
//
// Only `hello`, `reset`, and `readState` are required. Everything else is
// optional: an absent method is reported to the orchestrator as the error code
// `unsupported`, so a SUT declares its surface by what it implements plus the
// capability flags it returns from `hello`.

import type { Capabilities, HistoryEntry, Message, SimState } from "./types.ts";

export interface Adapter {
  /** Advertise name, protocol version, and capability flags. Required. */
  hello(): Capabilities;
  /** Start a fresh, seeded run. Required. `config` is SUT-specific. */
  reset(seed: number, config?: Record<string, unknown>): void;
  /** Read the current state. Required. */
  readState(): SimState;

  /** Advance one logical tick (phase-1). */
  tick?(): void;
  /** Currently legal action ids (phase-0 action seam). */
  availableActions?(): readonly string[];
  /** Apply one action by id (phase-0 action seam). */
  act?(action: string): void;

  /** Inject a network message addressed to this process (phase-2). */
  deliver?(message: Message): void;
  /** Take and clear the messages this process wants to send (phase-2). */
  drainOutbox?(): Message[];

  /** The client-visible history recorded so far (phase-4). */
  history?(): HistoryEntry[];
  /** An opaque JSON snapshot for golden capture and diff (phase-1). */
  snapshot?(): unknown;
  /** Release resources; the run is over (phase-0). */
  bye?(): void;
}
