# simharness: the walls.
#
# Philosophy: we do not rely on remembering
# best practices. We encode them as DETERMINISTIC checks that pass or fail, and
# loop until they pass. `make check` is the single gate; CI runs exactly it.
#
#   make check      fmt + lint + typecheck + layering + version-sync + tests + coverage floor
#   make cov        human-readable coverage report (src only)
#   make cov-html   browsable HTML coverage under coverage/html
#   make compile    build the self-contained `dist/simharness` binary
#   make package    validate the package publishes cleanly to JSR (dry run)
#
# Rule: never lower a threshold to make a check pass. Fix the code, or change the
# threshold ON PURPOSE in a commit that says why. COV_FLOOR is a ratchet.

# Allow `make DENO=/path/to/deno check` when deno is not on PATH.
DENO ?= deno

# Line-coverage floor over src/ (measured with the full test suite). Ratcheted
# up as slices land; never down to pass. Actual at 0.0.0-alpha.0: 98.0%.
COV_FLOOR ?= 95

.PHONY: check fmt lint typecheck deps version test cov-gate cov cov-html compile package clean

check: fmt lint typecheck deps version test cov-gate
	@echo "═══ make check: ALL WALLS GREEN ═══"

fmt:
	@echo "── fmt ──"
	$(DENO) fmt --check

lint:
	@echo "── lint ──"
	$(DENO) lint

typecheck:
	@echo "── typecheck (src + tests + examples) ──"
	$(DENO) check src/ tests/ examples/

deps:
	@echo "── dependency-layering (contract must not import tooling) ──"
	./scripts/check-layers.sh

version:
	@echo "── version-sync (deno.json = package.json = src/version.ts) ──"
	$(DENO) run --allow-read scripts/check_version.ts

test:
	@echo "── tests (with coverage) ──"
	rm -rf coverage
	$(DENO) test --allow-read --allow-write --allow-env --allow-run --coverage=coverage

# Depends on `test` so the coverage dir exists; make builds `test` once per run.
cov-gate: test
	@echo "── coverage floor ($(COV_FLOOR)% lines, src only) ──"
	$(DENO) coverage coverage --include="src/" --lcov > coverage/src.lcov
	$(DENO) run --allow-read scripts/cov_gate.ts coverage/src.lcov $(COV_FLOOR)

cov:
	$(DENO) coverage coverage --include="src/"

cov-html:
	$(DENO) coverage coverage --include="src/" --html
	@echo "open coverage/html/index.html"

compile:
	@echo "── compile self-contained binary ──"
	mkdir -p dist
	$(DENO) compile --allow-read --allow-write --allow-env --output dist/simharness src/main.ts
	@echo "built dist/simharness"

# Validate the package is publishable to JSR (exports, no slow types, file set)
# without actually publishing. --allow-dirty so it runs on an uncommitted tree.
package:
	@echo "── package (JSR publish dry run) ──"
	$(DENO) publish --dry-run --allow-dirty

clean:
	rm -rf coverage dist
