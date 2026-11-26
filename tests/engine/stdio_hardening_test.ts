// #45: the stdio transport fails loud instead of hanging on a wedged child, and
// surfaces a crashed child's stderr and exit code for diagnosis.

import { connectSubprocess } from "../../src/engine/protocol/stdio.ts";
import { assert, assertStrictEquals } from "../assert.ts";

const HANG = new URL("./fixtures/hang_stdio.ts", import.meta.url).href;
const CRASH = new URL("./fixtures/crash_stdio.ts", import.meta.url).href;

Deno.test("stdio: a hung child times out instead of blocking forever", async () => {
  const sub = connectSubprocess(Deno.execPath(), ["run", HANG], { timeoutMs: 300 });
  try {
    const r = await sub.client.request("hello", { protocol: 0 });
    assert(!r.ok);
    assertStrictEquals(r.error.code, "sut_error");
    assert(String(r.error.reason).includes("timed out"));
  } finally {
    await sub.close();
  }
});

Deno.test("stdio: a crashed child surfaces its stderr and a nonzero exit", async () => {
  const sub = connectSubprocess(Deno.execPath(), ["run", CRASH]);
  // The child exits before replying, so the request fails rather than hanging.
  const r = await sub.client.request("hello", { protocol: 0 });
  assert(!r.ok);
  const status = await sub.close();
  assertStrictEquals(status.code, 3);
  assert(sub.stderr().includes("boom"), sub.stderr());
});
