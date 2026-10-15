// Runs update/update.ps1 for real (PowerShell 7 stands in for Windows PowerShell 5.1).
// Skipped when PowerShell is not installed.

import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataBlock } from "../scripts/lib/payload.ts";

const pwsh = Bun.which("pwsh") ?? (existsSync("/snap/bin/pwsh") ? "/snap/bin/pwsh" : null);

const DECT_ROWS = ["Α/Α;ΑΡΙΘΜΟΣ;ΟΝΟΜΑΤΕΠΩΝΥΜΟ;ΔΙΕΥΘΥΝΣΗ;ΘΕΣΗ;ΕΠΙΣΤΑΣΙΑ", "1;3995;ΧΕΙΜΩΝΑΣ ΑΝΤΩΝΙΟΣ;251 ΓΝΑ;ΔΚΤΗΣ;."];
const DIRECTORY = "Διοικητής\t4057\r\n\r\nΔιεύθυνση Παθολογικού Τομέα (ΔΠΤ)\r\nΓραμματεία\t4270\r\n";
const PAGE = `<!doctype html><title>t</title>${dataBlock(null)}<p>app</p>`;

/** Excel «Κείμενο Unicode»: tab-separated UTF-16 LE with BOM. */
const unicodeText = (rows: string[]) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rows.join("\r\n").replaceAll(";", "\t"), "utf16le")]);

/** A release folder with an empty page, the scripts and the given data files. */
function setup(files: Record<string, string | Buffer>) {
	const dir = mkdtempSync(join(tmpdir(), "update-ps1-"));
	for (const f of ["update.ps1", "ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt"]) copyFileSync(join("update", f), join(dir, f));
	writeFileSync(join(dir, "katalogos.html"), PAGE);
	mkdirSync(join(dir, "data"));
	for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, "data", name), content);
	return dir;
}

function run(dir: string) {
	const p = Bun.spawnSync([pwsh!, "-NoProfile", "-File", join(dir, "update.ps1")]);
	const page = readFileSync(join(dir, "katalogos.html"), "utf8");
	const json = page.match(/<script id="catalog-data" type="application\/json">(.*?)<\/script>/)?.[1];
	return { code: p.exitCode, out: p.stdout.toString(), payload: json ? JSON.parse(json) : null };
}

describe.skipIf(!pwsh)("update.ps1", () => {
	test("embeds the .csv and the .txt", () => {
		const { code, payload } = run(setup({ "DECT.csv": DECT_ROWS.join("\r\n"), "KATALOGOS.txt": DIRECTORY }));
		expect(code).toBe(0);
		expect(payload.dect.file).toBe("DECT.csv");
		expect(payload.directory.file).toBe("KATALOGOS.txt");
		expect(payload.restricted).toContain("3995");
	});

	test("a DECT table saved as .txt (Excel «Κείμενο Unicode») is not used as the directory", () => {
		const dir = setup({ "DECT.csv": DECT_ROWS.join("\r\n"), "KATALOGOS.txt": DIRECTORY, "DECT.txt": unicodeText(DECT_ROWS) });
		const future = new Date(Date.now() + 60_000);
		utimesSync(join(dir, "data", "DECT.txt"), future, future); // newest .txt
		const { code, out, payload } = run(dir);
		expect(code).toBe(0);
		expect(payload.directory.file).toBe("KATALOGOS.txt");
		expect(out).toContain("«DECT.txt» έχει τις στήλες του DECT");
	});

	test("without a .csv, a DECT table saved as .txt is used for DECT", () => {
		const { code, payload } = run(setup({ "KATALOGOS.txt": DIRECTORY, "DECT.txt": unicodeText(DECT_ROWS) }));
		expect(code).toBe(0);
		expect(payload.dect.file).toBe("DECT.txt");
		expect(payload.directory.file).toBe("KATALOGOS.txt");
	});

	test("only DECT tables as .txt: explains that the directory is missing", () => {
		const { code, out, payload } = run(setup({ "DECT.csv": DECT_ROWS.join("\r\n"), "DECT.txt": unicodeText(DECT_ROWS) }));
		expect(code).toBe(1);
		expect(out).toContain("Δεν βρέθηκε αρχείο καταλόγου");
		expect(out).toContain("εξαγωγές του DECT");
		expect(payload).toBeNull();
	});

	test.skipIf(process.getuid?.() === 0)("read-only page: clear message, page untouched, no .tmp left", () => {
		const dir = setup({ "DECT.csv": DECT_ROWS.join("\r\n"), "KATALOGOS.txt": DIRECTORY });
		chmodSync(join(dir, "katalogos.html"), 0o444);
		const { code, out, payload } = run(dir);
		expect(code).toBe(1);
		expect(out).toContain("Δεν ήταν δυνατή η αποθήκευση της σελίδας");
		expect(out).toContain("Μόνο για ανάγνωση");
		expect(payload).toBeNull();
		expect(readdirSync(dir).filter(f => f.endsWith(".tmp"))).toEqual([]);
	});
});
