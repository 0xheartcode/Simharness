// The deterministic simulation core (phase-1). Internal to the rewrite: not re-exported
// from the package index, so the published package API stays unchanged while the core
// is built out.

export { Driver, type Tickable, TickBudgetExceeded } from "./tickable.ts";
export { TickClock, Timeout, WaitList } from "./clock.ts";
export { createEntropy, type Entropy, IdGen } from "./entropy.ts";
export { EventLog, type RunResult, type SimContext, type SimEvent, Simulation } from "./run.ts";
export { type FirstDiff, snapshot, snapshotEqual, structuredDiff } from "./snapshot.ts";
