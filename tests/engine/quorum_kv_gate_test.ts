// Phase-0 GATE (#20): prove the universal contract hosts a real non-game system.
//
// The quorum-KV SUT is driven only through the protocol (reset / available_actions
// / act / tick / read_state / history). Four claims, together, are the go/no-go:
//   1. SAFETY: the quorum invariant holds across many seeds under a lossy,
//      reordering network.
//   2. TEETH: with the quorum removed (W=R=1), the same checker catches stale
//      reads, so claim 1 is not vacuous.
//   3. LIVENESS sanity: reads and writes actually complete, so the sweep is not
//      passing because nothing happened.
//   4. DETERMINISM: one seed yields one history and one snapshot, byte for byte.
// Plus: the same SUT is hostable over stdio, so the contract, not the language
// or the transport, is what carries it.

import { inProcessChannel } from "../../src/engine/protocol/in_process.ts";
import { connectSubprocess } from "../../src/engine/protocol/stdio.ts";
import type { HistoryEntry, Op, Response, SimState } from "../../src/engine/protocol/types.ts";
import { createRng } from "@0xheartcode/simharness";
import { QuorumKvAdapter, type QuorumKvConfig } from "../../examples/quorum-kv/quorum_kv.ts";
import { checkQuorumInvariants } from "../../examples/quorum-kv/invariants.ts";
import { assert, assertEquals } from "../assert.ts";

interface Driven {
  state: SimState;
  history: HistoryEntry[];
}

/** Unwrap a response, failing loudly on an error response. */
function resultOf(r: Response): unknown {
  assert(r.ok, `expected ok response, got ${JSON.stringify(r)}`);
  return r.result;
}

/** Drive the SUT through the in-process channel with a seeded workload, then drain. */
function driveSync(seed: number, config: QuorumKvConfig, steps: number): Driven {
  const ch = inProcessChannel(new QuorumKvAdapter());
  assert(ch.request("reset", { seed, config }).ok, "reset must succeed");
  const actions = resultOf(ch.request("available_actions")) as string[];
  const driver = createRng(seed ^ 0x9e3779b9);
  for (let i = 0; i < steps; i++) {
    if (driver.bool(0.6)) ch.request("act", { action: driver.pick(actions) });
    ch.request("tick");
  }
  for (let i = 0; i < 30; i++) ch.request("tick"); // drain in-flight messages
  return {
    state: resultOf(ch.request("read_state")) as SimState,
    history: resultOf(ch.request("history")) as HistoryEntry[],
  };
}

function okCounts(history: HistoryEntry[]): { puts: number; gets: number } {
  let puts = 0, gets = 0;
  for (const e of history) {
    if (e.kind !== "ok") continue;
    const kind = (e.value as { kind?: string }).kind;
    if (kind === "put") puts++;
    else if (kind === "get") gets++;
  }
  return { puts, gets };
}

Deno.test("gate SAFETY: the quorum invariant holds across seeds under faults", () => {
  let totalPuts = 0, totalGets = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { history } = driveSync(seed, { dropProb: 0.3, maxDelay: 3 }, 120);
    const breaks = checkQuorumInvariants(history);
    assertEquals(breaks, [], `seed ${seed} violated the quorum invariant: ${breaks[0] ?? ""}`);
    const c = okCounts(history);
    totalPuts += c.puts;
    totalGets += c.gets;
  }
  // LIVENESS sanity: the sweep actually exercised completed reads and writes.
  assert(totalPuts > 0, "expected some puts to complete across the sweep");
  assert(totalGets > 0, "expected some gets to complete across the sweep");
});

Deno.test("gate TEETH: without a real quorum (W=R=1) the checker catches stale reads", () => {
  let seedsWithBreaks = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { history } = driveSync(seed, { dropProb: 0.3, maxDelay: 3, w: 1, r: 1 }, 120);
    if (checkQuorumInvariants(history).length > 0) seedsWithBreaks++;
  }
  // If the checker could never fail, claim SAFETY would be meaningless.
  assert(seedsWithBreaks > 0, "removing the quorum should produce stale reads the checker catches");
});

Deno.test("gate DETERMINISM: one seed yields identical history and snapshot", () => {
  const a = driveSync(7, { dropProb: 0.4, maxDelay: 4 }, 150);
  const b = driveSync(7, { dropProb: 0.4, maxDelay: 4 }, 150);
  assertEquals(JSON.stringify(a.history), JSON.stringify(b.history));
  assertEquals(JSON.stringify(a.state), JSON.stringify(b.state));
});

// A fixed script (no driver RNG) so the in-process and stdio runs are identical
// by construction: same seed, same op order.
const SCRIPT: Array<[Op, Record<string, unknown>]> = [
  ["reset", { seed: 7, config: { dropProb: 0.2, maxDelay: 2 } }],
  ["act", { action: "put:x:2" }],
  ["tick", {}],
  ["tick", {}],
  ["act", { action: "get:x" }],
  ["tick", {}],
  ["tick", {}],
  ["tick", {}],
  ["act", { action: "put:y:3" }],
  ["tick", {}],
  ["tick", {}],
  ["tick", {}],
  ["act", { action: "get:y" }],
  ["tick", {}],
  ["tick", {}],
  ["tick", {}],
];

const STDIO_ENTRY = new URL("../../examples/quorum-kv/quorum_kv_stdio.ts", import.meta.url).href;

Deno.test("gate TRANSPORT: the quorum-KV SUT is hostable over stdio, same answers as in-process", async () => {
  // In-process reference.
  const ch = inProcessChannel(new QuorumKvAdapter());
  for (const [op, args] of SCRIPT) ch.request(op, args);
  const refState = resultOf(ch.request("read_state"));
  const refHist = resultOf(ch.request("history"));

  // Same script over a real child process.
  const sub = connectSubprocess(Deno.execPath(), ["run", STDIO_ENTRY]);
  try {
    for (const [op, args] of SCRIPT) {
      const r = await sub.client.request(op, args);
      assert(r.ok, `stdio op ${op} failed`);
    }
    const state = resultOf(await sub.client.request("read_state"));
    const hist = resultOf(await sub.client.request("history"));
    assertEquals(JSON.stringify(state), JSON.stringify(refState));
    assertEquals(JSON.stringify(hist), JSON.stringify(refHist));
  } finally {
    await sub.close();
  }
});
