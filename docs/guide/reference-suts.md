# Reference systems under test

The engine ships reference systems under test that double as the test suite and the teaching material. Each is
deliberately a different shape, so together they check that the universal contract does not overfit to one kind of
system. All of them run green under `make check`.

## quorum-KV (`examples/quorum-kv`)

A quorum key-value store: three replicas, write quorum and read quorum of two over three, with a seeded lossy and
reordering network. It is the canonical distributed-store example and the phase-0 gate: it proved the contract hosts a
real replicated system before any further build. Its safety invariant (a read that starts after a write commits never
returns an older value) holds under faults and is shown to have teeth by a no-quorum control.

## gossip-register (`examples/gossip-register`)

A gossip last-writer-wins register as real cluster `Node`s over the engine's cluster, network, and fault scheduler. It
is the eventually-consistent shape: it diverges under partitions and converges after heal. A correct node keeps a safety
invariant (adopted versions never regress) that a buggy variant breaks, and the liveness check distinguishes a cluster
that converges from a wedged one. It drives the CLI examples (`run` / `fuzz` / `explain`).

## chase (`examples/chase`)

A small deterministic real-time game that implements the existing `SimAdapter`. It runs on the engine through the
in-process SDK (`fromSimAdapter`) with no change, so it is both the migration example and proof that an interactive,
spatial system fits the same contract as a replicated store.

## Why three shapes

A distributed store, an eventually-consistent cluster, and a real-time game are about as different as systems under test
get. The contract (tick plus a discrete action space, state read-out, history, snapshot) carries all three without a
special case. That is the evidence that it is a universal contract and not a quorum-store contract wearing a general
name.
