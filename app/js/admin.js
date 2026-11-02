// ── Admin page ───────────────────────────────────────────────────────
//
// Sections + phones editor. Every change is saved immediately: the whole
// catalog is sent with saveCatalog(catalog, version) and `version` is
// replaced by the returned one. Data shape: docs/CONTRACT.md (schema 3).

import { CONFLICT, catalogVersion, changePassword, isAdmin, loadCatalog, logout, saveCatalog } from "./api.js";
import { fold } from "./normalize.js";
import { escapeHtml } from "./search.js";
import { initializeTheme, toggleTheme } from "./theme.js";

const ALL = "@all";
const NONE = "@none";

let catalog = null;
let version = null;
let selected = ALL;
let busy = false;

const $ = id => document.getElementById(id);

// ── Helpers ──────────────────────────────────────────────────────────

const sectionsById = () => new Map(catalog.sections.map(s => [s.id, s]));

function sectionLabel(s) {
	if (!s) return "—";
	return s.abbr ? `${s.name} (${s.abbr})` : s.name;
}

function newId(prefix, list) {
	const used = new Set(list.map(x => x.id));
	let n = Date.now();
	let id;
	do id = prefix + (n++).toString(36);
	while (used.has(id));
	return id;
}

/** Sections in tree order: [{ section, depth }]. Orphans count as roots. */
function sectionTree() {
	const ids = new Set(catalog.sections.map(s => s.id));
	const children = new Map();
	const roots = [];
	for (const s of catalog.sections) {
		if (s.parentId && ids.has(s.parentId) && s.parentId !== s.id) {
			if (!children.has(s.parentId)) children.set(s.parentId, []);
			children.get(s.parentId).push(s);
		} else roots.push(s);
	}
	const out = [];
	const seen = new Set();
	const walk = (s, depth) => {
		if (seen.has(s.id)) return; // guards against parent cycles
		seen.add(s.id);
		out.push({ section: s, depth });
		for (const c of children.get(s.id) ?? []) walk(c, depth + 1);
	};
	roots.forEach(s => walk(s, 0));
	// Anything left is part of a cycle: show it flat rather than lose it.
	for (const s of catalog.sections) if (!seen.has(s.id)) walk(s, 0);
	return out;
}

function descendantsOf(id) {
	const out = new Set([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const s of catalog.sections) {
			if (s.parentId && out.has(s.parentId) && !out.has(s.id)) {
				out.add(s.id);
				grew = true;
			}
		}
	}
	return out;
}

const displayNumber = n => String(n).replace("-", "–");

/** "4332, 5501 - 5511" → { numbers: ["4332", "5501-5511"] } or { error }. */
function parseNumbers(text) {
	const tokens = String(text)
		.replace(/\s*[-–—]\s*/g, "-")
		.split(/[,;\s]+/)
		.filter(Boolean);
	if (!tokens.length) return { error: "Γράψτε τουλάχιστον έναν εσωτερικό αριθμό." };
	for (const t of tokens) {
		const m = /^(\d+)(?:-(\d+))?$/.exec(t);
		if (!m) return { error: `Ο αριθμός «${t}» δεν είναι σωστός. Επιτρέπονται μόνο ψηφία ή σειρές όπως 5501-5511.` };
		if (m[2] && Number(m[2]) < Number(m[1])) return { error: `Στη σειρά «${t}» ο δεύτερος αριθμός πρέπει να είναι μεγαλύτερος από τον πρώτο.` };
	}
	return { numbers: tokens };
}

const parseExternal = text =>
	String(text)
		.split(/[,;]+/)
		.map(t => t.trim().replace(/\s+/g, " "))
		.filter(Boolean);

function errorText(err) {
	if (typeof err === "string") return err;
	return err?.message || String(err);
}

// ── Toast & message dialog ───────────────────────────────────────────

let toastTimer = 0;
function toast(text) {
	const el = $("toast");
	el.textContent = text;
	el.classList.add("visible");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el.classList.remove("visible"), 1800);
}

/** Shows a message; with `confirm` it has two buttons and resolves to true on OK. */
function message(title, text, { confirm = false, okText = "Εντάξει", danger = false } = {}) {
	const dlg = $("messageDialog");
	$("messageTitle").textContent = title;
	$("messageText").textContent = text;
	$("messageCancel").hidden = !confirm;
	const ok = $("messageOk");
	ok.textContent = okText;
	ok.classList.toggle("adm-btn-danger", danger);
	ok.classList.toggle("adm-btn-primary", !danger);
	dlg.returnValue = "";
	dlg.showModal();
	(confirm ? $("messageCancel") : ok).focus();
	return new Promise(resolve => {
		dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
	});
}

// ── Loading & saving ─────────────────────────────────────────────────

async function reload() {
	const res = await loadCatalog();
	catalog = res.catalog;
	catalog.sections ??= [];
	catalog.phones ??= [];
	version = res.version;
	render();
}

/**
 * Applies `mutate` to a copy of the catalog and saves it.
 * @returns {Promise<boolean>} true when saved
 */
async function commit(mutate, done = "Αποθηκεύτηκε") {
	if (busy) return false;
	busy = true;
	document.body.classList.add("saving");
	const next = structuredClone(catalog);
	mutate(next);
	let newVersion;
	try {
		newVersion = await saveCatalog(next, version);
	} catch (err) {
		closeEditors();
		if (err === CONFLICT || err?.message === CONFLICT) {
			await reload().catch(() => {});
			await message(
				"Ο κατάλογος άλλαξε",
				"Κάποιος άλλος άλλαξε τον κατάλογο ενώ τον επεξεργαζόσασταν, γι' αυτό η τελευταία σας αλλαγή ΔΕΝ αποθηκεύτηκε.\n\nΦορτώθηκε η νεότερη έκδοση. Ελέγξτε την και κάντε ξανά την αλλαγή σας."
			);
		} else if (err === "not-admin" || err?.message === "not-admin") {
			await message("Η σύνδεση έληξε", "Πρέπει να συνδεθείτε ξανά ως διαχειριστής. Η αλλαγή δεν αποθηκεύτηκε.");
			location.href = "index.html";
		} else {
			await message("Η αλλαγή δεν αποθηκεύτηκε", errorText(err));
		}
		return false;
	} finally {
		busy = false;
		document.body.classList.remove("saving");
	}
	next.updatedAt = newVersion;
	catalog = next;
	version = newVersion;
	render();
	toast(done);
	return true;
}

function closeEditors() {
	for (const id of ["sectionDialog", "phoneDialog"]) if ($(id).open) $(id).close();
}

// ── Rendering ────────────────────────────────────────────────────────

function render() {
	if (selected !== ALL && selected !== NONE && !catalog.sections.some(s => s.id === selected)) selected = ALL;
	renderSections();
	renderPhones();
	const when = catalog.updatedAt ? new Date(catalog.updatedAt) : null;
	$("lastSaved").textContent = when && !isNaN(when) ? `Τελευταία αλλαγή: ${when.toLocaleString("el-GR")}` : "";
}

function renderSections() {
	const q = fold($("sectionFilter").value.trim());
	const counts = new Map();
	let noSection = 0;
	const ids = new Set(catalog.sections.map(s => s.id));
	for (const p of catalog.phones) {
		if (p.sectionId && ids.has(p.sectionId)) counts.set(p.sectionId, (counts.get(p.sectionId) ?? 0) + 1);
		else noSection++;
	}
	const item = (key, label, count, depth = 0, abbr = "") => `
		<li role="option" tabindex="0" data-key="${escapeHtml(key)}" aria-selected="${selected === key}" style="--depth:${depth}">
			${abbr ? `<span class="sec-abbr">${escapeHtml(abbr)}</span>` : ""}
			<span class="sec-name">${escapeHtml(label)}</span>
			<span class="sec-count">${count}</span>
		</li>`;
	let html = "";
	if (!q) html += item(ALL, "Όλα τα τηλέφωνα", catalog.phones.length) + item(NONE, "Χωρίς διεύθυνση", noSection);
	for (const { section: s, depth } of sectionTree()) {
		if (q && !fold(`${s.abbr} ${s.name}`).includes(q)) continue;
		html += item(s.id, s.name || "(χωρίς όνομα)", counts.get(s.id) ?? 0, q ? 0 : depth, s.abbr);
	}
	if (!html) html = `<li class="sec-empty">Δεν βρέθηκε διεύθυνση.</li>`;
	$("sectionList").innerHTML = html;
}

function phoneMatches(p, tokens, secs) {
	const hay = fold(
		[p.name, p.position, p.unit, ...p.numbers, ...p.external, ...p.external.map(e => e.replace(/\D/g, "")), secs.get(p.sectionId)?.abbr, secs.get(p.sectionId)?.name].join(" ")
	);
	return tokens.every(t => {
		if (hay.includes(t)) return true;
		if (/^\d+$/.test(t)) {
			const n = Number(t);
			return p.numbers.some(r => {
				const m = /^(\d+)-(\d+)$/.exec(r);
				return m && n >= Number(m[1]) && n <= Number(m[2]);
			});
		}
		return false;
	});
}

function visiblePhones() {
	const q = fold($("phoneSearch").value.trim());
	const secs = sectionsById();
	if (q) {
		const tokens = q.split(/\s+/);
		return { searching: true, phones: catalog.phones.filter(p => phoneMatches(p, tokens, secs)) };
	}
	if (selected === ALL) return { searching: false, phones: catalog.phones };
	if (selected === NONE) return { searching: false, phones: catalog.phones.filter(p => !p.sectionId || !secs.has(p.sectionId)) };
	return { searching: false, phones: catalog.phones.filter(p => p.sectionId === selected) };
}

function renderPhones() {
	const secs = sectionsById();
	const { searching, phones } = visiblePhones();
	const sec = secs.get(selected);

	let title;
	let sub = "";
	if (searching) {
		title = "Αποτελέσματα αναζήτησης";
		sub = `${phones.length} τηλέφωνα σε όλο τον κατάλογο`;
	} else if (selected === ALL) {
		title = "Όλα τα τηλέφωνα";
		sub = `${phones.length} τηλέφωνα`;
	} else if (selected === NONE) {
		title = "Τηλέφωνα χωρίς διεύθυνση";
		sub = `${phones.length} τηλέφωνα`;
	} else {
		title = sectionLabel(sec);
		const parent = secs.get(sec.parentId);
		sub = `${phones.length} τηλέφωνα` + (parent ? ` · ανήκει στη ${sectionLabel(parent)}` : "");
	}
	$("currentTitle").textContent = title;
	$("currentSub").textContent = sub;
	$("editSectionBtn").hidden = !sec || searching;

	const showSection = searching || selected === ALL || selected === NONE;
	document.querySelector(".adm-table").classList.toggle("hide-section", !showSection);

	const rows = phones.map(p => {
		const s = secs.get(p.sectionId);
		const nums = p.numbers.map(n => `<span class="num">${escapeHtml(displayNumber(n))}</span>`).join(", ");
		const ext = p.external.map(e => `<span class="ext">${escapeHtml(e)}</span>`).join("<br>");
		const type = p.type === "dect" ? `<span class="src-icon src-dect" aria-hidden="true"></span>Ασύρματο` : `<span class="src-icon src-dir" aria-hidden="true"></span>Σταθερό`;
		return `<tr data-id="${escapeHtml(p.id)}" class="${p.restricted ? "restricted" : ""}" tabindex="0" title="Κλικ για επεξεργασία">
			<td class="c-type">${type}</td>
			<td class="c-nums">${nums}</td>
			<td class="c-name">${escapeHtml(p.name)}${p.shared ? ` <span class="tag tag-shared">Κοινόχρηστο</span>` : ""}</td>
			<td>${escapeHtml(p.position)}</td>
			<td>${escapeHtml(p.unit)}</td>
			<td class="c-ext">${ext}</td>
			<td class="col-section">${s ? `<span class="sec-pill">${escapeHtml(s.abbr || s.name)}</span>` : "—"}</td>
			<td class="col-restricted"><button type="button" class="restrict-btn" data-toggle aria-pressed="${p.restricted}" title="${p.restricted ? "Πατήστε για να επιτρέπονται ξανά οι κλήσεις" : "Πατήστε για να ΜΗΝ συνδέονται κλήσεις"}">
				<span class="switch" aria-hidden="true"></span><span>${p.restricted ? "Μη συνδέετε" : "Συνδέετε"}</span>
			</button></td>
		</tr>`;
	});
	$("phoneRows").innerHTML = rows.join("");
	const empty = $("phonesEmpty");
	empty.hidden = phones.length > 0;
	empty.textContent = searching ? "Δεν βρέθηκε τηλέφωνο με αυτή την αναζήτηση." : "Δεν υπάρχουν τηλέφωνα εδώ. Πατήστε «+ Νέο τηλέφωνο» για να προσθέσετε.";
}

// ── Section editor ───────────────────────────────────────────────────

let editingSection = null; // id, or null for a new one

function fillParentSelect(select, excluded, value) {
	const opts = [`<option value="">— Καμία (κύρια διεύθυνση) —</option>`];
	for (const { section: s, depth } of sectionTree()) {
		if (excluded.has(s.id)) continue;
		opts.push(`<option value="${escapeHtml(s.id)}">${"   ".repeat(depth)}${escapeHtml(sectionLabel(s))}</option>`);
	}
	select.innerHTML = opts.join("");
	select.value = value ?? "";
}

function openSection(id) {
	const s = id ? catalog.sections.find(x => x.id === id) : null;
	editingSection = s ? s.id : null;
	const form = $("sectionForm");
	$("sectionDialogTitle").textContent = s ? "Επεξεργασία διεύθυνσης" : "Νέα διεύθυνση";
	form.name.value = s?.name ?? "";
	form.abbr.value = s?.abbr ?? "";
	fillParentSelect(form.parentId, s ? descendantsOf(s.id) : new Set(), s?.parentId ?? null);
	form.querySelector("[data-delete]").hidden = !s;
	showError(form, "");
	$("sectionDialog").showModal();
	form.name.focus();
}

async function submitSection(e) {
	e.preventDefault();
	const form = $("sectionForm");
	const name = form.name.value.trim().replace(/\s+/g, " ");
	const abbr = form.abbr.value.trim().replace(/\s+/g, " ");
	const parentId = form.parentId.value || null;
	if (!name) return showError(form, "Γράψτε το όνομα της διεύθυνσης.");
	const id = editingSection;
	let createdId = null;
	const ok = await commit(c => {
		if (id) {
			const s = c.sections.find(x => x.id === id);
			if (s) Object.assign(s, { name, abbr, parentId });
		} else {
			createdId = newId("s", c.sections);
			c.sections.push({ id: createdId, abbr, name, parentId });
		}
	});
	if (ok) {
		$("sectionDialog").close();
		if (createdId) selectSection(createdId);
	}
}

async function deleteSection() {
	const id = editingSection;
	const s = catalog.sections.find(x => x.id === id);
	if (!s) return;
	const phones = catalog.phones.filter(p => p.sectionId === id).length;
	const kids = catalog.sections.filter(x => x.parentId === id).length;
	if (phones || kids) {
		const parts = [];
		if (phones) parts.push(phones === 1 ? "1 τηλέφωνο" : `${phones} τηλέφωνα`);
		if (kids) parts.push(kids === 1 ? "1 υποδιεύθυνση" : `${kids} υποδιευθύνσεις`);
		await message(
			"Η διεύθυνση δεν μπορεί να διαγραφεί",
			`Η διεύθυνση «${sectionLabel(s)}» έχει ακόμα ${parts.join(" και ")}.\n\nΜετακινήστε τα σε άλλη διεύθυνση ή διαγράψτε τα πρώτα, και μετά διαγράψτε τη διεύθυνση.`
		);
		return;
	}
	const yes = await message("Διαγραφή διεύθυνσης", `Να διαγραφεί η διεύθυνση «${sectionLabel(s)}»;`, {
		confirm: true,
		okText: "Διαγραφή",
		danger: true
	});
	if (!yes) return;
	const ok = await commit(c => {
		c.sections = c.sections.filter(x => x.id !== id);
	}, "Η διεύθυνση διαγράφηκε");
	if (ok) {
		$("sectionDialog").close();
		selectSection(ALL);
	}
}

// ── Phone editor ─────────────────────────────────────────────────────

let editingPhone = null;

function fillSectionSelect(select, value) {
	const opts = [`<option value="">— Χωρίς διεύθυνση —</option>`];
	for (const { section: s, depth } of sectionTree()) {
		opts.push(`<option value="${escapeHtml(s.id)}">${"   ".repeat(depth)}${escapeHtml(sectionLabel(s))}</option>`);
	}
	select.innerHTML = opts.join("");
	select.value = value ?? "";
}

function openPhone(id) {
	const p = id ? catalog.phones.find(x => x.id === id) : null;
	editingPhone = p ? p.id : null;
	const form = $("phoneForm");
	$("phoneDialogTitle").textContent = p ? "Επεξεργασία τηλεφώνου" : "Νέο τηλέφωνο";
	const defaultSection = selected !== ALL && selected !== NONE ? selected : "";
	fillSectionSelect(form.sectionId, p ? p.sectionId : defaultSection);
	form.querySelector(`input[name=type][value=${p?.type === "dect" ? "dect" : "dir"}]`).checked = true;
	form.numbers.value = (p?.numbers ?? []).join(", ");
	form.external.value = (p?.external ?? []).join(", ");
	form.name.value = p?.name ?? "";
	form.position.value = p?.position ?? "";
	form.unit.value = p?.unit ?? "";
	form.shared.checked = Boolean(p?.shared);
	form.restricted.checked = Boolean(p?.restricted);
	form.querySelector("[data-delete]").hidden = !p;
	showError(form, "");
	$("phoneDialog").showModal();
	(p ? form.name : form.numbers).focus();
}

async function submitPhone(e) {
	e.preventDefault();
	const form = $("phoneForm");
	const parsed = parseNumbers(form.numbers.value);
	if (parsed.error) {
		form.numbers.focus();
		return showError(form, parsed.error);
	}
	const data = {
		type: form.type.value === "dect" ? "dect" : "dir",
		sectionId: form.sectionId.value || null,
		numbers: parsed.numbers,
		external: parseExternal(form.external.value),
		name: form.name.value.trim().replace(/\s+/g, " "),
		position: form.position.value.trim().replace(/\s+/g, " "),
		unit: form.unit.value.trim().replace(/\s+/g, " "),
		shared: form.shared.checked,
		restricted: form.restricted.checked
	};
	const id = editingPhone;
	const ok = await commit(c => {
		if (id) {
			const p = c.phones.find(x => x.id === id);
			if (p) Object.assign(p, data);
			return;
		}
		const phone = { id: newId("p", c.phones), ...data };
		// Insert after the last phone of the same section so it shows up with them.
		let at = -1;
		c.phones.forEach((p, i) => {
			if (p.sectionId === data.sectionId) at = i;
		});
		if (at >= 0) c.phones.splice(at + 1, 0, phone);
		else c.phones.push(phone);
	});
	if (ok) $("phoneDialog").close();
}

async function deletePhone() {
	const id = editingPhone;
	const p = catalog.phones.find(x => x.id === id);
	if (!p) return;
	const label = [p.numbers.map(displayNumber).join(", "), p.name].filter(Boolean).join(" — ");
	const yes = await message("Διαγραφή τηλεφώνου", `Να διαγραφεί το τηλέφωνο «${label}»;`, { confirm: true, okText: "Διαγραφή", danger: true });
	if (!yes) return;
	const ok = await commit(c => {
		c.phones = c.phones.filter(x => x.id !== id);
	}, "Το τηλέφωνο διαγράφηκε");
	if (ok) $("phoneDialog").close();
}

async function toggleRestricted(id) {
	const p = catalog.phones.find(x => x.id === id);
	if (!p) return;
	const value = !p.restricted;
	await commit(
		c => {
			const q = c.phones.find(x => x.id === id);
			if (q) q.restricted = value;
		},
		value ? "Αποθηκεύτηκε: Μη συνδέετε" : "Αποθηκεύτηκε: Συνδέετε"
	);
}

// ── Password ─────────────────────────────────────────────────────────

function openPassword() {
	const form = $("passwordForm");
	form.reset();
	showError(form, "");
	$("passwordDialog").showModal();
	form.old.focus();
}

async function submitPassword(e) {
	e.preventDefault();
	const form = $("passwordForm");
	const { old, new1, new2 } = form;
	if (!new1.value) return showError(form, "Γράψτε τον νέο κωδικό.");
	if (new1.value !== new2.value) {
		new2.select();
		return showError(form, "Οι δύο νέοι κωδικοί δεν είναι ίδιοι. Γράψτε τους ξανά.");
	}
	try {
		const ok = await changePassword(old.value, new1.value);
		if (!ok) {
			old.select();
			return showError(form, "Ο τρέχων κωδικός είναι λάθος.");
		}
		$("passwordDialog").close();
		toast("Ο κωδικός άλλαξε");
	} catch (err) {
		showError(form, errorText(err));
	}
}

// ── Wiring ───────────────────────────────────────────────────────────

function showError(form, text) {
	const el = form.querySelector("[data-error]");
	el.textContent = text;
	el.hidden = !text;
}

function selectSection(key) {
	selected = key;
	$("phoneSearch").value = "";
	render();
	document.querySelector(`#sectionList [data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
	document.querySelector(".adm-table-wrap").scrollTop = 0;
}

function wire() {
	$("themeToggle").addEventListener("click", toggleTheme);
	$("passwordBtn").addEventListener("click", openPassword);
	$("logoutBtn").addEventListener("click", async () => {
		try {
			await logout();
		} finally {
			location.href = "index.html";
		}
	});

	$("newSectionBtn").addEventListener("click", () => openSection(null));
	$("editSectionBtn").addEventListener("click", () => openSection(selected));
	$("newPhoneBtn").addEventListener("click", () => openPhone(null));
	$("sectionFilter").addEventListener("input", renderSections);
	$("phoneSearch").addEventListener("input", () => {
		renderPhones();
		document.querySelector(".adm-table-wrap").scrollTop = 0;
	});

	const list = $("sectionList");
	list.addEventListener("click", e => {
		const li = e.target.closest("[data-key]");
		if (li) selectSection(li.dataset.key);
	});
	list.addEventListener("keydown", e => {
		const li = e.target.closest("[data-key]");
		if (li && (e.key === "Enter" || e.key === " ")) {
			e.preventDefault();
			selectSection(li.dataset.key);
			list.querySelector(`[data-key="${CSS.escape(li.dataset.key)}"]`)?.focus();
		}
	});

	const rows = $("phoneRows");
	rows.addEventListener("click", e => {
		const tr = e.target.closest("tr[data-id]");
		if (!tr) return;
		if (e.target.closest("[data-toggle]")) toggleRestricted(tr.dataset.id);
		else openPhone(tr.dataset.id);
	});
	rows.addEventListener("keydown", e => {
		if (e.key === "Enter" && e.target.matches("tr[data-id]")) openPhone(e.target.dataset.id);
	});

	$("sectionForm").addEventListener("submit", submitSection);
	$("phoneForm").addEventListener("submit", submitPhone);
	$("passwordForm").addEventListener("submit", submitPassword);
	$("sectionForm").querySelector("[data-delete]").addEventListener("click", deleteSection);
	$("phoneForm").querySelector("[data-delete]").addEventListener("click", deletePhone);
	for (const btn of document.querySelectorAll("[data-cancel]")) btn.addEventListener("click", () => btn.closest("dialog").close());

	// Pick up other people's saves when coming back to the window, so
	// conflicts are rare. Never while an editor is open.
	const refresh = async () => {
		if (busy || document.querySelector("dialog[open]")) return;
		try {
			const v = await catalogVersion();
			if (v !== version) {
				await reload();
				toast("Φορτώθηκε νεότερη έκδοση του καταλόγου");
			}
		} catch {}
	};
	window.addEventListener("focus", refresh);
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) refresh();
	});
}

async function start() {
	initializeTheme();
	let admin = false;
	try {
		admin = await isAdmin();
	} catch {}
	if (!admin) {
		location.replace("index.html");
		return;
	}
	wire();
	try {
		await reload();
	} catch (err) {
		document.body.hidden = false;
		await message("Ο κατάλογος δεν φορτώθηκε", errorText(err));
		return;
	}
	document.body.hidden = false;
}

start();
