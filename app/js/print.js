// ── Printable directory ──────────────────────────────────────────────
//
// One heading per section (children nested under their parent), each with
// a compact table: desk phones first, then wireless handsets.

import { loadCatalog } from "./api.js";
import { escapeHtml } from "./search.js";
import { initializeTheme, toggleTheme } from "./theme.js";

/** Small sections (in rows) are kept on one page. */
const KEEP_TOGETHER = 25;

const nums = list => list.map(n => escapeHtml(String(n).replace("-", "–"))).join(", ");

function phoneRow(p) {
	const parts = [`<b>${escapeHtml(p.name)}</b>`];
	if (p.position) parts.push(`<span class="p-pos">${escapeHtml(p.position)}</span>`);
	let html = parts.join(" · ");
	if (p.unit) html += ` <span class="p-unit">— ${escapeHtml(p.unit)}</span>`;
	if (p.shared) html += ` <span class="p-flag">(Κοινόχρηστο)</span>`;
	if (p.restricted) html += ` <span class="p-flag">Μη συνδέετε</span>`;
	return `<tr${p.restricted ? ` class="p-restricted"` : ""}>
		<td>${html}</td>
		<td class="c-n">${nums(p.numbers)}</td>
		<td class="c-e">${p.external.map(escapeHtml).join("<br>")}</td>
	</tr>`;
}

function phoneTable(phones) {
	if (!phones.length) return "";
	const dir = phones.filter(p => p.type !== "dect");
	const dect = phones.filter(p => p.type === "dect");
	let body = dir.map(phoneRow).join("");
	if (dect.length) {
		body += `<tr class="p-sub"><th colspan="3">Ασύρματοι</th></tr>` + dect.map(phoneRow).join("");
	}
	return `<table>
		<thead><tr><th>Όνομα / Τμήμα</th><th class="c-n">Εσωτερικό</th><th class="c-e">Εξωτερικό</th></tr></thead>
		<tbody>${body}</tbody>
	</table>`;
}

function render(catalog) {
	const sections = catalog.sections ?? [];
	const phones = catalog.phones ?? [];
	const ids = new Set(sections.map(s => s.id));

	const bySection = new Map();
	const loose = [];
	for (const p of phones) {
		if (p.sectionId && ids.has(p.sectionId)) {
			if (!bySection.has(p.sectionId)) bySection.set(p.sectionId, []);
			bySection.get(p.sectionId).push(p);
		} else loose.push(p);
	}

	const children = new Map();
	const roots = [];
	for (const s of sections) {
		if (s.parentId && ids.has(s.parentId) && s.parentId !== s.id) {
			if (!children.has(s.parentId)) children.set(s.parentId, []);
			children.get(s.parentId).push(s);
		} else roots.push(s);
	}

	const seen = new Set();
	const block = (s, depth) => {
		if (seen.has(s.id)) return "";
		seen.add(s.id);
		const own = bySection.get(s.id) ?? [];
		const inner = (children.get(s.id) ?? []).map(c => block(c, depth + 1)).join("");
		if (!own.length && !inner) return "";
		const title = escapeHtml(s.name) + (s.abbr ? ` (${escapeHtml(s.abbr)})` : "");
		const tag = depth === 0 ? "h2" : "h3";
		const keep = own.length <= KEEP_TOGETHER && !inner ? " p-keep" : "";
		return `<section class="p-section${keep}"><${tag}>${title}</${tag}>${phoneTable(own)}${inner}</section>`;
	};

	let html = "";
	if (catalog.title) html += `<h1>${escapeHtml(catalog.title)}</h1>`;
	else html += `<h1>Τηλεφωνικός Κατάλογος</h1>`;
	const when = catalog.updatedAt ? new Date(catalog.updatedAt) : null;
	if (when && !isNaN(when)) html += `<p class="p-date">Ενημέρωση: ${when.toLocaleDateString("el-GR")}</p>`;

	const info = (catalog.info ?? []).filter(Boolean);
	if (info.length) {
		html += `<ul class="p-info">${info
			.map(line => {
				const i = line.indexOf(":");
				return i > 0 ? `<li><b>${escapeHtml(line.slice(0, i))}:</b>${escapeHtml(line.slice(i + 1))}</li>` : `<li>${escapeHtml(line)}</li>`;
			})
			.join("")}</ul>`;
	}

	html += roots.map(s => block(s, 0)).join("");
	html += sections.filter(s => !seen.has(s.id)).map(s => block(s, 0)).join(""); // parent cycles
	if (loose.length) {
		html += `<section class="p-section${loose.length <= KEEP_TOGETHER ? " p-keep" : ""}"><h2>Χωρίς διεύθυνση</h2>${phoneTable(loose)}</section>`;
	}
	if (!phones.length) html += `<p class="p-empty">Ο κατάλογος είναι άδειος.</p>`;
	document.getElementById("paper").innerHTML = html;
}

async function start() {
	initializeTheme();
	document.getElementById("themeToggle").addEventListener("click", toggleTheme);
	document.getElementById("printBtn").addEventListener("click", () => window.print());
	document.getElementById("backBtn").addEventListener("click", () => {
		if (history.length > 1 && document.referrer) history.back();
		else location.href = "index.html";
	});
	try {
		const { catalog } = await loadCatalog();
		render(catalog);
	} catch (err) {
		document.getElementById("paper").innerHTML = `<p class="p-empty">Ο κατάλογος δεν φορτώθηκε: ${escapeHtml(typeof err === "string" ? err : err?.message)}</p>`;
	}
}

start();
