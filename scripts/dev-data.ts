// ── Development preview with real data ───────────────────────────────
//
// Does on Linux/macOS what update/update.ps1 does on Windows: embeds the
// DECT export (.csv), the directory export (.txt) and the restricted numbers
// into the page, and writes it to preview/katalogos.html.
//
// preview/ is git-ignored: the page then contains personal data. dist/ (which
// is committed) always keeps an empty data block.
//
//   bun run data:dev [data-folder]      (default: ./actual_data)

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPayload, dataBlock, injectData, parseRestricted } from "./lib/payload.ts";
import { buildPage } from "./build.ts";

const ROOT = join(import.meta.dir, "..");
const PREVIEW = join(ROOT, "preview");
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

const restricted = parseRestricted(readFileSync(join(ROOT, "update/ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt"), "utf8"));
const payload = buildPayload({ csv, txt, restricted });

mkdirSync(PREVIEW, { recursive: true });
const output = join(PREVIEW, "katalogos.html");
writeFileSync(output, injectData(await buildPage(), dataBlock(payload)));

console.log(`✓ preview → ${output}`);
console.log(`  DECT:      ${csv ?? "—"}`);
console.log(`  Κατάλογος: ${txt ?? "—"}`);
console.log(`  Περιορισμένοι αριθμοί: ${restricted.length}`);
