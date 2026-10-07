// ── DECT inventory (.csv) parser ─────────────────────────────────────
//
// Input: the rows of the CSV export of the DECT spreadsheet (first sheet).
// The spreadsheet layout is kept exactly as the administrators maintain it;
// columns are located by their header text, not by position, so extra or
// reordered columns do not matter.
//
// Output:
//   DectRecord { id, number, name, shared, dir, position, unit, row }
//     shared  true for role/duty handsets (names prefixed with "*" in the sheet)
//     row     1-based CSV line, for diagnostics

import { clean } from "./normalize.js";

const COLUMNS = {
	number: "ΑΡΙΘΜΟΣ",
	name: "ΟΝΟΜΑΤΕΠΩΝΥΜΟ",
	dir: "ΔΙΕΥΘΥΝΣΗ",
	position: "ΘΕΣΗ",
	unit: "ΕΠΙΣΤΑΣΙΑ"
};
const HEADER_SCAN_ROWS = 20;

const headerKey = v =>
	clean(v)
		.toUpperCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "");

/** Placeholder values used in the sheet for "nothing" ("." or "-"). */
const value = v => {
	const t = clean(v);
	return /^[.\-–]*$/.test(t) ? "" : t;
};

/**
 * @typedef {{ id: number, number: string, name: string, shared: boolean, dir: string, position: string, unit: string, row: number }} DectRecord
 */

/**
 * @param {string[][]} rows
 * @returns {{ records: DectRecord[], warnings: { message: string, line?: number }[] }}
 */
export function parseDect(rows) {
	/** @type {{ message: string, line?: number }[]} */
	const warnings = [];
	/** @type {DectRecord[]} */
	const records = [];

	let header = null;
	for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS) && !header; r++) {
		const keys = (rows[r] ?? []).map(headerKey);
		const cols = {};
		for (const [field, title] of Object.entries(COLUMNS)) cols[field] = keys.indexOf(title);
		if (cols.number >= 0 && cols.name >= 0) header = { row: r, cols };
	}

	if (!header) {
		warnings.push({ message: "Δεν βρέθηκε γραμμή επικεφαλίδων με στήλες ΑΡΙΘΜΟΣ και ΟΝΟΜΑΤΕΠΩΝΥΜΟ στο αρχείο DECT" });
		return { records, warnings };
	}
	for (const [field, title] of Object.entries(COLUMNS)) {
		if (header.cols[field] < 0) warnings.push({ message: `Λείπει η στήλη ${title} από το αρχείο DECT` });
	}

	const cell = (row, field) => (header.cols[field] >= 0 ? value(row[header.cols[field]]) : "");
	const seen = new Map();

	for (let r = header.row + 1; r < rows.length; r++) {
		const row = rows[r] ?? [];
		const number = cell(row, "number");
		if (!number) continue;

		let name = cell(row, "name");
		const dir = cell(row, "dir");
		const position = cell(row, "position");
		const unit = cell(row, "unit");
		if (!name && !dir && !position && !unit) continue; // unassigned number

		const shared = name.startsWith("*");
		if (shared) name = name.replace(/^\*+\s*/, "");

		if (seen.has(number)) {
			warnings.push({ line: r + 1, message: `Ο αριθμός ${number} εμφανίζεται πολλές φορές (γραμμές ${seen.get(number)} και ${r + 1})` });
		}
		seen.set(number, r + 1);

		records.push({ id: records.length, number, name, shared, dir, position, unit, row: r + 1 });
	}

	return { records, warnings };
}
