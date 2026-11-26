// Protocol v0 conformance, in memory: dispatch semantics, the in-process
// channel, and a full line-protocol round-trip wired over paired string
// streams. The headline test drives the same request sequence through both
// transports and asserts identical responses, which is what "both transports
// carry the same operations with the same shapes" has to mean concretely.

import { dispatch } from "../../src/engine/protocol/dispatch.ts";
import { inProcessChannel } from "../../src/engine/protocol/in_process.ts";
import { encodeLine, LineClient, runLineServer, toLineStream } from "../../src/engine/protocol/lines.ts";
import type { Adapter } from "../../src/engine/protocol/adapter.ts";
import {
  type Capabilities,
  type HistoryEntry,
  isOk,
  type Message,
  type Op,
  PROTOCOL_VERSION,
  type Request,
  type Response,
  type SimState,
} from "../../src/engine/protocol/types.ts";
import { EchoAdapter } from "../../examples/echo/echo_adapter.ts";
import { assert, assertEquals, assertStrictEquals } from "../assert.ts";

/** A fixture that implements every optional op, to exercise the phase-2/4 dispatch branches. */
class FullAdapter implements Adapter {
  ticks = 0;
  delivered: Message[] = [];
  outbox: Message[] = [{ from: "a", to: "b", kind: "ping", payload: { n: 1 } }];
  hist: HistoryEntry[] = [{ kind: "invoke", client: "c1", op: "write", value: 1, tick: 0 }];
  hello(): Capabilities {
    return {
      name: "full",
      protocol: 0,
      supportsActions: true,
      supportsNetwork: true,
      supportsStorage: true,
      supportsByteNetwork: false,
      deterministicConcurrency: true,
    };
  }
  reset(): void {
    this.ticks = 0;
  }
  readState(): SimState {
    return { tick: this.ticks, phase: "running", extra: {} };
  }
  tick(): void {
    this.ticks += 1;
  }
  availableActions(): readonly string[] {
    return ["x"];
  }
  act(): void {}
  deliver(m: Message): void {
    this.delivered.push(m);
  }
  drainOutbox(): Message[] {
    const o = this.outbox;
    this.outbox = [];
    return o;
  }
  history(): HistoryEntry[] {
    return this.hist;
  }
  snapshot(): unknown {
    return { ticks: this.ticks };
  }
  bye(): void {}
}

function req(id: number, op: Op, args: Record<string, unknown> = {}): Request {
  return { v: PROTOCOL_VERSION, id, op, args };
}

/** Drop the envelope fields that are transport bookkeeping, keep the payload. */
function payload(r: Response): unknown {
  return r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error };
}

Deno.test("dispatch: hello returns the adapter capabilities", () => {
  const r = dispatch(new EchoAdapter(), req(1, "hello", { protocol: 0 }));
  assert(r.ok);
  assertEquals(r.result, {
    name: "echo",
    protocol: 0,
    supportsActions: true,
    supportsNetwork: false,
    supportsStorage: false,
    supportsByteNetwork: false,
    deterministicConcurrency: true,
  });
});

Deno.test("dispatch: a wrong envelope version is a protocol_mismatch", () => {
  const r = dispatch(new EchoAdapter(), { v: 1, id: 2, op: "hello", args: {} });
  assert(!r.ok);
  assertStrictEquals(r.error.code, "protocol_mismatch");
});

Deno.test("dispatch: hello with a mismatched protocol arg is rejected", () => {
  const r = dispatch(new EchoAdapter(), req(3, "hello", { protocol: 9 }));
  assert(!r.ok);
  assertStrictEquals(r.error.code, "protocol_mismatch");
});

Deno.test("dispatch: reset requires a finite numeric seed", () => {
  const bad = dispatch(new EchoAdapter(), req(4, "reset", { seed: "nope" }));
  assert(!bad.ok);
  assertStrictEquals(bad.error.code, "bad_args");
  const good = dispatch(new EchoAdapter(), req(5, "reset", { seed: 7 }));
  assert(good.ok);
});

Deno.test("dispatch: reset rejects a non-object config", () => {
  const r = dispatch(new EchoAdapter(), req(6, "reset", { seed: 1, config: 5 }));
  assert(!r.ok);
  assertStrictEquals(r.error.code, "bad_args");
});

Deno.test("dispatch: act is reflected in read_state", () => {
  const a = new EchoAdapter();
  dispatch(a, req(1, "reset", { seed: 3 }));
  dispatch(a, req(2, "act", { action: "ping" }));
  const r = dispatch(a, req(3, "read_state"));
  assert(r.ok);
  assertEquals(r.result, { tick: 0, phase: "running", extra: { seed: 3, last: "ping" } });
});

Deno.test("dispatch: act with a non-string action is bad_args", () => {
  const r = dispatch(new EchoAdapter(), req(1, "act", { action: 42 }));
  assert(!r.ok);
  assertStrictEquals(r.error.code, "bad_args");
});

Deno.test("dispatch: an op the adapter does not implement is unsupported", () => {
  // EchoAdapter has no deliver (supportsNetwork=false).
  const r = dispatch(new EchoAdapter(), req(1, "deliver", { message: { from: "a", to: "b", kind: "x", payload: {} } }));
  assert(!r.ok);
  assertStrictEquals(r.error.code, "unsupported");
});

Deno.test("dispatch: bye is always ok, even without a bye method", () => {
  const r = dispatch(new EchoAdapter(), req(1, "bye"));
  assert(r.ok);
  assertStrictEquals(r.result, null);
});

Deno.test("dispatch: a throwing adapter becomes a sut_error, not a crash", () => {
  const throwing = new EchoAdapter();
  throwing.readState = () => {
    throw new Error("boom");
  };
  const r = dispatch(throwing, req(1, "read_state"));
  assert(!r.ok);
  assertStrictEquals(r.error.code, "sut_error");
  assertStrictEquals(r.error.message, "boom");
});

Deno.test("dispatch: tick advances state when the adapter supports it", () => {
  const a = new FullAdapter();
  assert(isOk(dispatch(a, req(1, "tick"))));
  assert(isOk(dispatch(a, req(2, "tick"))));
  const r = dispatch(a, req(3, "read_state"));
  assert(isOk(r));
  assertStrictEquals((r.result as SimState).tick, 2);
});

Deno.test("dispatch: the phase-2/4 ops round-trip through a full adapter", () => {
  const a = new FullAdapter();
  const msg = { message: { from: "x", to: "y", kind: "k", payload: { v: 2 } } };
  assert(isOk(dispatch(a, req(1, "deliver", msg))));
  assertStrictEquals(a.delivered.length, 1);

  const out = dispatch(a, req(2, "drain_outbox"));
  assert(isOk(out));
  assertEquals(out.result, [{ from: "a", to: "b", kind: "ping", payload: { n: 1 } }]);

  const hist = dispatch(a, req(3, "history"));
  assert(isOk(hist));
  assertEquals(hist.result, [{ kind: "invoke", client: "c1", op: "write", value: 1, tick: 0 }]);

  const snap = dispatch(a, req(4, "snapshot"));
  assert(isOk(snap));
  assertEquals(snap.result, { ticks: 0 });

  const bye = dispatch(a, req(5, "bye"));
  assert(isOk(bye));
});

Deno.test("dispatch: deliver with a non-object message is bad_args", () => {
  const r = dispatch(new FullAdapter(), req(1, "deliver", { message: "nope" }));
  assert(!r.ok);
  assertStrictEquals(r.error.code, "bad_args");
});

Deno.test("in-process channel: assigns increasing ids and drives a run", () => {
  const ch = inProcessChannel(new EchoAdapter());
  const a = ch.request("reset", { seed: 2 });
  const b = ch.request("act", { action: "pong" });
  const c = ch.request("read_state");
  assertStrictEquals(a.id, 1);
  assertStrictEquals(b.id, 2);
  assertStrictEquals(c.id, 3);
  assert(c.ok);
  assertEquals(c.result, { tick: 0, phase: "running", extra: { seed: 2, last: "pong" } });
});

Deno.test("encodeLine: one JSON value, newline-terminated, no embedded newline", () => {
  const line = encodeLine({ v: 0, id: 1, op: "read_state", args: {} });
  assertStrictEquals(line.endsWith("\n"), true);
  assertStrictEquals(line.slice(0, -1).includes("\n"), false);
  assertEquals(JSON.parse(line), { v: 0, id: 1, op: "read_state", args: {} });
});

Deno.test("toLineStream: reassembles lines split across byte chunks", async () => {
  const enc = new TextEncoder();
  const chunks = ['{"a":1}\n{"b":', '2}\n{"c":3}', "\n"].map((s) => enc.encode(s));
  const bytes = ReadableStream.from(chunks);
  const lines: string[] = [];
  for await (const line of toLineStream(bytes)) lines.push(line);
  assertEquals(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

Deno.test("toLineStream: flushes a trailing line with no final newline", async () => {
  const bytes = ReadableStream.from([new TextEncoder().encode('{"a":1}')]);
  const lines: string[] = [];
  for await (const line of toLineStream(bytes)) lines.push(line);
  assertEquals(lines, ['{"a":1}']);
});

Deno.test("line protocol: a full round-trip matches the in-process transport exactly", async () => {
  const sequence: Array<[Op, Record<string, unknown>]> = [
    ["hello", { protocol: 0 }],
    ["reset", { seed: 11 }],
    ["available_actions", {}],
    ["act", { action: "ping" }],
    ["read_state", {}],
    ["deliver", { message: { from: "a", to: "b", kind: "x", payload: {} } }], // unsupported
    ["bye", {}],
  ];

  // In-process reference.
  const ch = inProcessChannel(new EchoAdapter());
  const inProc = sequence.map(([op, args]) => payload(ch.request(op, args)));

  // Same sequence over the line protocol, wired client <-> server in memory.
  const c2s = new TransformStream<string, string>();
  const s2c = new TransformStream<string, string>();
  const serverDone = runLineServer(new EchoAdapter(), c2s.readable, s2c.writable);
  const client = new LineClient(s2c.readable, c2s.writable);

  const overLine: unknown[] = [];
  for (const [op, args] of sequence) {
    overLine.push(payload(await client.request(op, args)));
  }
  await client.close();
  await serverDone;

  assertEquals(overLine, inProc);
  // And spot-check the content, so an all-wrong-both-ways bug cannot pass.
  assertEquals((inProc[4] as { result: unknown }).result, {
    tick: 0,
    phase: "running",
    extra: { seed: 11, last: "ping" },
  });
});

Deno.test("line protocol: a line that is not JSON gets a bad_args response", async () => {
  const requestLines = ["this is not json", JSON.stringify({ v: 0, id: 2, op: "read_state", args: {} })];
  const outLines: string[] = [];
  const input = ReadableStream.from(requestLines);
  const output = new WritableStream<string>({
    write(chunk) {
      outLines.push(chunk);
    },
  });
  await runLineServer(new EchoAdapter(), input, output);

  const responses = outLines.map((l) => JSON.parse(l) as Response);
  assert(!responses[0].ok);
  assertStrictEquals(responses[0].error.code, "bad_args");
  assert(responses[1].ok);
});
