// Version-sync wall: deno.json, package.json and src/version.ts must all carry
// the same version string, so a release can never ship three disagreeing
// numbers (the binary's --version, the JSR/pnpm metadata, and the tag).
//
//   deno run --allow-read scripts/check_version.ts

const root = new URL("..", import.meta.url);

const denoJson = JSON.parse(await Deno.readTextFile(new URL("deno.json", root))).version;
const pkgJson = JSON.parse(await Deno.readTextFile(new URL("package.json", root))).version;
const src = (await Deno.readTextFile(new URL("src/version.ts", root))).match(/VERSION\s*=\s*"([^"]+)"/)?.[1];

const entries = { "deno.json": denoJson, "package.json": pkgJson, "src/version.ts": src };
const distinct = new Set(Object.values(entries));

if (distinct.size !== 1 || [...distinct][0] === undefined) {
  console.error("✗ version mismatch across the sources of truth:");
  for (const [file, v] of Object.entries(entries)) console.error(`    ${file}: ${v ?? "(not found)"}`);
  Deno.exit(1);
}
console.log(`✓ version in sync: ${[...distinct][0]}`);
