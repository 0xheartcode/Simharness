// Public API for consuming projects.
export type { EntityState, GameState, HeroState, InputState, SimAdapter, SimEvent } from "./adapter";
export type { AssertResult, MetricsReport, SimharnessConfig } from "./config";
export { run, type RunOpts, type RunResult } from "./run";
export { autoplay, type AutoplayOpts, resolveStrategy } from "./autoplay";
export { fuzz, type FuzzOpts } from "./fuzz";
export { strategies, type Strategy } from "./strategies";
export { type BaselineDiff, diffMetrics, formatDiff, type MetricDiff, type MetricStatus } from "./baseline";
export { type Clock, createClock, createRng, mulberry32, type Rng } from "./determinism";
export { runCli } from "./cli";
