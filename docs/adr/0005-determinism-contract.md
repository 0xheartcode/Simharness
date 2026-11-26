# ADR-005: the determinism contract and its fitness functions

- Status: Accepted
- Date: 2026-11-26
- Depends on: ADR-001 (determinism exploited, not conferred)
- Tracking issue: the rewrite epic, phase-5

## Context

The engine exploits determinism: same seed in, identical run out. It cannot confer determinism on a system under test
that reads a wall clock or an unseeded RNG on a rare path. A single such call breaks replay months later, on the one
schedule that hits it, and discipline does not scale. The fix is a fitness function: a check that fails the build when
core code violates the rules.

## The rules (the SUT determinism contract)

A core module (the engine, and the deterministic part of an adapter) must honor:

1. **No wall clock.** No `Date.now`, `new Date`, `performance.now`, or any real-time read. Time is the virtual tick
   clock, injected.
2. **No unseeded entropy.** No `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`. All randomness flows from
   the seeded RNG.
3. **No real scheduling.** No `setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`, and no `async` / `await` in
   core. Asynchrony is modeled by ticks and `TickFuture`, which complete deterministically; real async introduces
   scheduler-dependent ordering.
4. **All IO through the seams.** Network and storage go through the simulated network and file IO, never a real socket
   or disk, so faults and timing are seeded and replayable.
5. **No iteration over unordered collections.** In JavaScript, `Map`, `Set`, and object iteration are insertion-ordered
   and therefore deterministic, so this rule is a no-op for the TypeScript engine. It binds the Rust and other SDKs,
   where hash-map iteration is unordered; their fitness functions enforce it.
6. **Thread confinement.** A future is completed only on the owning driver thread. The single-threaded TypeScript engine
   satisfies this by construction; a multi-threaded adapter SDK enforces it with an owner-thread guard.

## Decision

Enforce rules 1 to 4 in the TypeScript engine now, with a determinism fitness function wired into `make check` (the
`determinism` wall). It scans the core modules of `src/engine` for the forbidden patterns and fails the build on any
hit. The real-IO transport boundary (`protocol/stdio.ts`, `protocol/lines.ts`) is excluded: it is the seam to a real
child process and legitimately uses streams and promises; it is not core sim logic.

Rules 5 and 6 are language-specific to the Rust SDK (unordered hash iteration, multi-threaded completion) and are
enforced by that SDK's fitness function when it lands (phase-6), with a clippy or proc-macro lint and a runtime
owner-thread guard. They are recorded here so the contract is complete, not to imply they are checked in TypeScript,
where they do not apply.

## Consequence

A planted `Date.now`, `Math.random`, or `setTimeout` in a core module fails `make check`, so replay-breaking code cannot
merge. The check is the reason "remove CI" is rejected: CI is exactly what enforces the determinism seam.
