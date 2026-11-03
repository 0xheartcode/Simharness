import * as api from "@0xheartcode/simharness";
import { assert } from "./assert.ts";

Deno.test("index: the public API surface is exported", () => {
  for (const name of ["run", "autoplay", "fuzz", "strategies", "runCli"]) {
    assert(name in api, `missing export: ${name}`);
  }
  assert(typeof api.run === "function");
  assert(typeof api.strategies.aggressive === "function");
});
