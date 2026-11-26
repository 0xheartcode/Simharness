# ADR-006: positioning

- Status: Accepted
- Date: 2026-11-26
- Tracking issue: the rewrite epic, phase-8

## One sentence

Simharness is a lightweight, open, self-hostable deterministic simulation testing harness that drives real application
code (not just databases) through a versioned adapter protocol, so an ordinary service can be fuzzed under seeded faults
and replayed exactly, in any language.

## Where it sits

Deterministic simulation testing is an established idea; the field is not empty. This records where this harness fits
and, as importantly, where it does not.

- **Antithesis** runs any unmodified binary under a deterministic hypervisor. It is the most general and the most
  powerful, and it is a commercial, hosted product. Simharness asks a system to implement a small adapter instead of
  virtualizing the whole machine. That is a weaker guarantee and a much smaller thing to run: open, local, no
  hypervisor.
- **Shuttle** and **Turmoil** bring deterministic concurrency and network testing to Rust, in-process. They are
  excellent and Rust-only. Simharness keeps a versioned protocol and an stdio transport so a system under test can be
  written in any language and driven as a black box, with Rust as one SDK rather than the only one.
- **Tickloom** is a Java teaching implementation of the tick-loop, simulated network and disk, and consistency-checking
  blueprint. Simharness owes it the blueprint directly; the difference is intent: a reusable tool with a stable protocol
  and a distribution story, not a pedagogical codebase.

## The niche

The gap this fills: a deterministic simulation testing harness that is lightweight, open, and self-hostable, speaks a
stable protocol so it is polyglot, and is aimed at ordinary deterministic services, the replicated store and the
event-sourced read model, not only databases and not only Rust. The cost of that niche is honest: the adapter is a real
boundary a system must implement, and the determinism rules (ADR-005) are the system's to honor. The harness exploits
determinism; it does not confer it.
