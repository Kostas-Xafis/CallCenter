// Renders guide/ΟΔΗΓΙΕΣ.html to guide/ΟΔΗΓΙΕΣ.pdf with headless Chrome.  bun run guide
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SOURCE = join(ROOT, "guide/ΟΔΗΓΙΕΣ.html");
const OUTPUT = join(ROOT, "guide/ΟΔΗΓΙΕΣ.pdf");

const chrome = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].find(
	bin => Bun.spawnSync(["which", bin]).exitCode === 0
);
if (!chrome) throw new Error("Chrome/Chromium is needed to render the guide");

const proc = Bun.spawnSync([
	chrome, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
	`--print-to-pdf=${OUTPUT}`, `file://${SOURCE}`
]);
if (proc.exitCode !== 0 || !existsSync(OUTPUT)) {
	console.error(proc.stderr.toString());
	throw new Error("PDF rendering failed");
}
console.log(`✓ ${OUTPUT}`);
