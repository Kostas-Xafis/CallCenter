// ── Build: app/ → dist/katalogos.html (single self-contained file) ──
//
// Inlines the stylesheet, the bundled JavaScript and the favicon into
// app/index.html. If dist/katalogos.html already exists its data block is
// carried over, so rebuilding the app never drops the data. Also copies the
// Windows update scripts next to the page.
//
//   bun run build

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_BEGIN, DATA_END, extractDataBlock, injectData } from "./lib/payload.ts";

const ROOT = join(import.meta.dir, "..");
const APP = join(ROOT, "app");
const DIST = join(ROOT, "dist");
export const OUTPUT = join(DIST, "katalogos.html");

export async function build() {
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

	let html = readFileSync(join(APP, "index.html"), "utf8");
	// Function replacers: the inserted code may contain "$&"-style sequences.
	html = html
		.replace("/*@CSS@*/", () => css)
		.replace("/*@JS@*/", () => js)
		.replace("@FAVICON@", () => `data:image/svg+xml,${encodeURIComponent(icon)}`)
		.replace("@LOGO@", () => `data:image/png;base64,${logo}`);

	if (existsSync(OUTPUT)) {
		const previous = extractDataBlock(readFileSync(OUTPUT, "utf8"));
		if (previous) html = injectData(html, previous);
	}

	mkdirSync(DIST, { recursive: true });
	writeFileSync(OUTPUT, html);
	for (const f of ["update.ps1", "update.cmd", "ΟΔΗΓΙΕΣ.txt"]) copyFileSync(join(ROOT, "update", f), join(DIST, f));
	mkdirSync(join(DIST, "data"), { recursive: true });

	return { size: Buffer.byteLength(html) };
}

if (import.meta.main) {
	const { size } = await build();
	console.log(`✓ ${OUTPUT} (${(size / 1024).toFixed(0)} KB)`);
}
