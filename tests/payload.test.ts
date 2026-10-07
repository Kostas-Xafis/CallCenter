import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dataBlock, DATA_BEGIN, DATA_END, extractDataBlock, injectData, parseRestricted, toEmbeddedJson } from "../scripts/lib/payload.ts";

describe("payload helpers", () => {
	test("embedded JSON cannot close the script element", () => {
		const json = toEmbeddedJson({ t: "</script><!--x--> & \u2028" });
		expect(json).not.toContain("</script>");
		expect(json).not.toContain("<!--");
		expect(JSON.parse(json).t).toBe("</script><!--x--> & \u2028");
	});

	test("inject replaces exactly the data block", () => {
		const html = `<p>a</p>${dataBlock(null)}<script>app()</script>`;
		const next = injectData(html, dataBlock({ restricted: ["1"] } as any));
		expect(next.startsWith("<p>a</p>" + DATA_BEGIN)).toBe(true);
		expect(next.endsWith(DATA_END + "<script>app()</script>")).toBe(true);
		expect(extractDataBlock(next)).toContain('"restricted":["1"]');
		expect(() => injectData("<p>no markers</p>", "x")).toThrow();
	});

	test("restricted numbers: first number of each line, comments ignored", () => {
		const text = "\uFEFF# σχόλιο 1234\r\n3995  ΧΕΙΜΩΝΑΣ 251 ΓΝΑ\r\n\r\n  3953\tΥΔΚΤΗΣ\r\nκείμενο 5555\r\n3995 διπλό\r\n";
		expect(parseRestricted(text)).toEqual(["3995", "3953"]);
	});

	test("the shipped ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt is readable and saved with a UTF-8 BOM", () => {
		const bytes = readFileSync("update/ΠΕΡΙΟΡΙΣΜΕΝΟΙ.txt");
		expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		expect(parseRestricted(bytes.toString("utf8"))).toContain("3995");
	});

	test("update.ps1 uses the same markers and is saved with a UTF-8 BOM", () => {
		const bytes = readFileSync("update/update.ps1");
		expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const text = bytes.toString("utf8");
		expect(text).toContain(`'${DATA_BEGIN}'`);
		expect(text).toContain(`'${DATA_END}'`);
		expect(text).toContain('<script id="catalog-data" type="application/json">');
	});
});
