// #38: the determinism fitness function flags planted replay-breakers in a core
// module and passes the real core. This is the wall that make check enforces.

import { scanSource, scanTree } from "../../scripts/check_determinism.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

Deno.test("scanSource: clean core code has no violations", () => {
  const src = `
    export function step(tick: number): number {
      return tick + 1;
    }
  `;
  assertEquals(scanSource(src, "x.ts"), []);
});

Deno.test("scanSource: a planted wall-clock read is flagged", () => {
  const v = scanSource("const t = Date.now();", "core.ts");
  assertStrictEquals(v.length, 1);
  assert(v[0].rule.includes("wall clock"));
});

Deno.test("scanSource: planted unseeded entropy is flagged", () => {
  assert(scanSource("const r = Math.random();", "core.ts").some((v) => v.rule.includes("unseeded entropy")));
  assert(scanSource("crypto.getRandomValues(buf);", "core.ts").some((v) => v.rule.includes("unseeded entropy")));
});

Deno.test("scanSource: planted real scheduling and async are flagged", () => {
  assert(scanSource("setTimeout(fn, 10);", "core.ts").some((v) => v.rule.includes("real scheduling")));
  assert(scanSource("async function f() {}", "core.ts").some((v) => v.rule.includes("real async")));
  assert(scanSource("const x = await p;", "core.ts").some((v) => v.rule.includes("real async")));
});

Deno.test("scanSource: a forbidden pattern inside a comment is not a violation", () => {
  assertEquals(scanSource("// uses Date.now and Math.random historically\nreturn 1;", "core.ts"), []);
  assertEquals(scanSource("/* setTimeout here would break replay */\nreturn 1;", "core.ts"), []);
});

Deno.test("scanTree: the real engine core is determinism-clean", async () => {
  const violations = await scanTree();
  assertEquals(violations, [], violations.map((v) => `${v.path}:${v.line} ${v.rule}`).join("; "));
});
