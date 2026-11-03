#!/usr/bin/env node
// simharness CLI entry. Finds the consuming project's simharness.config.ts in
// the cwd, bundles it together with the harness core (esbuild, in-memory), and
// runs the requested command. Ships TypeScript source, no build step.
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const cwd = process.cwd();
const cfg = resolve(cwd, process.env.SIMHARNESS_CONFIG || "simharness.config.ts");
if (!existsSync(cfg)) {
  console.error(`simharness: no config found at ${cfg}
Create a simharness.config.ts in this directory whose default export is a
SimharnessConfig, e.g.:

  import { MyGameAdapter } from "./sim/my-game-adapter";
  export default { createAdapter: () => new MyGameAdapter() };`);
  process.exit(2);
}

const pkgCli = resolve(import.meta.dirname, "../src/cli.ts"); // this package's own CLI
const entry = join(tmpdir(), `simharness-entry-${Date.now()}.ts`);
writeFileSync(
  entry,
  `import config from ${JSON.stringify(cfg)};\n` +
    `import { runCli } from ${JSON.stringify(pkgCli)};\n` +
    `runCli(config && config.default ? config.default : config);\n`,
);

const out = join(tmpdir(), `simharness-${Date.now()}.mjs`);
await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "error",
  absWorkingDir: cwd, // resolve @0xheartcode/simharness from the consumer's node_modules
});
await import(pathToFileURL(out).href);
