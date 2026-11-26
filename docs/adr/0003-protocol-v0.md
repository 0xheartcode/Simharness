# Protocol v0: the orchestrator-to-adapter contract

- Status: Accepted (v0, unstable surface, versioned from day one)
- Date: 2026-11-26
- Depends on: ADR-001 (architecture charter), ADR-002 (message-level network)
- Tracking issue: the rewrite epic, phase-0 protocol

This is the wire and ABI that the orchestrator and every adapter SDK agree on. It is versioned (`v: 0`) so SUTs and the
orchestrator can evolve independently. The TypeScript reference lives in `src/engine/protocol/`; the machine-readable
JSON Schema for the stdio envelope is `src/engine/protocol/protocol-v0.schema.json`.

## Model

A SUT is driven as a set of one or more **processes**. Each process is reached through an **adapter** that implements
this protocol. The orchestrator is the only source of time (ticks) and entropy (the seed): an adapter must read neither
the wall clock nor an unseeded RNG.

Every operation is a request with a correlation `id` and a response with the same `id`. The two transports (in-process
and stdio) carry the same operations with the same shapes.

## Operations

| op                  | args                | result                   | phase |
| ------------------- | ------------------- | ------------------------ | ----- |
| `hello`             | `{ protocol: 0 }`   | `Capabilities`           | 0     |
| `reset`             | `{ seed, config? }` | `null`                   | 0     |
| `tick`              | `{}`                | `null`                   | 1     |
| `read_state`        | `{}`                | `SimState`               | 0     |
| `available_actions` | `{}`                | `string[]`               | 0     |
| `act`               | `{ action }`        | `null`                   | 0     |
| `deliver`           | `{ message }`       | `null`                   | 2     |
| `drain_outbox`      | `{}`                | `Message[]`              | 2     |
| `history`           | `{}`                | `HistoryEntry[]`         | 4     |
| `snapshot`          | `{}`                | `Snapshot` (opaque JSON) | 1     |
| `bye`               | `{}`                | `null`                   | 0     |

Phase-0 only requires `hello`, `reset`, `read_state`, `available_actions`, `act`, and `bye`. The rest are declared now
so the envelope never changes shape when later phases land; an adapter that does not support an op returns the error
code `unsupported`.

### `Capabilities`

```
{
  name: string,                     // SUT name, for reports
  protocol: 0,                      // must equal the orchestrator's version
  supportsActions: boolean,         // available_actions / act are meaningful
  supportsNetwork: boolean,         // deliver / drain_outbox are meaningful (phase-2)
  supportsStorage: boolean,         // simulated disk is used (phase-2)
  supportsByteNetwork: boolean,     // can be driven at the byte seam (phase-7)
  deterministicConcurrency: boolean // safe for the interleaving tier (phase-7)
}
```

A `hello` whose `protocol` does not equal the orchestrator's version is a hard error (`protocol_mismatch`); the run does
not start.

### `SimState`

The generalized simulation state. Discrete action space and tick come first; the spatial fields are optional and present
only for games.

```
{
  tick: number,            // logical tick, advanced only by `tick`
  phase: string,           // "running" keeps the run live; anything else ends it
  extra: object,           // SUT-specific state the checkers read
  hero?: { x, y, hp?, maxHp?, down? },     // spatial SUTs only
  enemies?: { kind, x, y, hp?, id? }[]     // spatial SUTs only
}
```

### `Message` (phase-2)

```
{ from: string, to: string, kind: string, payload: object }
```

`from` / `to` are `ProcessId`s. The network is message-level (ADR-002): the simulator moves whole `Message`s and never
sees partial frames.

### `HistoryEntry` (phase-4)

A client-visible operation, for the consistency checker.

```
{ kind: "invoke" | "ok" | "fail", client: string, op: string, value?: unknown, tick: number }
```

## Transports

### In-process

The adapter is a native object implementing the `Adapter` interface (the TypeScript shape in
`src/engine/protocol/adapter.ts`). The orchestrator calls its methods directly. Lowest overhead; same-language SUTs.
Requests and responses are plain values, not JSON text, but carry identical fields.

### stdio (JSON line protocol)

The adapter is a child process. The orchestrator writes one request JSON object per line to the child's stdin and reads
one response JSON object per line from its stdout. stderr is free for the SUT's own logging and is never parsed.

Request line:

```
{ "v": 0, "id": 7, "op": "act", "args": { "action": "buy" } }
```

Response line, success:

```
{ "v": 0, "id": 7, "ok": true, "result": null }
```

Response line, failure:

```
{ "v": 0, "id": 7, "ok": false, "error": { "code": "unsupported", "op": "deliver" } }
```

Rules:

- One JSON value per line, newline-terminated, no embedded newlines.
- `v` is the protocol version and must be `0`.
- `id` echoes the request `id`; the orchestrator matches responses by `id`.
- `ok: false` carries `error.code` (a stable string) plus free-form fields.
- The child must flush each response line before reading the next request.

Error codes: `protocol_mismatch`, `unsupported`, `bad_args`, `sut_error`.

## Versioning

v0 is explicitly unstable in surface but fixed in envelope: the `{ v, id, op,
args }` / `{ v, id, ok, result | error }`
frame does not change within v0. New operations are added as new `op` values that older adapters reject with
`unsupported`. A frame change is a new protocol version.

## Conformance

An adapter is conformant at phase-0 if a trivial echo adapter, reached over both transports, satisfies: `hello` returns
a matching `protocol`; `reset` then `read_state` returns `tick: 0`; `act("x")` then `read_state` reflects the act; and
the same request sequence produces identical responses on both transports. That round-trip is the phase-0 conformance
test.
