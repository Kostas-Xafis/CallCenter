// ── Source file decoding ─────────────────────────────────────────────
//
// update.ps1 embeds the exported files byte for byte (base64), so the page
// decides the encoding. Windows exports can be in any of:
//
//   Excel "CSV UTF-8" / Notepad / Word "Unicode (UTF-8)"  → UTF-8 (with or without BOM)
//   Word "Unicode", some Notepad versions                 → UTF-16 LE/BE with BOM
//   Excel "CSV (οριοθετημένο με κόμματα)", Word "Windows"  → Windows-1253 (Greek ANSI)
//
// Order: BOM → UTF-16 without BOM (many NUL bytes) → strict UTF-8 → Windows-1253.

/** @param {string} base64 */
export function base64ToBytes(base64) {
	const bin = atob(base64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ text: string, encoding: string }}
 */
export function decodeBytes(bytes) {
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8 (BOM)" };
	}
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "UTF-16 LE" };
	}
	if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "UTF-16 BE" };
	}
	// UTF-16 without BOM is also "valid" UTF-8 (NUL bytes), so check it first.
	const sample = bytes.subarray(0, 2000);
	let evenNul = 0;
	let oddNul = 0;
	for (let i = 0; i < sample.length; i++) {
		if (sample[i] !== 0) continue;
		if (i % 2) oddNul++;
		else evenNul++;
	}
	if (oddNul > sample.length / 4) return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "UTF-16 LE" };
	if (evenNul > sample.length / 4) return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "UTF-16 BE" };
	try {
		return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
	} catch {
		/* not valid UTF-8 */
	}
	return { text: new TextDecoder("windows-1253").decode(bytes), encoding: "Windows-1253" };
}

/** True when the text contains Greek letters (sanity check for a wrong encoding). */
export function looksGreek(text) {
	return /[Ά-ώ]/.test(text);
}
