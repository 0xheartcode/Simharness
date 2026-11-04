// Public API for consuming projects.
export type { EntityState, GameState, HeroState, InputState, SimAdapter, SimEvent } from "./adapter";
export type { AssertResult, MetricsReport, SimharnessConfig } from "./config";
export { run, type RunOpts, type RunResult } from "./run";
export { autoplay, type AutoplayOpts, resolveStrategy } from "./autoplay";
export { fuzz, type FuzzFailure, type FuzzOpts, type FuzzResult } from "./fuzz";
export { type AbilitySpec, strategies, type Strategy, withAbilities } from "./strategies";
export {
  type ActionPolicy,
  firstLegal,
  randomActionPolicy,
  replayActions,
  sequenceActions,
  shrinkActionTrace,
} from "./actions";
export { type BaselineDiff, diffMetrics, formatDiff, type MetricDiff, type MetricStatus } from "./baseline";
export { type Clock, createClock, createRng, mulberry32, type Rng } from "./determinism";
export { flatten, groupBy, seedAssert, summarize, type Summary } from "./stats";
export { runCli } from "./cli";
