// Test fixture: write to stderr and exit nonzero, to exercise crash surfacing.
console.error("boom: adapter crashed");
Deno.exit(3);
