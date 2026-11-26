// #25: one seeded entropy source gives identical streams and ids on replay, and
// a fitness check proves there is zero unseeded entropy anywhere in the engine core.

import { createEntropy, IdGen } from "../../src/engine/core/entropy.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

Deno.test("IdGen: positional, strictly increasing, replay-stable ids", () => {
  const a = new IdGen("node");
  assertEquals([a.next(), a.next(), a.next()], ["node-0", "node-1", "node-2"]);
  assertStrictEquals(a.count, 3);
  const b = new IdGen("node");
  assertStrictEquals(b.next(), "node-0"); // a fresh generator restarts identically
});

Deno.test("createEntropy: the same seed yields identical rng draws and ids", () => {
  function sample(seed: number): { nums: number[]; ids: string[] } {
    const e = createEntropy(seed, "p");
    const nums = [e.rng.next(), e.rng.int(100), e.rng.range(0, 1)];
    const ids = [e.ids.next(), e.ids.next()];
    return { nums, ids };
  }
  assertEquals(sample(42), sample(42));
});

Deno.test("createEntropy: different seeds diverge in the rng stream", () => {
  const a = createEntropy(1);
  const b = createEntropy(2);
  // Not a strict guarantee for a single draw, but mulberry32 differs immediately here.
  assert(a.rng.next() !== b.rng.next());
});

Deno.test("fitness: no unseeded entropy anywhere in src/engine", async () => {
  const forbidden = [
    "Math.random",
    "Date.now",
    "performance.now",
    "crypto.randomUUID",
    "crypto.getRandomValues",
  ];
  const offenders: string[] = [];

  async function scan(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        await scan(path);
      } else if (entry.name.endsWith(".ts")) {
        const raw = await Deno.readTextFile(path);
        // Strip comments so documentation that NAMES a forbidden call (as this
        // very test file's docs do) is not mistaken for a use of it.
        const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
        for (const token of forbidden) {
          if (code.includes(token)) offenders.push(`${path}: ${token}`);
        }
      }
    }
  }

  const root = new URL("../../src/engine", import.meta.url);
  await scan(root.pathname);
  assertEquals(offenders, [], `unseeded entropy in core: ${offenders.join(", ")}`);
});
