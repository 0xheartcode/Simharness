# Migrating an existing adapter onto the engine

The engine does not replace the existing single-adapter tooling; it is where that tooling is heading, and an existing
`SimAdapter` runs on the engine unchanged through the in-process SDK. There is one tool, not two. This guide takes an
existing game or service adapter to the engine protocol.

## The short version

An existing `SimAdapter` already satisfies most of protocol v0: its state shape is the generalized `SimState` with the
spatial fields optional. Wrap it:

```ts
import { fromSimAdapter } from "src/engine/sdk/bridge.ts";
import { inProcessChannel } from "src/engine/protocol/in_process.ts";
import { MyAdapter } from "./my-adapter.ts";

const channel = inProcessChannel(fromSimAdapter(new MyAdapter()));
channel.request("reset", { seed: 1 });
channel.request("tick");
const state = channel.request("read_state");
```

That is the whole compat path: no change to the adapter. `examples/chase` is a game adapter driven exactly this way in
the tests.

## What the bridge maps

| Protocol v0           | SimAdapter                  | Notes                               |
| --------------------- | --------------------------- | ----------------------------------- |
| `hello`               | `name`, `availableActions?` | capabilities are derived            |
| `reset(seed, config)` | `reset(seed, config)`       | identical                           |
| `tick`                | `step(dt)`                  | one protocol tick is one `step(dt)` |
| `read_state`          | `readState()`               | `GameState` is a `SimState`         |
| `available_actions`   | `availableActions?()`       | present only if the adapter has it  |
| `act`                 | `act?(id)`                  | present only if the adapter has it  |
| `snapshot`            | `snapshotAscii()`           | wrapped as `{ ascii }`              |

## When to go further

The bridge drives a single process. To exercise a cluster, a simulated network, or storage crashes, implement the system
as engine `Node`s over a `Cluster` (see `examples/gossip-register`) and define a `Scenario` with invariants, then drive
it with the CLI (`run` / `replay` / `fuzz` / `assert` / `snap` / `metrics` / `explain`). That is a port, not a wrap, and
it buys the distributed-systems bug class the single adapter cannot reach.

## Determinism

Whichever path, the adapter must honor the determinism contract (ADR-005): no wall clock, no unseeded entropy, no real
scheduling in the parts the engine drives. The `determinism` wall in `make check` enforces this for the engine core; an
adapter that breaks it will flake on replay.
