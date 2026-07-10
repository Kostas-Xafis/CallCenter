// ── Signup form handler ──────────────────────────────────────────────

import "../shared/dev-logger.js";
import { registerServiceWorker } from "../shared/sw.js";
import { initializeTheme } from "../shared/theme.js";

// ── DOM elements ─────────────────────────────────────────────────────

const form = document.getElementById("signupForm");
const btn = document.getElementById("submitBtn");
const err = document.getElementById("errorMsg");
const loadingState = document.getElementById("loadingState");
const invalidState = document.getElementById("invalidState");
const invalidMsg = document.getElementById("invalidMsg");
const successState = document.getElementById("successState");
const successMsg = document.getElementById("successMsg");
const usernameInput = document.getElementById("username");

// ── Get invitation ID from query string ──────────────────────────────

const params = new URLSearchParams(window.location.search);
const inviteId = params.get("id");

function showError(message) {
	err.textContent = message;
	err.classList.add("visible");
}

function hideError() {
	err.classList.remove("visible");
}

// ── Validate invitation on page load ─────────────────────────────────

async function validateInvitation() {
	if (!inviteId) {
		loadingState.classList.add("hidden");
		invalidMsg.textContent = "Λείπει ο κωδικός πρόσκλησης. Χρησιμοποιήστε τον σύνδεσμο που σας δόθηκε.";
		invalidState.classList.remove("hidden");
		return null;
	}

	try {
		const res = await fetch(`/api/signup/validate?id=${encodeURIComponent(inviteId)}`);

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			loadingState.classList.add("hidden");
			invalidMsg.textContent = data.error || "Η πρόσκληση δεν είναι έγκυρη ή έχει λήξει.";
			invalidState.classList.remove("hidden");
			return null;
		}

		const data = await res.json();
		return data; // { username }
	} catch {
		loadingState.classList.add("hidden");
		invalidMsg.textContent = "Αδυναμία σύνδεσης με τον διακομιστή.";
		invalidState.classList.remove("hidden");
		return null;
	}
}

// ── Submit signup form ───────────────────────────────────────────────

form.addEventListener("submit", async e => {
	e.preventDefault();
	hideError();

	const password = document.getElementById("password").value;
	const confirmPassword = document.getElementById("confirmPassword").value;

	if (password.length < 6) {
		showError("Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.");
		return;
	}

	if (password !== confirmPassword) {
		showError("Οι κωδικοί δεν ταιριάζουν.");
		return;
	}

	btn.disabled = true;
	btn.textContent = "…";

	try {
		const res = await fetch("/auth/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				inviteId,
				password
			})
		});

		if (res.ok) {
			form.classList.add("hidden");
			successMsg.textContent = "Η εγγραφή ολοκληρώθηκε με επιτυχία! Μπορείτε τώρα να συνδεθείτε.";
			successState.classList.remove("hidden");
		} else {
			const data = await res.json().catch(() => ({}));
			showError(data.error || "Σφάλμα κατά την εγγραφή.");
			btn.disabled = false;
			btn.textContent = "Ολοκλήρωση εγγραφής";
		}
	} catch {
		showError("Αδυναμία σύνδεσης με τον διακομιστή.");
		btn.disabled = false;
		btn.textContent = "Ολοκλήρωση εγγραφής";
	}
});

// ── Init ──────────────────────────────────────────────────────────────

async function init() {
	const invitation = await validateInvitation();
	if (invitation) {
		usernameInput.value = invitation.username;
		loadingState.classList.add("hidden");
		form.classList.remove("hidden");
	}
}

initializeTheme();
registerServiceWorker();
init();
