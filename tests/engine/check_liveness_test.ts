// #36: a correct cluster converges after a partition heals; a wedged one that
// cannot re-sync trips the liveness assert.

import { allAgree, runLiveness } from "../../src/engine/check/liveness.ts";
import { gossipScenario } from "../../examples/gossip-register/scenario.ts";
import { assert, assertStrictEquals } from "../assert.ts";

Deno.test("runLiveness: a correct gossip cluster converges after heal", () => {
  const r = runLiveness(gossipScenario(), {
    seed: 1,
    faultTicks: 120,
    healBound: 80,
    profile: "partition-heavy",
  });
  assert(r.converged, `expected convergence after heal, used ${r.healTicks} recovery ticks`);
});

Deno.test("runLiveness: a wedged (silent) cluster fails to converge within the bound", () => {
  const r = runLiveness(gossipScenario({ silent: true }), {
    seed: 1,
    faultTicks: 120,
    healBound: 80,
    profile: "partition-heavy",
  });
  assertStrictEquals(r.converged, false);
});

Deno.test("runLiveness: the same seed gives the same liveness outcome", () => {
  const cfg = { seed: 5, faultTicks: 100, healBound: 60 } as const;
  const a = runLiveness(gossipScenario(), cfg);
  const b = runLiveness(gossipScenario(), cfg);
  assertStrictEquals(a.converged, b.converged);
  assertStrictEquals(a.convergeTick, b.convergeTick);
});

Deno.test("allAgree: true only when every node holds equal state", () => {
  assertStrictEquals(allAgree({ a: { v: 1 }, b: { v: 1 } }), true);
  assertStrictEquals(allAgree({ a: { v: 1 }, b: { v: 2 } }), false);
  assertStrictEquals(allAgree({ a: 1 }), true);
});
