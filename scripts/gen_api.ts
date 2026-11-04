// Auto-generate API.md from the public exports in src/index.ts, so the API
// surface stays documented without hand-maintenance.
//   deno run --allow-read --allow-write scripts/gen_api.ts           # write API.md
//   deno run --allow-read scripts/gen_api.ts --check                 # fail if stale (a wall)
// Deterministic: it reads the export list and the declaring modules only.
const root = new URL("../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, root));

interface Sym {
  name: string;
  kind: string;
  summary: string;
}

function render(): string {
  const index = read("src/index.ts");
  const blocks = [...index.matchAll(/export\s*\{([^}]*)\}\s*from\s*["'](\.\/[^"']+)["']/gs)];
  const lines: string[] = [
    "# API reference",
    "",
    "Auto-generated from `src/index.ts` by `make api`. Do not edit by hand.",
    "",
    "Import from `@0xheartcode/simharness` (the root) unless a subpath is noted.",
    "",
  ];

  for (const [, inner, mod] of blocks) {
    const names = inner.split(",").map((s) => s.trim().replace(/^type\s+/, "")).filter(Boolean);
    let src = "";
    try {
      src = read(`src/${mod.replace(/^\.\//, "")}.ts`);
    } catch {
      src = "";
    }
    const syms: Sym[] = names.map((name) => {
      const re = new RegExp(
        `export\\s+(?:declare\\s+)?(?:abstract\\s+)?(function|interface|type|class|const|enum)\\s+${name}\\b`,
      );
      const m = re.exec(src);
      if (!m) return { name, kind: "export", summary: "" };
      const kind = m[1];
      // The JSDoc (if any) is the /** */ block immediately before the declaration.
      let summary = "";
      const before = src.slice(0, m.index).replace(/\s+$/, "");
      if (before.endsWith("*/")) {
        const start = before.lastIndexOf("/**");
        if (start >= 0) {
          const doc = before.slice(start + 3, before.length - 2).replace(/^\s*\*\s?/gm, "").trim();
          summary = doc.split(/\.\s|\n/)[0].trim();
        }
      }
      return { name, kind, summary };
    });
    syms.sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`## \`${mod}\``, "");
    for (const s of syms) lines.push(`- **${s.name}** _(${s.kind})_${s.summary ? `: ${s.summary}` : ""}`);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

const out = render();
if (Deno.args.includes("--check")) {
  let existing = "";
  try {
    existing = read("API.md");
  } catch {
    existing = "";
  }
  if (existing !== out) {
    console.error("API.md is stale; run `make api` and commit the result");
    Deno.exit(1);
  }
  console.log("API.md up to date");
} else {
  Deno.writeTextFileSync(new URL("API.md", root), out);
  console.log("wrote API.md");
}
