# Architecture decision records

Decisions that steer the rewrite. Each record is immutable once Accepted; a change is a new record that supersedes an
old one.

- [ADR-001: architecture charter](0001-architecture-charter.md) - orchestrator language, protocol split,
  walk-the-real-code, determinism, capability tiers, non-goals.
- [ADR-002: network simulation boundary](0002-network-simulation-boundary.md) - message-level for the core, byte-level
  as a later tier.
- [Protocol v0](0003-protocol-v0.md) - the versioned orchestrator-to-adapter contract (operations, SimState, both
  transports).
- [Phase-0 gate go/no-go](0004-phase-0-gate-go-no-go.md) - GO: the contract hosts a real quorum-KV system under faults
  with no shape change forced.
- [ADR-005: determinism contract](0005-determinism-contract.md) - the SUT determinism rules and the fitness function
  that enforces them in `make check`.
- [ADR-006: positioning](0006-positioning.md) - the one-sentence why, and where this sits versus Antithesis, Shuttle,
  Turmoil, and Tickloom.
- [ADR-007: the advanced tiers live in two places](0007-advanced-tiers.md) - engine-integrated for in-process SUTs and
  native Rust for Rust-native SUTs; amends ADR-001's Rust-only scoping.

Guides live in [`docs/guide`](../guide): migrating an existing adapter onto the engine, and the reference systems under
test.
