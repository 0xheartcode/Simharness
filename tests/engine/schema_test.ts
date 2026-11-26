// Guards the stdio envelope schema against drift: the JSON Schema parses, and
// real responses from `dispatch` carry exactly the envelope keys the schema
// requires. This is a structural check, not a full JSON Schema validator; it
// exists so a change to the envelope shape that forgets the schema fails here.

import { dispatch } from "../../src/engine/protocol/dispatch.ts";
import { PROTOCOL_VERSION } from "../../src/engine/protocol/types.ts";
import { EchoAdapter } from "../../examples/echo/echo_adapter.ts";
import { assert, assertEquals } from "../assert.ts";

const schema = JSON.parse(
  await Deno.readTextFile(new URL("../../src/engine/protocol/protocol-v0.schema.json", import.meta.url)),
);

function required(defName: string): string[] {
  return schema.$defs[defName].required as string[];
}

Deno.test("schema: parses and pins the protocol version and ops", () => {
  assert(schema.$defs.request.properties.v.const === PROTOCOL_VERSION);
  const ops = schema.$defs.op.enum as string[];
  assertEquals(ops.includes("hello") && ops.includes("bye"), true);
});

Deno.test("schema: an ok response carries exactly the okResponse keys", () => {
  const r = dispatch(new EchoAdapter(), { v: PROTOCOL_VERSION, id: 1, op: "read_state", args: {} });
  assertEquals(Object.keys(r).sort(), required("okResponse").sort());
});

Deno.test("schema: an error response carries the errResponse keys with a known code", () => {
  const r = dispatch(new EchoAdapter(), { v: PROTOCOL_VERSION, id: 1, op: "deliver", args: { message: {} } });
  assertEquals(Object.keys(r).sort(), required("errResponse").sort());
  assert(!r.ok);
  assertEquals((schema.$defs.errorCode.enum as string[]).includes(r.error.code), true);
});
