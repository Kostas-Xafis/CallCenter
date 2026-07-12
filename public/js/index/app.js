// ── Main application (index page) ────────────────────────────────────

import "../shared/dev-logger.js";
import { registerServiceWorker } from "../shared/sw.js";
import { initializeTheme, toggleTheme } from "../shared/theme.js";
import { idbGet, idbGetAll, idbPut, idbPutAll, openIDB } from "./db.js";
import { clientFuzzySearch, fuzzyMatchIndices, highlightStringAt } from "./fuzzy-search.js";
import { toGreekQuery, updateSearchHint } from "./greek-layout.js";

// ── Constants ────────────────────────────────────────────────────────

const API_BASE = "";
const PAGE_SIZE = 100;

const RESTRICTED_CODES = new Set(["3995", "3955", "3953", "3738", "3974", "3780", "3808", "3535", "3915", "1745", "3997", "3598"]);

// ── State ────────────────────────────────────────────────────────────

let allRecords = [];
let currentRecords = [];
let currentPage = 1;
let totalPages = 1;
let activeQuery = "";

// ── Records cache loader ─────────────────────────────────────────────

async function loadRecordsWithCache() {
	showLoading();
	try {
		const [idb, hashRes] = await Promise.all([openIDB(), fetch(`${API_BASE}/api/records/hash`)]);
		const { hash: serverHash } = await hashRes.json();
		const cachedHash = await idbGet(idb, "meta", "hash");

		if (cachedHash === serverHash) {
			allRecords = await idbGetAll(idb, "records");
		} else {
			const res = await fetch(`${API_BASE}/api/records`);
			allRecords = await res.json();
			await idbPutAll(idb, "records", allRecords);
			await idbPut(idb, "meta", "hash", serverHash);
		}
		displayResults(allRecords);
	} catch (error) {
		showError("Αποτυχία φόρτωσης εγγραφών");
		console.error("Σφάλμα φόρτωσης εγγραφών:", error);
	}
}

// ── Type filter loader ───────────────────────────────────────────────

async function loadTypes() {
	try {
		const response = await fetch(`${API_BASE}/api/stats`);
		const stats = await response.json();
		const typeFilter = document.getElementById("typeFilter");
		const display = document.getElementById("typePillDisplay");
		stats.types.forEach(type => {
			const option = document.createElement("option");
			option.value = type;
			option.textContent = type;
			typeFilter.appendChild(option);
		});
		typeFilter.addEventListener("change", () => {
			const sel = typeFilter.options[typeFilter.selectedIndex];
			display.textContent = sel.value || "Όλα";
			filterByType();
		});
	} catch (error) {
		console.error("Σφάλμα φόρτωσης τύπων:", error);
	}
}

// ── Search & filter ──────────────────────────────────────────────────

function loadAllRecords() {
	activeQuery = "";
	displayResults(allRecords);
}

function performSearch() {
	const raw = document.getElementById("searchInput").value.trim();
	if (!raw) {
		updateSearchHint("");
		loadAllRecords();
		return;
	}

	const { query } = toGreekQuery(raw);
	activeQuery = query;

	const results = clientFuzzySearch(allRecords, query);
	displayResults(results);
}

function filterByType() {
	const type = document.getElementById("typeFilter").value;
	activeQuery = "";
	if (!type) {
		displayResults(allRecords);
	} else {
		displayResults(allRecords.filter(r => r.type === type));
	}
}

// ── Display & pagination ─────────────────────────────────────────────

function displayResults(records) {
	currentRecords = records;
	currentPage = 1;
	totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
	renderPage();
}

function goToPage(page) {
	currentPage = Math.min(Math.max(1, page), totalPages);
	renderPage();
	document.getElementById("resultsContainer").scrollTop = 0;
}

function renderPage() {
	const container = document.getElementById("resultsContainer");
	const countLabel = document.getElementById("resultsCount");
	const pagination = document.getElementById("pagination");

	countLabel.textContent = `${currentRecords.length} εγγραφ${currentRecords.length !== 1 ? "ές" : "ή"}`;

	if (currentRecords.length === 0) {
		container.innerHTML = '<div class="no-results">Δεν βρέθηκαν εγγραφές</div>';
		pagination.style.display = "none";
		return;
	}

	const start = (currentPage - 1) * PAGE_SIZE;
	const pageRecords = currentRecords.slice(start, start + PAGE_SIZE);

	const rows = pageRecords
		.map(record => {
			const { type, service, code, merged, matchesIdx } = record;
			const restricted = RESTRICTED_CODES.has(code);

			let serviceHtml;
			if (merged) {
				const services = JSON.parse(service);
				const chips = services
					.map(s => {
						const indices = activeQuery ? fuzzyMatchIndices(activeQuery, s) : [];
						const inner = indices.length ? highlightStringAt(s, indices) : s;
						return `<span class="service-chip">${inner}</span>`;
					})
					.join("");
				serviceHtml = `<div class="merged-services">${chips}</div>`;
			} else {
				const matchesIdxService = matchesIdx && matchesIdx.filter(idx => idx < service.length);
				serviceHtml =
					((matchesIdxService && highlightStringAt(service, matchesIdxService)) || service) +
					(restricted ? '<span class="restricted-badge">ΜΗ ΔΙΑΘΕΣΙΜΟ</span>' : "");
			}

			const matchesIdxCode =
				!merged && matchesIdx && matchesIdx.filter(idx => idx >= service.length).map(idx => idx - service.length - 1);
			const codeHtml = (matchesIdxCode && highlightStringAt(code, matchesIdxCode)) || code;

			return `
            <tr${restricted ? ' class="restricted"' : ""}>
                <td><strong>${codeHtml}</strong></td>
                <td>${serviceHtml}</td>
                <td><span class="badge badge-type">${type}</span></td>
            </tr>
        `;
		})
		.join("");

	container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Κωδικός</th>
                    <th>Υπηρεσία</th>
                    <th>Τύπος</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

	// Update pagination controls
	document.getElementById("pageInfo").textContent = `Σελίδα ${currentPage} από ${totalPages}`;
	document.getElementById("btnFirst").disabled = currentPage === 1;
	document.getElementById("btnPrev").disabled = currentPage === 1;
	document.getElementById("btnNext").disabled = currentPage === totalPages;
	document.getElementById("btnLast").disabled = currentPage === totalPages;
	pagination.style.display = totalPages > 1 ? "flex" : "none";
}

// ── UI helpers ───────────────────────────────────────────────────────

function showLoading() {
	document.getElementById("resultsContainer").innerHTML = '<div class="loading"><div class="spinner"></div>Φόρτωση…</div>';
}

function showError(message) {
	document.getElementById("resultsContainer").innerHTML = `<div class="error">⚠️ ${message}</div>`;
}

// ── Initialization ───────────────────────────────────────────────────

async function init() {
	await loadTypes();
	await loadRecordsWithCache();
}

// ── Event listeners ──────────────────────────────────────────────────

document.getElementById("searchInput").addEventListener("keypress", e => {
	if (e.key === "Enter") {
		clearTimeout(searchDebounceTimer);
		performSearch();
	}
});

let searchDebounceTimer = null;
let lastSearchValue = "";

document.getElementById("searchInput").addEventListener("input", e => {
	const raw = e.target.value.trim();
	updateSearchHint(raw);
	clearTimeout(searchDebounceTimer);

	// If the user clears the field, reset immediately — no need to debounce
	if (!raw) {
		lastSearchValue = "";
		performSearch();
		return;
	}

	// Debounce fuzzy searches by 150 ms to avoid thrashing on fast typing
	searchDebounceTimer = setTimeout(() => {
		if (raw !== lastSearchValue) {
			lastSearchValue = raw;
			performSearch();
		}
	}, 150);
});

// ── Logout ────────────────────────────────────────────────────────────

async function logout() {
	await fetch("/auth/logout", { method: "POST" });
	window.location.href = "/login";
}

// Expose functions needed by inline onclick handlers
window.toggleTheme = toggleTheme;
window.logout = logout;
window.performSearch = performSearch;
window.filterByType = filterByType;
window.goToPage = goToPage;
Object.defineProperty(window, "currentPage", { get: () => currentPage });
Object.defineProperty(window, "totalPages", { get: () => totalPages });

// ── Boot ─────────────────────────────────────────────────────────────

initializeTheme();
init();
registerServiceWorker();
