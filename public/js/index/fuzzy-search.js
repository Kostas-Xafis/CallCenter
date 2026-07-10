// ── Client-side fuzzy search (ported from src/fuzzy_search.ts) ──────

export class FuzzySearch {
	constructor(data) {
		this.data = data;
	}

	_customDistance(q, s) {
		let distance = 0;
		let lastMatchIndex = -1;
		let matchedChars = 0;
		const matchesIdx = [];
		outer: for (let i = 0; i < q.length; i++) {
			const qChar = q.charAt(i);
			let found = false;
			for (let j = lastMatchIndex + 1; j < s.length; j++) {
				if (qChar === s.charAt(j)) {
					lastMatchIndex = j;
					matchesIdx.push(j);
					matchedChars++;
					found = true;
					continue outer;
				} else {
					distance += 1;
				}
			}
			if (!found) distance += s.length;
		}
		distance += s.length - matchedChars;
		return [distance, matchesIdx];
	}

	search(query, threshold = 0.3) {
		const results = this.data
			.map((item, index) => {
				const [distance, matchesIdx] = this._customDistance(query.toLowerCase(), item.toLowerCase());
				const maxLen = Math.max(query.length, item.length);
				const score = Math.exp(-distance / (maxLen * 2));
				return { item, score, matchesIdx, index };
			})
			.filter(r => r.score >= threshold);
		results.sort((a, b) => b.score - a.score);
		return results.map(r => ({ item: r.item, matchesIdx: r.matchesIdx, index: r.index }));
	}
}

// ── Record-level fuzzy search ────────────────────────────────────────

/**
 * Replicates phone_repository.ts fuzzySearch() entirely on the client.
 * Handles merged records (multiple services per record) by searching
 * each service+code combination independently.
 */
export function clientFuzzySearch(records, query, threshold = 0.4) {
	// ── Exact code search for purely numeric queries ───────────────────
	// When the user searches for a specific phone code (e.g. "4021"),
	// use exact substring matching on the code field so that "4021"
	// never matches "4022", "4023", etc.
	if (/^\d+$/.test(query.trim())) {
		const seen = new Set();
		const results = [];
		for (const record of records) {
			if (seen.has(record.id)) continue;
			const code = String(record.code);
			if (!code.includes(query)) continue;
			seen.add(record.id);

			// Compute highlight indices only for non-merged records
			let matchesIdx = [];
			if (!record.merged) {
				const searchableStr = `${record.service} ${record.code}`;
				const codePos = searchableStr.lastIndexOf(code);
				const queryPosInCode = code.indexOf(query);
				if (codePos >= 0) {
					matchesIdx = Array.from({ length: query.length }, (_, i) => codePos + queryPosInCode + i);
				}
			}
			results.push({ ...record, matchesIdx });
		}
		return results;
	}

	// ── Standard fuzzy search (service name + code) ────────────────────
	const searchableItems = [];
	const itemToRecord = [];

	for (const record of records) {
		if (record.merged) {
			const services = JSON.parse(record.service);
			for (const s of services) {
				searchableItems.push(`${s} ${record.code}`);
				itemToRecord.push(record);
			}
		} else {
			searchableItems.push(`${record.service} ${record.code}`);
			itemToRecord.push(record);
		}
	}

	const fuzzy = new FuzzySearch(searchableItems);
	const results = fuzzy.search(query, threshold);

	const seen = new Set();
	return results.flatMap(result => {
		const record = itemToRecord[result.index];
		if (!record || seen.has(record.id)) return [];
		seen.add(record.id);
		const matchesIdx = record.merged ? [] : result.matchesIdx;
		return [{ ...record, matchesIdx }];
	});
}

// ── Highlight helpers ─────────────────────────────────────────────────

/** Returns indices of characters in `subject` that match `query` chars in order. */
export function fuzzyMatchIndices(query, subject) {
	const q = query.toLowerCase();
	const s = subject.toLowerCase();
	let lastMatchIndex = -1;
	let matchedChars = 0;
	const matchesIdx = [];
	outer: for (let i = 0; i < q.length; i++) {
		const qChar = q[i];
		for (let j = lastMatchIndex + 1; j < s.length; j++) {
			if (qChar === s[j]) {
				lastMatchIndex = j;
				matchesIdx.push(j);
				matchedChars++;
				continue outer;
			}
		}
	}
	return matchedChars > 0 ? matchesIdx : [];
}

export const highlightString = text => `<span class="highlight">${text}</span>`;

export function highlightStringAt(text, indices) {
	if (!indices || indices.length === 0) return text;

	const normalizedIndices = [...new Set(indices)].filter(i => Number.isInteger(i) && i >= 0 && i < text.length).sort((a, b) => a - b);

	if (normalizedIndices.length === 0) return text;

	let result = "";
	let lastIndex = 0;
	let rangeStart = normalizedIndices[0];
	let rangeEnd = normalizedIndices[0];

	for (let i = 1; i < normalizedIndices.length; i++) {
		const index = normalizedIndices[i];
		if (index === rangeEnd + 1) {
			rangeEnd = index;
			continue;
		}
		result += text.slice(lastIndex, rangeStart);
		result += highlightString(text.slice(rangeStart, rangeEnd + 1));
		lastIndex = rangeEnd + 1;
		rangeStart = index;
		rangeEnd = index;
	}

	result += text.slice(lastIndex, rangeStart);
	result += highlightString(text.slice(rangeStart, rangeEnd + 1));
	result += text.slice(rangeEnd + 1);
	return result;
}
