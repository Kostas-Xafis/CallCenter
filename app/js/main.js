// ── Application entry point ──────────────────────────────────────────

import { buildModel, readEmbeddedPayload, SOURCES } from "./data.js";
import { buildIndex, escapeHtml, highlight, search } from "./search.js";
import { updateSearchHint } from "./greek-layout.js";
import { initializeTheme, toggleTheme } from "./theme.js";
import { abbrKey, fold } from "./normalize.js";

const BATCH_SIZE = 150;
const SEARCH_DEBOUNCE_MS = 120;

const $ = id => document.getElementById(id);

const state = {
	query: "",
	source: "all",
	dirKey: "",
	items: [], // rows to render: { type: "group", ... } | { type: "record", record, highlights }
	rendered: 0
};

let model = null;
let index = null;

// ── Rendering ────────────────────────────────────────────────────────

const ICON_COPY_TITLE = "Κλικ για αντιγραφή";

function renderNumbers(record, hl) {
	const hits = hl?.numbers ?? [];
	const parts = record.numbers.map(token => {
		const hit = hits.find(h => h.number === token);
		let inner = escapeHtml(token);
		let cls = "num";
		if (hit) {
			inner = highlight(token, [[hit.start, hit.end]]);
		} else if (token.includes("–")) {
			const [a, b] = token.split("–").map(Number);
			if (hits.some(h => Number(h.number) >= a && Number(h.number) <= b && h.number.length === String(a).length)) cls += " num-hit";
		}
		const copy = token.includes("–") ? token.split("–")[0] : token;
		return `<button type="button" class="${cls}" data-copy="${escapeHtml(copy)}" title="${ICON_COPY_TITLE}">${inner}</button>`;
	});
	const external = record.external.map(x => {
		const hit = hits.some(h => h.number === x.replace(/\D/g, ""));
		return `<button type="button" class="num num-ext${hit ? " num-hit" : ""}" data-copy="${escapeHtml(x)}" title="Εξωτερική γραμμή · ${ICON_COPY_TITLE}">${escapeHtml(x)}</button>`;
	});
	return parts.join("") + external.join("");
}

function renderRecord(record, hl = {}) {
	const classes = ["row", `row-${record.source}`];
	if (record.restricted) classes.push("restricted");
	const name =
		highlight(record.name, hl.name) +
		(record.shared ? ' <span class="tag tag-shared">Κοινόχρηστο</span>' : "") +
		(record.restricted ? ' <span class="tag tag-restricted" title="Δεν συνδέουμε κλήσεις σε αυτόν τον αριθμό">Μη συνδέετε</span>' : "");
	const dirTitle = record.dirTitle && record.dirTitle !== record.dir ? record.dirTitle : "";
	return `<div class="${classes.join(" ")}" role="row">
		<div class="c-num"><span class="src-icon src-${record.source}" title="${SOURCES[record.source].long}"></span><div class="nums">${renderNumbers(record, hl)}</div></div>
		<div class="c-dir">${record.dir ? `<button type="button" class="dir-badge" data-dir="${escapeHtml(record.dirKey)}" title="${escapeHtml(dirTitle ? dirTitle + " · " : "")}Φιλτράρισμα">${highlight(record.dir, hl.dir?.filter(([a]) => a < record.dir.length))}</button>` : ""}</div>
		<div class="c-name">${name}</div>
		<div class="c-pos">${highlight(record.position, hl.position)}</div>
		<div class="c-unit">${highlight(record.unit, hl.unit)}</div>
	</div>`;
}

function renderGroup(item) {
	return `<div class="group" role="row"><span class="group-title">${escapeHtml(item.title)}</span>${item.subtitle ? `<span class="group-sub">${escapeHtml(item.subtitle)}</span>` : ""}<span class="group-count">${item.count}</span></div>`;
}

function renderBatch() {
	const container = $("results");
	const slice = state.items.slice(state.rendered, state.rendered + BATCH_SIZE);
	if (!slice.length) return;
	const html = slice.map(item => (item.type === "group" ? renderGroup(item) : renderRecord(item.record, item.highlights))).join("");
	container.insertAdjacentHTML("beforeend", html);
	state.rendered += slice.length;
}

function renderEmpty(message) {
	$("results").innerHTML = `<div class="empty">${message}</div>`;
}

// ── Filtering ────────────────────────────────────────────────────────

let searchCache = { query: null, results: [] };
function searchResults() {
	if (searchCache.query !== state.query) searchCache = { query: state.query, results: search(index, state.query) };
	return searchCache.results;
}

function matchesFilters(record) {
	if (state.source !== "all" && record.source !== state.source) return false;
	if (state.dirKey && record.dirKey !== state.dirKey) return false;
	return true;
}

/** Without a query: directory in document order grouped by section, then DECT by number. */
function browseItems(records) {
	const items = [];
	let lastGroup = null;
	let group = null;
	for (const record of records) {
		const groupId = record.source === "dir" ? `s:${record.section.id}` : "dect";
		if (groupId !== lastGroup) {
			lastGroup = groupId;
			if (record.source === "dir") {
				const s = record.section;
				group = {
					type: "group",
					title: s.abbr ? `${s.name} (${s.abbr})` : s.name,
					subtitle: s.parent ? `υπάγεται: ${s.parent}` : "",
					count: 0
				};
			} else {
				group = { type: "group", title: SOURCES.dect.long, subtitle: "κατά αριθμό", count: 0 };
			}
			items.push(group);
		}
		group.count++;
		items.push({ type: "record", record, highlights: {} });
	}
	return items;
}

function update() {
	const filtered = state.query
		? searchResults().filter(r => matchesFilters(r.record))
		: model.records.filter(matchesFilters);

	state.items = state.query
		? filtered.map(r => ({ type: "record", record: r.record, highlights: r.highlights }))
		: browseItems(filtered);
	state.rendered = 0;

	const count = filtered.length;
	$("resultsCount").textContent = `${count} ${count === 1 ? "εγγραφή" : "εγγραφές"}`;
	$("resetFilters").hidden = !state.query && state.source === "all" && !state.dirKey;
	$("clearBtn").hidden = !state.query;

	$("resultsScroll").scrollTop = 0;
	$("results").innerHTML = "";
	if (!count) {
		renderEmpty(state.query ? `Δεν βρέθηκαν αποτελέσματα για «${escapeHtml(state.query)}»` : "Δεν υπάρχουν εγγραφές");
		return;
	}
	renderBatch();
	// Fill the viewport immediately; the rest loads on scroll.
	requestAnimationFrame(fillViewport);
}

function fillViewport() {
	const scroll = $("resultsScroll");
	let guard = 20;
	while (state.rendered < state.items.length && scroll.scrollHeight <= scroll.clientHeight * 2 && guard--) renderBatch();
}

function updateCounts() {
	const counts = { all: 0, dir: 0, dect: 0 };
	const base = state.query ? searchResults().map(r => r.record) : model.records;
	for (const r of base) {
		if (state.dirKey && r.dirKey !== state.dirKey) continue;
		counts.all++;
		counts[r.source]++;
	}
	for (const el of document.querySelectorAll("[data-count]")) el.textContent = counts[el.dataset.count];
}

function refresh() {
	update();
	updateCounts();
}

// ── Side panel ───────────────────────────────────────────────────────

/** Display labels for the header lines of the directory document. */
const INFO_LABELS = [[/^Επισύνδεση(?!\p{L})/iu, "Επισύνδεση με VPN"]];

const infoLabel = label => INFO_LABELS.find(([re]) => re.test(label))?.[1] ?? label;

const formatDate = iso => {
	if (!iso) return "—";
	const d = new Date(iso);
	return isNaN(d) ? iso : d.toLocaleString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

function renderSidePanel() {
	if (model.info.length) {
		$("infoCard").hidden = false;
		$("infoList").innerHTML = model.info
			.map(line => {
				const i = line.lastIndexOf(":");
				const label = i > 0 ? line.slice(0, i) : line;
				const value = i > 0 ? line.slice(i + 1).trim() : "";
				const note = value.match(/^(.*?)\s*(\(.*\))$/);
				const dd = note ? `${escapeHtml(note[1])} <small>${escapeHtml(note[2])}</small>` : escapeHtml(value);
				return `<dt>${escapeHtml(infoLabel(label))}</dt><dd>${dd}</dd>`;
			})
			.join("");
	}

	if (model.meta.generatedAt) {
		$("lastUpdate").hidden = false;
		$("lastUpdate").textContent = `Τελευταία ενημέρωση: ${formatDate(model.meta.generatedAt)}`;
	}

	if (model.warnings.length) {
		const btn = $("warningsBtn");
		btn.hidden = false;
		btn.textContent = `⚠ ${model.warnings.length} προειδοποιήσεις επεξεργασίας`;
		$("warningsList").innerHTML = model.warnings
			.map(
				w =>
					`<li><strong>${SOURCES[w.source]?.label ?? ""}${w.line ? ` · γραμμή ${w.line}` : ""}:</strong> ${escapeHtml(w.message)}${w.raw ? `<pre>${escapeHtml(w.raw)}</pre>` : ""}</li>`
			)
			.join("");
		btn.addEventListener("click", () => $("warningsDialog").showModal());
	}
}

function renderDirectorateFilter() {
	const select = $("dirFilter");
	const option = d => {
		const label = d.hasAbbr ? (d.title && d.title !== d.abbr ? `${d.abbr} — ${d.title}` : d.abbr) : d.title || d.abbr;
		return `<option value="${escapeHtml(d.key)}">${escapeHtml(label)} (${d.count})</option>`;
	};
	const withAbbr = model.directorates.filter(d => d.hasAbbr);
	const others = model.directorates.filter(d => !d.hasAbbr);
	select.insertAdjacentHTML(
		"beforeend",
		`<optgroup label="Διευθύνσεις & Υπηρεσίες">${withAbbr.map(option).join("")}</optgroup>` +
			(others.length ? `<optgroup label="Λοιπές ενότητες">${others.map(option).join("")}</optgroup>` : "")
	);
}

// ── Interaction ──────────────────────────────────────────────────────

let toastTimer = null;
function toast(message) {
	const el = $("toast");
	el.textContent = message;
	el.classList.add("visible");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el.classList.remove("visible"), 1600);
}

async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		document.execCommand("copy");
		ta.remove();
	}
	toast(`Αντιγράφηκε: ${text}`);
}

// ── Page state ↔ URL ─────────────────────────────────────────────────
//
// The search, the phone type and the directorate live in the address bar,
// e.g. katalogos.html#q=καρδιολ&τυπος=ασυρματα&διευθυνση=ΔΤΕ, so a reload or a
// bookmark brings the same view back.

const URL_TYPE = { dir: "σταθερα", dect: "ασυρματα" };

/** Readable URL value for a directorate: its abbreviation, or its name. */
const directorateParam = key => {
	const d = model.directorates.find(x => x.key === key);
	return d ? (d.hasAbbr ? d.abbr : d.title) : key;
};

function directorateFromParam(value) {
	if (!value) return "";
	const d = model.directorates.find(x => x.key === value || x.abbr === value || x.title === value || x.key === abbrKey(value));
	return d ? d.key : "";
}

function syncUrl() {
	const params = new URLSearchParams();
	if (state.query) params.set("q", state.query);
	if (state.source !== "all") params.set("τυπος", URL_TYPE[state.source]);
	if (state.dirKey) params.set("διευθυνση", directorateParam(state.dirKey));
	const hash = params.toString();
	try {
		history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
	} catch {
		/* some browsers restrict history on file:// */
	}
}

function readUrl() {
	const params = new URLSearchParams(location.hash.replace(/^#/, ""));
	const type = fold(params.get("τυπος") ?? "");
	const source = Object.keys(URL_TYPE).find(k => URL_TYPE[k] === type) ?? "all";
	return { query: (params.get("q") ?? "").trim(), source, dirKey: directorateFromParam(params.get("διευθυνση")) };
}

/** Applies a full state to the controls and redraws once. */
function applyState({ query, source, dirKey }) {
	state.query = query;
	state.source = source;
	state.dirKey = dirKey;
	$("searchInput").value = query;
	updateSearchHint(query);
	$("dirFilter").value = dirKey;
	for (const tab of document.querySelectorAll("#sourceTabs [data-source]")) {
		tab.setAttribute("aria-selected", String(tab.dataset.source === source));
	}
	syncUrl();
	refresh();
}

function setSource(source) {
	state.source = source;
	for (const tab of document.querySelectorAll("#sourceTabs [data-source]")) {
		tab.setAttribute("aria-selected", String(tab.dataset.source === source));
	}
	syncUrl();
	update();
}

function setDirectorate(key) {
	state.dirKey = key;
	$("dirFilter").value = key;
	syncUrl();
	refresh();
}

function setQuery(raw) {
	state.query = raw.trim();
	updateSearchHint(state.query);
	syncUrl();
	refresh();
}

function bindEvents() {
	const input = $("searchInput");
	let timer = null;
	input.addEventListener("input", () => {
		clearTimeout(timer);
		if (!input.value.trim()) return setQuery("");
		timer = setTimeout(() => setQuery(input.value), SEARCH_DEBOUNCE_MS);
	});
	input.addEventListener("keydown", e => {
		if (e.key === "Escape") {
			input.value = "";
			setQuery("");
		} else if (e.key === "Enter") {
			clearTimeout(timer);
			setQuery(input.value);
		}
	});
	$("clearBtn").addEventListener("click", () => {
		input.value = "";
		setQuery("");
		input.focus();
	});

	// Type anywhere to search
	document.addEventListener("keydown", e => {
		if (e.target === input || e.ctrlKey || e.metaKey || e.altKey) return;
		if ($("warningsDialog").open) return;
		if (e.key === "/" || (e.key.length === 1 && !/\s/.test(e.key) && !(e.target instanceof HTMLSelectElement))) {
			if (e.key === "/") e.preventDefault();
			input.focus();
		} else if (e.key === "Escape" && state.query) {
			input.value = "";
			setQuery("");
		}
	});

	$("sourceTabs").addEventListener("click", e => {
		const tab = e.target.closest("[data-source]");
		if (tab) setSource(tab.dataset.source);
	});
	$("dirFilter").addEventListener("change", e => setDirectorate(e.target.value));
	$("resetFilters").addEventListener("click", () => applyState({ query: "", source: "all", dirKey: "" }));
	// Address edited by hand (or a bookmark opened in the same tab)
	window.addEventListener("hashchange", () => applyState(readUrl()));

	$("results").addEventListener("click", e => {
		const num = e.target.closest("[data-copy]");
		if (num) return copyText(num.dataset.copy);
		const dir = e.target.closest("[data-dir]");
		if (dir) setDirectorate(dir.dataset.dir);
	});

	const observer = new IntersectionObserver(entries => {
		if (entries.some(en => en.isIntersecting)) renderBatch();
	}, { root: $("resultsScroll"), rootMargin: "600px" });
	observer.observe($("sentinel"));

	$("themeToggle").addEventListener("click", toggleTheme);
}

// ── Boot ─────────────────────────────────────────────────────────────

function init() {
	initializeTheme();
	const payload = readEmbeddedPayload();
	model = buildModel(payload);
	index = buildIndex(model.records);

	renderSidePanel();
	renderDirectorateFilter();
	bindEvents();

	if (!payload) {
		renderEmpty("Δεν υπάρχουν δεδομένα. Εκτελέστε το <code>update.cmd</code> για να φορτωθούν τα σταθερά και τα ασύρματα τηλέφωνα.");
		$("resultsCount").textContent = "";
		return;
	}
	applyState(readUrl());
	$("searchInput").focus();
}

init();
