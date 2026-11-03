import { loadConfig, main } from "../src/main.ts";
import { VERSION } from "../src/version.ts";
import { assert, assertStrictEquals } from "./assert.ts";

const EXAMPLE_DIR = new URL("../examples/chase", import.meta.url).pathname;

Deno.test("main: --version prints the version and returns 0", async () => {
  const log = console.log;
  const out: string[] = [];
  console.log = (...a: unknown[]) => out.push(a.map(String).join(" "));
  try {
    assertStrictEquals(await main(["--version"]), 0);
  } finally {
    console.log = log;
  }
  assertStrictEquals(out[0], VERSION);
});

Deno.test("main: --help returns 0, no args returns 1", async () => {
  const log = console.log;
  console.log = () => {};
  try {
    assertStrictEquals(await main(["--help"]), 0);
    assertStrictEquals(await main([]), 1);
  } finally {
    console.log = log;
  }
});

Deno.test("main: returns 2 when no config is found", async () => {
  const dir = await Deno.makeTempDir({ prefix: "simharness-noconfig-" });
  const err = console.error;
  console.error = () => {};
  try {
    assertStrictEquals(await main(["assert"], dir), 2);
  } finally {
    console.error = err;
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("loadConfig: loads the example config", async () => {
  const cfg = await loadConfig(`${EXAMPLE_DIR}/simharness.config.ts`);
  assert(typeof cfg.createAdapter === "function");
  assertStrictEquals(cfg.createAdapter().name, "chase");
});

Deno.test("loadConfig: rejects a module without createAdapter", async () => {
  const file = await Deno.makeTempFile({ suffix: ".ts" });
  await Deno.writeTextFile(file, "export default { nope: true };");
  let threw = false;
  try {
    await loadConfig(file);
  } catch (e) {
    threw = true;
    assert((e as Error).message.includes("createAdapter"));
  } finally {
    await Deno.remove(file);
  }
  assert(threw, "a config without createAdapter must be rejected");
});

Deno.test("main: drives the example 'assert' end to end (exit 0)", async () => {
  // runCli owns the exit contract; stub process.exit so a passing gate does not
  // tear down the test runner.
  const realExit = process.exit;
  const log = console.log;
  let code: number | null = null;
  // deno-lint-ignore no-explicit-any
  (process as any).exit = (c?: number) => {
    code = c ?? 0;
    throw new Error("__exit__");
  };
  console.log = () => {};
  try {
    await main(["assert"], EXAMPLE_DIR);
  } catch (e) {
    if ((e as Error).message !== "__exit__") throw e;
  } finally {
    process.exit = realExit;
    console.log = log;
  }
  assertStrictEquals(code, 0, "the example's assertions should all pass");
});
