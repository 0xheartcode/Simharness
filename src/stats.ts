// Statistical helpers for asserts() and metrics(): summarize a sample, assert a
// property holds across N seeds, group rows by a dimension, and flatten a nested
// (dimensional) summary into the flat key/value shape the baseline gate diffs.
import type { AssertResult } from "./config";

export interface Summary {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  stdev: number;
}

/** Descriptive stats for a numeric sample (all NaN for an empty sample). */
export function summarize(values: number[]): Summary {
  const n = values.length;
  if (n === 0) return { n: 0, min: NaN, max: NaN, mean: NaN, median: NaN, p95: NaN, stdev: NaN };
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const p95 = s[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { n, min: s[0], max: s[n - 1], mean, median, p95, stdev: Math.sqrt(variance) };
}

/** Assert a predicate holds across every seed; the message lists the failing seeds. */
export function seedAssert(name: string, seeds: readonly number[], check: (seed: number) => boolean): AssertResult {
  const failing = seeds.filter((s) => !check(s));
  return failing.length === 0
    ? { name, ok: true, msg: `held across ${seeds.length} seeds` }
    : { name, ok: false, msg: `failed for ${failing.length}/${seeds.length} seeds: ${failing.slice(0, 8).join(", ")}` };
}

/** Group items by a string dimension. */
export function groupBy<T>(items: readonly T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const it of items) (out[key(it)] ??= []).push(it);
  return out;
}

/** Flatten a nested metrics object into dotted keys, so dimensional metrics diff in the flat baseline gate. */
export function flatten(obj: Record<string, unknown>, prefix = "", sep = "."): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}${sep}${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key, sep));
    } else out[key] = v;
  }
  return out;
}
