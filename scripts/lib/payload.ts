// ── Data payload helpers (development counterpart of update/update.ps1) ──
//
// update.ps1 is what administrators run on Windows. This module produces the
// same payload on the development machine so the app can be built and tested
// here. Keep both in sync: same payload shape, same markers.
//
// Payload (schema 2):
//   {
//     schema: 2, generatedAt, generator,
//     dect:      { file, modified, base64 }   the DECT export (.csv), byte for byte
//     directory: { file, modified, base64 }   the directory export (.txt), byte for byte
//     restricted: string[]
//   }
// Decoding (encoding detection) and parsing happen in the page (app/js).

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

export const DATA_BEGIN = "<!--CATALOG-DATA-BEGIN-->";
export const DATA_END = "<!--CATALOG-DATA-END-->";

export type SourceFile = { file: string; modified: string; base64: string };
export type Payload = {
	schema: 2;
	generatedAt: string;
	generator: string;
	dect: SourceFile | null;
	directory: SourceFile | null;
	restricted: string[];
};

export function readSource(path: string): SourceFile {
	return {
		file: basename(path),
		modified: statSync(path).mtime.toISOString(),
		base64: readFileSync(path).toString("base64")
	};
}

/** JSON safe to embed inside a <script> element. */
export function toEmbeddedJson(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

export function dataBlock(payload: Payload | null): string {
	const json = payload ? toEmbeddedJson(payload) : "null";
	return `${DATA_BEGIN}<script id="catalog-data" type="application/json">${json}</script>${DATA_END}`;
}

/** Replaces the data block of an HTML document. */
export function injectData(html: string, block: string): string {
	const a = html.indexOf(DATA_BEGIN);
	const b = html.indexOf(DATA_END);
	if (a < 0 || b < a) throw new Error("Data markers not found in HTML");
	return html.slice(0, a) + block + html.slice(b + DATA_END.length);
}

/** Returns the existing data block of an HTML document, if any. */
export function extractDataBlock(html: string): string | null {
	const a = html.indexOf(DATA_BEGIN);
	const b = html.indexOf(DATA_END);
	return a >= 0 && b > a ? html.slice(a, b + DATA_END.length) : null;
}

/**
 * Restricted numbers from ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt (same rule as update.ps1): the
 * number at the start of each line; anything after it, and lines starting
 * with #, are ignored.
 */
export function parseRestricted(text: string): string[] {
	const out: string[] = [];
	for (const line of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
		const m = line.match(/^\s*(\d+)/);
		if (m && !out.includes(m[1])) out.push(m[1]);
	}
	return out;
}

export function buildPayload(opts: { csv: string | null; txt: string | null; restricted: string[] }): Payload {
	return {
		schema: 2,
		generatedAt: new Date().toISOString(),
		generator: "dev-data.ts",
		dect: opts.csv ? readSource(opts.csv) : null,
		directory: opts.txt ? readSource(opts.txt) : null,
		restricted: opts.restricted
	};
}
