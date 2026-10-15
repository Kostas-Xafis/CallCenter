// ── Source file decoding ─────────────────────────────────────────────
//
// update.ps1 embeds the exported files byte for byte (base64), so the page
// decides the encoding. Windows exports can be in any of:
//
//   Excel "CSV UTF-8" / Notepad / Word "Unicode (UTF-8)"  → UTF-8 (with or without BOM)
//   Word "Unicode", some Notepad versions                 → UTF-16 LE/BE with BOM
//   Excel "CSV (οριοθετημένο με κόμματα)", Word "Windows"  → Windows-1253 (Greek ANSI)
//   Excel "CSV (MS-DOS)", Word "MS-DOS"                   → code page 737 (Greek DOS)
//
// Order: BOM → UTF-16 without BOM → strict UTF-8 → Windows-1253 or 737,
// whichever yields more Greek letters.

// Code page 737, bytes 0x80–0xFF (browsers have no decoder for it).
const CP737_HIGH =
	"ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρσςτυφχψ░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀ωάέήϊίόύϋώΆΈΉΊΌΎΏ±≥≤ΪΫ÷≈°∙·√ⁿ²■\u00a0";

/** @param {Uint8Array} bytes */
function decodeCp737(bytes) {
	return Array.from(bytes, b => (b < 0x80 ? String.fromCharCode(b) : CP737_HIGH[b - 0x80])).join("");
}

const greekLetterCount = text => text.match(/[Ά-ώ]/g)?.length ?? 0;

/**
 * Share of the high (even = BE, odd = LE) bytes that are 0x00, 0x03 or 0x20:
 * the high bytes of Latin, Greek and punctuation (’ “ –) code units in UTF-16.
 */
function utf16HighByteShare(sample, offset) {
	let hits = 0;
	let total = 0;
	for (let i = offset; i < sample.length; i += 2) {
		total++;
		if (sample[i] === 0x00 || sample[i] === 0x03 || sample[i] === 0x20) hits++;
	}
	return total ? hits / total : 0;
}

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
	// UTF-16 without BOM can also be "valid" UTF-8, so check it first. Greek
	// letters have 0x03 (not NUL) as high byte, so count that too.
	const sample = bytes.subarray(0, 2000 - (Math.min(bytes.length, 2000) % 2));
	if (sample.length >= 4) {
		const le = utf16HighByteShare(sample, 1);
		const be = utf16HighByteShare(sample, 0);
		if (le > 0.8 && le > be) return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "UTF-16 LE" };
		if (be > 0.8 && be > le) return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "UTF-16 BE" };
	}
	try {
		return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
	} catch {
		/* not valid UTF-8 */
	}
	const ansi = new TextDecoder("windows-1253").decode(bytes);
	const dos = decodeCp737(bytes);
	if (greekLetterCount(dos) > greekLetterCount(ansi)) return { text: dos, encoding: "DOS 737" };
	return { text: ansi, encoding: "Windows-1253" };
}

/** True when the text contains Greek letters (sanity check for a wrong encoding). */
export function looksGreek(text) {
	return /[Ά-ώ]/.test(text);
}
