import { runCli } from "@0xheartcode/simharness/cli";
import type { SimharnessConfig } from "@0xheartcode/simharness/config";
import { MockAdapter, type MockExtra, type MockOpts } from "./mock_adapter.ts";
import { assert, assertStrictEquals, captureExit } from "./assert.ts";

interface CfgOpts extends MockOpts {
  withAsserts?: "pass" | "fail";
  withMetrics?: boolean;
  withInvariants?: boolean;
  invariantBreak?: boolean;
}

function makeConfig(o: CfgOpts = {}): SimharnessConfig<MockExtra> {
  const cfg: SimharnessConfig<MockExtra> = { createAdapter: () => new MockAdapter(o) };
  if (o.withAsserts) {
    cfg.asserts = () => [
      { name: "always ok", ok: true },
      { name: "conditional", ok: o.withAsserts === "pass", msg: "detail" },
    ];
  }
  if (o.withMetrics) {
    cfg.metrics = (_a, opts) => ({ summary: { seeds: opts.seeds, ticks: opts.ticks }, rows: ["row one", "row two"] });
  }
  if (o.withInvariants || o.invariantBreak) cfg.invariants = () => (o.invariantBreak ? ["mock invariant broke"] : []);
  return cfg;
}

Deno.test("cli: help is printed with no command", () => {
  const { out } = captureExit(() => runCli(makeConfig(), []));
  assert(out.join("\n").includes("game-agnostic AI dev harness"));
});

Deno.test("cli: run prints final state and events", () => {
  const { out } = captureExit(() => runCli(makeConfig({ endAt: 5 }), ["run", "7", "50"]));
  const text = out.join("\n");
  assert(text.includes('"seed": 7'));
  assert(text.includes("events (last 12)"));
});

Deno.test("cli: run exits 1 when an invariant breaks on the deterministic run", () => {
  const { code, err } = captureExit(() => runCli(makeConfig({ endAt: 5, invariantBreak: true }), ["run", "1", "20"]));
  assertStrictEquals(code, 1);
  assert(err.join("\n").includes("INVARIANT BREAKS"));
});

Deno.test("cli: ascii prints a board snapshot", () => {
  const { out } = captureExit(() => runCli(makeConfig(), ["ascii", "3"]));
  assert(out.join("\n").includes("mock tick"));
});

Deno.test("cli: autoplay runs the named strategy", () => {
  const { out } = captureExit(() => runCli(makeConfig(), ["autoplay", "1", "20", "turtle"]));
  assert(out.join("\n").includes('"seed": 1'));
});

Deno.test("cli: autoplay exits 1 and names the options on an unknown strategy", () => {
  const { code, err } = captureExit(() => runCli(makeConfig(), ["autoplay", "1", "20", "nope"]));
  assertStrictEquals(code, 1);
  const text = err.join("\n");
  assert(text.includes('unknown strategy "nope"'));
  assert(text.includes("aggressive"), "lists the available built-ins");
});

Deno.test("cli: autoplay resolves a project strategy from config.strategies", () => {
  const cfg = makeConfig();
  cfg.strategies = { pacifist: () => ({}) };
  const { out } = captureExit(() => runCli(cfg, ["autoplay", "1", "10", "pacifist"]));
  assert(out.join("\n").includes('"fired": 0'), "the project strategy never fires");
});

Deno.test("cli: fuzz passes on a clean adapter (exit 0 path, no exit call)", () => {
  const { out, code } = captureExit(() => runCli(makeConfig({ withInvariants: true }), ["fuzz", "3", "10"]));
  assertStrictEquals(code, null, "a clean fuzz does not call process.exit");
  assert(out.join("\n").includes("fuzz OK"));
});

Deno.test("cli: fuzz fails and exits 1 when an invariant breaks", () => {
  const { code, err } = captureExit(() => runCli(makeConfig({ nanAt: 1 }), ["fuzz", "2", "10"]));
  assertStrictEquals(code, 1);
  assert(err.join("\n").includes("FUZZ FAILURES"));
});

Deno.test("cli: assert exits 0 when all pass", () => {
  const { code, out } = captureExit(() => runCli(makeConfig({ withAsserts: "pass" }), ["assert"]));
  assertStrictEquals(code, 0);
  assert(out.join("\n").includes("ALL PASS"));
});

Deno.test("cli: assert exits 1 on a failure", () => {
  const { code, out } = captureExit(() => runCli(makeConfig({ withAsserts: "fail" }), ["assert"]));
  assertStrictEquals(code, 1);
  assert(out.join("\n").includes("FAIL  conditional"));
});

Deno.test("cli: assert exits 2 when the config has no asserts()", () => {
  const { code, err } = captureExit(() => runCli(makeConfig(), ["assert"]));
  assertStrictEquals(code, 2);
  assert(err.join("\n").includes("No asserts()"));
});

Deno.test("cli: balance prints the metrics report", () => {
  const { out } = captureExit(() => runCli(makeConfig({ withMetrics: true }), ["balance", "4", "100"]));
  const text = out.join("\n");
  assert(text.includes('"seeds": 4'));
  assert(text.includes("row one"));
});

Deno.test("cli: balance exits 2 when the config has no metrics()", () => {
  const { code, err } = captureExit(() => runCli(makeConfig(), ["balance"]));
  assertStrictEquals(code, 2);
  assert(err.join("\n").includes("No metrics()"));
});

Deno.test("cli: run --json emits one parseable object and no human text", () => {
  const { out } = captureExit(() => runCli(makeConfig({ endAt: 5 }), ["run", "7", "50", "--json"]));
  const text = out.join("\n");
  assert(!text.includes("events (last 12)"), "no human text in --json mode");
  const o = JSON.parse(text);
  assertStrictEquals(o.seed, 7);
  assert(typeof o.final.tick === "number" && Array.isArray(o.events));
});

Deno.test("cli: balance --json emits only the summary", () => {
  const { out } = captureExit(() => runCli(makeConfig({ withMetrics: true }), ["balance", "4", "100", "--json"]));
  const o = JSON.parse(out.join("\n"));
  assertStrictEquals(o.seeds, 4);
  assert(out.join("\n").indexOf("row one") === -1, "rows are suppressed in --json mode");
});

Deno.test("cli: fuzz --json reports ok and exits 1 on failure", () => {
  const clean = captureExit(() => runCli(makeConfig({ withInvariants: true }), ["fuzz", "2", "10", "--json"]));
  assertStrictEquals(JSON.parse(clean.out.join("\n")).ok, true);
  const broken = captureExit(() => runCli(makeConfig({ nanAt: 1 }), ["fuzz", "2", "10", "--json"]));
  assertStrictEquals(broken.code, 1);
  const o = JSON.parse(broken.out.join("\n"));
  assertStrictEquals(o.ok, false);
  assert(o.failures.length > 0);
});

Deno.test("cli: assert --json carries the per-assert results", () => {
  const { code, out } = captureExit(() => runCli(makeConfig({ withAsserts: "fail" }), ["assert", "--json"]));
  assertStrictEquals(code, 1);
  const o = JSON.parse(out.join("\n"));
  assertStrictEquals(o.ok, false);
  assert(o.asserts.some((r: { name: string; ok: boolean }) => r.name === "conditional" && !r.ok));
});

Deno.test("cli: unknown command prints usage", () => {
  const { out } = captureExit(() => runCli(makeConfig(), ["frobnicate"]));
  assert(out.join("\n").includes("Usage: simharness"));
});

Deno.test("cli: baseline save + balance --against gates on regression", async () => {
  const dir = await Deno.makeTempDir({ prefix: "simharness-baseline-test-" });
  const cwd = Deno.cwd();
  Deno.chdir(dir);
  try {
    // Save a baseline from a metrics summary of {seeds:4, ticks:100}.
    let r = captureExit(() => runCli(makeConfig({ withMetrics: true }), ["baseline", "save", "b1", "4", "100"]));
    assert(r.out.join("\n").includes("WROTE"));

    // Same inputs => identical summary => within tolerance, no exit.
    r = captureExit(() => runCli(makeConfig({ withMetrics: true }), ["balance", "4", "100", "--against", "b1"]));
    assertStrictEquals(r.code, null);
    assert(r.out.join("\n").includes("OK"));

    // Different seeds => the metric moves far => REGRESSED + exit 1.
    r = captureExit(() => runCli(makeConfig({ withMetrics: true }), ["balance", "40", "100", "--against", "b1"]));
    assertStrictEquals(r.code, 1);
    assert(r.out.join("\n").includes("REGRESSED"));

    // --json emits the diff object.
    r = captureExit(() =>
      runCli(makeConfig({ withMetrics: true }), ["balance", "40", "100", "--against", "b1", "--json"])
    );
    assertStrictEquals(JSON.parse(r.out.join("\n")).regressed, true);

    // A missing baseline exits 2.
    r = captureExit(() => runCli(makeConfig({ withMetrics: true }), ["balance", "--against", "nope"]));
    assertStrictEquals(r.code, 2);
    assert(r.err.join("\n").includes("baseline not found"));
  } finally {
    Deno.chdir(cwd);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cli: baseline requires metrics() and the save subcommand", () => {
  const noMetrics = captureExit(() => runCli(makeConfig(), ["baseline", "save"]));
  assertStrictEquals(noMetrics.code, 2);
  assert(noMetrics.err.join("\n").includes("No metrics()"));
  const badSub = captureExit(() => runCli(makeConfig({ withMetrics: true }), ["baseline", "frobnicate"]));
  assertStrictEquals(badSub.code, 2);
  assert(badSub.err.join("\n").includes("usage: simharness baseline"));
});

Deno.test("cli: snap writes, then matches, then detects a change", async () => {
  const dir = await Deno.makeTempDir({ prefix: "simharness-snap-test-" });
  const cwd = Deno.cwd();
  Deno.chdir(dir);
  try {
    // First run writes the golden.
    let r = captureExit(() => runCli(makeConfig(), ["snap", "1"]));
    assert(r.out.join("\n").includes("WROTE"));

    // Second run with identical output matches.
    r = captureExit(() => runCli(makeConfig(), ["snap", "1"]));
    assert(r.out.join("\n").includes("MATCH"));

    // A different enemy count changes the snapshot => CHANGED + exit 1.
    r = captureExit(() => runCli(makeConfig({ enemies: 7 }), ["snap", "1"]));
    assertStrictEquals(r.code, 1);
    assert(r.out.join("\n").includes("CHANGED"));
  } finally {
    Deno.chdir(cwd);
    await Deno.remove(dir, { recursive: true });
  }
});
