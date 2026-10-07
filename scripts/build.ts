// ── Build: app/ → dist/ (the ready-to-copy folder for administrators) ──
//
// dist/ is committed to git: administrators cannot run Bun/Node, so they
// download it from GitHub and copy it to their machine as is.
//
//   dist/katalogos.html     the whole app in one file, with an EMPTY data block
//                           (update.cmd fills it in on the administrator's PC;
//                           personal data must never end up in git)
//   dist/update.cmd, update.ps1, ΟΔΗΓΙΕΣ.pdf, ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt
//   dist/data/              where the exported .csv/.txt go
//
// For a preview with real data use `bun run data:dev` (writes preview/).
//
//   bun run build

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_BEGIN, DATA_END, dataBlock, injectData } from "./lib/payload.ts";

const ROOT = join(import.meta.dir, "..");
const APP = join(ROOT, "app");
export const DIST = join(ROOT, "dist");
export const RELEASE_FILES = ["update.ps1", "update.cmd", "ΟΔΗΓΙΕΣ.pdf", "ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt"];

/** Builds the single-file page (empty data block) and returns its HTML. */
export async function buildPage(): Promise<string> {
	const result = await Bun.build({
		entrypoints: [join(APP, "js/main.js")],
		format: "iife",
		target: "browser",
		minify: { whitespace: true, syntax: true, identifiers: false }
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error("JavaScript bundle failed");
	}
	const js = await result.outputs[0].text();
	const css = readFileSync(join(APP, "styles.css"), "utf8");
	const icon = readFileSync(join(APP, "assets/icon.svg"), "utf8").replace(/\s*\n\s*/g, " ").trim();
	const logo = readFileSync(join(APP, "assets/logo-128.png")).toString("base64");

	for (const [what, text] of [["JS", js], ["CSS", css]] as const) {
		if (/<\/(script|style)/i.test(text)) throw new Error(`${what} contains a closing </script> or </style> tag`);
		if (text.includes(DATA_BEGIN) || text.includes(DATA_END)) throw new Error(`${what} contains a data marker`);
	}

	const html = readFileSync(join(APP, "index.html"), "utf8")
		// Function replacers: the inserted code may contain "$&"-style sequences.
		.replace("/*@CSS@*/", () => css)
		.replace("/*@JS@*/", () => js)
		.replace("@FAVICON@", () => `data:image/svg+xml,${encodeURIComponent(icon)}`)
		.replace("@LOGO@", () => `data:image/png;base64,${logo}`);
	return injectData(html, dataBlock(null));
}

export async function build(outDir = DIST) {
	const html = await buildPage();
	mkdirSync(join(outDir, "data"), { recursive: true });
	writeFileSync(join(outDir, "katalogos.html"), html);
	for (const f of RELEASE_FILES) copyFileSync(join(ROOT, "update", f), join(outDir, f));
	// Keeps the empty data/ folder in git; update.ps1 only looks at .csv/.txt.
	writeFileSync(join(outDir, "data", ".gitkeep"), "");
	return { size: Buffer.byteLength(html) };
}

if (import.meta.main) {
	const { size } = await build();
	console.log(`✓ ${join(DIST, "katalogos.html")} (${(size / 1024).toFixed(0)} KB, χωρίς δεδομένα)`);
}
