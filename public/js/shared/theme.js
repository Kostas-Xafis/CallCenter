// ── Theme management (shared between pages) ──────────────────────────

export const THEME_STORAGE_KEY = "callcenter-theme";

export function applyTheme(theme) {
	const isDark = theme === "dark";
	const themeToggle = document.getElementById("themeToggle");
	const moonIcon = document.querySelector(".theme-icon-moon");
	const sunIcon = document.querySelector(".theme-icon-sun");
	document.documentElement.classList.toggle("dark-mode", isDark);
	if (themeToggle) {
		themeToggle.setAttribute("aria-pressed", String(isDark));
	}
	if (moonIcon) moonIcon.style.display = isDark ? "none" : "";
	if (sunIcon) sunIcon.style.display = isDark ? "" : "none";
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
