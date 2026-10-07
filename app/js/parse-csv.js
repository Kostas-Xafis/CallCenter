// ── CSV parser ───────────────────────────────────────────────────────
//
// RFC 4180 (quoted fields, "" escapes, line breaks inside quotes). The
// separator is detected, because Excel on a Greek Windows writes ";" by
// default (regional list separator) while "CSV UTF-8" exports often use ",".

const SEPARATORS = [",", ";", "\t"];

/** Counts separator characters outside quotes in one line. */
function countOutsideQuotes(line, sep) {
	let n = 0;
	let quoted = false;
	for (const ch of line) {
		if (ch === '"') quoted = !quoted;
		else if (ch === sep && !quoted) n++;
	}
	return n;
}

/**
 * Picks the separator that splits the header line (or, failing that, the
 * first lines) into the most fields.
 * @param {string} text
 */
export function detectSeparator(text) {
	const lines = text.split(/\r\n|\r|\n/, 50);
	const header = lines.find(l => /ΑΡΙΘΜΟΣ/i.test(l));
	const sample = header ? [header] : lines;
	let best = ",";
	let bestCount = 0;
	for (const sep of SEPARATORS) {
		const count = sample.reduce((sum, l) => sum + countOutsideQuotes(l, sep), 0);
		if (count > bestCount) {
			best = sep;
			bestCount = count;
		}
	}
	return best;
}

/**
 * @param {string} text
 * @param {string} [separator]  detected when omitted
 * @returns {string[][]}
 */
export function parseCsv(text, separator = detectSeparator(text)) {
	const rows = [];
	let row = [];
	let field = "";
	let quoted = false;
	const s = text.replace(/^﻿/, "");

	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (quoted) {
			if (ch === '"') {
				if (s[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += ch;
			}
		} else if (ch === '"' && field === "") {
			quoted = true;
		} else if (ch === separator) {
			row.push(field);
			field = "";
		} else if (ch === "\r" || ch === "\n") {
			if (ch === "\r" && s[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += ch;
		}
	}
	if (field !== "" || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}
