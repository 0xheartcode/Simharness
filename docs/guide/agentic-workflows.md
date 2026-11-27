# Agentic developer workflows

An agentic developer workflow is a loop where a coding agent changes a system, runs a check, reads the result, and
iterates until the check is green. The thing that makes such a loop work or fail is reproducibility: if a failure cannot
be triggered on demand, the agent cannot tell whether its fix worked, and the loop degrades into guessing.

This engine is built for that loop. A seed goes in and an identical run comes out, enforced by the determinism wall, so
an agent can reproduce the exact failure every time. The agent-facing commands (`fuzz` as the gate, `explain` as the
root-cause handoff) emit a stable, versioned JSON envelope, so the agent parses structured data instead of scraping
prose.

## The load-bearing guarantee

The most useful property for an autonomous loop is not the reproducibility, it is the **determinism wall as a
commit-time guardrail**. A classic agent regression is to make a flaky test pass by reaching for `Date.now()` or
`Math.random()`. That silently destroys replay for everyone downstream. The determinism fitness function
(`scripts/check_determinism.ts`, wired into `make check`) fails the build on that at commit time, before it can land.
For a loop with no human watching every diff, that wall is what keeps the agent honest.

## The loop

```
change ──> fuzz --json ──> parse exit code + envelope
                                  │
                    exit 0 (pass) │ exit 1 (a seed broke an invariant)
                                  │
                         explain <seed> --json
                                  │
                  feed the envelope into a root-cause prompt
                                  │
                            apply a fix ──> back to the top
```

A shell skeleton, driving the shipped `gossip-register` example (set `GOSSIP_BUGGY=1` to run the variant whose invariant
breaks, so the loop runs end to end against a real failure):

```sh
DENO="$HOME/.deno/bin/deno"
ENTRY="examples/gossip-register/main.ts"
RUN="$DENO run --allow-read --allow-env --allow-run $ENTRY"

# 1. The gate. Nonzero means a seed broke an invariant.
report="$($RUN fuzz --seeds 100 --ticks 200 --json)"
if [ $? -eq 0 ]; then
  echo "green"; exit 0
fi

# 2. Pull the offending seed straight out of the envelope (no prose scraping).
seed="$(echo "$report" | jq -r .seed)"

# 3. The root-cause handoff: the full failure report as one JSON object.
$RUN explain "$seed" --ticks 200 --json > failure.json

# 4. Feed failure.json into the agent's root-cause prompt, apply a fix, loop.
```

`jq` is only illustrative; the envelope is ordinary JSON any agent can parse.

## The report envelope

Every agent-facing command prints one JSON object when given `--json`. The envelope is versioned with a `v` field so a
parser can refuse a shape it does not understand. Exit codes: `0` pass, `1` an invariant broke, `2` a usage error.

### `fuzz --json`

On a clean run (`mode` is `seeded`, or `guided` for `--guided`):

```json
{
  "v": 1,
  "report": "fuzz-pass",
  "mode": "seeded",
  "scenario": "gossip-register",
  "seeds": 100,
  "ticks": 200,
  "profile": "partition-heavy"
}
```

On a failure, seeded mode:

```json
{
  "v": 1,
  "report": "fuzz-failure",
  "mode": "seeded",
  "scenario": "gossip-register",
  "seed": 0,
  "ticks": 120,
  "profile": "partition-heavy",
  "invariant": "node athens version regressed 1 -> -1 at tick 4",
  "invariants": ["...up to five..."],
  "invariantCount": 40,
  "minimalSchedule": [{ "tick": 3, "action": "isolate", "targets": ["athens"] }],
  "essentialFaults": 1,
  "totalFaults": 35,
  "reproduce": "explain 0 --ticks 120 --profile partition-heavy"
}
```

The guided mode (`--guided`) searches fault scripts directly rather than seeds, so instead of a `reproduce` seed it
returns the breaking script as `minimalSchedule`, plus `foundAtIteration` and `coverage`.

`invariant` is the one signal; `invariants` is a sample capped at five and `invariantCount` is the true total, so one
bug that trips a long cascade of related violations does not bloat the envelope. `minimalSchedule` is the shrunk fault
schedule (the few faults that are actually essential to the failure), with `essentialFaults` of `totalFaults`; all three
are `null` when shrinking is off or the failure does not depend on faults at all.

### `explain --json`

On a clean seed:

```json
{ "v": 1, "report": "clean", "scenario": "gossip-register", "seed": 2, "ticks": 100, "profile": "partition-heavy" }
```

On a failure, the full report: the same invariant and `minimalSchedule` fields as above, plus the tail of the
tick-stamped event log (`events`, with `eventsShown` of `eventsTotal`) and a `reproduce` line.

```json
{
  "v": 1,
  "report": "failure",
  "scenario": "gossip-register",
  "seed": 0,
  "ticks": 120,
  "profile": "partition-heavy",
  "invariant": "node athens version regressed 1 -> -1 at tick 4",
  "invariants": ["...up to five..."],
  "invariantCount": 40,
  "minimalSchedule": [],
  "essentialFaults": 0,
  "totalFaults": 35,
  "events": [{ "tick": 115, "type": "net.deliver", "detail": {} }],
  "eventsShown": 20,
  "eventsTotal": 143,
  "reproduce": "explain 0 --ticks 120 --profile partition-heavy"
}
```

An `essentialFaults` of `0` is meaningful: it says the failure does not depend on any injected fault, so the bug is on
the happy path, not a fault-handling corner.

## Where this is not automatic

- **The harness exploits determinism, it cannot confer it.** If the agent writes a nondeterministic system under test,
  the harness can flag the flakiness (via `replay`, which fails when two runs of a seed diverge) but cannot remove it.
- **Invariants are the judgment-heavy part.** An agent can propose an invariant, but a vacuous or wrong one gives false
  confidence. Each reference system under test ships a control that proves its invariant can actually fail, and that
  discipline is worth keeping: an invariant with no demonstrated failure is a test that has never been shown to work.
- **The interleaving and coverage-guided tiers are foundations, not push-button tools.** They find the bugs they are
  pointed at; wiring them into a specific system under test is still engineering, not a flag.
