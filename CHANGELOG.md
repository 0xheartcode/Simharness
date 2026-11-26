# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While on the `0.0.x-alpha` line the public contract
(`SimAdapter`, `SimharnessConfig`) may still change between releases; it will be frozen at the first `0.1.0`.

## [Unreleased]

Simharness is growing from a single-adapter game harness into a general deterministic simulation testing (DST) harness.
This work lives under `src/engine` and is internal: it is not exported from the package index, so the published contract
(`SimAdapter`, `SimharnessConfig`) and the released surface are unchanged, and the version stays `0.0.0-alpha.1`. The
existing single-adapter tooling keeps working and will migrate onto the engine over time; there is one tool, not two.

### Added

- **Byte-level network seam, engine-integrated** (`src/engine/sim/byte_network.ts`, ADR-002 phase-7): a tick-driven
  `SimulatedByteChannel` that delivers a byte stream in seeded fragments ignoring frame boundaries, and can cut a
  fragment mid-stream. A buffering framer recovers every frame under fragmentation; a naive one-read-one-frame framer
  breaks. Whole-frame (message-level) delivery hides the same split-frame bug.
- **Coverage-guided fuzzing, engine-integrated** (`src/engine/check/coverage_fuzz.ts`, ADR-007): a corpus-plus-coverage
  fuzzer over explicit fault scripts (applied by `ScriptedDecisions`, which also replays a schedule faithfully). It
  keeps scripts that reach new coverage and mutates from them, so it builds toward a deep cascade bug (silencing a
  specific set of sources in `examples/cascade`) that a blind search of the same budget does not reach. A CLI
  `fuzz --guided` mode runs it.
- **Interleaving exploration, engine-integrated** (`src/engine/check/schedule_explore.ts`, ADR-007): a stateless model
  checker that makes the `SimulatedNetwork` delivery order a choice point and explores delivery interleavings with a
  partial-order reduction (only same-recipient messages are reordered, since cross-recipient order is independent). A
  CLI `explore` command runs it. It finds an order-dependent bug (a withdraw lost to withdraw-before-deposit delivery in
  `examples/bank`) that the default send order and random seeds both miss, and the counterexample path replays.
- **Decision records** (`docs/adr`): the architecture charter, the message-level network boundary, the versioned
  protocol v0 spec, and the phase-0 go/no-go gate (verdict GO).
- **Protocol v0** (`src/engine/protocol`): a versioned orchestrator-to-adapter contract over an in-process transport and
  a stdio JSON line transport, with a shared dispatch core so both behave identically, a JSON Schema for the stdio
  envelope, and a trivial echo adapter plus dual-transport conformance tests.
- **Deterministic core** (`src/engine/core`): a fixed-order tick loop (`Driver` / `Tickable` / `tickUntil`), a virtual
  clock with tick-counted `Timeout` and a deterministic `WaitList`, one seeded entropy source (RNG plus positional
  `IdGen`) with a fitness test that fails on any unseeded entropy, a fast-forward `Simulation` with a seed-replay
  guarantee, and byte-stable snapshots with a structured first-divergence diff.
- **Simulated environment** (`src/engine/sim`): a multi-process `Cluster` with a `ProcessId` registry and fixed-order
  ticking, a message-level `SimulatedNetwork` with per-link delay, drop, duplicate, partition, and clog faults over a
  delivery-tick priority queue, and a crash-aware `SimulatedFileIO` with visible/durable bytes and tick-completed
  futures.
- **Fault injection and workloads** (`src/engine/sim`): a seeded `SimulationDecisions` scheduler that emits a
  tick-stamped, structured, replayable fault schedule (isolate, partition, delay, drop, heal), closed-loop client
  `Workload` issuers, and named fault profiles (quiet, latency-spike, partition-heavy, reorg-storm).
- **Cluster CLI** (`src/engine/cli`): a `Scenario` abstraction and a `run` / `replay` / `fuzz` / `assert` / `snap` /
  `metrics` command set over a cluster, with long-form flags, seed-first failure output, and a `fuzz` that exits nonzero
  with the offending seed as a CI gate.
- **Correctness checking** (`src/engine/check`): a client-visible `History` (Jepsen-style invoke/ok/fail), a
  linearizability checker for a register with a pluggable model, a liveness check (converge-after-heal, with a wedged
  cluster tripping it), and failure-to-minimal-repro fault-schedule shrinking that is faithful (masking a fault drops
  its effect without disturbing the RNG stream) and deterministic, surfaced by `fuzz` as the essential fault set.
- **Gate proof** (`examples/quorum-kv`): a quorum key-value reference system (3 replicas, W=R=2) hosted through the
  contract, with a safety invariant that holds under seeded faults and is shown to have teeth.
- **Cluster example** (`examples/gossip-register`): a gossip last-writer-wins register as real cluster nodes, with a
  safety invariant (adopted versions never regress) that passes for the correct node and fails for a buggy variant.
- **Determinism fitness function** (`scripts/check_determinism.ts`, ADR-005): a `determinism` wall in `make check` that
  fails the build on a wall-clock read, unseeded entropy, or real scheduling/async in the engine core. Documents the
  full SUT determinism contract, including the rules the Rust SDK will enforce later.
- **In-process TypeScript adapter SDK** (`src/engine/sdk`): `fromSimAdapter` runs an existing `SimAdapter` through
  protocol v0 unchanged, so the existing tooling adapts onto the engine. The chase game example runs through it.
- **stdio transport hardening** (`src/engine/protocol`): a wall-clock per-request safety timeout so a hung child fails
  loud instead of blocking, plus captured child stderr and exit status surfaced for diagnosing a crashed adapter.
- **LLM-handoff failure report**: a CLI `explain <seed>` command that emits a self-contained, copy-pasteable report
  (seed, profile, the broken invariant, the minimal fault schedule, and the tick-stamped event log tail).
- **Docs**: a positioning record (ADR-006, where this sits versus Antithesis, Shuttle, Turmoil, Tickloom), a migration
  guide (an existing `SimAdapter` onto the engine), and a reference-systems guide (quorum-KV, gossip-register, chase).
- **Rust adapter SDK** (`rs/simharness-adapter`): protocol v0 in Rust (types, dispatch with the reference semantics, a
  stdio JSON-line server, and an echo adapter), proving the protocol is polyglot. Cross-language conformance is checked
  two ways against a shared golden fixture generated from the TypeScript reference: a Rust `cargo test`, and a live test
  where the TypeScript orchestrator drives the compiled Rust echo binary over stdio. Adds `make rs-check` / `rs-build`,
  a CI `rust` job, Rust determinism rules in the `determinism` wall (no unordered hash iteration, no clock, no unseeded
  entropy, no threads), and tracks `rs/Cargo.lock`.
- **Coverage-guided fuzzing and a byte-level channel** (`rs/simharness-fuzz`): a coverage-guided fuzzer (the AFL idea at
  its core) that keeps a corpus of inputs reaching new coverage and so finds a deep bug (a 4-byte needle) that a blind
  search cannot; and a byte-level channel that fragments a stream into seeded chunks ignoring frame boundaries, exposing
  a split-frame bug that whole-frame (message-level) delivery hides. Demonstrable foundations of the advanced tiers and
  of ADR-002's byte-level seam.
- **Interleaving exploration** (`rs/simharness-explore`): a deterministic explorer of the interleavings of a small
  concurrent model (the Shuttle / loom idea at its core). The `dpor` module adds a **partial-order reduction** (sleep
  sets over an independence relation: steps touching different objects, or both reads, commute), so N independent writes
  collapse from N! interleavings to one representative while a real race (a lost update on a shared counter) is still
  found. It also finds a lost-update from a non-atomic read-modify-write that a random search would miss, and reports
  none when the increments are atomic.
- **Rust orchestrator** (`rs/simharness-orchestrator`): a single static binary that drives a stdio system under test
  through protocol v0 with `run` / `replay` / `fuzz` / `snap`, a seeded action driver, and seed-first reporting. It
  checks the one property a black-box SUT can be held to without knowing its invariants: determinism (same seed gives an
  identical final state and snapshot, with no unexpected protocol error). A cross-language test has the Rust
  orchestrator drive the TypeScript echo adapter over stdio, completing both orchestrator-drives-adapter directions.

## [0.0.0-alpha.1] - 2026-11-04

Consumer-feedback round: features and fixes from three downstream integrations, each verified against the source. The
`SimAdapter` contract stays backward-compatible (new generics and fields are optional/defaulted).

### Added

- **Baseline regression gate.** `baseline save [name]` writes the metrics summary;
  `balance --against <name>
  [--tolerance <pct>]` diffs it and exits non-zero on a regression.
  `diffMetrics`/`formatDiff` are exported and pure.
- **`--json` output** for `run`/`autoplay`/`fuzz`/`assert`/`balance`/`baseline`: one machine-readable object, human text
  suppressed. A flag parser splits flags from positionals so `--json` never shifts argument indices.
- **Project strategies** via `SimharnessConfig.strategies`, resolvable by name in `autoplay`; `resolveStrategy` errors
  on an unknown name instead of silently running `aggressive`.
- **Typed run config**: `SimAdapter`/`RunOpts`/`AutoplayOpts` gain an optional `TConfig` generic and `config` is
  threaded to `reset(seed, config)`; the CLI accepts `--config '<json>'`.
- **`run()` controls**: `stopWhen(state)` predicate stop, and `invariants` enforced on deterministic `run`/`autoplay`
  (recorded in `RunResult.invariantBreaks`, exit 1 in the CLI), not only under `fuzz`.
- **Determinism toolkit** (`src/determinism.ts`): `mulberry32`, `createRng`, `createClock`.
- **Statistical helpers** (`src/stats.ts`): `summarize`, `seedAssert` (holds across N seeds), `groupBy`, and `flatten`
  (nest dimensional metrics into the flat shape the baseline gate diffs).
- **Composable strategies**: `withAbilities(base, abilities)` fires declared abilities off cooldown.
- **Fuzz as insight**: `fuzz()` returns a structured `FuzzResult` with per-failure first-repro tick and final-phase
  coverage; `FuzzOpts.seedBase`.
- **Genre-agnostic core + action-first seam.** `hero` and `enemies` are now optional, so a non-spatial sim needs
  neither. A new optional discrete-action seam, `SimAdapter.availableActions()` / `act(id)`, lets management / economy /
  turn-based sims express an action space; `fuzz` then samples that space and reports per-action coverage, and `run`
  drives it through `RunOpts.actionPolicy` (`randomActionPolicy` provided). The CLI's `run`/`autoplay` auto-drive the
  seam when present. `check` command: a deterministic multi-seed invariant gate. Worked example `examples/economy` (a
  non-spatial action-driven sim).
- **Porcelain action policies**: `firstLegal`, `sequenceActions`, `replayActions` compose declarative action scripts
  over the raw seam.
- **Action-trace shrinking**: `shrinkActionTrace` reduces a failing trace to a minimal deterministic reproducer; `fuzz`
  attaches a shrunk `minTrace` per action-mode failure.
- **Generated API reference**: `make api` writes `API.md` from the public exports; `make check` fails if it is stale.

### Changed

- `fuzz()` now returns `FuzzResult` instead of `string[]`.
- The vestigial `RunOpts.cls` is replaced by the typed `config`.

### Fixed

- `autoplay` no longer silently falls back to `aggressive` on an unknown strategy name.
- CI installs npm deps so `deno check` finds `@types/node`; the release workflow verifies the tag with `sed` (Deno 2
  dropped `deno run -e`).

## [0.0.0-alpha.0] - 2026-11-03

The first versioned, Deno-native release. The harness logic is unchanged in behaviour from the pre-versioning library;
this release is about putting it on a solid engineering footing (deterministic walls, a self-contained binary, tests,
and a release pipeline) and starting proper version management.

### Added

- **Deno core.** The harness is now a Deno-first TypeScript package (`deno.json`, task runner, JSR-shaped exports)
  versioned from `0.0.0-alpha.0`. Node/pnpm consumers keep working unchanged through the existing `bin/simharness.mjs`
  esbuild launcher and the `package.json` `exports`/`bin`.
- **Self-contained binary.** `deno compile` builds a single `simharness` executable that discovers a
  `simharness.config.{ts,mjs,js}` in the cwd, dynamically imports it, and runs any command, with the harness core
  embedded, so a consumer needs only the binary on PATH (no `node_modules`, no build step). `--version` / `--help`
  included. The release workflow cross-compiles it for linux (x64/arm64, gnu), macOS (x64/arm64) and windows (x64).
- **The walls (`make check`).** A single deterministic gate: `deno fmt --check`, `deno lint`, `deno check`, a
  dependency-layering check (the contract must not import the tooling), a version-sync check (`deno.json` =
  `package.json` = `src/version.ts`), the test suite, and a line coverage floor over `src/` (ratcheted, starts at 95%;
  currently over 98%). `make
  package` validates the package publishes cleanly to JSR (dry run).
- **Test suite.** 42 tests covering the run loop and event derivation, the strategies, fuzz (NaN / throw / invariant
  detection and de-duplication), the autoplayer, every CLI command and exit code, and the binary's config loader, driven
  by a controllable mock adapter.
- **Worked example.** `examples/chase`, a tiny, fully deterministic game implementing `SimAdapter`, plus a real
  `simharness.config.ts`, so the binary (and a reader) can be exercised end-to-end in a minute.
- **CI + release workflows**, `CHANGELOG`, `LICENSE` (MIT), and `docs/` (`ARCHITECTURE.md`, `CONTRACT.md`).
- `run()` and `autoplay()` now share an exported `RunResult<TExtra>` type.
- `runCli(config, argv?)` accepts an explicit argv, so it is callable from the Deno binary and from tests without
  touching `process.argv`.

### Notes

- Internal relative imports stay extensionless so pnpm `link:` consumers (whose tsc resolves the package's realpath
  outside `node_modules`) are not forced to enable `allowImportingTsExtensions`. Deno bridges this with the
  `sloppy-imports` unstable flag; the `no-sloppy-imports` lint rule is therefore disabled on purpose. Tightening to
  explicit extensions is a future item.
