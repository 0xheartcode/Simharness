// Baseline diffing for `balance`: save a metrics summary, then compare a later
// summary against it with a per-metric tolerance so a balance regression fails
// CI instead of being eyeballed across two terminal scrolls. Pure + no I/O here
// (the CLI owns reading/writing the baseline file) so the diff is unit-testable.

export type MetricStatus = "ok" | "regressed" | "added" | "removed" | "changed";

export interface MetricDiff {
  key: string;
  baseline: unknown;
  current: unknown;
  /** Percent change for numeric metrics (Infinity when the baseline is 0 and the current is not). */
  deltaPct?: number;
  status: MetricStatus;
}

export interface BaselineDiff {
  tolerancePct: number;
  metrics: MetricDiff[];
  /** True when any numeric metric moved beyond tolerance: the gate fails. */
  regressed: boolean;
}

/**
 * Diff a current metrics summary against a baseline. Numeric metrics that move
 * more than `tolerancePct` are `regressed` (the only status that fails the
 * gate); keys only in one side are `added`/`removed`; non-numeric changes are
 * `changed`. All are reported so the caller can print a full table.
 */
export function diffMetrics(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  tolerancePct: number,
): BaselineDiff {
  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort();
  const metrics: MetricDiff[] = [];
  for (const key of keys) {
    const b = baseline[key];
    const c = current[key];
    const inB = key in baseline;
    const inC = key in current;
    if (inB && !inC) {
      metrics.push({ key, baseline: b, current: undefined, status: "removed" });
      continue;
    }
    if (!inB && inC) {
      metrics.push({ key, baseline: undefined, current: c, status: "added" });
      continue;
    }
    if (typeof b === "number" && typeof c === "number") {
      const deltaPct = b === 0 ? (c === 0 ? 0 : Infinity) : Math.abs(c - b) / Math.abs(b) * 100;
      metrics.push({ key, baseline: b, current: c, deltaPct, status: deltaPct > tolerancePct ? "regressed" : "ok" });
      continue;
    }
    metrics.push({ key, baseline: b, current: c, status: b === c ? "ok" : "changed" });
  }
  return { tolerancePct, metrics, regressed: metrics.some((m) => m.status === "regressed") };
}

/** A one-line-per-metric human table of a diff. */
export function formatDiff(diff: BaselineDiff): string[] {
  const lines = diff.metrics.map((m) => {
    const d = m.deltaPct === undefined ? "" : m.deltaPct === Infinity ? " (+inf%)" : ` (${m.deltaPct.toFixed(1)}%)`;
    return `  [${m.status.toUpperCase()}] ${m.key}: ${JSON.stringify(m.baseline)} -> ${JSON.stringify(m.current)}${d}`;
  });
  lines.push(diff.regressed ? `REGRESSED (tolerance ${diff.tolerancePct}%)` : `OK (within ${diff.tolerancePct}%)`);
  return lines;
}
