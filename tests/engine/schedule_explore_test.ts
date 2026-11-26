// #41 integrated: the interleaving explorer finds an order-dependent bug (a
// withdraw lost to withdraw-before-deposit delivery) that the default send order
// and random seeds both miss, and the counterexample path replays.

import { exploreSchedules, orderingsOf, replaySchedule } from "../../src/engine/check/schedule_explore.ts";
import { checkInvariants, runScenario } from "../../src/engine/cli/scenario.ts";
import { runCli } from "../../src/engine/cli/cli.ts";
import type { DueMessage } from "../../src/engine/sim/network.ts";
import { bankScenario } from "../../examples/bank/scenario.ts";
import { assert, assertEquals, assertStrictEquals, captureConsole } from "../assert.ts";

function due(to: string, seq: number): DueMessage {
  return { from: "x", to, kind: "m", seq };
}

Deno.test("orderingsOf: reorders only same-recipient messages", () => {
  assertStrictEquals(orderingsOf([due("a", 0), due("b", 1)]).length, 1); // cross-recipient is independent
  assertStrictEquals(orderingsOf([due("a", 0), due("a", 1)]).length, 2); // same recipient interleaves
  assertStrictEquals(orderingsOf([due("a", 0), due("a", 1), due("b", 2)]).length, 2);
  assertEquals(orderingsOf([due("a", 0), due("a", 1)]), [[0, 1], [1, 0]]); // send order first
});

Deno.test("bank: the default send order satisfies the invariant", () => {
  const breaks = checkInvariants(bankScenario(), runScenario(bankScenario(), { seed: 1, ticks: 4, profile: "quiet" }));
  assertEquals(breaks, []);
});

Deno.test("bank: random seeds do not find the order-dependent bug", () => {
  const scenario = bankScenario();
  for (let seed = 0; seed < 25; seed++) {
    const run = runScenario(scenario, { seed, ticks: 4, profile: "quiet" });
    assertEquals(checkInvariants(scenario, run), [], `seed ${seed} unexpectedly broke`);
  }
});

Deno.test("exploreSchedules: finds the withdraw-before-deposit reordering", () => {
  const scenario = bankScenario();
  const result = exploreSchedules(scenario, { seed: 1, ticks: 4, profile: "quiet" });
  assert(result.violation !== null, "the explorer must find the order-dependent bug");
  assert(result.violation.breaks[0].includes("net to zero"));
  // the counterexample path reproduces the violation
  assert(replaySchedule(scenario, { seed: 1, ticks: 4, profile: "quiet", path: result.violation.path }).length > 0);
});

Deno.test("exploreSchedules: is deterministic and reports an exhausted-clean space", () => {
  const a = exploreSchedules(bankScenario(), { seed: 1, ticks: 4, profile: "quiet" });
  const b = exploreSchedules(bankScenario(), { seed: 1, ticks: 4, profile: "quiet" });
  assertEquals(a.violation?.path, b.violation?.path);
  assertEquals(a.runs, b.runs);
});

Deno.test("cli explore: reports the reordering violation and exits 1", () => {
  let code = -1;
  const { out } = captureConsole(() => {
    code = runCli(["explore", "1", "--ticks", "4"], bankScenario());
  });
  assertStrictEquals(code, 1);
  const text = out.join("\n");
  assert(text.includes("delivery order breaks an invariant"), text);
  assert(text.includes("reproduce path:"), text);
});
