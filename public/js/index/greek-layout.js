// ── Greek keyboard layout conversion ─────────────────────────────────

/** Standard Greek keyboard layout mapping (Latin key → Greek character). */
export const LATIN_TO_GREEK = {
	a: "α",
	b: "β",
	c: "ψ",
	d: "δ",
	e: "ε",
	f: "φ",
	g: "γ",
	h: "η",
	i: "ι",
	j: "ξ",
	k: "κ",
	l: "λ",
	m: "μ",
	n: "ν",
	o: "ο",
	p: "π",
	r: "ρ",
	s: "σ",
	t: "τ",
	u: "θ",
	v: "ω",
	w: "ς",
	x: "χ",
	y: "υ",
	z: "ζ",
	A: "Α",
	B: "Β",
	C: "Ψ",
	D: "Δ",
	E: "Ε",
	F: "Φ",
	G: "Γ",
	H: "Η",
	I: "Ι",
	J: "Ξ",
	K: "Κ",
	L: "Λ",
	M: "Μ",
	N: "Ν",
	O: "Ο",
	P: "Π",
	R: "Ρ",
	S: "Σ",
	T: "Τ",
	U: "Θ",
	V: "Ω",
	X: "Χ",
	Y: "Υ",
	Z: "Ζ"
};

/**
 * Converts Latin-typed text to Greek using the standard keyboard mapping.
 * If the text already contains Greek characters, it is returned unchanged.
 * @returns {{ query: string, converted: boolean }}
 */
export function toGreekQuery(text) {
	const hasGreek = /[\u0370-\u03FF\u1F00-\u1FFF]/.test(text);
	if (hasGreek) return { query: text, converted: false };
	const converted = text
		.split("")
		.map(ch => LATIN_TO_GREEK[ch] ?? ch)
		.join("");
	return { query: converted, converted: converted !== text };
}

/** Updates the search hint element to show the converted Greek query. */
export function updateSearchHint(raw) {
	const hint = document.getElementById("searchHint");
	if (!hint) return;
	if (!raw) {
		hint.textContent = "";
		return;
	}
	const { query, converted } = toGreekQuery(raw);
	hint.innerHTML = converted ? `Αναζήτηση ως: <span>${query}</span>` : "";
}
