# ADR-007: the advanced tiers live in two places

- Status: Accepted
- Date: 2026-11-26
- Amends: ADR-001 (which scoped the advanced tiers as Rust-only)
- Tracking issue: the rewrite epic, phases 5 and 7

## Context

ADR-001 scoped the advanced tiers (interleaving exploration, coverage-guided fuzzing, byte-level network) as Rust-only,
reasoning that the Rust orchestrator is where that machinery belongs. Building them revealed a boundary that reasoning
alone had missed: the orchestrator drives a system under test as a black box over stdio, so it cannot control the SUT's
internal message-delivery order, cannot observe the SUT's code coverage, and cannot cut the SUT's own byte streams.
Those tiers only bite where the harness owns the environment.

For a system under test modeled as in-process cluster nodes (as the quorum-KV and gossip-register references are), the
engine owns the simulated network, the scheduler, and the SUT state, so it can explore delivery orders, measure
coverage, and fragment bytes. For a real multi-threaded Rust service, only a native, Rust-side explorer can intercept
its threads and sync primitives.

## Decision

Build each advanced tier in both places, for the two different kinds of SUT.

1. **Engine-integrated (TypeScript), for in-process cluster SUTs.** The interleaving explorer controls the
   `SimulatedNetwork` delivery order and does stateless model checking with a partial-order reduction; coverage-guided
   fuzzing runs over real `Scenario` runs with a real state/event coverage signal; the byte-level seam is a
   `SimulatedByteNetwork` a SUT opts into. These find bugs in the engine's own SUTs today.

2. **Native (Rust), for Rust-native SUTs and heavy search.** A deterministic interleaving explorer over a real
   cooperative-thread model with a partial-order reduction, and a coverage-guided fuzzer and byte-level channel as
   standalone crates. These serve SUTs the engine cannot host in-process, and native-speed exploration.

## Consequences

- The tiers are no longer Rust-only; ADR-001's scoping is amended here.
- The two implementations share algorithms (stateless model checking with partial-order reduction; corpus-plus-coverage
  fuzzing; fragment-and-reframe) but not a target set: the engine tiers target in-process SUTs, the Rust tiers target
  Rust programs. That duplication is deliberate, because the two SUT kinds are genuinely different.
- The partial-order reduction is the same idea in both: deliveries (or steps) to independent recipients commute, so only
  dependent ones are reordered.
