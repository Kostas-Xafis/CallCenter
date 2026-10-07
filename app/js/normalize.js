// ── Text normalization ───────────────────────────────────────────────
//
// Search works on a "folded" form of every string: lowercase, no Greek
// accents/diaeresis, final sigma → sigma. Folding is done per character so
// the folded string has exactly the same length as the original, which
// lets match positions be used directly for highlighting.

const LATIN_LOOKALIKES = {
	A: "Α", B: "Β", E: "Ε", H: "Η", I: "Ι", K: "Κ", M: "Μ", N: "Ν",
	O: "Ο", P: "Ρ", T: "Τ", X: "Χ", Y: "Υ", Z: "Ζ"
};

const foldCache = new Map();

/** Folds a single character (always returns exactly one character). */
export function foldChar(ch) {
	let out = foldCache.get(ch);
	if (out !== undefined) return out;
	out = ch.normalize("NFD").charAt(0).toLowerCase();
	if (out === "ς") out = "σ";
	if (out.length !== 1) out = ch.toLowerCase().charAt(0) || ch;
	foldCache.set(ch, out);
	return out;
}

/** Length-preserving fold used for searching and highlighting. */
export function fold(text) {
	let out = "";
	for (const ch of String(text ?? "")) out += foldChar(ch);
	return out;
}

/**
 * Canonical key for an organizational abbreviation, so that "Ε.Ι." and
 * "ΕΙ", "ΣΜ. Τ-Η" and "ΣΜ.Τ-Η", or "AAYE" (Latin) and "ΑΑΥΕ" compare equal.
 */
export function abbrKey(text) {
	return String(text ?? "")
		.toUpperCase()
		.replace(/[ABEHIKMNOPTXYZ]/g, ch => LATIN_LOOKALIKES[ch])
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[\s.]/g, "");
}

/** Collapses whitespace and trims. */
export function clean(text) {
	return String(text ?? "")
		.replace(/[\s ]+/g, " ")
		.trim();
}
