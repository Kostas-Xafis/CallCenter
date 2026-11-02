// ── Data model ───────────────────────────────────────────────────────
//
// Turns a schema-3 catalog (docs/CONTRACT.md) into display records shared by
// both phone types:
//
//   Record {
//     key, source: "dir" | "dect", order,
//     numbers[]      display tokens ("4011", "5501–5511")
//     searchNumbers[] every individual number (ranges expanded) + outside lines (digits only)
//     external[]     outside lines ("210-7799410")
//     name           DECT: full name · directory: entry label
//     position       DECT: ΘΕΣΗ
//     unit           DECT: ΕΠΙΣΤΑΣΙΑ · directory: sub-path ("Βιοπαθολογία › Αιματολογικό")
//     dir            ΔΙΕΥΘΥΝΣΗ abbreviation / section name
//     dirKey, dirTitle
//     shared         DECT handset used by a role/duty rather than a person
//     restricted     never transfer calls to this number
//     section        { id, abbr, name, parent } for desk phones (for grouping), null for DECT
//   }

import { abbrKey } from "./normalize.js";

export const SOURCES = {
	dir: { label: "Σταθερά", long: "Σταθερά" },
	dect: { label: "Ασύρματοι", long: "Ασύρματοι" }
};

// Extra searchable words per source, so "ασύρματο καρδιολογ" or "σταθερό γραμματεία"
// narrows the results to that kind of phone. Low weight: the type never outranks a real match.
// The directorate code is what callers usually say ("ΔΟΥ", "ΚΑΙ"): an exact hit on
// it must outrank names that merely start with the same letters (ΔΟΥΛΓΕΡΑΚΗΣ).
const ABBR_WEIGHT = 1.6;

const SOURCE_TERMS = {
	dir: { text: "Σταθερά σταθερό σταθερός σταθεροί", weight: 0.3 },
	dect: { text: "Ασύρματα ασύρματο ασύρματος ασύρματοι DECT", weight: 0.3 }
};

const MAX_RANGE_EXPANSION = 100;

/** Splits "5501-5511" into { from, to }; anything else is a plain extension. */
function parseRange(token) {
	const m = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/.exec(token);
	return m ? { from: m[1], to: m[2] } : null;
}

/** Expands ranges ({ from, to }[]) into individual numbers (used for searching). */
export function expandRanges(ranges) {
	const out = [];
	for (const { from, to } of ranges) {
		const a = Number(from);
		const b = Number(to);
		if (!(b >= a) || b - a > MAX_RANGE_EXPANSION) continue;
		for (let n = a; n <= b; n++) out.push(String(n).padStart(from.length, "0"));
	}
	return out;
}

const NO_SECTION = { id: "none", abbr: "", name: "—", parent: "" };

/** Builds the application model from a catalog (schema 3). */
export function buildModel(catalog) {
	const sections = new Map();
	const rawSections = catalog?.sections ?? [];
	const rawById = new Map(rawSections.map(s => [s.id, s]));
	rawSections.forEach((s, i) => {
		const parent = s.parentId ? rawById.get(s.parentId) : null;
		sections.set(s.id, { id: s.id, abbr: s.abbr || "", name: s.name || "", parent: parent ? parent.abbr || parent.name || "" : "", order: i });
	});

	const directorates = new Map(); // dirKey → { key, abbr, title, count, hasAbbr }
	const addDirectorate = (key, abbr, title) => {
		let d = directorates.get(key);
		if (!d) directorates.set(key, (d = { key, abbr, title, count: 0, hasAbbr: Boolean(abbr) }));
		d.count++;
	};

	const phones = (catalog?.phones ?? []).map((p, i) => ({ p, i, section: sections.get(p.sectionId) ?? NO_SECTION }));
	// Desk phones grouped by section (section order, then array order); DECT after them, by number.
	const dirs = phones.filter(x => x.p.type !== "dect").sort((a, b) => (a.section.order ?? Infinity) - (b.section.order ?? Infinity) || a.i - b.i);
	const dects = phones
		.filter(x => x.p.type === "dect")
		.sort((a, b) => Number(a.p.numbers[0]) - Number(b.p.numbers[0]) || String(a.p.numbers[0]).localeCompare(String(b.p.numbers[0])) || a.i - b.i);

	const records = [];
	for (const { p, section } of [...dirs, ...dects]) {
		const source = p.type === "dect" ? "dect" : "dir";
		const abbr = section.abbr;
		const dirKey = abbr ? abbrKey(abbr) : `name:${section.name}`;
		addDirectorate(dirKey, abbr, section.name);

		const extensions = [];
		const ranges = [];
		for (const n of p.numbers ?? []) {
			const r = parseRange(n);
			if (r) ranges.push(r);
			else extensions.push(String(n).trim());
		}
		const external = p.external ?? [];
		const numbers = (p.numbers ?? []).map(n => {
			const r = parseRange(n);
			return r ? `${r.from}–${r.to}` : String(n).trim();
		});
		const unit = p.unit ?? "";
		const position = p.position ?? "";
		const name = p.name ?? "";

		records.push({
			key: `${source}:${p.id}`,
			source,
			order: records.length,
			numbers,
			searchNumbers: [...extensions, ...expandRanges(ranges), ...ranges.map(r => r.from), ...external.map(x => x.replace(/\D/g, ""))],
			external,
			name,
			position,
			unit,
			dir: abbr || section.name,
			dirKey,
			dirTitle: section.name,
			shared: Boolean(p.shared),
			restricted: Boolean(p.restricted),
			section: source === "dir" ? section : null,
			searchFields: {
				name: { text: name, weight: 1 },
				...(source === "dect" ? { position: { text: position, weight: 0.8 } } : {}),
				unit: { text: unit, weight: 0.85 },
				abbr: { text: abbr, weight: ABBR_WEIGHT },
				...(source === "dir" ? { parent: { text: section.parent, weight: ABBR_WEIGHT } } : {}),
				dir: { text: section.name, weight: 0.6 },
				source: SOURCE_TERMS[source]
			}
		});
	}

	return {
		records,
		directorates: [...directorates.values()].sort((a, b) => (a.abbr || a.title).localeCompare(b.abbr || b.title, "el")),
		title: catalog?.title ?? null,
		info: catalog?.info ?? [],
		meta: { generatedAt: catalog?.updatedAt ?? null }
	};
}
