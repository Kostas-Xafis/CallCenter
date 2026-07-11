// ── Admin panel JavaScript ───────────────────────────────────────────

// ---- Theme ----------------------------------------------------------
const THEME_KEY = "callcenter-theme";

function applyTheme(theme) {
	const isDark = theme === "dark";
	const toggle = document.getElementById("themeToggle");
	document.documentElement.classList.toggle("dark-mode", isDark);
	if (toggle) {
		toggle.textContent = isDark ? "☀️" : "🌙";
		toggle.setAttribute("aria-pressed", String(isDark));
	}
}

function initTheme() {
	const saved = localStorage.getItem(THEME_KEY);
	const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
	applyTheme(saved || (prefersDark ? "dark" : "light"));
}
window.toggleTheme = function () {
	const next = document.documentElement.classList.contains("dark-mode") ? "light" : "dark";
	applyTheme(next);
	localStorage.setItem(THEME_KEY, next);
};

window.logout = async function () {
	await fetch("/auth/logout", { method: "POST" });
	window.location.href = "/login";
};

initTheme();

// ---- Tab switching --------------------------------------------------
const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabBtns.forEach(btn => {
	btn.addEventListener("click", () => {
		const target = btn.getAttribute("data-tab");

		tabBtns.forEach(b => {
			b.classList.remove("active");
			b.setAttribute("aria-selected", "false");
		});
		tabPanels.forEach(p => p.classList.remove("active"));

		btn.classList.add("active");
		btn.setAttribute("aria-selected", "true");
		const panel = document.getElementById(`panel-${target}`);
		if (panel) panel.classList.add("active");
	});
});

// =====================================================================
// TAB 1 — User Creation
// =====================================================================

const createUserForm = document.getElementById("createUserForm");
const createUserBtn = document.getElementById("createUserBtn");
const signupResult = document.getElementById("signupResult");
const signupUrlEl = document.getElementById("signupUrl");
const copyUrlBtn = document.getElementById("copyUrlBtn");
const createUserStatus = document.getElementById("createUserStatus");

/**
 * Format a Unix timestamp (seconds) into a human-readable Greek date string.
 */
function formatExpiryDate(unixSeconds) {
	const date = new Date(unixSeconds * 1000);
	return date.toLocaleDateString("el-GR", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit"
	});
}

/**
 * API call: POST /api/admin/create-user
 * Creates a signup invitation for a new user.
 */
async function createUserApi(username, role) {
	const response = await fetch("/api/admin/create-user", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, role })
	});

	const data = await response.json();

	if (!response.ok) {
		throw new Error(data.error || "Σφάλμα δημιουργίας χρήστη");
	}

	return data; // { signupUrl, hexCode, expiresAt }
}

function showStatus(element, message, type) {
	element.textContent = message;
	element.className = `status-msg ${type}`;
	element.classList.remove("hidden");
}

function hideStatus(element) {
	element.classList.add("hidden");
}

createUserForm.addEventListener("submit", async e => {
	e.preventDefault();

	const username = document.getElementById("newUsername").value.trim();
	const role = document.getElementById("newUserRole").value;

	if (!username || !role) {
		showStatus(createUserStatus, "Παρακαλώ συμπληρώστε όλα τα πεδία.", "error");
		return;
	}

	// Basic validation
	if (username.length < 2) {
		showStatus(createUserStatus, "Το όνομα χρήστη πρέπει να έχει τουλάχιστον 2 χαρακτήρες.", "error");
		return;
	}

	hideStatus(createUserStatus);
	signupResult.classList.add("hidden");
	createUserBtn.disabled = true;
	createUserBtn.textContent = "Δημιουργία...";

	try {
		const { signupUrl, expiresAt } = await createUserApi(username, role);

		const fullUrl = `${window.location.origin}${signupUrl}`;
		signupUrlEl.textContent = fullUrl;
		document.getElementById("signupExpiry").textContent = `Ισχύει έως: ${formatExpiryDate(expiresAt)}`;
		signupResult.classList.remove("hidden");
		showStatus(createUserStatus, "Ο χρήστης δημιουργήθηκε επιτυχώς!", "success");
	} catch (err) {
		showStatus(createUserStatus, err.message || "Παρουσιάστηκε σφάλμα κατά τη δημιουργία.", "error");
	} finally {
		createUserBtn.disabled = false;
		createUserBtn.textContent = "Δημιουργία Χρήστη";
	}
});

// Copy signup URL to clipboard
copyUrlBtn.addEventListener("click", async () => {
	const url = signupUrlEl.textContent;
	try {
		await navigator.clipboard.writeText(url);
		copyUrlBtn.textContent = "Αντιγράφηκε! ✓";
		setTimeout(() => {
			copyUrlBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Αντιγραφή
            `;
		}, 2000);
	} catch {
		// Fallback: select the text
		const range = document.createRange();
		range.selectNodeContents(signupUrlEl);
		const sel = window.getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
	}
});

// =====================================================================
// TAB 2 — File Upload (Drag & Drop)
// =====================================================================

const uploadForm = document.getElementById("uploadForm");
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const dropZoneContent = document.getElementById("dropZoneContent");
const fileInfo = document.getElementById("fileInfo");
const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const removeFileBtn = document.getElementById("removeFileBtn");
const uploadBtn = document.getElementById("uploadBtn");
const uploadProgress = document.getElementById("uploadProgress");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const uploadStatus = document.getElementById("uploadStatus");

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
let selectedFile = null;

function formatFileSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function showFileInfo(file) {
	fileNameEl.textContent = file.name;
	fileSizeEl.textContent = formatFileSize(file.size);
	dropZoneContent.classList.add("hidden");
	fileInfo.classList.remove("hidden");
	uploadBtn.disabled = false;
}

function clearFileInfo() {
	selectedFile = null;
	fileInput.value = "";
	dropZoneContent.classList.remove("hidden");
	fileInfo.classList.add("hidden");
	uploadBtn.disabled = true;
	hideStatus(uploadStatus);
	uploadProgress.classList.add("hidden");
}

function validateFile(file) {
	if (!file) return "Δεν επιλέχθηκε αρχείο.";

	const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
	if (ext !== ".xlsx") {
		return "Επιτρέπονται μόνο αρχεία .xlsx (Excel).";
	}

	if (file.size > MAX_FILE_SIZE) {
		return `Το αρχείο υπερβαίνει το μέγιστο επιτρεπόμενο μέγεθος (${formatFileSize(MAX_FILE_SIZE)}).`;
	}

	if (file.size === 0) {
		return "Το αρχείο είναι κενό.";
	}

	return null;
}

function handleFileSelect(file) {
	const error = validateFile(file);
	if (error) {
		showStatus(uploadStatus, error, "error");
		clearFileInfo();
		return;
	}
	hideStatus(uploadStatus);
	selectedFile = file;
	showFileInfo(file);
}

// Click to open file picker
dropZone.addEventListener("click", () => {
	fileInput.click();
});

fileInput.addEventListener("change", () => {
	const file = fileInput.files[0];
	if (file) handleFileSelect(file);
});

// Drag & drop events
dropZone.addEventListener("dragover", e => {
	e.preventDefault();
	dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", e => {
	e.preventDefault();
	dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", e => {
	e.preventDefault();
	dropZone.classList.remove("drag-over");

	const file = e.dataTransfer.files[0];
	if (file) handleFileSelect(file);
});

// Remove selected file
removeFileBtn.addEventListener("click", e => {
	e.stopPropagation(); // don't trigger dropZone click
	clearFileInfo();
});

/**
 * API call: POST /api/admin/upload-data
 * Uploads an xlsx file and refreshes the entire database.
 * Uses XMLHttpRequest for upload progress tracking.
 */
async function uploadFileApi(file, onProgress) {
	const formData = new FormData();
	formData.append("file", file);

	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();

		xhr.upload.addEventListener("progress", e => {
			if (e.lengthComputable) {
				onProgress(Math.round((e.loaded / e.total) * 100));
			}
		});

		xhr.addEventListener("load", () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve(JSON.parse(xhr.responseText));
			} else {
				try {
					const err = JSON.parse(xhr.responseText);
					reject(new Error(err.error || "Σφάλμα μεταφόρτωσης"));
				} catch {
					reject(new Error(`HTTP ${xhr.status}: Σφάλμα μεταφόρτωσης`));
				}
			}
		});

		xhr.addEventListener("error", () => reject(new Error("Σφάλμα δικτύου κατά τη μεταφόρτωση.")));

		xhr.open("POST", "/api/admin/upload-data");
		xhr.send(formData);
	});
}

uploadForm.addEventListener("submit", async e => {
	e.preventDefault();

	if (!selectedFile) {
		showStatus(uploadStatus, "Παρακαλώ επιλέξτε ένα αρχείο .xlsx.", "error");
		return;
	}

	hideStatus(uploadStatus);
	uploadBtn.disabled = true;
	uploadBtn.textContent = "Μεταφόρτωση...";
	uploadProgress.classList.remove("hidden");
	progressFill.style.width = "0%";
	progressText.textContent = "Προετοιμασία...";

	try {
		const result = await uploadFileApi(selectedFile, pct => {
			progressFill.style.width = `${pct}%`;
			progressText.textContent = pct < 100 ? `Μεταφόρτωση: ${pct}%` : "Επεξεργασία δεδομένων...";
		});

		progressText.textContent = "Ολοκληρώθηκε!";
		showStatus(uploadStatus, `✅ ${result.message} (${result.recordsProcessed.toLocaleString("el")} εγγραφές)`, "success");

		// Clear the file after successful upload
		setTimeout(() => {
			clearFileInfo();
			uploadProgress.classList.add("hidden");
		}, 2000);
	} catch (err) {
		uploadProgress.classList.add("hidden");
		showStatus(uploadStatus, err.message || "Σφάλμα κατά τη μεταφόρτωση.", "error");
	} finally {
		uploadBtn.disabled = false;
		uploadBtn.textContent = "Αποστολή και Ενημέρωση Βάσης";
	}
});
