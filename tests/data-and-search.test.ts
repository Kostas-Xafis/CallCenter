import { describe, expect, test } from "bun:test";
import { buildModel, expandRanges } from "../app/js/data.js";
import { buildIndex, highlight, search } from "../app/js/search.js";
import { abbrKey, fold } from "../app/js/normalize.js";
import { toGreekQuery } from "../app/js/greek-layout.js";

type P = { id: string; type: string; sectionId: string | null; numbers: string[]; external?: string[]; name: string; position?: string; unit?: string; shared?: boolean; restricted?: boolean };
const phone = (id: string, type: string, sectionId: string | null, numbers: string[], name: string, o: Partial<P> = {}): P => ({
	id, type, sectionId, numbers, external: [], name, position: "", unit: "", shared: false, restricted: false, ...o
});

const catalog = {
	schema: 3,
	updatedAt: "2026-10-06T10:00:00.000Z",
	title: "ΚΑΤΑΛΟΓΟΣ",
	info: ["Κέντρο: 210-7463399"],
	sections: [
		{ id: "s0", abbr: "", name: "Διοίκηση", parentId: null },
		{ id: "s1", abbr: "ΔΠΤ", name: "Διεύθυνση Παθολογικού Τομέα", parentId: null },
		{ id: "s2", abbr: "Ε.Ι.", name: "Εξωτερικά Ιατρεία", parentId: null },
		{ id: "s3", abbr: "ΔΟΤ", name: "Διεύθυνση Οδοντιατρικού Τομέα", parentId: null },
		{ id: "s4", abbr: "AAYE", name: "ΑΝΩΤΑΤΗ ΑΕΡΟΠΟΡΙΑΣ ΥΓΕΙΟΝΟΜΙΚΗ ΕΠΙΤΡΟΠΗ", parentId: null },
		{ id: "s5", abbr: "ΣΜ. Τ-Η", name: "ΔΥΠ / Σμήνος Τηλεπικοινωνιών – Ηλεκτρονικών", parentId: null },
		{ id: "s6", abbr: "ΔΟΥ", name: "Διεύθυνση Οικονομικών Υπηρεσιών", parentId: null },
		{ id: "s7", abbr: "", name: "Οικήματα Αγάμων", parentId: null },
		{ id: "s8", abbr: "", name: "Κλινικές", parentId: null },
		{ id: "s9", abbr: "ΤΕΠ", name: "Τμήμα Επειγόντων", parentId: "s1" }
	],
	phones: [
		phone("d1", "dir", "s0", ["4057"], "Διοικητής"),
		phone("d2", "dir", "s1", ["4270"], "Γραμματεία"),
		phone("d3", "dir", "s2", ["4183"], "Επιμελητές", { unit: "Ω.Ρ.Λ." }),
		phone("d4", "dir", "s2", ["4182"], "Γραμματεία", { unit: "Ω.Ρ.Λ." }),
		phone("d5", "dir", "s3", ["4289"], "Γραμματεία", { unit: "Γναθοχειρουργικό" }),
		phone("d6", "dir", "s4", ["5610"], "Πρόεδρος"),
		phone("d7", "dir", "s5", ["3010"], "Βλάβες", { unit: "Συνεργείο Τηλεπικοινωνιών" }),
		phone("d8", "dir", "s6", ["4136"], "Λογιστήριο"),
		phone("d9", "dir", "s7", ["4888"], "Δωμάτιο Δουλγεράκη"),
		phone("d10", "dir", "s8", ["5501-5511"], "Δωμάτια Ασθενών", { unit: "Γ΄ Παθολογική" }),
		phone("d11", "dir", "s8", ["4452"], "Γραφείο Ιατρών", { unit: "Καρδιολογική", external: ["210-7700315"] }),
		phone("c1", "dect", "s1", ["3478"], "ΤΣΙΤΛΑΚΙΔΗΣ ΚΩΝΣΤΑΝΤΙΝΟΣ", { position: "ΕΠΙΜ.", unit: "ΚΑΡΔΙΟΛΟΓΙΚΗΣ" }),
		phone("c2", "dect", null, ["3995"], "ΧΕΙΜΩΝΑΣ ΑΝΤΩΝΙΟΣ", { position: "ΔΚΤΗΣ", restricted: true }),
		phone("c3", "dect", "s9", ["3451"], "ΤΕΠ/ ΤΡΑΥΜΑΤΙΟΦΟΡΕΑΣ 1", { position: "ΕΦΗΜΕΡΕΙΑ", unit: "ΤΕΠ", shared: true }),
		phone("c4", "dect", "s2", ["3870"], "ΠΑΠΑΔΟΠΟΥΛΟΣ, ΙΩΑΝΝΗΣ", { position: "ΕΠΙΜ.", unit: "ΩΡΛ" })
	]
};

const model = buildModel(catalog);
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

describe("model", () => {
	test("records from both sources", () => {
		expect(model.records.filter(r => r.source === "dir")).toHaveLength(11);
		expect(model.records.filter(r => r.source === "dect")).toHaveLength(4);
	});
	test("desk phones keep section order, DECT follows sorted by number", () => {
		expect(model.records.slice(0, 3).map(r => r.numbers[0])).toEqual(["4057", "4270", "4183"]);
		expect(model.records.filter(r => r.source === "dect").map(r => r.numbers[0])).toEqual(["3451", "3478", "3870", "3995"]);
	});
	test("restricted and shared flags come from the phone", () => {
		expect(model.records.filter(r => r.restricted).map(r => r.numbers[0])).toEqual(["3995"]);
		expect(model.records.filter(r => r.shared).map(r => r.numbers[0])).toEqual(["3451"]);
	});
	test("ranges are displayed with an en dash and expanded for search", () => {
		const r = model.records.find(x => x.numbers[0] === "5501–5511")!;
		expect(r.searchNumbers).toEqual(expect.arrayContaining(["5501", "5505", "5511"]));
		expect(r.searchNumbers).toHaveLength(12);
		expect(expandRanges([{ from: "1", to: "1000" }])).toEqual([]);
		expect(expandRanges([{ from: "0098", to: "0100" }])).toEqual(["0098", "0099", "0100"]);
	});
	test("outside lines are searchable by their digits", () => {
		expect(model.records.find(r => r.numbers[0] === "4452")!.searchNumbers).toContain("2107700315");
	});
	test("directorates are shared between types (Ε.Ι. = ΕΙ)", () => {
		const ei = model.directorates.find(d => d.key === abbrKey("ΕΙ"))!;
		expect(ei.count).toBe(3);
		expect(ei.title).toBe("Εξωτερικά Ιατρεία");
	});
	test("sections without an abbreviation are keyed by name; missing section is «—»", () => {
		expect(model.directorates.find(d => d.key === "name:Κλινικές")!.hasAbbr).toBe(false);
		expect(model.records.find(r => r.numbers[0] === "3995")!.dir).toBe("—");
	});
	test("DECT phones know their directorate name", () => {
		expect(model.records.find(r => r.numbers[0] === "3478")!.dirTitle).toBe("Διεύθυνση Παθολογικού Τομέα");
	});
	test("title, info and last update", () => {
		expect(model.title).toBe("ΚΑΤΑΛΟΓΟΣ");
		expect(model.info).toEqual(["Κέντρο: 210-7463399"]);
		expect(model.meta.generatedAt).toBe("2026-10-06T10:00:00.000Z");
	});
	test("missing catalog", () => {
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
