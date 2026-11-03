// A consuming project provides a simharness.config.ts whose default export is
// a SimharnessConfig: at minimum a factory for its SimAdapter, plus optional
// project-specific scenario staging, assertions, balance metrics, and fuzz
// invariants. `TExtra` ties the config's typed hooks to the adapter's state.
import type { GameState, SimAdapter } from "./adapter";

export interface AssertResult {
  name: string;
  ok: boolean;
  msg?: string;
}

export interface MetricsReport {
  summary: Record<string, unknown>;
  rows: string[];
}

export interface SimharnessConfig<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  /** Build a fresh adapter (the harness resets it per run). */
  createAdapter: () => SimAdapter<TExtra>;
  /** Stage a scene for `ascii` / `snap` (defaults to reset + a few steps). */
  stage?: (a: SimAdapter<TExtra>, seed: number) => void;
  /** Project assertions for `assert` (a CI gate over game mechanics). */
  asserts?: (a: SimAdapter<TExtra>) => AssertResult[];
  /** Project balance metrics for `balance`. */
  metrics?: (a: SimAdapter<TExtra>, o: { seeds: number; ticks: number }) => MetricsReport;
  /** Project fuzz invariants: return a message per broken invariant (empty = OK). */
  invariants?: (s: GameState<TExtra>) => string[];
}
