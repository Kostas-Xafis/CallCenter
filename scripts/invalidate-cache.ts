import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SW_PATH = resolve(__dirname, '..', 'public', 'sw.js');

const swContent = readFileSync(SW_PATH, 'utf-8');

const newVersion = `callcenter-v${Date.now()}`;

// Replace the CACHE_NAME constant value. The pattern matches:
//   const CACHE_NAME = "callcenter-v<NUMBERS>";
const updated = swContent.replace(
    /const CACHE_NAME = "callcenter-v\d+"/,
    `const CACHE_NAME = "${newVersion}"`,
);

if (updated === swContent) {
    console.error("❌ Could not find CACHE_NAME in sw.js — is the format correct?");
    process.exit(1);
}

writeFileSync(SW_PATH, updated);
console.log(`✅ Service worker cache version bumped to: ${newVersion}`);
