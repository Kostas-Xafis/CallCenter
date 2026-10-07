// ── Development data loader ──────────────────────────────────────────
//
// Does on Linux/macOS what update/update.ps1 does on Windows: embeds the
// DECT export (.csv) and the directory export (.txt) into the data block of
// dist/katalogos.html.
//
//   bun run data:dev [data-folder]      (default: ./actual_data)

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPayload, dataBlock, injectData, restrictedFromScript } from "./lib/payload.ts";
import { build, OUTPUT } from "./build.ts";

const ROOT = join(import.meta.dir, "..");
const dataDir = process.argv[2] ?? join(ROOT, "actual_data");

/** Newest file with the extension (same rule as update.ps1). */
function pick(ext: string): string | null {
	const matches = readdirSync(dataDir)
		.filter(f => f.toLowerCase().endsWith(ext) && !f.startsWith(".~lock") && !f.startsWith("~$"))
		.map(f => join(dataDir, f))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	return matches[0] ?? null;
}

const csv = pick(".csv");
const txt = pick(".txt");
if (!csv && !txt) throw new Error(`No .csv or .txt files in ${dataDir}`);

const restricted = restrictedFromScript(readFileSync(join(ROOT, "update/update.ps1"), "utf8"));
const payload = buildPayload({ csv, txt, restricted });

if (!existsSync(OUTPUT)) await build();
writeFileSync(OUTPUT, injectData(readFileSync(OUTPUT, "utf8"), dataBlock(payload)));

console.log(`✓ data → ${OUTPUT}`);
console.log(`  DECT:      ${csv ?? "—"}`);
console.log(`  Κατάλογος: ${txt ?? "—"}`);
console.log(`  Περιορισμένοι αριθμοί: ${restricted.length}`);
