// ── Search ───────────────────────────────────────────────────────────
//
// Every query word must match somewhere in the record (AND semantics).
// Words are matched accent/case-insensitively against each text field:
//
//   word start ("γναθ" → "Γναθοχειρουργικό")  strong
//   anywhere inside a word                    medium
//   in-order letters inside one word (typos)  weak, only for words ≥ 4 letters
//
// Numeric words match the record's numbers (exact > prefix > substring).
// Dots and apostrophes are ignored, so "ωρλ" finds "Ω.Ρ.Λ." and
// "α παθολογικη" finds "Α΄ Παθολογική".
//
// Results carry highlight ranges per field, in original-string indices.

import { foldChar } from "./normalize.js";
import { toGreekQuery } from "./greek-layout.js";

const IGNORED = new Set([".", "'", "΄", "’", "`", "´", "ʼ"]);
const MIN_FUZZY_LENGTH = 4;
const MAX_FUZZY_GAP = 2;

/**
 * Builds a searchable representation of a string: folded characters with
 * ignorable punctuation removed, plus a map back to original indices.
 */
export function prepare(text) {
	const original = String(text ?? "");
	let folded = "";
	const map = [];
	for (let i = 0; i < original.length; i++) {
		const ch = original[i];
		if (IGNORED.has(ch)) continue;
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

/** Best match of a query word inside one prepared field. */
function matchField(word, field) {
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
	if (best) return { quality: best.quality, ranges: [[field.map[best.start], field.map[best.end - 1] + 1]] };

	if (word.length < MIN_FUZZY_LENGTH) return null;
	return fuzzyInWord(word, field);
}

/**
 * In-order letter match confined to a single word of the field, allowing
 * up to MAX_FUZZY_GAP skipped characters in total (handles typos such as
 * "καρδιλογικο" or "γναθοχειρουρικο"). The first letter must match a word start.
 */
function fuzzyInWord(word, field) {
	const s = field.folded;
	for (let start = 0; start < s.length; start++) {
		if (s[start] !== word[0] || isWordChar(s[start - 1])) continue;
		let j = start;
		let gaps = 0;
		const hits = [start];
		let ok = true;
		for (let i = 1; i < word.length; i++) {
			j++;
			while (j < s.length && s[j] !== word[i] && isWordChar(s[j]) && gaps <= MAX_FUZZY_GAP) {
				j++;
				gaps++;
			}
			if (j >= s.length || s[j] !== word[i] || gaps > MAX_FUZZY_GAP) {
				ok = false;
				break;
			}
			hits.push(j);
		}
		if (ok) return { quality: 0.35, ranges: hits.map(h => [field.map[h], field.map[h] + 1]) };
	}
	return null;
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
		fields: Object.fromEntries(Object.entries(record.searchFields).map(([k, v]) => [k, { ...prepare(v.text), weight: v.weight }])),
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
	const words = text.split(/\s+/).map(prepareQueryWord).filter(Boolean);
	if (!words.length) return [];
	const results = [];

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
				const m = matchField(word, field);
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
