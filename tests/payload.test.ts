import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dataBlock, DATA_BEGIN, DATA_END, extractDataBlock, injectData, restrictedFromScript, toEmbeddedJson } from "../scripts/lib/payload.ts";

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

	test("restricted list is read from update.ps1", () => {
		const list = restrictedFromScript(readFileSync("update/update.ps1", "utf8"));
		expect(list.length).toBeGreaterThan(0);
		expect(list).toContain("3995");
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
