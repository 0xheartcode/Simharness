// Public API for consuming projects.
export type { EntityState, GameState, HeroState, InputState, SimAdapter, SimEvent } from "./adapter";
export type { AssertResult, MetricsReport, SimharnessConfig } from "./config";
export { run, type RunOpts, type RunResult } from "./run";
export { autoplay } from "./autoplay";
export { fuzz, type FuzzOpts } from "./fuzz";
export { strategies, type Strategy } from "./strategies";
export { runCli } from "./cli";
