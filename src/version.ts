// The single source of truth for the harness version. The `version-sync` wall
// (see the Makefile) asserts this equals the `version` in deno.json and
// package.json, so a release can never ship three disagreeing numbers.
export const VERSION = "0.0.0-alpha.0";
