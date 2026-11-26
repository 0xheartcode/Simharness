// Correctness checking (phase-4): client-visible history, linearizability,
// liveness, and failure-to-minimal-repro shrinking. Internal to the engine.

export { History, type HistoryOp, type Outcome } from "./history.ts";
export {
  checkLinearizable,
  type LinViolation,
  type Model,
  type ModelResult,
  registerModel,
} from "./linearizability.ts";
export { allAgree, type LivenessConfig, type LivenessResult, runLiveness } from "./liveness.ts";
export { type MinimalRepro, minimalRepro, shrinkIndices } from "./shrink.ts";
