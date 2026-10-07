import { describe, expect, test } from "bun:test";
import { parseDect } from "../app/js/parse-dect.js";
import { detectSeparator, parseCsv } from "../app/js/parse-csv.js";
import { decodeBytes, looksGreek } from "../app/js/decode.js";
import { buildModel } from "../app/js/data.js";
import { buildIndex, highlight, search } from "../app/js/search.js";
import { abbrKey, fold } from "../app/js/normalize.js";
import { toGreekQuery } from "../app/js/greek-layout.js";
import { existsSync, readFileSync } from "node:fs";

const DECT_CSV = [
	",,,,,",
	"Α/Α,ΑΡΙΘΜΟΣ,ΟΝΟΜΑΤΕΠΩΝΥΜΟ,ΔΙΕΥΘΥΝΣΗ,ΘΕΣΗ,ΕΠΙΣΤΑΣΙΑ",
	"1,3400,,,,",
	"2,3995,ΧΕΙΜΩΝΑΣ ΑΝΤΩΝΙΟΣ,251 ΓΝΑ,ΔΚΤΗΣ,.",
	"3,3451,*ΤΕΠ/ ΤΡΑΥΜΑΤΙΟΦΟΡΕΑΣ 1,ΤΕΠ,ΕΦΗΜΕΡΕΙΑ,ΤΕΠ",
	"4,3478,ΤΣΙΤΛΑΚΙΔΗΣ ΚΩΝΣΤΑΝΤΙΝΟΣ ,ΔΠΤ,ΕΠΙΜ.,ΚΑΡΔΙΟΛΟΓΙΚΗΣ",
	'5,3870,"ΠΑΠΑΔΟΠΟΥΛΟΣ, ΙΩΑΝΝΗΣ",Ε.Ι.,ΕΠΙΜ.,ΩΡΛ'
].join("\r\n");

const DIRECTORY = [
	"Διοικητής\t4057",
	"",
	"Διεύθυνση Παθολογικού Τομέα (ΔΠΤ)",
	"Γραμματεία\t4270",
	"",
	"Εξωτερικά Ιατρεία (ΕΙ)",
	"Ω.Ρ.Λ. Επιμελητές\t4183",
	"Ω.Ρ.Λ. Γραμματεία\t4182",
	"",
	"Διεύθυνση Οδοντιατρικού Τομέα (ΔΟΤ)",
	"Γναθοχειρουργικό. Γραμματεία\t4289",
	"",
	"ΑΝΩΤΑΤΗ ΑΕΡΟΠΟΡΙΑΣ ΥΓΕΙΟΝΟΜΙΚΗ ΕΠΙΤΡΟΠΗ (AAYE)",
	"Πρόεδρος\t5610",
	"",
	"ΔΥΠ / Σμήνος Τηλεπικοινωνιών – Ηλεκτρονικών (ΣΜ. Τ-Η)",
	"Συνεργείο Τηλεπικοινωνιών. Βλάβες\t3010",
	"",
	"Διεύθυνση Οικονομικών Υπηρεσιών (ΔΟΥ)",
	"Λογιστήριο\t4136",
	"",
	"Οικήματα Αγάμων",
	"Δωμάτιο Δουλγεράκη\t4888",
	"",
	"Κλινικές",
	"Γ΄ Παθολογική. Δωμάτια Ασθενών\t5501 έως 5511",
	"Καρδιολογική. Γραφείο Ιατρών\t4452\t\t210-7700315"
].join("\n");

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const payload = {
	schema: 2,
	generatedAt: "2026-10-06T10:00:00.000Z",
	generator: "test",
	dect: { file: "dect.csv", modified: "2026-10-06T09:00:00.000Z", base64: b64("\uFEFF" + DECT_CSV) },
	directory: { file: "dir.txt", modified: "2026-10-06T09:00:00.000Z", base64: b64(DIRECTORY) },
	restricted: ["3995"]
};

const model = buildModel(payload);
const index = buildIndex(model.records);
const top = (q: string) => search(index, q).map(r => `${r.record.numbers.join(",")} ${r.record.name}`);

describe("normalize", () => {
	test("fold is length preserving and accent/case/final-sigma insensitive", () => {
		expect(fold("Ψυχιατρική ΧΕΙΜΩΝΑΣ")).toBe("ψυχιατρικη χειμωνασ");
		expect(fold("Ϊ ΐ")).toHaveLength(3);
	});
	test("abbrKey", () => {
		expect(abbrKey("Ε.Ι.")).toBe(abbrKey("ΕΙ"));
		expect(abbrKey("ΣΜ. Τ-Η")).toBe(abbrKey("ΣΜ.Τ-Η"));
		expect(abbrKey("AAYE")).toBe(abbrKey("ΑΑΥΕ"));
	});
	test("Latin keyboard conversion uses final sigma", () => {
		expect(toGreekQuery("xeimvnas")).toEqual({ query: "χειμωνας", converted: true });
	});
});

describe("parseDect", () => {
	const r = parseDect(parseCsv(DECT_CSV));
	test("finds header row, skips unassigned numbers, cleans values", () => {
		expect(r.records.map(x => x.number)).toEqual(["3995", "3451", "3478", "3870"]);
		expect(r.records[0]).toMatchObject({ name: "ΧΕΙΜΩΝΑΣ ΑΝΤΩΝΙΟΣ", dir: "251 ΓΝΑ", position: "ΔΚΤΗΣ", unit: "", shared: false });
		expect(r.records[1]).toMatchObject({ name: "ΤΕΠ/ ΤΡΑΥΜΑΤΙΟΦΟΡΕΑΣ 1", shared: true });
		expect(r.records[2].name).toBe("ΤΣΙΤΛΑΚΙΔΗΣ ΚΩΝΣΤΑΝΤΙΝΟΣ");
		expect(r.records[3].name).toBe("ΠΑΠΑΔΟΠΟΥΛΟΣ, ΙΩΑΝΝΗΣ");
	});
	test("columns are found by header, in any order", () => {
		const rows = parseCsv("ΘΕΣΗ;ΑΡΙΘΜΟΣ;ΟΝΟΜΑΤΕΠΩΝΥΜΟ\nΔΝΤΗΣ;3501;ΚΑΠΟΙΟΣ");
		expect(parseDect(rows).records[0]).toMatchObject({ number: "3501", name: "ΚΑΠΟΙΟΣ", position: "ΔΝΤΗΣ", dir: "" });
	});
	test("missing header is reported", () => {
		expect(parseDect([["a", "b"]]).warnings).toHaveLength(1);
	});
	test("duplicate numbers are reported", () => {
		const rows = parseCsv("ΑΡΙΘΜΟΣ,ΟΝΟΜΑΤΕΠΩΝΥΜΟ\n3500,Α\n3500,Β");
		expect(parseDect(rows).warnings.filter(w => /πολλές φορές/.test(w.message)).map(w => w.line)).toEqual([3]);
	});
});

describe("parseCsv", () => {
	test("quotes, escaped quotes, line breaks inside quotes, CRLF", () => {
		expect(parseCsv('a,"b ""c"", d",e\r\n"x\ny",z\r\n')).toEqual([["a", 'b "c", d', "e"], ["x\ny", "z"]]);
	});
	test("separator detection (Greek Excel uses ;)", () => {
		expect(detectSeparator("Α/Α;ΑΡΙΘΜΟΣ;ΟΝΟΜΑΤΕΠΩΝΥΜΟ\n1;3400;Χ, Ψ")).toBe(";");
		expect(detectSeparator(";;;\nΑ/Α,ΑΡΙΘΜΟΣ,ΟΝΟΜΑΤΕΠΩΝΥΜΟ")).toBe(",");
		expect(detectSeparator("Α/Α\tΑΡΙΘΜΟΣ\tΟΝΟΜΑΤΕΠΩΝΥΜΟ")).toBe("\t");
	});
});

describe("decodeBytes", () => {
	const greek = "ΑΡΙΘΜΟΣ Χειμώνας";
	test("UTF-8 with and without BOM", () => {
		expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(greek)]))).toEqual({ text: greek, encoding: "UTF-8 (BOM)" });
		expect(decodeBytes(new Uint8Array(Buffer.from(greek))).text).toBe(greek);
	});
	test("UTF-16 LE with BOM and without", () => {
		const le = Buffer.from(greek, "utf16le");
		expect(decodeBytes(new Uint8Array([0xff, 0xfe, ...le])).text).toBe(greek);
		expect(decodeBytes(new Uint8Array(Buffer.from("ABCDEF 3400", "utf16le"))).encoding).toBe("UTF-16 LE");
	});
	test("Windows-1253 (Greek ANSI)", () => {
		// "ΑΡΙΘΜΟΣ" in Windows-1253
		const r = decodeBytes(new Uint8Array([0xc1, 0xd1, 0xc9, 0xc8, 0xcc, 0xcf, 0xd3]));
		expect(r).toEqual({ text: "ΑΡΙΘΜΟΣ", encoding: "Windows-1253" });
		expect(looksGreek(r.text)).toBe(true);
	});
	test("wrong encoding is reported by the model", () => {
		const m = buildModel({ ...payload, directory: { ...payload.directory, base64: b64("abc\t4011") } });
		expect(m.warnings.some(w => /κωδικοποίηση/.test(w.message))).toBe(true);
	});
});

describe("model", () => {
	test("records from both sources", () => {
		expect(model.records.filter(r => r.source === "dir")).toHaveLength(11);
		expect(model.warnings).toEqual([]);
		expect(model.records.filter(r => r.source === "dect")).toHaveLength(4);
	});
	test("restricted numbers are flagged", () => {
		expect(model.records.filter(r => r.restricted).map(r => r.numbers[0])).toEqual(["3995"]);
	});
	test("directorates are shared between sources (Ε.Ι. = ΕΙ)", () => {
		const ei = model.directorates.find(d => d.key === abbrKey("ΕΙ"))!;
		expect(ei.count).toBe(3);
		expect(ei.title).toBe("Εξωτερικά Ιατρεία");
	});
	test("DECT directorate names come from the directory headings", () => {
		const dect = model.records.find(r => r.numbers[0] === "3478")!;
		expect(dect.dirTitle).toBe("Διεύθυνση Παθολογικού Τομέα");
	});
	test("missing payload", () => {
		expect(buildModel(null).records).toEqual([]);
	});
});

describe("search", () => {
	test("multi-word across fields", () => {
		expect(top("γναθ γραμ")).toEqual(["4289 Γραμματεία"]);
	});
	test("Latin keyboard input", () => {
		expect(top("xeimvnas")).toEqual(["3995 ΧΕΙΜΩΝΑΣ ΑΝΤΩΝΙΟΣ"]);
	});
	test("accents and case are ignored", () => {
		expect(top("ΚΑΡΔΙΟΛΟΓΙΚΗ")[0]).toBe("4452 Γραφείο Ιατρών");
	});
	test("abbreviations without dots", () => {
		expect(top("ωρλ")).toEqual(expect.arrayContaining(["4183 Επιμελητές", "4182 Γραμματεία", "3870 ΠΑΠΑΔΟΠΟΥΛΟΣ, ΙΩΑΝΝΗΣ"]));
	});
	test("numbers: exact, inside ranges, outside lines", () => {
		expect(top("3995")).toEqual(["3995 ΧΕΙΜΩΝΑΣ ΑΝΤΩΝΙΟΣ"]);
		expect(top("5505")).toEqual(["5501–5511 Δωμάτια Ασθενών"]);
		expect(top("7700315")).toEqual(["4452 Γραφείο Ιατρών"]);
	});
	test("typo tolerance: missing, wrong, extra and swapped letters", () => {
		expect(top("καρδιλογικης")).toContain("3478 ΤΣΙΤΛΑΚΙΔΗΣ ΚΩΝΣΤΑΝΤΙΝΟΣ"); // missing
		expect(top("καρδιολογεκης")).toContain("3478 ΤΣΙΤΛΑΚΙΔΗΣ ΚΩΝΣΤΑΝΤΙΝΟΣ"); // wrong
		expect(top("καρδιολλογικης")).toContain("3478 ΤΣΙΤΛΑΚΙΔΗΣ ΚΩΝΣΤΑΝΤΙΝΟΣ"); // extra
		expect(top("καρδιολογκιης")).toContain("3478 ΤΣΙΤΛΑΚΙΔΗΣ ΚΩΝΣΤΑΝΤΙΝΟΣ"); // swapped
		expect(top("γναθοχειρουργκο")).toEqual(["4289 Γραμματεία"]);
	});
	test("Greek spelling confusions (ο/ω, ι/η/υ) are free", () => {
		expect(top("χειμονας")).toEqual(["3995 ΧΕΙΜΩΝΑΣ ΑΝΤΩΝΙΟΣ"]);
		expect(top("τσιτλακιδις")).toEqual(["3478 ΤΣΙΤΛΑΚΙΔΗΣ ΚΩΝΣΤΑΝΤΙΝΟΣ"]);
	});
	test("typos are only tolerated when nothing matches exactly", () => {
		// "γραμ" has exact hits, so it must not loosely match other words
		expect(top("γραμ").every(r => /Γραμματεία/.test(r))).toBe(true);
		// the first letter must be right
		expect(top("ξειμωνας")).toEqual([]);
		// short words are never matched loosely
		expect(top("ωρκ")).toEqual([]);
	});
	test("phone type can be part of the query", () => {
		const types = (q: string) => [...new Set(search(index, q).map(r => r.record.source))];
		expect(types("ασυρματοι")).toEqual(["dect"]);
		expect(types("ασυρματα")).toEqual(["dect"]);
		expect(types("σταθεροι")).toEqual(["dir"]);
		expect(types("dect")).toEqual(["dect"]);
		expect(types("σταθερα")).toEqual(["dir"]);
		expect(top("ασυρματο ωρλ")).toEqual(["3870 ΠΑΠΑΔΟΠΟΥΛΟΣ, ΙΩΑΝΝΗΣ"]);
		expect(top("σταθερο ωρλ")).toEqual(expect.arrayContaining(["4183 Επιμελητές", "4182 Γραμματεία"]));
		expect(top("σταθερο ωρλ")).toHaveLength(2);
	});
	test("type words do not pollute other searches", () => {
		expect(top("τηλεφωνο")).toEqual([]);
		expect(top("γραμ")).toHaveLength(3);
	});
	test("Latin look-alike letters in the source still match Greek queries", () => {
		expect(top("ΑΑΥΕ")).toEqual(["5610 Πρόεδρος"]);
		expect(top("ααυε προεδρος")).toEqual(["5610 Πρόεδρος"]);
		expect(top("AAYE")).toEqual(["5610 Πρόεδρος"]);
	});
	test("dotted abbreviations match with or without spaces", () => {
		expect(top("ΣΜ.Τ-Η")).toEqual(["3010 Βλάβες"]);
		expect(top("σμ.τ-η βλαβες")).toEqual(["3010 Βλάβες"]);
		expect(top("ΣΜ. Τ-Η")).toEqual(["3010 Βλάβες"]);
	});
	test("an exact directorate code outranks names starting with the same letters", () => {
		expect(top("ΔΟΥ")).toEqual(["4136 Λογιστήριο", "4888 Δωμάτιο Δουλγεράκη"]);
		expect(top("ΔΠΤ")[0]).toMatch(/Γραμματεία|ΤΣΙΤΛΑΚΙΔΗΣ/);
	});
	test("every word must match", () => {
		expect(top("γναθ επιμελητες")).toEqual([]);
	});
	test("word-start matches rank above inner matches", () => {
		expect(top("γραμ")[0]).toMatch(/Γραμματεία/);
		expect(top("γραμ")).toHaveLength(3);
	});
	test("highlight escapes HTML and merges ranges", () => {
		expect(highlight("<a&b>", [[0, 2], [1, 3]])).toBe("<mark>&lt;a&amp;</mark>b&gt;");
	});
});

const REAL_CSV = "actual_data/DECT ΑΠΟΓΡΑΦΗ.csv";
describe.skipIf(!existsSync(REAL_CSV))("real DECT export", () => {
	test("parses without warnings", () => {
		const { text } = decodeBytes(new Uint8Array(readFileSync(REAL_CSV)));
		const r = parseDect(parseCsv(text));
		expect(r.warnings).toEqual([]);
		expect(r.records.length).toBeGreaterThan(450);
		expect(r.records.every(x => /^\d+$/.test(x.number))).toBe(true);
	});
});
