# @0xheartcode/simharness

A **game-agnostic AI development harness**. Any 2D game with a _deterministic, render-separated simulation_ implements
one interface (`SimAdapter`) and gets:

- **Deterministic headless runs**: `reset(seed)` then step N ticks, no browser.
- **Scriptable input**: a per-tick timeline injected through the sim's input API.
- **Typed state readout**: real values (hp, positions, resources, phase, kills), never screen-scraped.
- **ASCII board snapshots**: a one-way glyph dump for "what does it look like", plus regression diffs.
- **Event log**: clears, hero-down, phase changes, with tick stamps.
- **Assertions and deterministic replay**: "after inputs X from seed S the core broke"; the same seed and policy give an
  identical run.
- **Fuzz and invariants**: random seeds and inputs assert never-NaN, never-throws.
- **Autoplayer ("GM") and strategies**: aggressive, turtle, random, idle stress runs.
- **Balance metrics**: many seeds in, win rate, averages, and per-run rows out.
- **CLI**: `run | ascii | autoplay | fuzz | assert | balance | snap`.

It is deliberately _not_ tied to any one game: the harness is the reusable core, and each project ships a small adapter
and config.

> **Status:** `0.0.0-alpha.1`. Deno-native core, self-contained `deno compile` binary, and deterministic walls
> (`make check`: fmt, lint, typecheck, layering, version-sync, tests, and a 95% coverage floor, currently over 98%). The
> `SimAdapter` contract may still shift on the alpha line; it freezes at `0.1.0`.

## Try it in a minute

The repo ships a tiny deterministic `chase` game whose adapter is the whole contract in about 160 lines. Drive it
headlessly, with no game to look at:

```bash
git clone https://github.com/0xheartcode/Simharness && cd Simharness
make compile                      # builds dist/simharness (needs deno 2.9.x)

cd examples/chase
../../dist/simharness assert      # project assertions (CI gate)
../../dist/simharness autoplay 7 400 aggressive
../../dist/simharness balance 8
../../dist/simharness ascii 3
```

Nothing there is chase-specific: the harness only ever touches the universal `GameState` core, and every genre detail
lives in `extra`.

## Use it in your game

1. **Implement `SimAdapter`** over your sim (see `examples/chase/chase_adapter.ts`).
2. **Add a `simharness.config.ts`** at your repo root whose default export is a `SimharnessConfig`: a `createAdapter()`
   factory, plus optional `stage`, `asserts`, `metrics`, `invariants`:

   ```ts
   import type { SimharnessConfig } from "@0xheartcode/simharness/config";
   import { MyGameAdapter } from "./sim/my-game-adapter";
   const config: SimharnessConfig = { createAdapter: () => new MyGameAdapter() };
   export default config;
   ```

3. **Run a command.** Three supported ways, pick what fits your project:

   | Path       | How                                                                         | When                                                                                  |
   | ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
   | **Binary** | `simharness assert` (the `deno compile` binary on PATH)                     | Any repo; no deps, no build. The core is embedded and resolves your config's imports. |
   | **pnpm**   | `"@0xheartcode/simharness": "link:../Simharness"`, then `simharness assert` | Node/Vite projects (bundled on the fly by `bin/simharness.mjs`).                      |
   | **deno**   | `deno run -A --config <repo>/deno.json <repo>/src/main.ts assert`           | A Deno project or from a checkout.                                                    |

## The adapter

```ts
interface SimAdapter<TExtra> {
  readonly name: string;
  reset(seed: number, opts?): void;
  step(dt: number): void;
  setInput(partial: InputState): void; // move, aimWorld, fire, press/hold keys
  readState(): GameState<TExtra>; // the seam: typed state every tick
  snapshotAscii(): string;
  debug?(action: string, arg?: unknown): void;
}
```

`GameState<TExtra>` is a tiny universal core (`tick`, `phase`, `hero`, `enemies`) plus a project-typed `extra` that the
harness never reads but your asserts, metrics, and invariants do. See `examples/chase` for a complete adapter and
config.

## Beyond action games

`hero`, `enemies` and `InputState` (move / aim / fire / keys) are the batteries for real-time action games, and the
built-in strategies and the `fuzz` input generator use them. They are all optional. A non-realtime sim (management,
economy, turn-based) omits them and exposes a discrete action space instead:

- `availableActions(): string[]` returns the currently legal action ids.
- `act(id): void` applies one.

With that seam `fuzz` samples your real action space and reports per-action coverage, instead of perturbing movement
your sim ignores, and a run drives it through `actionPolicy` (see `randomActionPolicy`). A sim that drives its own
agents can also just be stepped with no input: call `run` with no `timeline` or `actionPolicy` and read state each tick.

## The deterministic simulation engine

Simharness is growing from a single-adapter game harness into a general deterministic simulation testing (DST) harness:
the same discipline (seed in, identical run out) extended from one simulation to a cluster of processes over a simulated
network and disk, with client-visible histories checked for consistency. The existing single-adapter tooling keeps
working and migrates onto the engine over time; there is one tool, not two.

The engine lives under `src/engine`:

- `protocol/` is the versioned orchestrator-to-adapter contract, over an in-process or a stdio (JSON line) transport, so
  a system under test can be written in any language and driven as a black box.
- `core/` is the deterministic heart: a fixed-order tick loop, a virtual clock with tick-counted timeouts, one seeded
  entropy source, a fast-forward run loop with a seed-replay guarantee, and byte-stable snapshots with a structured
  diff.
- `sim/` is the simulated environment: a multi-process cluster, a message-level network with seeded faults, a
  crash-aware file model, a seeded fault scheduler that emits a replayable structured schedule, and closed-loop client
  workloads.
- `cli/` is the orchestrator: a `Scenario` (cluster plus workload plus invariants) driven by `run` / `replay` / `fuzz` /
  `assert` / `snap` / `metrics` / `explain`, where `fuzz` is a CI gate that exits nonzero with the offending seed and
  the minimal essential fault set, and `explain` emits a copy-pasteable failure report.
- `check/` is correctness: a client-visible history, a linearizability checker, a converge-after-heal liveness check,
  and faithful, deterministic fault-schedule shrinking to a minimal repro.
- `sdk/` is the in-process adapter SDK: `fromSimAdapter` runs an existing `SimAdapter` through protocol v0 unchanged, so
  the existing single-adapter tooling adapts onto the engine rather than being rewritten.

The decisions that steer this work, and the go/no-go gate that proved the contract on a real replicated system (a quorum
key-value store) before any further build, are recorded in [`docs/adr`](docs/adr/README.md). Guides for migrating an
adapter onto the engine and for the reference systems under test are in [`docs/guide`](docs/guide).

## Development: the walls

We encode best practices as deterministic checks and loop until green. `make check` is the single gate, and CI runs
exactly it.

```bash
make check      # fmt + lint + typecheck + layering + version-sync + api + determinism + tests + coverage floor
make cov        # coverage report (src only)
make compile    # build dist/simharness
make package    # validate the JSR publish (dry run)
```

Rule: never lower a threshold to pass a check. Fix the code, or raise the bar on purpose in a commit that says why.
`COV_FLOOR` is a ratchet.

## Versioning

One version, three sources of truth kept in lockstep by `make version` (`deno.json`, `package.json`, `src/version.ts`).
Tag `vX.Y.Z` to cut a release: the workflow re-runs the gate, cross-compiles the binary for linux/macOS/windows, and
attaches them to the GitHub Release. See [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT © 0xheartcode
