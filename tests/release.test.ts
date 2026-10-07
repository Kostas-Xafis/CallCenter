// dist/ is committed and downloaded by administrators as is, so it must be
// complete, up to date with app/ and update/, and free of personal data.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { buildPage, RELEASE_FILES } from "../scripts/build.ts";
import { extractDataBlock } from "../scripts/lib/payload.ts";

const page = existsSync("dist/katalogos.html") ? readFileSync("dist/katalogos.html", "utf8") : "";

describe("dist/ release folder", () => {
	test("katalogos.html has an empty data block (no personal data in git)", () => {
		expect(extractDataBlock(page)).toContain('type="application/json">null</script>');
	});

	test("katalogos.html is up to date with app/ (run `bun run build`)", async () => {
		expect(page === (await buildPage())).toBe(true);
	});

	test("scripts, guide and restricted list match update/ (run `bun run build`)", () => {
		for (const f of RELEASE_FILES) {
			expect(existsSync(`dist/${f}`)).toBe(true);
			expect(Buffer.compare(readFileSync(`dist/${f}`), readFileSync(`update/${f}`))).toBe(0);
		}
	});

	test("data/ folder is present", () => {
		expect(existsSync("dist/data/.gitkeep")).toBe(true);
	});
});
