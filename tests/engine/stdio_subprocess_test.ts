// The stdio transport against a real child process: spawn the echo adapter with
// the deno binary and drive it as a black box. The in-memory test already
// proves the framing and dispatch; this proves the actual pipe wiring, and that
// a child reached over stdin/stdout gives the same answers as the in-process
// path.

import { connectSubprocess } from "../../src/engine/protocol/stdio.ts";
import { inProcessChannel } from "../../src/engine/protocol/in_process.ts";
import type { Response } from "../../src/engine/protocol/types.ts";
import { EchoAdapter } from "../../examples/echo/echo_adapter.ts";
import { assert, assertEquals } from "../assert.ts";

const ENTRY = new URL("../../examples/echo/echo_stdio.ts", import.meta.url).href;

function payload(r: Response): unknown {
  return r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error };
}

Deno.test("stdio subprocess: a black-box echo adapter matches the in-process one", async () => {
  const sub = connectSubprocess(Deno.execPath(), ["run", ENTRY]);
  try {
    const hello = await sub.client.request("hello", { protocol: 0 });
    assert(hello.ok);
    assertEquals((hello.result as { name: string }).name, "echo");

    await sub.client.request("reset", { seed: 11 });
    await sub.client.request("act", { action: "ping" });
    const state = await sub.client.request("read_state");

    // The in-process reference, same sequence.
    const ch = inProcessChannel(new EchoAdapter());
    ch.request("reset", { seed: 11 });
    ch.request("act", { action: "ping" });
    const ref = ch.request("read_state");

    assertEquals(payload(state), payload(ref));
    assertEquals(state.ok && state.result, { tick: 0, phase: "running", extra: { seed: 11, last: "ping" } });
  } finally {
    await sub.close();
  }
});
