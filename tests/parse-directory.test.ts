import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { expandRanges, parseDirectory, parseHeading, parseNumbers, splitPath } from "../app/js/parse-directory.js";
import { readFileSync } from "node:fs";

const SAMPLE = [
	"251 ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΑΕΡΟΠΟΡΙΑΣ",
	"",
	"ΤΗΛΕΦΩΝΙΚΟΣ ΚΑΤΑΛΟΓΟΣ",
	"",
	"Τηλεφωνικό Κέντρο (Αστικός Αριθμός Κλήσης):  210-746 3399",
	"",
	"Διοικητής\t4057\t\t210-7798700",
	"Γραφείο Διοικητή\t4011,4012,4014     210-7799410",
	"",
	"Γραφείο Ασφάλειας Εδάφους (ΓΑΕ)\t4135",
	"",
	"Διεύθυνση Τομέα Εργαστηρίων (ΔΤΕ)",
	"Βιοπαθολογία. Αιμοδοσία (Τράπεζα Αίματος)\t4332,4384\t\t210-7786449",
	"Βιοπαθολογία. Μικροβιολογικό. Δντρια Εργ. Κλιν.\t4377",
	"Γραμματεία – Τμήμα Εκπαίδευσης Υγειον. Ιατρών\t4138",
	"",
	"ΔΥΠ / Σμήνος Τηλεπικοινωνιών – Ηλεκτρονικών (ΣΜ. Τ-Η)",
	"ΚΕΠΙΚ. Γραφείο Σημάτων\t5001",
	"",
	"Κλινικές",
	"Α΄ Παθολογική. Δωμάτια Ασθενών\t4852 έως 4861,4864",
	"                              \t4885,4886,4887",
	"Γ΄ Παθολογική. Δωμάτια Ασθενών\t5501 έως 5511 \t",
	"Μερικός Διαχειριστής\t4334 έως και 4338,4346",
	"",
	"ΔΙΕΥΘΥΝΣΗ ΥΓΕΙΟΝΟΜΙΚΟΥ (ΔΥΓ) / ΓΕΑ",
	"Τμήμα 2. Μητρώο Ασφαλισμένων Έκδοσης ΑΒΝ\t4547,4538,4528",
	"Τμήμα 2. Μητρώο Ασφαλισμένων Έκδοσης Ευρωπαϊκών ",
	"Εντύπων (ΕΚΑΑ, S1 κ.α.)\t4547,4531",
	"",
	"ΟΙΚΟΝΟΜΙΚΟ & ΛΟΓΙΣΤΙΚΟ ΚΕΝΤΡΟ ΑΕΡΟΠΟΡΙΑΣ (ΟΛΚΑ) / ΓΕΑ",
	"Διαχείριση Δαπανών Υγειονομικής Περίθ. Δχση Χρημ………4339\t\t210-7758655",
	"",
	"ΚΕΝΤΡΟ ΑΕΡΟΠΟΡΙΚΗΣ ΙΑΤΡΙΚΗΣ (ΚΑΙ)",
	"Υποδιοικητής\t4712",
	"Διεύθυνση Εκπαίδευσης - Έρευνας - Αεροπορικής Ιατρικής",
	"Επιτελής\t4716",
	"Τμήμα 1. - Εκπαίδευσης & Σχολείων",
	"Τμηματάρχης\t4714"
].join("\r\n");

const parsed = parseDirectory(SAMPLE);
const entry = (label: string) => parsed.entries.find(e => e.label === label)!;
const sectionOf = (label: string) => parsed.sections.find(s => s.id === entry(label).sectionId)!;

describe("parseNumbers", () => {
	test("extensions, outside lines and ranges", () => {
		expect(parseNumbers("4011,4012,4014     210-7799410")).toEqual({
			extensions: ["4011", "4012", "4014"],
			ranges: [],
			external: ["210-7799410"],
			leftover: ""
		});
		expect(parseNumbers("4334 έως και 4338,4346")).toMatchObject({ extensions: ["4346"], ranges: [{ from: "4334", to: "4338" }] });
		expect(parseNumbers("09").extensions).toEqual(["09"]);
		expect(parseNumbers("4011 κάτι").leftover).toBe("κάτι");
	});

	test("expandRanges", () => {
		expect(expandRanges([{ from: "5501", to: "5503" }])).toEqual(["5501", "5502", "5503"]);
		expect(expandRanges([{ from: "1000", to: "9999" }])).toEqual([]);
	});
});

describe("splitPath", () => {
	test("splits complete words, keeps abbreviations", () => {
		expect(splitPath("Βιοπαθολογία. Αιματολογικό. Εργαστήριο")).toEqual(["Βιοπαθολογία", "Αιματολογικό", "Εργαστήριο"]);
		expect(splitPath("Βιοπαθολογία. Μικροβιολογικό. Δντρια Εργ. Κλιν.")).toEqual(["Βιοπαθολογία", "Μικροβιολογικό", "Δντρια Εργ. Κλιν."]);
		expect(splitPath("Γραμματεία – Τμήμα Εκπαίδευσης Υγειον. Ιατρών")).toEqual(["Γραμματεία – Τμήμα Εκπαίδευσης Υγειον. Ιατρών"]);
		expect(splitPath("Γραφείο Επιχειρήσεων - Σχεδίων. Προϊστάμενος")).toEqual(["Γραφείο Επιχειρήσεων - Σχεδίων", "Προϊστάμενος"]);
		expect(splitPath("Ψυχιατρική. Αναπλ. Διευθυντής")).toEqual(["Ψυχιατρική", "Αναπλ. Διευθυντής"]);
		expect(splitPath("Τμήμα 6. Επιτελής.")).toEqual(["Τμήμα 6", "Επιτελής"]);
		expect(splitPath("Γραφείο Μισθοδοσίας-Οδοιπορικών Εξόδων Μ.Υ.")).toEqual(["Γραφείο Μισθοδοσίας-Οδοιπορικών Εξόδων Μ.Υ."]);
	});

	test("acronym prefixes", () => {
		expect(splitPath("Ω.Ρ.Λ. Επιμελητές")).toEqual(["Ω.Ρ.Λ.", "Επιμελητές"]);
		expect(splitPath("ΚΕΠΙΚ. Γραφείο Σημάτων")).toEqual(["ΚΕΠΙΚ", "Γραφείο Σημάτων"]);
	});
});

describe("parseHeading", () => {
	test("variants", () => {
		expect(parseHeading("Διεύθυνση Τομέα Εργαστηρίων (ΔΤΕ)")).toEqual({ name: "Διεύθυνση Τομέα Εργαστηρίων", abbr: "ΔΤΕ", parent: null });
		expect(parseHeading("ΔΥΠ / Σμήνος Μεταφορικών Μέσων (ΣΜΜ)")).toEqual({ name: "Σμήνος Μεταφορικών Μέσων", abbr: "ΣΜΜ", parent: "ΔΥΠ" });
		expect(parseHeading("ΔΤΕΕΟΕ/ ΚΕΠΙΧ (Κέντρο Επιχειρήσεων)")).toEqual({ name: "Κέντρο Επιχειρήσεων", abbr: "ΚΕΠΙΧ", parent: "ΔΤΕΕΟΕ" });
		expect(parseHeading("ΔΙΕΥΘΥΝΣΗ ΥΓΕΙΟΝΟΜΙΚΟΥ (ΔΥΓ) / ΓΕΑ")).toEqual({ name: "ΔΙΕΥΘΥΝΣΗ ΥΓΕΙΟΝΟΜΙΚΟΥ / ΓΕΑ", abbr: "ΔΥΓ/ΓΕΑ", parent: null });
		expect(parseHeading("ΤΠΔ /Γρ. Ασφαλείας")).toEqual({ name: "Γρ. Ασφαλείας", abbr: null, parent: "ΤΠΔ" });
		expect(parseHeading("Κλινικές")).toEqual({ name: "Κλινικές", abbr: null, parent: null });
	});
});

describe("parseDirectory", () => {
	test("preamble", () => {
		expect(parsed.title).toBe("251 ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΑΕΡΟΠΟΡΙΑΣ — ΤΗΛΕΦΩΝΙΚΟΣ ΚΑΤΑΛΟΓΟΣ");
		expect(parsed.info).toEqual(["Τηλεφωνικό Κέντρο (Αστικός Αριθμός Κλήσης): 210-746 3399"]);
		expect(parsed.warnings).toEqual([]);
	});

	test("headless first block is the administration", () => {
		expect(sectionOf("Διοικητής").name).toBe("Διοίκηση");
		expect(entry("Γραφείο Διοικητή")).toMatchObject({ extensions: ["4011", "4012", "4014"], external: ["210-7799410"] });
	});

	test("lone entry becomes its own section", () => {
		expect(sectionOf("Γραφείο Ασφάλειας Εδάφους (ΓΑΕ)")).toMatchObject({ name: "Γραφείο Ασφάλειας Εδάφους", abbr: "ΓΑΕ" });
	});

	test("dotted paths", () => {
		expect(entry("Αιμοδοσία (Τράπεζα Αίματος)")).toMatchObject({ path: ["Βιοπαθολογία"], external: ["210-7786449"] });
		expect(sectionOf("Αιμοδοσία (Τράπεζα Αίματος)").abbr).toBe("ΔΤΕ");
		expect(entry("Γραφείο Σημάτων")).toMatchObject({ path: ["ΚΕΠΙΚ"], extensions: ["5001"] });
	});

	test("continuation line with empty description", () => {
		const rooms = parsed.entries.filter(e => e.label === "Δωμάτια Ασθενών");
		expect(rooms[0]).toMatchObject({ path: ["Α΄ Παθολογική"], extensions: ["4864", "4885", "4886", "4887"], ranges: [{ from: "4852", to: "4861" }] });
		expect(rooms[1]).toMatchObject({ path: ["Γ΄ Παθολογική"], ranges: [{ from: "5501", to: "5511" }] });
	});

	test("wrapped line is joined with the next one", () => {
		expect(entry("Μητρώο Ασφαλισμένων Έκδοσης Ευρωπαϊκών Εντύπων (ΕΚΑΑ, S1 κ.α.)")).toMatchObject({ path: ["Τμήμα 2"], extensions: ["4547", "4531"] });
	});

	test("dot leaders instead of tabs", () => {
		expect(entry("Διαχείριση Δαπανών Υγειονομικής Περίθ. Δχση Χρημ")).toMatchObject({ extensions: ["4339"], external: ["210-7758655"] });
	});

	test("sub-headings inside a section", () => {
		expect(entry("Υποδιοικητής").path).toEqual([]);
		expect(entry("Επιτελής").path).toEqual(["Διεύθυνση Εκπαίδευσης - Έρευνας - Αεροπορικής Ιατρικής"]);
		expect(entry("Τμηματάρχης").path).toEqual(["Διεύθυνση Εκπαίδευσης - Έρευνας - Αεροπορικής Ιατρικής", "Τμήμα 1. - Εκπαίδευσης & Σχολείων"]);
	});

	test("Word text conventions (CR paragraphs, vertical tab, cell marks)", () => {
		const word = "Κλινικές\rΑ΄ Ορθοπεδική. Γραφείο Ιατρών\x074348\x07\rΚαρδιολογική\vΓραφείο\t4452";
		const r = parseDirectory("Διοικητής\t4057\r\r" + word);
		expect(r.entries.map(e => [e.label, e.extensions])).toContainEqual(["Γραφείο Ιατρών", ["4348"]]);
	});

	test("«09» is the switchboard and becomes 3399 without a warning", () => {
		const r = parseDirectory("Διοικητής\t4057\n\nΣΜ. Τ-Η\nΚΕΠΙΚ. Τηλεφωνικό Κέντρο\t09");
		expect(r.entries[1]).toMatchObject({ label: "Τηλεφωνικό Κέντρο", extensions: ["3399"] });
		expect(r.warnings).toEqual([]);
	});

	test("other numbers that are not 4 digits are dropped and reported", () => {
		const r = parseDirectory("Διοικητής\t4057\n\nΣΜ. Τ-Η\nΚάτι\t123\nΒλάβες\t3010,401");
		expect(r.entries.map(e => [e.label, e.extensions])).toEqual([["Διοικητής", ["4057"]], ["Βλάβες", ["3010"]]]);
		expect(r.warnings.map(w => w.line)).toEqual([4, 5]);
		expect(r.warnings[0].message).toContain("«123»");
		expect(r.warnings[0].message).toContain("η εγγραφή παραλείπεται");
	});

	test("unparseable numbers are reported", () => {
		const r = parseDirectory("Διοικητής\t4057\n\nΤμήμα\nΚάτι\t4011 ή κάτι άλλο");
		expect(r.warnings.length).toBe(1);
		expect(r.warnings[0].line).toBe(4);
	});
});

const REAL_TXT = "actual_data/THL_KATALOGOS_251_GNA.txt";
describe.skipIf(!existsSync(REAL_TXT))("real directory file", () => {
	test("parses without warnings", () => {
		const r = parseDirectory(readFileSync(REAL_TXT, "utf8"));
		expect(r.warnings).toEqual([]);
		expect(r.entries.length).toBeGreaterThan(600);
		expect(r.sections.length).toBeGreaterThan(40);
		expect(r.entries.every(e => e.label && (e.extensions.length || e.ranges.length))).toBe(true);
	});
});
