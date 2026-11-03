# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While on the `0.0.x-alpha` line the public contract
(`SimAdapter`, `SimharnessConfig`) may still change between releases; it will be frozen at the first `0.1.0`.

## [0.0.0-alpha.0] - 2026-11-03

The first versioned, Deno-native release. The harness logic is unchanged in behaviour from the pre-versioning library;
this release is about putting it on a solid engineering footing (deterministic walls, a self-contained binary, tests,
and a release pipeline) and starting proper version management.

### Added

- **Deno core.** The harness is now a Deno-first TypeScript package (`deno.json`, task runner, JSR-shaped exports)
  versioned from `0.0.0-alpha.0`. Node/pnpm consumers keep working unchanged through the existing `bin/simharness.mjs`
  esbuild launcher and the `package.json` `exports`/`bin`.
- **Self-contained binary.** `deno compile` builds a single `simharness` executable that discovers a
  `simharness.config.{ts,mjs,js}` in the cwd, dynamically imports it, and runs any command, with the harness core
  embedded, so a consumer needs only the binary on PATH (no `node_modules`, no build step). `--version` / `--help`
  included. The release workflow cross-compiles it for linux (x64/arm64, gnu), macOS (x64/arm64) and windows (x64).
- **The walls (`make check`).** A single deterministic gate: `deno fmt --check`, `deno lint`, `deno check`, a
  dependency-layering check (the contract must not import the tooling), a version-sync check (`deno.json` =
  `package.json` = `src/version.ts`), the test suite, and a line coverage floor over `src/` (ratcheted, starts at 95%;
  currently over 98%). `make
  package` validates the package publishes cleanly to JSR (dry run).
- **Test suite.** 42 tests covering the run loop and event derivation, the strategies, fuzz (NaN / throw / invariant
  detection and de-duplication), the autoplayer, every CLI command and exit code, and the binary's config loader, driven
  by a controllable mock adapter.
- **Worked example.** `examples/chase`, a tiny, fully deterministic game implementing `SimAdapter`, plus a real
  `simharness.config.ts`, so the binary (and a reader) can be exercised end-to-end in a minute.
- **CI + release workflows**, `CHANGELOG`, `LICENSE` (MIT), and `docs/` (`ARCHITECTURE.md`, `CONTRACT.md`).
- `run()` and `autoplay()` now share an exported `RunResult<TExtra>` type.
- `runCli(config, argv?)` accepts an explicit argv, so it is callable from the Deno binary and from tests without
  touching `process.argv`.

### Notes

- Internal relative imports stay extensionless so pnpm `link:` consumers (whose tsc resolves the package's realpath
  outside `node_modules`) are not forced to enable `allowImportingTsExtensions`. Deno bridges this with the
  `sloppy-imports` unstable flag; the `no-sloppy-imports` lint rule is therefore disabled on purpose. Tightening to
  explicit extensions is a future item.
