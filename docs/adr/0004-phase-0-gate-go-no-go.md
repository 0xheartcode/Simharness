# Phase-0 gate: go/no-go

- Status: GO
- Date: 2026-11-26
- Decides: issue #20 (prove the universal contract on a real non-game SUT)
- Depends on: ADR-001, protocol v0

## Verdict

**GO.** The protocol v0 contract hosts a real replicated system end to end with no change forced to its shape. Phase-1
(the TypeScript core engine) may proceed. The two advanced Rust-only tiers remain gated behind their own phases; this
gate only unblocks the core build.

## What was proven, and how

The proof SUT is an in-repo quorum key-value store: three replicas (athens, byzantium, cyrene), write quorum W=2 and
read quorum R=2 over N=3, with a seeded message network that loses, delays, and reorders messages. It is the real thing,
not a toy economy: last-writer-wins by a global op version, a coordinator chosen per operation, writes acked by a
quorum, reads returning the highest version seen across a read quorum.

Crucially, it is driven only through the contract: `reset(seed, config)`, `available_actions`, `act`, `tick`,
`read_state`, and `history`. The harness never reaches inside it.

Four claims, together, are the gate (see `tests/engine/quorum_kv_gate_test.ts`):

1. **Safety.** Across 60 seeds under a 30% drop rate and up to 3-tick delays, the quorum invariant holds: a read that
   begins after a write commits never returns an older version. This is the property W + R > N buys, checked from the
   client-visible history alone.
2. **Teeth.** With the quorum removed (W=R=1), the same checker catches stale reads on the same workload. Safety is
   therefore not vacuous: the invariant can fail, and does, exactly when the system is wrong.
3. **Liveness sanity.** The sweep asserts that reads and writes actually complete, so safety is not passing because
   nothing happened.
4. **Determinism.** One seed yields one history and one snapshot, byte for byte, on repeated runs.

Plus a transport claim: the same SUT, unchanged, is hosted over the stdio line protocol as a real child process and
returns identical answers to the in-process path. The contract, not the language or the transport, carries it.

## Did the contract fight the system?

No change was forced. The generalized `SimState` (tick and a discrete action space first, spatial `hero` / `enemies`
omitted) carried a replicated store cleanly: all cluster state lived in `extra`, which the core never interprets. The
go/no-go the gate asked for is a GO with no contract revision.

The build did surface refinements, recorded here for later phases. None blocks phase-1.

- **`act` is void; client-op results surface through `history`.** A client operation is invoked at one tick and
  completes (ok) several ticks later when its quorum responds. That is the right model for an asynchronous distributed
  op, and `history` (invoke / ok / fail) expressed a linearizability-flavored safety check without any extra surface. A
  future protocol version could let `act` return an opId handle so a checker correlates invoke and completion without
  parsing history payloads. Optional, not required.
- **The phase-0 network lives inside the SUT.** This proof put the simulated network inside the adapter as throwaway
  scaffolding. The contract already declares `deliver` / `drain_outbox` (phase-2) for externalizing it, so the phase-2
  SimulatedNetwork seam is anticipated by protocol v0, not a shape change. Confirmed, not a fight.
- **`history` and `snapshot` shapes are sufficient.** The phase-4 history primitive (invoke / ok / fail with a client,
  op, value, and tick) and an opaque JSON `snapshot` were enough for both the safety check and the determinism check. No
  additions needed for phase-0.

## Consequence

Phase-1 is funded: the deterministic core engine (tick loop, virtual clock, seeded PRNG as sole entropy, fast-forward
replay, snapshot and diff) builds on protocol v0 as written. The recorded `act`-returns-opId refinement is a candidate
for a future protocol version and is not actioned now.
