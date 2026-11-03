// Coverage floor wall. Reads an lcov report, sums lines-found / lines-hit
// across every record, and fails when line coverage is below the floor passed
// as the second argument. Kept dependency-free (Deno std is not needed to add
// two integers), in the spirit of the harness core.
//
//   deno run --allow-read scripts/cov_gate.ts coverage/src.lcov 95
//
// The floor is a ratchet: raise it as coverage climbs, and never lower it to
// make the gate pass; fix the tests instead (see the Makefile).

const [lcovPath, floorArg] = Deno.args;
if (!lcovPath || !floorArg) {
  console.error("usage: cov_gate.ts <lcov-file> <floor-percent>");
  Deno.exit(2);
}
const floor = Number(floorArg);

let text: string;
try {
  text = await Deno.readTextFile(lcovPath);
} catch {
  console.error(`cov_gate: cannot read ${lcovPath} (did the test step write coverage?)`);
  Deno.exit(2);
}

let found = 0;
let hit = 0;
for (const line of text.split("\n")) {
  if (line.startsWith("LF:")) found += Number(line.slice(3));
  else if (line.startsWith("LH:")) hit += Number(line.slice(3));
}

if (found === 0) {
  console.error("cov_gate: no line data in the lcov report");
  Deno.exit(2);
}

const pct = (hit / found) * 100;
const rounded = Math.round(pct * 10) / 10;
if (pct + 1e-9 < floor) {
  console.error(`✗ coverage ${rounded}% is below the floor of ${floor}% (${hit}/${found} lines)`);
  Deno.exit(1);
}
console.log(`✓ coverage ${rounded}% ≥ floor ${floor}% (${hit}/${found} lines)`);
