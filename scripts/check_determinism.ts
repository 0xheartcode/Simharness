// Determinism fitness function (ADR-005). Scans the core modules of src/engine
// for replay-breaking patterns and fails the build on any hit. The real-IO
// transport boundary is excluded: it is the seam to a real child process and
// legitimately uses streams and promises.
//
// Run as a wall:  deno run --allow-read scripts/check_determinism.ts
// It exits nonzero and prints file:line for each violation.

export interface Violation {
  path: string;
  line: number;
  rule: string;
}

/** The forbidden patterns, each with a human-readable rule name. */
const RULES: { rule: string; re: RegExp }[] = [
  { rule: "no wall clock (Date.now)", re: /\bDate\.now\b/ },
  { rule: "no wall clock (new Date)", re: /\bnew Date\b/ },
  { rule: "no wall clock (performance.now)", re: /\bperformance\.now\b/ },
  { rule: "no unseeded entropy (Math.random)", re: /\bMath\.random\b/ },
  { rule: "no unseeded entropy (crypto.randomUUID)", re: /\bcrypto\.randomUUID\b/ },
  { rule: "no unseeded entropy (crypto.getRandomValues)", re: /\bcrypto\.getRandomValues\b/ },
  { rule: "no real scheduling (setTimeout)", re: /\bsetTimeout\b/ },
  { rule: "no real scheduling (setInterval)", re: /\bsetInterval\b/ },
  { rule: "no real scheduling (setImmediate)", re: /\bsetImmediate\b/ },
  { rule: "no real scheduling (queueMicrotask)", re: /\bqueueMicrotask\b/ },
  { rule: "no real async (async)", re: /\basync\b/ },
  { rule: "no real async (await)", re: /\bawait\b/ },
];

/** Remove comments so documentation that names a forbidden pattern is not a hit. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Scan one source string; returns the violations with 1-based line numbers. */
export function scanSource(source: string, path: string): Violation[] {
  const code = stripComments(source);
  const lines = code.split("\n");
  const out: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (const { rule, re } of RULES) {
      if (re.test(lines[i])) out.push({ path, line: i + 1, rule });
    }
  }
  return out;
}

/**
 * The Rust determinism rules (ADR-005 rules 5 and 6): no unordered hash
 * iteration, no real clock, no unseeded entropy, no threads. The TS engine does
 * not need rule 5 (Map/Set are insertion-ordered), but the Rust core does.
 */
const RUST_RULES: { rule: string; re: RegExp }[] = [
  { rule: "no unordered map (use BTreeMap)", re: /\bHashMap\b/ },
  { rule: "no unordered set (use BTreeSet)", re: /\bHashSet\b/ },
  { rule: "no wall clock (SystemTime)", re: /\bSystemTime\b/ },
  { rule: "no wall clock (Instant)", re: /\bInstant\b/ },
  { rule: "no unseeded entropy (rand)", re: /\brand::/ },
  { rule: "no unseeded entropy (thread_rng)", re: /\bthread_rng\b/ },
  { rule: "no threads (thread::spawn)", re: /\bthread::spawn\b/ },
];

/** The core modules to scan, and the transport-boundary files to skip. */
const CORE_ROOT = "src/engine";
const EXCLUDE = new Set([
  "src/engine/protocol/stdio.ts",
  "src/engine/protocol/lines.ts",
]);

/** Scan the Rust crate sources (rs/<crate>/src) for the Rust determinism rules. */
export async function scanRustTree(root = "rs"): Promise<Violation[]> {
  const violations: Violation[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch {
      return; // rs/ absent (e.g. a Deno-only checkout): nothing to scan
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (path.includes("/target/") || path.endsWith("/tests")) continue;
      if (entry.isDirectory) {
        await walk(path);
      } else if (entry.name.endsWith(".rs") && !path.includes("/tests/")) {
        const code = stripComments(await Deno.readTextFile(path));
        const lines = code.split("\n");
        for (let i = 0; i < lines.length; i++) {
          for (const { rule, re } of RUST_RULES) {
            if (re.test(lines[i])) violations.push({ path, line: i + 1, rule });
          }
        }
      }
    }
  };
  await walk(root);
  return violations;
}

/** Walk the core tree and scan every .ts file that is not an excluded boundary. */
export async function scanTree(root = CORE_ROOT, exclude = EXCLUDE): Promise<Violation[]> {
  const violations: Violation[] = [];
  const walk = async (dir: string): Promise<void> => {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(path);
      } else if (entry.name.endsWith(".ts") && !exclude.has(path)) {
        violations.push(...scanSource(await Deno.readTextFile(path), path));
      }
    }
  };
  await walk(root);
  return violations;
}

if (import.meta.main) {
  const violations = [...await scanTree(), ...await scanRustTree()];
  if (violations.length > 0) {
    console.error(`determinism check FAILED: ${violations.length} violation(s)`);
    for (const v of violations) console.error(`  ${v.path}:${v.line}  ${v.rule}`);
    Deno.exit(1);
  }
  console.log("determinism check: core is clean");
}
