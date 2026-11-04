# @0xheartcode/simharness

A **game-agnostic AI development harness**. Any 2D game with a _deterministic, render-separated simulation_ implements
one interface (`SimAdapter`) and gets:

- **Deterministic headless runs**: `reset(seed)` then step N ticks, no browser.
- **Scriptable input**: a per-tick timeline injected through the sim's input API.
- **Typed state readout**: real values (hp, positions, resources, phase, kills), never screen-scraped.
- **ASCII board snapshots**: a one-way glyph dump for "what does it look like", plus regression diffs.
- **Event log**: clears, hero-down, phase changes, with tick stamps.
- **Assertions and deterministic replay**: "after inputs X from seed S the core broke"; the same seed and policy give an
  identical run.
- **Fuzz and invariants**: random seeds and inputs assert never-NaN, never-throws.
- **Autoplayer ("GM") and strategies**: aggressive, turtle, random, idle stress runs.
- **Balance metrics**: many seeds in, win rate, averages, and per-run rows out.
- **CLI**: `run | ascii | autoplay | fuzz | assert | balance | snap`.

It is deliberately _not_ tied to any one game: the harness is the reusable core, and each project ships a small adapter
and config.

> **Status:** `0.0.0-alpha.1`. Deno-native core, self-contained `deno compile` binary, and deterministic walls
> (`make check`: fmt, lint, typecheck, layering, version-sync, tests, and a 95% coverage floor, currently over 98%). The
> `SimAdapter` contract may still shift on the alpha line; it freezes at `0.1.0`.

## Try it in a minute

The repo ships a tiny deterministic `chase` game whose adapter is the whole contract in about 160 lines. Drive it
headlessly, with no game to look at:

```bash
git clone https://github.com/0xheartcode/Simharness && cd Simharness
make compile                      # builds dist/simharness (needs deno 2.9.x)

cd examples/chase
../../dist/simharness assert      # project assertions (CI gate)
../../dist/simharness autoplay 7 400 aggressive
../../dist/simharness balance 8
../../dist/simharness ascii 3
```

Nothing there is chase-specific: the harness only ever touches the universal `GameState` core, and every genre detail
lives in `extra`.

## Use it in your game

1. **Implement `SimAdapter`** over your sim (see `examples/chase/chase_adapter.ts`).
2. **Add a `simharness.config.ts`** at your repo root whose default export is a `SimharnessConfig`: a `createAdapter()`
   factory, plus optional `stage`, `asserts`, `metrics`, `invariants`:

   ```ts
   import type { SimharnessConfig } from "@0xheartcode/simharness/config";
   import { MyGameAdapter } from "./sim/my-game-adapter";
   const config: SimharnessConfig = { createAdapter: () => new MyGameAdapter() };
   export default config;
   ```

3. **Run a command.** Three supported ways, pick what fits your project:

   | Path       | How                                                                         | When                                                                                  |
   | ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
   | **Binary** | `simharness assert` (the `deno compile` binary on PATH)                     | Any repo; no deps, no build. The core is embedded and resolves your config's imports. |
   | **pnpm**   | `"@0xheartcode/simharness": "link:../Simharness"`, then `simharness assert` | Node/Vite projects (bundled on the fly by `bin/simharness.mjs`).                      |
   | **deno**   | `deno run -A --config <repo>/deno.json <repo>/src/main.ts assert`           | A Deno project or from a checkout.                                                    |

## The adapter

```ts
interface SimAdapter<TExtra> {
  readonly name: string;
  reset(seed: number, opts?): void;
  step(dt: number): void;
  setInput(partial: InputState): void; // move, aimWorld, fire, press/hold keys
  readState(): GameState<TExtra>; // the seam: typed state every tick
  snapshotAscii(): string;
  debug?(action: string, arg?: unknown): void;
}
```

`GameState<TExtra>` is a tiny universal core (`tick`, `phase`, `hero`, `enemies`) plus a project-typed `extra` that the
harness never reads but your asserts, metrics, and invariants do. See `examples/chase` for a complete adapter and
config.

## Development: the walls

We encode best practices as deterministic checks and loop until green. `make check` is the single gate, and CI runs
exactly it.

```bash
make check      # fmt + lint + typecheck + layering + version-sync + tests + coverage floor
make cov        # coverage report (src only)
make compile    # build dist/simharness
make package    # validate the JSR publish (dry run)
```

Rule: never lower a threshold to pass a check. Fix the code, or raise the bar on purpose in a commit that says why.
`COV_FLOOR` is a ratchet.

## Versioning

One version, three sources of truth kept in lockstep by `make version` (`deno.json`, `package.json`, `src/version.ts`).
Tag `vX.Y.Z` to cut a release: the workflow re-runs the gate, cross-compiles the binary for linux/macOS/windows, and
attaches them to the GitHub Release. See [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT © 0xheartcode
