// Cross-language conformance (#40). The golden fixture is generated from the
// TypeScript echo adapter (the reference). This locks the TS output to it, and,
// when the Rust echo binary has been built, drives that binary over stdio and
// checks it produces semantically identical responses. JSON object key order is
// not semantically meaningful (Rust's serde_json sorts keys), so the live
// comparison is structural, via snapshotEqual.

import { dispatch } from "../../src/engine/protocol/dispatch.ts";
import { connectSubprocess } from "../../src/engine/protocol/stdio.ts";
import type { Op, Request, Response } from "../../src/engine/protocol/types.ts";
import { snapshotEqual } from "../../src/engine/core/snapshot.ts";
import { EchoAdapter } from "../../examples/echo/echo_adapter.ts";
import { assert, assertEquals } from "../assert.ts";

interface Pair {
  request: Request & { op: Op };
  response: Response;
}

const GOLDEN: Pair[] = JSON.parse(
  await Deno.readTextFile(new URL("../../conformance/echo-golden.json", import.meta.url)),
);

Deno.test("conformance: the TS echo adapter matches the golden fixture", () => {
  const echo = new EchoAdapter();
  for (const pair of GOLDEN) {
    assertEquals(dispatch(echo, pair.request), pair.response, `id ${pair.request.id}`);
  }
  assert(GOLDEN.length > 0);
});

const RUST_ECHO = new URL("../../rs/target/release/simharness-echo", import.meta.url).pathname;

function rustBinaryExists(): boolean {
  try {
    return Deno.statSync(RUST_ECHO).isFile;
  } catch {
    return false;
  }
}

Deno.test({
  name: "conformance: the Rust echo binary matches the golden fixture over stdio",
  ignore: !rustBinaryExists(),
  fn: async () => {
    const sub = connectSubprocess(RUST_ECHO, [], { timeoutMs: 5000 });
    try {
      // The client always sends the current envelope version, so the deliberate
      // v:1 envelope-mismatch pair cannot be driven here; the Rust cargo test
      // covers that one by replaying the exact request. All others are v:0 and
      // do not change state when they error, so the sequence state still lines up.
      for (const pair of GOLDEN.filter((p) => p.request.v === 0)) {
        const { op, args } = pair.request;
        const got = await sub.client.request(op, args);
        // The id is assigned by the client, so compare the payload, not the id.
        const gotPayload = got.ok ? { ok: true, result: got.result } : { ok: false, error: got.error };
        const wantPayload = pair.response.ok
          ? { ok: true, result: pair.response.result }
          : { ok: false, error: pair.response.error };
        assert(
          snapshotEqual(gotPayload, wantPayload),
          `rust response differs for op ${op} (id ${pair.request.id}): got ${JSON.stringify(gotPayload)}`,
        );
      }
    } finally {
      await sub.close();
    }
  },
});
