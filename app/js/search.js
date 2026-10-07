// ── Search ───────────────────────────────────────────────────────────
//
// Every query word must match somewhere in the record (AND semantics).
// Words are matched accent/case-insensitively against each text field:
//
//   word start ("γναθ" → "Γναθοχειρουργικό")  strong
//   anywhere inside a word                    medium
//   with typos (see below)                    weak
//
// Typos: a query word of 4+ letters that matches nothing exactly anywhere
// is compared with the start of every word using an edit distance that
// counts wrong, missing, extra and swapped letters (the first letter must be
// right). Allowed mistakes: 1 for 4–5 letters, 2 for 6–10, 3 for 11+.
// Common Greek spelling confusions (ο/ω, ι/η/υ) cost nothing. Words with
// exact hits are never matched loosely, so short queries like "γραμ" stay
// precise.
//
// Numeric words match the record's numbers (exact > prefix > substring).
// Dots and apostrophes are ignored, so "ωρλ" finds "Ω.Ρ.Λ." and
// "α παθολογικη" finds "Α΄ Παθολογική".
//
// Abbreviations typed with dots ("ΣΜ.Τ-Η") also match regardless of spaces
// ("ΣΜ. Τ-Η" in the directory, "ΣΜ.Τ-Η" in the DECT file).
//
// Greek words made only of letters that have Latin twins (Α Β Ε Η Ι Κ Μ Ν Ο
// Ρ Τ Υ Χ Ζ) also try the Latin spelling, because the source files sometimes
// contain look-alike Latin letters (e.g. "(AAYE)" in the directory).
//
// Results carry highlight ranges per field, in original-string indices.

import { foldChar } from "./normalize.js";
import { toGreekQuery } from "./greek-layout.js";

const IGNORED = new Set([".", "'", "΄", "’", "`", "´", "ʼ"]);
const MIN_FUZZY_LENGTH = 4;

/** Folded Greek letters → identical-looking Latin letters (folded). */
const LATIN_TWIN = { α: "a", β: "b", ε: "e", η: "h", ι: "i", κ: "k", μ: "m", ν: "n", ο: "o", ρ: "p", τ: "t", υ: "y", χ: "x", ζ: "z" };

/** The word itself plus its Latin look-alike spelling, when every letter has one. */
function alternatives(word) {
	if (!/[α-ω]/.test(word)) return [word];
	let latin = "";
	for (const ch of word) {
		if (/\d/.test(ch)) latin += ch;
		else if (LATIN_TWIN[ch]) latin += LATIN_TWIN[ch];
		else return [word];
	}
	return [word, latin];
}

/** Allowed mistakes for a query word of the given length. */
const maxTypos = len => (len < MIN_FUZZY_LENGTH ? 0 : len <= 5 ? 1 : len <= 10 ? 2 : 3);

/** Letters that are commonly confused in Greek spelling (folded forms). */
const SOUND = { ω: "ο", η: "ι", υ: "ι" };
const sound = ch => SOUND[ch] ?? ch;

/**
 * Builds a searchable representation of a string: folded characters with
 * ignorable punctuation (and optionally whitespace) removed, plus a map back
 * to original indices.
 */
export function prepare(text, { dropSpaces = false } = {}) {
	const original = String(text ?? "");
	let folded = "";
	const map = [];
	for (let i = 0; i < original.length; i++) {
		const ch = original[i];
		if (IGNORED.has(ch) || (dropSpaces && /\s/.test(ch))) continue;
		folded += foldChar(ch);
		map.push(i);
	}
	return { original, folded, map };
}

/** Normalizes a query word the same way as field text. */
function prepareQueryWord(word) {
	let out = "";
	for (const ch of word) if (!IGNORED.has(ch)) out += foldChar(ch);
	return out;
}

const isWordChar = ch => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Exact (non-typo) match of a query word inside one prepared field. */
function matchExact(word, field) {
	const s = field.folded;
	let best = null;

	let idx = s.indexOf(word);
	while (idx >= 0) {
		const atStart = !isWordChar(s[idx - 1]);
		const wholeWord = atStart && !isWordChar(s[idx + word.length]);
		const quality = wholeWord ? 1.2 : atStart ? 1 : 0.6;
		if (!best || quality > best.quality) {
			best = { quality, start: idx, end: idx + word.length };
			if (wholeWord) break;
		}
		idx = s.indexOf(word, idx + 1);
	}
	return best && { quality: best.quality, ranges: [[field.map[best.start], field.map[best.end - 1] + 1]] };
}

/**
 * Typo-tolerant match: the smallest edit distance (optimal string alignment,
 * i.e. with adjacent swaps) between the query word and the beginning of any
 * word in the field. Returns null when it exceeds the allowed mistakes.
 */
function matchTypo(word, field) {
	const limit = maxTypos(word.length);
	if (!limit) return null;
	const q = soundFold(word);
	let best = null;

	for (const w of field.words) {
		// Typos rarely hit the first letter; requiring it keeps results relevant.
		if (w.text[0] !== q[0] || w.text.length < q.length - limit) continue;
		const r = prefixDistance(q, w.text, limit);
		if (r && (!best || r.distance < best.distance)) {
			best = { distance: r.distance, start: w.start, end: w.start + r.length };
			if (r.distance === 0) break;
		}
	}
	if (!best) return null;
	return {
		quality: 0.45 - 0.08 * best.distance,
		ranges: [[field.map[best.start], field.map[Math.max(best.start, best.end - 1)] + 1]]
	};
}

const soundFold = text => {
	let out = "";
	for (const ch of text) out += sound(ch);
	return out;
};

/** Words of a prepared field (start offsets in the folded string), for typo matching. */
function fieldWords(folded) {
	const words = [];
	for (const m of folded.matchAll(/[\p{L}\p{N}]+/gu)) words.push({ start: m.index, text: soundFold(m[0]) });
	return words;
}

/**
 * Edit distance between `q` and the closest prefix of `w` (so a partly typed
 * word still matches). Rows past the limit are cut short.
 * @returns {{ distance: number, length: number } | null}
 */
function prefixDistance(q, w, limit) {
	const m = q.length;
	const n = w.length;
	let prev2 = null;
	let prev = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= m; i++) {
		const cur = [i];
		let rowMin = i;
		for (let j = 1; j <= n; j++) {
			const cost = q[i - 1] === w[j - 1] ? 0 : 1;
			let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
			if (i > 1 && j > 1 && q[i - 1] === w[j - 2] && q[i - 2] === w[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
			cur.push(d);
			if (d < rowMin) rowMin = d;
		}
		if (rowMin > limit) return null;
		prev2 = prev;
		prev = cur;
	}
	let distance = Infinity;
	let length = 0;
	for (let j = 0; j <= n; j++) {
		if (prev[j] < distance) {
			distance = prev[j];
			length = j;
		}
	}
	return distance <= limit ? { distance, length } : null;
}

/** Matches a numeric word against a record's numbers. */
function matchNumber(word, numbers) {
	let best = null;
	for (const n of numbers) {
		const idx = n.indexOf(word);
		if (idx < 0) continue;
		const quality = n === word ? 3 : idx === 0 ? 2 : 1;
		if (!best || quality > best.quality) best = { quality, number: n, start: idx, end: idx + word.length };
	}
	return best;
}

/**
 * Builds the search index.
 * @param {object[]} records  records from data.js
 */
export function buildIndex(records) {
	return records.map(record => ({
		record,
		fields: Object.fromEntries(
			Object.entries(record.searchFields).map(([k, v]) => {
				const prepared = prepare(v.text);
				return [k, { ...prepared, compact: prepare(v.text, { dropSpaces: true }), words: fieldWords(prepared.folded), weight: v.weight }];
			})
		),
		numbers: record.searchNumbers
	}));
}

/** Splits a query into words, keeping Latin and Greek-converted variants. */
export function queryVariants(raw) {
	const trimmed = String(raw ?? "").trim();
	if (!trimmed) return [];
	const { query, converted } = toGreekQuery(trimmed);
	return converted ? [query, trimmed] : [trimmed];
}

function searchVariant(index, text) {
	const rawWords = text.split(/\s+/).filter(w => prepareQueryWord(w));
	const words = rawWords.map(prepareQueryWord);
	// Dotted words are abbreviations: also try them against the text without spaces.
	const dotted = new Set(rawWords.filter(w => /\.\S/.test(w)).map(prepareQueryWord));
	if (!words.length) return [];
	const results = [];

	const alts = new Map(
		words.map(word => {
			const texts = alternatives(word);
			const list = texts.map(text => ({ text, compact: false }));
			if (dotted.has(word)) list.push(...texts.map(text => ({ text, compact: true })));
			return [word, list];
		})
	);
	const fieldFor = (field, alt) => (alt.compact ? field.compact : field);

	// Typo matching only for words that match nothing exactly anywhere.
	const loose = new Set(
		words.filter(
			word =>
				!/^\d+$/.test(word) &&
				maxTypos(word.length) > 0 &&
				!index.some(item => Object.values(item.fields).some(f => alts.get(word).some(alt => fieldFor(f, alt).folded.includes(alt.text))))
		)
	);

	for (const item of index) {
		let score = 0;
		const highlights = {};
		let ok = true;

		for (const word of words) {
			let best = null;
			if (/^\d+$/.test(word)) {
				const m = matchNumber(word, item.numbers);
				if (m) best = { score: m.quality * 2, number: m };
			}
			for (const [key, field] of Object.entries(item.fields)) {
				let m = null;
				for (const alt of alts.get(word)) {
					const e = matchExact(alt.text, fieldFor(field, alt));
					if (e && (!m || e.quality > m.quality)) m = e;
				}
				m ??= loose.has(word) ? matchTypo(word, field) : null;
				if (!m) continue;
				const s = m.quality * field.weight;
				if (!best || s > best.score) best = { score: s, key, ranges: m.ranges };
			}
			if (!best) {
				ok = false;
				break;
			}
			score += best.score;
			if (best.number) {
				(highlights.numbers ??= []).push(best.number);
			} else {
				(highlights[best.key] ??= []).push(...best.ranges);
			}
		}

		if (ok) results.push({ record: item.record, score, highlights });
	}
	return results;
}

/**
 * Searches the index. Returns results sorted by score (best first).
 * @returns {{ record: any, score: number, highlights: any }[]}
 */
export function search(index, raw) {
	const variants = queryVariants(raw);
	const best = new Map();
	for (const v of variants) {
		for (const r of searchVariant(index, v)) {
			const prev = best.get(r.record.key);
			if (!prev || r.score > prev.score) best.set(r.record.key, r);
		}
	}
	return [...best.values()].sort((a, b) => b.score - a.score || a.record.order - b.record.order);
}

/** Wraps highlight ranges of `text` in <mark>, escaping HTML. */
export function highlight(text, ranges) {
	const s = String(text ?? "");
	if (!ranges || !ranges.length) return escapeHtml(s);
	const sorted = ranges
		.map(([a, b]) => [Math.max(0, a), Math.min(s.length, b)])
		.filter(([a, b]) => b > a)
		.sort((x, y) => x[0] - y[0]);
	const merged = [];
	for (const r of sorted) {
		const last = merged[merged.length - 1];
		if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
		else merged.push([...r]);
	}
	let out = "";
	let pos = 0;
	for (const [a, b] of merged) {
		out += escapeHtml(s.slice(pos, a)) + "<mark>" + escapeHtml(s.slice(a, b)) + "</mark>";
		pos = b;
	}
	return out + escapeHtml(s.slice(pos));
}

export function escapeHtml(s) {
	return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
