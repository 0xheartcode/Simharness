// #33: each subcommand works against a cluster scenario; fuzz returns nonzero
// with the offending seed when an invariant breaks; replay and snap are
// deterministic.

import { runCli } from "../../src/engine/cli/cli.ts";
import { gossipScenario } from "../../examples/gossip-register/scenario.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";
import { captureConsole } from "../assert.ts";

function cli(argv: string[], buggy = false): { code: number; out: string } {
  let code = -999;
  const { out } = captureConsole(() => {
    code = runCli(argv, gossipScenario({ buggy }));
  });
  return { code, out: out.join("\n") };
}

Deno.test("cli run: reports a clean run as exit 0", () => {
  const r = cli(["run", "1", "--ticks", "100"]);
  assertStrictEquals(r.code, 0);
  assert(r.out.includes("invariants OK"), r.out);
});

Deno.test("cli fuzz: a correct scenario passes across seeds (exit 0)", () => {
  const r = cli(["fuzz", "--seeds", "25", "--ticks", "120"]);
  assertStrictEquals(r.code, 0);
  assert(r.out.includes("no invariant violated"), r.out);
});

Deno.test("cli fuzz: the buggy scenario fails with the offending seed (exit 1)", () => {
  const r = cli(["fuzz", "--seeds", "25", "--ticks", "120"], true);
  assertStrictEquals(r.code, 1);
  assert(/FAIL seed=\d+/.test(r.out), r.out);
  assert(r.out.includes("reproduce with: replay"), r.out);
});

Deno.test("cli assert: exit 0 on a clean seed, exit 1 on the buggy one", () => {
  assertStrictEquals(cli(["assert", "2", "--ticks", "150"]).code, 0);
  // find a seed the buggy node breaks on, via fuzz output
  const fuzz = cli(["fuzz", "--seeds", "25", "--ticks", "120"], true);
  const seed = fuzz.out.match(/FAIL seed=(\d+)/)?.[1];
  assert(seed !== undefined);
  assertStrictEquals(cli(["assert", seed!, "--ticks", "120"], true).code, 1);
});

Deno.test("cli replay: deterministic, and prints the fault schedule", () => {
  const r = cli(["replay", "3", "--ticks", "100", "--profile", "reorg-storm"]);
  assertStrictEquals(r.code, 0);
  assert(r.out.includes("deterministic=yes"), r.out);
  assert(r.out.includes("fault schedule"), r.out);
});

Deno.test("cli snap: byte-stable across runs of the same seed", () => {
  const a = cli(["snap", "7", "--ticks", "80"]);
  const b = cli(["snap", "7", "--ticks", "80"]);
  assertStrictEquals(a.code, 0);
  assertStrictEquals(a.out, b.out);
});

Deno.test("cli metrics and json run produce machine-readable output", () => {
  const m = cli(["metrics", "--seeds", "10", "--ticks", "60", "--json"]);
  assertStrictEquals(m.code, 0);
  const parsed = JSON.parse(m.out);
  assertStrictEquals(parsed.seeds, 10);

  const run = cli(["run", "1", "--ticks", "50", "--json"]);
  assertEquals(JSON.parse(run.out).cmd, "run");
});

Deno.test("cli explain: emits a self-contained failure report on a failing seed", () => {
  // find a failing seed for the buggy scenario
  const fuzz = cli(["fuzz", "--seeds", "25", "--ticks", "120"], true);
  const seed = fuzz.out.match(/FAIL seed=(\d+)/)?.[1];
  assert(seed !== undefined);
  const r = cli(["explain", seed!, "--ticks", "120"], true);
  assertStrictEquals(r.code, 1);
  assert(r.out.includes("failure report"), r.out);
  assert(r.out.includes("minimal fault schedule"), r.out);
  assert(r.out.includes("event log"), r.out);
  assert(r.out.includes("reproduce:"), r.out);
});

Deno.test("cli explain: a clean seed has nothing to explain (exit 0)", () => {
  const r = cli(["explain", "2", "--ticks", "100"]);
  assertStrictEquals(r.code, 0);
  assert(r.out.includes("clean:"), r.out);
});

Deno.test("cli fuzz --json: a failure is a stable, versioned envelope an agent can parse", () => {
  const r = cli(["fuzz", "--seeds", "25", "--ticks", "120", "--json"], true);
  assertStrictEquals(r.code, 1);
  const env = JSON.parse(r.out);
  assertStrictEquals(env.v, 1);
  assertStrictEquals(env.report, "fuzz-failure");
  assertStrictEquals(env.mode, "seeded");
  assertStrictEquals(typeof env.seed, "number");
  assert(typeof env.invariant === "string" && env.invariant.length > 0, r.out);
  // the shrink fields are always present (null when nothing is essential), so the shape is stable
  assert("minimalSchedule" in env && "essentialFaults" in env && "totalFaults" in env, r.out);
  assert(env.reproduce.startsWith(`explain ${env.seed} `), env.reproduce);
});

Deno.test("cli fuzz --json: a clean run is a fuzz-pass envelope (exit 0)", () => {
  const r = cli(["fuzz", "--seeds", "25", "--ticks", "120", "--json"]);
  assertStrictEquals(r.code, 0);
  const env = JSON.parse(r.out);
  assertStrictEquals(env.v, 1);
  assertStrictEquals(env.report, "fuzz-pass");
  assertStrictEquals(env.seeds, 25);
});

Deno.test("cli explain --json: the full failure report as one structured envelope", () => {
  const fuzz = cli(["fuzz", "--seeds", "25", "--ticks", "120", "--json"], true);
  const seed = JSON.parse(fuzz.out).seed as number;
  const r = cli(["explain", String(seed), "--ticks", "120", "--json"], true);
  assertStrictEquals(r.code, 1);
  const env = JSON.parse(r.out);
  assertStrictEquals(env.v, 1);
  assertStrictEquals(env.report, "failure");
  assertStrictEquals(env.seed, seed);
  assert(typeof env.invariant === "string" && env.invariant.length > 0, r.out);
  assert(Array.isArray(env.events) && env.events.length === env.eventsShown, r.out);
  assertStrictEquals(typeof env.eventsTotal, "number");
  assert(env.reproduce.startsWith(`explain ${seed} `), env.reproduce);
});

Deno.test("cli explain --json: a clean seed is a clean envelope (exit 0)", () => {
  const r = cli(["explain", "2", "--ticks", "100", "--json"]);
  assertStrictEquals(r.code, 0);
  const env = JSON.parse(r.out);
  assertStrictEquals(env.v, 1);
  assertStrictEquals(env.report, "clean");
});

Deno.test("cli: an unknown command prints usage and exits 2", () => {
  const r = cli(["wat"]);
  assertStrictEquals(r.code, 2);
  assert(r.out.includes("usage:"), r.out);
});
