// ── Theme management ─────────────────────────────────────────────────
//
// The page is opened straight from disk (file://), where storage can be
// unavailable; every storage access is guarded.

export const THEME_STORAGE_KEY = "callcenter-theme";

function readStoredTheme() {
	try {
		return localStorage.getItem(THEME_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function applyTheme(theme) {
	const isDark = theme === "dark";
	document.documentElement.classList.toggle("dark-mode", isDark);
	const toggle = document.getElementById("themeToggle");
	if (toggle) {
		toggle.setAttribute("aria-pressed", String(isDark));
		toggle.title = isDark ? "Φωτεινή εμφάνιση" : "Σκούρα εμφάνιση";
	}
}

export function initializeTheme() {
	const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
	applyTheme(readStoredTheme() || (prefersDark ? "dark" : "light"));
}

export function toggleTheme() {
	const next = document.documentElement.classList.contains("dark-mode") ? "light" : "dark";
	applyTheme(next);
	try {
		localStorage.setItem(THEME_STORAGE_KEY, next);
	} catch {
		/* storage unavailable — theme still applies for this session */
	}
}
