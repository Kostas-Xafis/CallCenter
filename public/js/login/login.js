// ── Login form handler ───────────────────────────────────────────────

import "../shared/dev-logger.js";
import { registerServiceWorker } from "../shared/sw.js";
import { initializeTheme } from "../shared/theme.js";

const form = document.getElementById("loginForm");
const btn = document.getElementById("submitBtn");
const err = document.getElementById("errorMsg");

form.addEventListener("submit", async e => {
	e.preventDefault();
	err.classList.remove("visible");
	btn.disabled = true;
	btn.textContent = "…";

	try {
		const res = await fetch("/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: document.getElementById("username").value,
				password: document.getElementById("password").value
			})
		});

		if (res.ok) {
			window.location.replace("/");
		} else {
			const data = await res.json().catch(() => ({}));
			err.textContent = data.error || "Σφάλμα σύνδεσης.";
			err.classList.add("visible");
			btn.disabled = false;
			btn.textContent = "Σύνδεση";
		}
	} catch {
		err.textContent = "Αδυναμία σύνδεσης με τον διακομιστή.";
		err.classList.add("visible");
		btn.disabled = false;
		btn.textContent = "Σύνδεση";
	}
});

initializeTheme();
registerServiceWorker();
