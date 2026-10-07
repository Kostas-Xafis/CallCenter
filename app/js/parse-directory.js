// ── Telephone directory (.txt) parser ────────────────────────────────
//
// Input is the plain text of THL_KATALOGOS (one paragraph per line, tab
// between the description and its numbers), i.e. Word "Save as → Plain text".
//
// The document is a sequence of blank-line separated blocks:
//
//   <section heading>                     e.g. "Διεύθυνση Τομέα Εργαστηρίων (ΔΤΕ)"
//   <path>. <path>. <label> \t <numbers>  e.g. "Βιοπαθολογία. Αιμοδοσία\t4332,4384\t\t210-7786449"
//   <sub-heading>                         (only inside some sections, e.g. ΚΑΙ)
//
// Output schema (all strings trimmed):
//
//   Section { id, name, abbr, parent, heading }
//     name    "Διεύθυνση Τομέα Εργαστηρίων"
//     abbr    "ΔΤΕ"                       (null when the heading has none)
//     parent  "ΔΥΠ"                       for headings like "ΔΥΠ / Σμήνος …"
//     heading the original heading line   (null for blocks without a heading)
//
//   Entry { id, sectionId, path[], label, extensions[], ranges[], external[], raw, line }
//     path        ["Βιοπαθολογία"]         dotted prefixes and sub-headings
//     label       "Αιμοδοσία"
//     extensions  ["4332","4384"]          individually listed internal numbers
//     ranges      [{from:"5501",to:"5511"}] "5501 έως 5511"
//     external    ["210-7786449"]          outside lines
//     raw/line    original text and 1-based line number, for diagnostics

/**
 * @typedef {{ id: number, name: string, abbr: string|null, parent: string|null, heading: string|null }} Section
 * @typedef {{ from: string, to: string }} Range
 * @typedef {{ id: number, sectionId: number, path: string[], label: string, extensions: string[], ranges: Range[], external: string[], raw: string, line: number }} Entry
 * @typedef {{ line: number|null, raw: string, message: string }} ParseWarning
 */

const EXTERNAL_RE = /\b(?:2\d{2}\s?-\s?\d{3}\s?\d{4}|2\d{9}|69\d{8})\b/g;
const RANGE_RE = /(\d{2,5})\s*(?:έως|εως|-|–)\s*(?:και\s*)?(\d{2,5})/g;
const NUMBER_RE = /\d{2,5}/g;
const MAX_RANGE_EXPANSION = 100;

const HEADLESS_FIRST_BLOCK_NAME = "Διοίκηση";
const HEADLESS_BLOCK_NAME = "Γενικά";

/** Converts the "Plain text" export of the Word document into clean lines. */
export function toLines(text) {
	return String(text ?? "")
		.replace(/^﻿/, "")
		.replace(/\r\x07/g, "\t") // Word table cell end markers
		.replace(/\x07/g, "\t")
		.replace(/\r\n?|[\v\f\u2028\u2029]/g, "\n")
		.replace(/\x1e/g, "-") // non-breaking hyphen
		.replace(/[\x1f­]/g, "") // optional hyphen
		.replace(/ /g, " ")
		.replace(/…+|\.{3,}/g, "\t") // dot leaders used instead of tabs
		.split("\n");
}

const isBlank = line => line.trim() === "";
const hasLowercase = s => /[a-zα-ωάέήίόύώϊϋΐΰ]/.test(s);

/** Splits a raw line into description and number part, or null for text lines. */
function splitEntry(line) {
	const tab = line.indexOf("\t");
	if (tab >= 0) {
		const rest = line.slice(tab + 1);
		if (/\d/.test(rest)) return { label: line.slice(0, tab), numbers: rest };
		return null;
	}
	// Fallback: numbers separated by spaces only ("Κάτι   4011,4012")
	const m = line.match(/^(.*?\S)\s{2,}(\d{2,5}(?:\s*,\s*\d{2,5})*)\s*$/);
	return m ? { label: m[1], numbers: m[2] } : null;
}

/** Parses the number part of an entry. */
export function parseNumbers(text) {
	let rest = String(text);
	const external = [];
	const ranges = [];
	const extensions = [];

	rest = rest.replace(EXTERNAL_RE, m => {
		external.push(m.replace(/\s+/g, "").replace(/^(\d{3})-?(\d{7})$/, "$1-$2"));
		return " ";
	});
	rest = rest.replace(RANGE_RE, (_, from, to) => {
		ranges.push({ from, to });
		return " ";
	});
	rest = rest.replace(NUMBER_RE, m => {
		extensions.push(m);
		return " ";
	});

	const leftover = rest.replace(/[\s,;&/]+/g, "").replace(/^(και)+$/, "");
	return { extensions, ranges, external, leftover };
}

/** Expands ranges into individual numbers (used for searching). */
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

/**
 * Splits "Βιοπαθολογία. Αιματολογικό. Εργαστήριο" into path segments.
 *
 * A ". " only separates segments when the word before it is a complete
 * word (ends in a vowel, ς, -ων or a digit — Greek abbreviations such as
 * "Εργ.", "Κλιν.", "Υγειον." end in a consonant) or when the whole segment
 * so far is an acronym ("Ω.Ρ.Λ.", "ΚΕΠΙΚ").
 */
export function splitPath(label) {
	const text = String(label).trim();
	const segments = [];
	let start = 0;
	const re = /\.(?=\s|$)/g;
	let m;
	while ((m = re.exec(text))) {
		const segment = text.slice(start, m.index).trim();
		const lastWord = segment.split(/\s+/).pop() ?? "";
		const isAcronym = /^[Α-ΩA-Z0-9][Α-ΩA-Z0-9.\-]*$/.test(segment) && segment.length >= 2;
		const isWord = !lastWord.includes(".") && /(?:[αεηιουωάέήίόύώϊϋΐΰςΑΕΗΙΟΥΩΆΈΉΊΌΎΏ0-9]|[ωώΩ][νΝ])$/.test(lastWord);
		if (!segment || !(isAcronym || isWord)) continue;
		segments.push(isAcronym && segment.includes(".") ? segment + "." : segment);
		start = m.index + 1;
	}
	const tail = text.slice(start).trim();
	if (tail) segments.push(tail);
	return segments;
}

/** Parses a section heading: "ΔΥΠ / Σμήνος Μεταφορικών Μέσων (ΣΜΜ)" etc. */
export function parseHeading(text) {
	let t = text.replace(/\s+/g, " ").trim();
	let parent = null;
	let org = null;
	let abbr = null;
	let name = t;

	const parentMatch = t.match(/^([^\s/()]+)\s*\/\s*(.+)$/);
	if (parentMatch && !hasLowercase(parentMatch[1])) {
		parent = parentMatch[1];
		t = parentMatch[2];
	}
	const orgMatch = t.match(/^(.*\([^)]*\))\s*\/\s*(\S.*)$/);
	if (orgMatch) {
		t = orgMatch[1];
		org = orgMatch[2].trim();
	}
	const paren = t.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
	if (paren) {
		const [, outside, inside] = paren;
		if (!hasLowercase(inside)) {
			name = outside;
			abbr = inside.trim();
		} else if (!hasLowercase(outside)) {
			name = inside.trim();
			abbr = outside;
		} else {
			name = t;
		}
	} else {
		name = t;
		if (!hasLowercase(t) && !/\s/.test(t) && t.length <= 10) abbr = t;
	}
	if (org) {
		name = `${name} / ${org}`;
		if (abbr) abbr = `${abbr}/${org}`;
	}
	return { name: name.trim(), abbr, parent };
}

function firstSegment(label) {
	const parts = splitPath(label);
	return parts.length > 1 ? parts[0] : null;
}

/**
 * Parses the directory text.
 * @param {string} text
 * @returns {{ title: string|null, info: string[], sections: Section[], entries: Entry[], warnings: ParseWarning[] }}
 */
export function parseDirectory(text) {
	const lines = toLines(text);
	/** @type {ParseWarning[]} */
	const warnings = [];
	/** @type {(Section & { stripSegment?: string })[]} */
	const sections = [];
	/** @type {Entry[]} */
	const entries = [];

	// ── Group into blank-line separated blocks ──
	const blocks = [];
	let current = null;
	lines.forEach((raw, i) => {
		if (isBlank(raw)) {
			current = null;
			return;
		}
		if (!current) blocks.push((current = []));
		current.push({ raw, line: i + 1, entry: splitEntry(raw) });
	});

	// ── Preamble: every block before the first one that holds an entry ──
	let title = null;
	const info = [];
	let b = 0;
	for (; b < blocks.length; b++) {
		const block = blocks[b];
		const firstEntryIdx = block.findIndex(l => l.entry);
		if (firstEntryIdx === 0) break;
		if (firstEntryIdx > 0) {
			// Heading directly followed by entries → real section, stop here.
			// Any lines before the heading itself still belong to the preamble.
			break;
		}
		for (const l of block) {
			const t = l.raw.replace(/\s+/g, " ").trim();
			if (/:/.test(t)) info.push(t);
			else if (!title) title = t;
			else title = `${title} — ${t}`;
		}
	}

	// ── Sections ──
	let firstContentBlock = true;
	for (; b < blocks.length; b++) {
		const block = blocks[b];
		let idx = 0;
		let section;

		if (!block[0].entry) {
			section = { id: sections.length, ...parseHeading(block[0].raw), heading: block[0].raw.trim() };
			idx = 1;
		} else {
			section = headlessSection(block, firstContentBlock, sections.length);
		}
		sections.push(section);
		firstContentBlock = false;

		let subheadings = [];
		let pendingPrefix = "";
		let lastEntry = null;

		for (; idx < block.length; idx++) {
			const l = block[idx];

			if (!l.entry) {
				const t = l.raw.trim();
				const next = block[idx + 1];
				const isWrap =
					next?.entry &&
					(/\s$/.test(l.raw) || (lastEntry && firstSegment(t) && firstSegment(t) === lastEntry.path[0]));
				if (isWrap) {
					pendingPrefix += t + " ";
				} else if (/^Διεύθυνση/i.test(t) || !subheadings.length) {
					subheadings = [t];
				} else if (/^Τμήμα/i.test(t) && /^Διεύθυνση/i.test(subheadings[0])) {
					subheadings = [subheadings[0], t];
				} else {
					subheadings = [t];
				}
				continue;
			}

			const label = (pendingPrefix + l.entry.label).replace(/\s+/g, " ").trim();
			pendingPrefix = "";
			const nums = parseNumbers(l.entry.numbers);
			if (nums.leftover) {
				warnings.push({ line: l.line, raw: l.raw, message: `Μη αναγνωρίσιμο τμήμα αριθμών: "${nums.leftover}"` });
			}

			// Continuation line: no description, only more numbers for the previous entry.
			if (!label && lastEntry) {
				lastEntry.extensions.push(...nums.extensions);
				lastEntry.ranges.push(...nums.ranges);
				lastEntry.external.push(...nums.external);
				lastEntry.raw += "\n" + l.raw;
				continue;
			}
			if (!label) {
				warnings.push({ line: l.line, raw: l.raw, message: "Αριθμοί χωρίς περιγραφή" });
			}

			let segments = splitPath(label);
			if (section.stripSegment && segments.length > 1 && segments[0] === section.stripSegment) {
				segments = segments.slice(1);
			}
			const entryLabel = segments.pop() ?? "";
			const entry = {
				id: entries.length,
				sectionId: section.id,
				path: [...subheadings, ...segments],
				label: entryLabel,
				extensions: nums.extensions,
				ranges: nums.ranges,
				external: nums.external,
				raw: l.raw,
				line: l.line
			};
			entries.push(entry);
			lastEntry = entry;
		}

		if (pendingPrefix) {
			warnings.push({ line: block[block.length - 1].line, raw: pendingPrefix, message: "Γραμμή χωρίς αριθμό στο τέλος ενότητας" });
		}
		delete section.stripSegment;
	}

	// Sections that ended up with no entries are noise (e.g. stray headings)
	const used = new Set(entries.map(e => e.sectionId));
	for (const s of sections) {
		if (!used.has(s.id)) warnings.push({ line: null, raw: s.heading ?? s.name, message: "Ενότητα χωρίς αριθμούς" });
	}

	return { title, info, sections: sections.filter(s => used.has(s.id)), entries, warnings };
}

/** Names a block that starts directly with entries (no heading line). */
function headlessSection(block, isFirst, id) {
	const entryLines = block.filter(l => l.entry);
	if (entryLines.length === 1 && block.length === 1) {
		// A lone line such as "Γραφείο Ασφάλειας Εδάφους (ΓΑΕ)\t4135"
		const label = entryLines[0].entry.label.trim();
		return { id, ...parseHeading(label), heading: null };
	}
	const firsts = entryLines.map(l => firstSegment(l.entry.label));
	if (firsts[0] && firsts.every(f => f === firsts[0])) {
		return { id, ...parseHeading(firsts[0]), heading: null, stripSegment: firsts[0] };
	}
	return { id, name: isFirst ? HEADLESS_FIRST_BLOCK_NAME : HEADLESS_BLOCK_NAME, abbr: null, parent: null, heading: null };
}
