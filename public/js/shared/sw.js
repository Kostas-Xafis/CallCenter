// ── Service Worker registration (shared between pages) ──────────────

export function registerServiceWorker() {
	// Skip SW registration during local development so that cached assets
	// don't prevent live updates. The server also sends `no-cache` headers
	// in dev mode, but skipping the SW entirely is the safest approach.
	const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "[::1]";
	if (isLocalhost) {
		console.log("[dev] Service Worker skipped — running on localhost");
		return;
	}

	if ("serviceWorker" in navigator) {
		window.addEventListener("load", () => {
			navigator.serviceWorker.register("/sw.js");
		});
	}
}
