# ADR-002: network simulation boundary (message-level vs byte-level)

- Status: Accepted
- Date: 2026-11-26
- Deciders: maintainer
- Depends on: ADR-001
- Tracking issue: the rewrite epic, phase-2 network seam

## Context

The simulated network is where most distributed-systems faults are injected, so where it cuts into the SUT decides which
bugs it can find. There are two established places to cut.

### Message-level (TigerBeetle, Tickloom)

The simulator moves whole application messages between processes. A send hands the simulator a complete message; the
simulator decides, from the seed, when (or whether) to deliver it.

- Simpler: the unit is the message the SUT already reasons about.
- Exercises lost, delayed, reordered, duplicated, partitioned, and timeout/retry paths directly.
- Does not run the SUT's framing, buffering, or reconnect code, because those sit below the message boundary and are
  bypassed.

### Byte-level (FoundationDB's simulated connection)

The simulator moves partial byte ranges across a simulated connection. A send writes bytes into a simulated socket; the
simulator decides how many bytes arrive and when, and can cut the connection mid-stream.

- Runs the real framing, buffering, and reconnect code under fault.
- Catches split-frame bugs (a message arriving in two reads), mid-frame connection death, and partial-write handling
  that message-level never touches.
- More work: the seam is lower, and every SUT pays the cost of a byte transport even when its bug is above the frame.

## Decision

**The engine core uses a message-level simulated network.** The phase-2 network seam moves whole messages on a per-link,
seeded, delivery-tick priority queue, and injects loss, delay, reorder, duplication, and partition at the message unit.

**Byte-level is scheduled as a later Rust-tier capability** (phase-7), offered to SUTs that opt in, not required of the
core. The capability flag `supports_byte_network` marks a SUT that can be driven at the byte seam.

## Rationale

- The first proof SUT and the common case (replicated state over quorum reads/writes) have their interesting bugs at the
  message level: delivery order, partition, and retry, not framing. Message-level finds those for a fraction of the
  build cost.
- A lower seam is a one-way door for every SUT's adapter. Starting high keeps adapters simple and keeps the
  message-level fault vocabulary (loss, delay, reorder, duplicate, partition) small and well understood.
- Byte-level is additive: it is a second transport under the same protocol, not a rewrite. Deferring it costs nothing
  that message-level already covers.

## What byte-level would additionally catch (recorded for phase-7)

- A message split across two reads that the SUT mis-frames.
- A connection killed between two writes of one message (half-sent state).
- Partial-write back-pressure handling.
- Reconnect-and-resume correctness after a mid-stream cut.

These are real and worth a tier; they are not worth blocking the core on.

## Consequences

- The phase-2 network seam inherits the message-level decision: its API is send(from, to, message) and the fault model
  is defined over messages.
- SUT adapters frame and serialize above the simulator; the message-level network never sees partial frames.
- Phase-7 adds a byte transport behind `supports_byte_network` without changing the message-level API that core SUTs
  depend on.
