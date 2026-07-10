export { };

const SW_PATH = new URL("../public/sw.js", import.meta.url).pathname;

const swContent = await Bun.file(SW_PATH).text();

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

await Bun.write(SW_PATH, updated);
console.log(`✅ Service worker cache version bumped to: ${newVersion}`);
