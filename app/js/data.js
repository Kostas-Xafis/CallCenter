// ── Data model ───────────────────────────────────────────────────────
//
// Turns the payload embedded by update.ps1 into display records shared by
// both sources:
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
//     section        directory section (for grouping)
//   }

import { parseDirectory, expandRanges } from "./parse-directory.js";
import { parseDect } from "./parse-dect.js";
import { parseCsv } from "./parse-csv.js";
import { base64ToBytes, decodeBytes, looksGreek } from "./decode.js";
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

/** Reads the JSON payload embedded in the page. */
export function readEmbeddedPayload(doc = document) {
	const el = doc.getElementById("catalog-data");
	if (!el) return null;
	try {
		return JSON.parse(el.textContent || "null");
	} catch (err) {
		console.error("Μη έγκυρα ενσωματωμένα δεδομένα", err);
		return null;
	}
}

/**
 * Decodes one embedded source file ({ file, modified, base64 }).
 * @returns {{ text: string, encoding: string } | null}
 */
function decodeSource(source, label, warnings, key) {
	if (!source) return null;
	try {
		const decoded = decodeBytes(base64ToBytes(source.base64 ?? ""));
		if (decoded.text.trim() && !looksGreek(decoded.text)) {
			warnings.push({
				source: key,
				message: `Το αρχείο ${label} «${source.file}» δεν περιέχει ελληνικούς χαρακτήρες — πιθανώς αποθηκεύτηκε με λάθος κωδικοποίηση (επιλέξτε UTF-8).`
			});
		}
		return decoded;
	} catch (err) {
		warnings.push({ source: key, message: `Αδύνατη η ανάγνωση του αρχείου ${label} «${source.file}»: ${err.message}` });
		return null;
	}
}

/** Builds the application model from the payload. */
export function buildModel(payload) {
	const warnings = [];
	const records = [];
	const restricted = new Set((payload?.restricted ?? []).map(String));
	const directorates = new Map(); // dirKey → { key, abbr, title, count, hasAbbr }

	const addDirectorate = (key, abbr, title) => {
		let d = directorates.get(key);
		if (!d) directorates.set(key, (d = { key, abbr, title, count: 0, hasAbbr: Boolean(abbr) }));
		if (!d.title && title) d.title = title;
		d.count++;
		return d;
	};

	// ── Decode & parse ──
	const dectSource = decodeSource(payload?.dect, "DECT", warnings, "dect");
	const dirSource = decodeSource(payload?.directory, "καταλόγου", warnings, "dir");

	const dect = parseDect(dectSource ? parseCsv(dectSource.text) : []);
	if (dectSource) warnings.push(...dect.warnings.map(w => ({ source: "dect", ...w })));

	const directory = dirSource ? parseDirectory(dirSource.text) : null;
	if (directory) warnings.push(...directory.warnings.map(w => ({ source: "dir", ...w })));

	// Full directorate names come from the directory headings ("Διεύθυνση Τομέα Εργαστηρίων (ΔΤΕ)").
	const lookup = new Map();
	for (const s of directory?.sections ?? []) {
		if (s.abbr && !lookup.has(abbrKey(s.abbr))) lookup.set(abbrKey(s.abbr), s.name);
	}

	if (directory) {
		const sectionById = new Map(directory.sections.map(s => [s.id, s]));
		for (const e of directory.entries) {
			const section = sectionById.get(e.sectionId);
			const abbr = section.abbr;
			const key = abbr ? abbrKey(abbr) : `name:${section.name}`;
			const title = section.name;
			addDirectorate(key, abbr, title);

			const numbers = [...e.extensions, ...e.ranges.map(r => `${r.from}–${r.to}`)];
			records.push({
				key: `dir:${e.id}`,
				source: "dir",
				order: records.length,
				numbers,
				searchNumbers: [...e.extensions, ...expandRanges(e.ranges), ...e.ranges.map(r => r.from), ...e.external.map(x => x.replace(/\D/g, ""))],
				external: e.external,
				name: e.label,
				position: "",
				unit: e.path.join(" › "),
				dir: abbr || section.name,
				dirKey: key,
				dirTitle: title,
				shared: false,
				restricted: [...e.extensions, ...expandRanges(e.ranges)].some(n => restricted.has(n)),
				section,
				raw: e.raw,
				searchFields: {
					name: { text: e.label, weight: 1 },
					unit: { text: e.path.join(" › "), weight: 0.85 },
					abbr: { text: abbr ?? "", weight: ABBR_WEIGHT },
					parent: { text: section.parent ?? "", weight: ABBR_WEIGHT },
					dir: { text: section.name, weight: 0.6 },
					source: SOURCE_TERMS.dir
				}
			});
		}
	}

	// ── DECT records (sorted by number) ──
	const dectSorted = [...dect.records].sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number));
	for (const r of dectSorted) {
		const key = r.dir ? abbrKey(r.dir) : "name:—";
		const title = lookup.get(abbrKey(r.dir)) || "";
		addDirectorate(key, r.dir || "—", title);
		records.push({
			key: `dect:${r.id}`,
			source: "dect",
			order: records.length,
			numbers: [r.number],
			searchNumbers: [r.number],
			external: [],
			name: r.name,
			position: r.position,
			unit: r.unit,
			dir: r.dir,
			dirKey: key,
			dirTitle: title,
			shared: r.shared,
			restricted: restricted.has(r.number),
			section: null,
			searchFields: {
				name: { text: r.name, weight: 1 },
				position: { text: r.position, weight: 0.8 },
				unit: { text: r.unit, weight: 0.85 },
				abbr: { text: r.dir, weight: ABBR_WEIGHT },
				dir: { text: title, weight: 0.6 },
				source: SOURCE_TERMS.dect
			}
		});
	}

	return {
		records,
		directorates: [...directorates.values()].sort((a, b) => (a.abbr || a.title).localeCompare(b.abbr || b.title, "el")),
		title: directory?.title ?? null,
		info: directory?.info ?? [],
		warnings,
		meta: {
			generatedAt: payload?.generatedAt ?? null,
			dect: dectSource
				? { file: payload.dect.file, modified: payload.dect.modified, encoding: dectSource.encoding, count: dect.records.length }
				: null,
			directory: dirSource
				? { file: payload.directory.file, modified: payload.directory.modified, encoding: dirSource.encoding, count: directory.entries.length }
				: null,
			restrictedCount: restricted.size
		}
	};
}
