# API reference

Auto-generated from `src/index.ts` by `make api`. Do not edit by hand.

Import from `@0xheartcode/simharness` (the root) unless a subpath is noted.

## `./run`

- **run** _(function)_
- **RunOpts** _(interface)_
- **RunResult** _(interface)_: The outcome of a run: the final state, the derived event log, and any invariant breaks.

## `./autoplay`

- **autoplay** _(function)_
- **AutoplayOpts** _(interface)_
- **resolveStrategy** _(function)_: Resolve a strategy by name against the built-ins plus any extras

## `./fuzz`

- **fuzz** _(function)_
- **FuzzFailure** _(interface)_
- **FuzzOpts** _(interface)_
- **FuzzResult** _(interface)_

## `./strategies`

- **AbilitySpec** _(interface)_: An ability a composed strategy presses off cooldown.
- **strategies** _(const)_
- **Strategy** _(export)_
- **withAbilities** _(function)_: Compose a base strategy with declared abilities fired off cooldown, replacing

## `./actions`

- **ActionPolicy** _(type)_: A per-tick action chooser: return an action id to apply via adapter.act, or nothing to skip.
- **firstLegal** _(function)_: Each tick, apply the first of `preferred` that is currently legal (a priority policy).
- **randomActionPolicy** _(function)_: Pick a uniformly random legal action each tick, seeded for determinism.
- **replayActions** _(function)_: Replay an explicit action trace, one action per tick (the counterpart used by shrinking).
- **sequenceActions** _(function)_: Apply `ids` in order, one per tick; past the end, stop (or loop when `opts.loop`).
- **shrinkActionTrace** _(function)_: Greedily reduce an action `trace` to a minimal subsequence that still triggers

## `./baseline`

- **BaselineDiff** _(interface)_
- **diffMetrics** _(function)_: Diff a current metrics summary against a baseline
- **formatDiff** _(function)_: A one-line-per-metric human table of a diff.
- **MetricDiff** _(interface)_
- **MetricStatus** _(type)_

## `./determinism`

- **Clock** _(interface)_: A virtual clock: read `now()` in step() instead of Date.now(), and advance it yourself.
- **createClock** _(function)_
- **createRng** _(function)_: A seeded RNG with convenience helpers
- **mulberry32** _(function)_: mulberry32: a tiny, fast, well-distributed seeded PRNG returning a float in [0, 1).
- **Rng** _(interface)_

## `./stats`

- **flatten** _(function)_: Flatten a nested metrics object into dotted keys, so dimensional metrics diff in the flat baseline gate.
- **groupBy** _(function)_: Group items by a string dimension.
- **seedAssert** _(function)_: Assert a predicate holds across every seed; the message lists the failing seeds.
- **summarize** _(function)_: Descriptive stats for a numeric sample (all NaN for an empty sample).
- **Summary** _(interface)_

## `./cli`

- **runCli** _(function)_

