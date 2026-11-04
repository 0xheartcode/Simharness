import { diffMetrics, formatDiff } from "@0xheartcode/simharness";
import { assert, assertEquals, assertStrictEquals } from "./assert.ts";

Deno.test("diffMetrics: numeric within tolerance is ok, not regressed", () => {
  const d = diffMetrics({ winRate: 50 }, { winRate: 52 }, 10);
  assertStrictEquals(d.regressed, false);
  const m = d.metrics.find((x) => x.key === "winRate")!;
  assertStrictEquals(m.status, "ok");
  assert(m.deltaPct !== undefined && m.deltaPct === 4);
});

Deno.test("diffMetrics: numeric beyond tolerance regresses and fails the gate", () => {
  const d = diffMetrics({ winRate: 50 }, { winRate: 60 }, 10);
  assertStrictEquals(d.regressed, true);
  assertStrictEquals(d.metrics.find((x) => x.key === "winRate")!.status, "regressed");
});

Deno.test("diffMetrics: boundary (exactly tolerance) is ok", () => {
  const d = diffMetrics({ x: 100 }, { x: 110 }, 10); // exactly 10%
  assertStrictEquals(d.regressed, false);
});

Deno.test("diffMetrics: baseline 0 -> nonzero is +inf% and regresses", () => {
  const d = diffMetrics({ deaths: 0 }, { deaths: 3 }, 10);
  const m = d.metrics[0];
  assertStrictEquals(m.deltaPct, Infinity);
  assertStrictEquals(m.status, "regressed");
  // 0 -> 0 is a 0% change, not a regression
  assertStrictEquals(diffMetrics({ deaths: 0 }, { deaths: 0 }, 10).regressed, false);
});

Deno.test("diffMetrics: added / removed / changed keys are reported but do not fail", () => {
  const d = diffMetrics({ a: 1, gone: 2, label: "x" }, { a: 1, fresh: 9, label: "y" }, 10);
  const byKey = Object.fromEntries(d.metrics.map((m) => [m.key, m.status]));
  assertStrictEquals(byKey.gone, "removed");
  assertStrictEquals(byKey.fresh, "added");
  assertStrictEquals(byKey.label, "changed");
  assertStrictEquals(d.regressed, false, "non-numeric / structural changes do not fail the gate");
});

Deno.test("formatDiff: one line per metric plus a verdict line", () => {
  const d = diffMetrics({ x: 10 }, { x: 30 }, 10);
  const lines = formatDiff(d);
  assertEquals(lines.length, 2);
  assert(lines[0].includes("REGRESSED") && lines[0].includes("x"));
  assert(lines[1].startsWith("REGRESSED"));
});
