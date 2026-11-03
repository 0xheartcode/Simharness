#!/usr/bin/env bash
# Dependency-layering wall: the CONTRACT (adapter.ts, config.ts) must stay
# independent of the TOOLING (run / strategies / fuzz / autoplay / cli / main).
# The dependency arrow points one way only, from tooling to contract, so a consumer
# can import the types (SimAdapter, SimharnessConfig, GameState) without pulling
# in the run loop or the CLI, and the contract never develops a cycle with the
# machinery written against it. The contract layer never imports the tooling layer.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)/src"
fail=0

tooling='run|strategies|fuzz|autoplay|cli|main'

for f in adapter config; do
  if grep -nE "from \"\./($tooling)\"" "$root/$f.ts" >/dev/null 2>&1; then
    echo "FAIL: src/$f.ts (contract) imports tooling; the arrow must point from tooling to contract, not back"
    grep -nE "from \"\./($tooling)\"" "$root/$f.ts"
    fail=1
  fi
done

# adapter.ts is the root of the contract: it must not import any sibling module.
if grep -nE "^import .* from \"\./" "$root/adapter.ts" >/dev/null 2>&1; then
  echo "FAIL: src/adapter.ts must be self-contained (the contract root imports no sibling)"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: layering intact (tooling -> contract, one way)"
fi
exit "$fail"
