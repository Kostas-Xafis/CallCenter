// ── Dev-mode request logger (client-side) ────────────────────────────
// Patches window.fetch to log API calls when dev mode is enabled.
//
// Enable by:
//   1. Setting localStorage.devMode = 'true'    →  localStorage.setItem('devMode', 'true')
//   2. Adding ?dev to the URL                    →  /index.html?dev
//
// Disable by:
//   1. localStorage.removeItem('devMode')
//   2. Removing ?dev from the URL

const DEV_MODE = localStorage.getItem("devMode") === "true" || new URLSearchParams(window.location.search).has("dev");

if (DEV_MODE) {
	const _fetch = window.fetch;

	window.fetch = function (input, init) {
		const url = typeof input === "string" ? input : input instanceof Request ? input.url : input;
		const method = (init && init.method) || (input instanceof Request && input.method) || "GET";
		const start = performance.now();

		return _fetch
			.call(window, input, init)
			.then(response => {
				const duration = (performance.now() - start).toFixed(1);
				const emoji = response.ok ? "✅" : response.status < 500 ? "⚠️" : "❌";
				console.log(
					`%c[fetch]%c ${emoji} ${method} ${response.status} ${duration}ms  ${url}`,
					"font-weight:bold;color:#7c3aed",
					"font-weight:normal"
				);
				return response;
			})
			.catch(error => {
				const duration = (performance.now() - start).toFixed(1);
				console.log(
					`%c[fetch]%c ❌ ${method} ERR  ${duration}ms  ${url}`,
					"font-weight:bold;color:#7c3aed",
					"font-weight:normal",
					error
				);
				throw error;
			});
	};

	console.log(
		"%c🐛 Dev logger active%c — all fetch() calls will be logged. %cRemove ?dev or clear localStorage.devMode to disable.",
		"font-weight:bold;color:#059669",
		"font-weight:normal",
		"color:#6b7280"
	);
}
