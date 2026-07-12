// ── Theme management (shared between pages) ──────────────────────────

export const THEME_STORAGE_KEY = "callcenter-theme";

export function applyTheme(theme) {
	const isDark = theme === "dark";
	const themeToggle = document.getElementById("themeToggle");
	document.documentElement.classList.toggle("dark-mode", isDark);
	if (themeToggle) {
		themeToggle.textContent = isDark ? "☀️ Σκούρα εμφάνιση" : "🌙 Σκούρα εμφάνιση";
		themeToggle.setAttribute("aria-pressed", String(isDark));
	}
}

export function initializeTheme() {
	const saved = localStorage.getItem(THEME_STORAGE_KEY);
	const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
	applyTheme(saved || (prefersDark ? "dark" : "light"));
}

export function toggleTheme() {
	const next = document.documentElement.classList.contains("dark-mode") ? "light" : "dark";
	applyTheme(next);
	localStorage.setItem(THEME_STORAGE_KEY, next);
}
