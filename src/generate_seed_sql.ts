/**
 * Generates migrations/0002_seed.sql from phones.csv.
 * Run with: bun run db:gen-seed
 */
import { createReadStream, writeFileSync } from "fs";
import { createInterface } from "readline";
import path from "path";

const csvPath = path.join(import.meta.dir, "../phones.csv");
const sqlPath = path.join(import.meta.dir, "../migrations/0002_seed.sql");

function escape(s: string): string {
    return s.replace(/'/g, "''");
}

const rl = createInterface({
    input: createReadStream(csvPath),
    crlfDelay: Infinity
});

const lines: string[] = ["-- Seed data generated from phones.csv", ""];
let count = 0;
let skipped = 0;
let header = true;

for await (const line of rl) {
    if (header) { header = false; continue; }

    const [type, service, code] = line.split(",").map(s => s.trim());

    if (!type || !service || !code) {
        skipped++;
        continue;
    }

    lines.push(
        `INSERT INTO phone_records (type, service, code) VALUES ` +
        `('${escape(type)}', '${escape(service)}', '${escape(code)}');`
    );
    count++;
}

writeFileSync(sqlPath, lines.join("\n") + "\n", "utf-8");
console.log(`Generated ${count} INSERT statements (${skipped} skipped) → ${sqlPath}`);
