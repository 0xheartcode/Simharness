#!/usr/bin/env node
// simharness CLI entry. Finds the consuming project's simharness.config.ts
// (walking up from the cwd so it resolves from a subdir or a git worktree),
// bundles it together with the harness core (esbuild, in-memory), and runs the
// requested command. Ships TypeScript source, no build step.
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CONFIG_NAMES = ["simharness.config.ts", "simharness.config.mjs", "simharness.config.js"];

// Resolve the config: an explicit SIMHARNESS_CONFIG wins; otherwise walk up from
// the cwd to the filesystem root so a run from a subdirectory still finds it.
function findConfig(startDir) {
  if (process.env.SIMHARNESS_CONFIG) {
    const p = resolve(startDir, process.env.SIMHARNESS_CONFIG);
    return existsSync(p) ? p : null;
  }
  let dir = startDir;
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const cfg = findConfig(process.cwd());
if (!cfg) {
  console.error(`simharness: no simharness.config.{ts,mjs,js} found in the cwd or any parent.
Create one whose default export is a SimharnessConfig, e.g.:

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
  sourcemap: "inline", // so a config/adapter error points at the real source line
  // Resolve @0xheartcode/simharness from the config's package (handles workspaces
  // where node_modules lives beside the config, not at the cwd).
  absWorkingDir: dirname(cfg),
});

// Make Node map bundled stack traces back through the inline sourcemap.
process.setSourceMapsEnabled?.(true);
await import(pathToFileURL(out).href);
