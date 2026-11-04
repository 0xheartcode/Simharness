// A simharness config for a non-spatial, action-driven sim. Exercises the whole
// non-action path: invariants (checked by `fuzz` and `check`), asserts, and
// balance metrics, all driven through the discrete-action seam via
// `randomActionPolicy`. Run from this directory:
//   ../../dist/simharness fuzz 8 400        # samples the action space, reports coverage
//   ../../dist/simharness check 8 400        # invariants across seeds (deterministic)
//   ../../dist/simharness assert
//   ../../dist/simharness balance 8 400
import type { SimharnessConfig } from "@0xheartcode/simharness/config";
import type { GameState } from "@0xheartcode/simharness/adapter";
import { createRng, randomActionPolicy, run, summarize } from "@0xheartcode/simharness";
import { type EcoExtra, EconomyAdapter } from "./economy_adapter.ts";

function invariants(s: GameState<EcoExtra>): string[] {
  const breaks: string[] = [];
  if (s.extra.gold < 0) breaks.push("gold negative");
  if (s.extra.wood < 0) breaks.push("wood negative");
  if (s.extra.planks < 0) breaks.push("planks negative");
  return breaks;
}

const config: SimharnessConfig<EcoExtra> = {
  createAdapter: () => new EconomyAdapter(),
  invariants,
  asserts: (a) => {
    const r = run(a, {
      seed: 1,
      ticks: 300,
      stopOnEnd: false,
      actionPolicy: randomActionPolicy(createRng(1)),
      invariants,
    });
    return [
      {
        name: "resources stay non-negative under random actions",
        ok: r.invariantBreaks.length === 0,
        msg: r.invariantBreaks.join(", ") || "clean",
      },
      {
        name: "gold is earned over 300 ticks",
        ok: (r.final.extra.gold as number) > 0,
        msg: `gold=${r.final.extra.gold}`,
      },
    ];
  },
  metrics: (a, { seeds, ticks }) => {
    const golds: number[] = [];
    const rows: string[] = [];
    for (let i = 0; i < seeds; i++) {
      const r = run(a, { seed: i, ticks, stopOnEnd: false, actionPolicy: randomActionPolicy(createRng(i)) });
      const g = r.final.extra.gold as number;
      golds.push(g);
      rows.push(`seed ${i}: gold ${g}, sold ${r.final.extra.sold}`);
    }
    const s = summarize(golds);
    return { summary: { seeds, meanGold: s.mean, maxGold: s.max, minGold: s.min }, rows };
  },
};

export default config;
