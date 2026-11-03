// The Deno binary entry (`deno compile` target). It locates the consuming
// project's simharness.config in the current directory, dynamically imports it,
// and runs the requested command through the game-agnostic CLI.
//
// This is the Deno-native counterpart to `bin/simharness.mjs` (the esbuild
// launcher kept for Node/pnpm consumers). The compiled binary carries the
// harness core inside it and resolves the config's `@0xheartcode/simharness`
// imports through the import map embedded at compile time (see `deno.json` and
// the `compile` task), so a consumer needs only the binary on PATH, no
// node_modules and no build step.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "./cli";
import type { SimharnessConfig } from "./config";
import { VERSION } from "./version";
// Force the public entry points into the compiled binary's module graph so a
// consumer config's `@0xheartcode/simharness` (and /adapter, /config) imports
// resolve against the embedded core through the import map baked in at compile
// time, so no node_modules needed at the consumer. main.ts would otherwise not
// pull in index.ts, leaving the `.` specifier unresolvable in the binary.
import "./index";
import "./adapter";

const USAGE = `simharness ${VERSION}: game-agnostic AI dev harness

Usage: simharness <cmd> [args]   (needs a simharness.config in the cwd)

Commands:
  run <seed> [ticks]                autoplay a run, print final state + events
  ascii <seed>                      staged scene -> ASCII board snapshot
  autoplay <seed> [ticks] [strat]   strat = aggressive | turtle | random | idle
  fuzz [seeds] [ticks]              random inputs, assert invariants (CI gate)
  assert                            project assertions (CI gate)
  balance [seeds] [ticks]           project balance metrics
  snap <seed>                       write/diff an ASCII snapshot (regression)

Options:
  -v, --version                     print the version and exit
  -h, --help                        print this help and exit

Config resolution (first that exists):
  $SIMHARNESS_CONFIG, then ./simharness.config.ts, .mjs, .js`;

/** Candidate config filenames, in resolution order. */
const CONFIG_CANDIDATES = ["simharness.config.ts", "simharness.config.mjs", "simharness.config.js"];

/** Resolve the consumer's config path, or return null with the list tried. */
async function findConfig(cwd: string): Promise<string | null> {
  const fromEnv = Deno.env.get("SIMHARNESS_CONFIG");
  const candidates = fromEnv ? [fromEnv] : CONFIG_CANDIDATES;
  for (const c of candidates) {
    const abs = resolve(cwd, c);
    try {
      const st = await Deno.stat(abs);
      if (st.isFile) return abs;
    } catch {
      // not here; try the next candidate
    }
  }
  return null;
}

/** Load a config module and return its SimharnessConfig default export. */
export async function loadConfig(path: string): Promise<SimharnessConfig> {
  const mod = await import(pathToFileURL(path).href);
  const config = (mod && mod.default ? mod.default : mod) as SimharnessConfig;
  if (!config || typeof config.createAdapter !== "function") {
    throw new Error(`simharness: ${path} must default-export a SimharnessConfig with a createAdapter()`);
  }
  return config;
}

export async function main(args: string[] = Deno.args, cwd: string = Deno.cwd()): Promise<number> {
  const first = args[0];
  if (first === "-v" || first === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (first === undefined || first === "-h" || first === "--help" || first === "help") {
    console.log(USAGE);
    return first === undefined ? 1 : 0;
  }

  const cfgPath = await findConfig(cwd);
  if (!cfgPath) {
    console.error(
      `simharness: no config found in ${cwd}\n` +
        `Create a simharness.config.ts whose default export is a SimharnessConfig, e.g.:\n\n` +
        `  import { MyGameAdapter } from "./sim/my-game-adapter";\n` +
        `  export default { createAdapter: () => new MyGameAdapter() };`,
    );
    return 2;
  }

  const config = await loadConfig(cfgPath);
  // runCli owns the exit contract (it calls process.exit for the gating
  // commands assert/fuzz); for the non-exiting commands we return 0.
  runCli(config, args);
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
