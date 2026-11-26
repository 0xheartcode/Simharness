// Deterministic snapshots and a structured diff (#27). Because time and entropy
// are seamed, a snapshot of simulation state is byte-stable across runs, which
// makes it a CI regression anchor: capture a golden snapshot for a seed, and a
// later run either matches it or the diff points at the first divergence.
//
// Snapshots are canonical JSON: object keys are sorted, so two states that are
// equal as values serialize to identical text regardless of insertion order.

/** Canonicalize a value: sort object keys recursively, preserve array order. */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return out;
}

/** A stable, pretty JSON snapshot of `state`, identical for equal values. */
export function snapshot(state: unknown): string {
  return JSON.stringify(canonicalize(state), null, 2);
}

/** The first point at which two states differ, located by a path. */
export interface FirstDiff {
  /** A JSONPath-ish location, e.g. `$.store.athens.x` or `$.log[3].type`. */
  path: string;
  left: unknown;
  right: unknown;
}

/**
 * Find the first structural divergence between two values, or null if equal.
 * Traversal is deterministic: array indices in order, object keys sorted, so the
 * "first" divergence is well-defined and stable across runs.
 */
export function structuredDiff(a: unknown, b: unknown, path = "$"): FirstDiff | null {
  if (Object.is(a, b)) return null;

  const aObj = a !== null && typeof a === "object";
  const bObj = b !== null && typeof b === "object";
  if (!aObj || !bObj) return { path, left: a, right: b };

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return { path, left: a, right: b };

  if (aArr && bArr) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = structuredDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort();
  for (const key of keys) {
    const d = structuredDiff(ao[key], bo[key], `${path}.${key}`);
    if (d) return d;
  }
  return null;
}

/** True when two states are structurally equal (equivalently, their snapshots match). */
export function snapshotEqual(a: unknown, b: unknown): boolean {
  return structuredDiff(a, b) === null;
}
