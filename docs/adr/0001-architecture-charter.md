# ADR-001: architecture charter

- Status: Accepted
- Date: 2026-11-26
- Deciders: maintainer
- Supersedes: none (first ADR)
- Tracking issue: the rewrite epic

## Context

Simharness today (released at `0.0.0-alpha.1`) is a deterministic single-SUT fuzz harness: one adapter implements a
genre-agnostic contract, and the tooling (run, assert, autoplay, metrics, fuzz, ascii) drives that one system under a
seeded clock and PRNG, diffs snapshots, and shrinks failing action traces.

That shape has a ceiling. It models one process, has no storage model, and checks invariants against a single state
tree. It cannot express the class of bug that only appears when several processes exchange messages over a network that
loses, delays, duplicates, and partitions them, and then has to converge.

This rewrite generalizes that single-SUT harness into an application-level deterministic simulation testing (DST)
harness in the Tickloom / Shuttle / HydroSim class: multiple processes, a simulated network, a simulated disk, seeded
fault schedules, and a client-visible history checked for consistency. The point is to walk the real code under a
deterministic schedule, not to check a separate model of it.

### Lineage

- Hellerstein, "No Room for Bugs": the screen must exercise the real code path, never a hand-written model that can
  drift from it.
- The Tickloom DST writeup: the tick-loop plus simulated network and disk plus seeded fault injection plus consistency
  checking blueprint.
- TigerStyle: the determinism discipline (route all time and entropy through injected sources; no wall clock, no
  unseeded randomness, no unordered iteration in anything that must replay).

## Decision

### 1. The orchestrator is a single static Rust binary

The orchestrator owns the CLI, seed scheduling, the fuzz search, snapshot and diff, reporting, and the determinism gate.
It drives systems under test (SUTs) that implement a stable protocol.

Reasons, in priority order:

1. Distribution: one static binary with no runtime dependency to install, which matters for a tool meant to run in other
   teams' CI.
2. Process startup cost: a fuzz campaign launches thousands of short runs, so per-run startup overhead dominates
   wall-clock; a fast-starting native binary keeps campaigns cheap.
3. Its own determinism: the orchestrator itself must replay identically, and a language with explicit control over
   iteration order and no hidden global clock makes that easier to guarantee.
4. It is the natural home for the Rust-only capability tiers (interleaving exploration, coverage-guided fuzzing,
   byte-level network).

Raw execution speed is explicitly **not** a reason. In a DST run the SUT's own work dominates; the orchestrator is
scheduling glue. Rust is chosen for distribution, startup, determinism, and the advanced tiers, not for throughput.

### 2. SUTs implement a stable, versioned protocol through per-language adapter SDKs

The protocol (see the protocol v0 spec) is the contract both sides agree on, versioned from day one. A SUT is reached
one of two ways:

- in-process: the adapter is linked into the orchestrator's process and called natively (same-language SUTs, lowest
  overhead);
- over stdio: the adapter speaks a JSON line protocol on stdin/stdout as a black box (any-language SUTs).

The TypeScript adapter SDK ships first (it ports the existing single-adapter contract forward and keeps the existing
service and tooling niche). A Rust adapter SDK follows. The protocol, not the language, is the product; languages are
downstream of it.

### 3. Walk-the-real-code is an invariant, not a preference

An adapter is a thin seam onto the real system's code. It may inject a simulated clock, network, and disk, but it must
not reimplement the logic under test. A SUT that passes by running a simplified copy of itself is a failed adapter, not
a passing test.

### 4. Determinism is exploited, not conferred

Simharness gives a SUT a deterministic environment (seeded entropy, a virtual clock, an ordered network). It cannot make
a nondeterministic SUT deterministic. SUTs must honor the determinism rules; a per-language fitness function (a later
phase) checks that they do, and a run that diverges on replay fails loudly rather than flaking.

### 5. Capability tiers

Capability grows in tiers, and a SUT advertises what it supports:

1. single-threaded deterministic simulation (all languages, the floor);
2. deterministic interleaving / schedule exploration (Rust-only tier);
3. coverage-guided fuzzing and byte-level network (Rust-only tier).

The two advanced tiers are Rust-only and are funded only after the core and the polyglot protocol are proven.

## Alternatives considered and rejected

### (a) A cleaner TypeScript-only rewrite that keeps the single-SUT model

Lower effort, one language, reuses the existing harness wholesale. Rejected: it caps at no-concurrency testing (no
cluster, no message network), so it can never reach the distributed-systems bug class that is the whole reason for the
rewrite, and it loses the systems audience the rewrite is aimed at.

### (b) A Rust-only, in-process-only harness

Simplest orchestrator story and the strongest advanced tiers. Rejected: it abandons the service and TypeScript niche
where the first real proof SUT lives, and it breaks walk-the-real-code for any SUT not written in Rust, since those
would have to be reimplemented rather than adapted.

The chosen design keeps a native orchestrator for distribution and the advanced tiers, while the versioned protocol and
the stdio transport keep SUTs in their own language walking their own code.

## Non-goals

- A hypervisor-level simulator that runs any unmodified binary. That is a different and much larger project (the
  Antithesis class); this harness asks SUTs to implement an adapter.
- A separate model checker that re-specifies the SUT. Models drift from code; DST explores schedules of the real code
  instead.
- Replacing ordinary unit tests. DST explores schedulings of the same assertions; it does not replace decoder, parser,
  or pure-function tests.

## Consequences

- There is now a protocol surface to version and keep stable; breaking it is a deliberate, documented act.
- The orchestrator and the SUTs can evolve independently as long as both honor a protocol version.
- Phase-0 must prove this contract against a real (non-game) system before any Rust orchestrator work is funded (see the
  phase-0 gate). If the universal contract fights a real system, the contract is revised; the gate is not bypassed.
