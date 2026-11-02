// ── Start screen ─────────────────────────────────────────────────────

import { hasPassword, login, setPassword } from "./api.js";
import { initializeTheme, toggleTheme } from "./theme.js";

const $ = id => document.getElementById(id);
const MIN_LENGTH = 4;

let firstRun = false;

function showError(message) {
	$("loginError").textContent = message;
	$("loginError").hidden = !message;
}

function showForm(show) {
	$("loginForm").hidden = !show;
	$("startActions").hidden = show;
}

async function openAdmin() {
	showError("");
	$("password").value = "";
	$("password2").value = "";
	try {
		firstRun = !(await hasPassword());
	} catch (err) {
		firstRun = false;
	}
	$("loginTitle").textContent = firstRun ? "Ορίστε κωδικό διαχείρισης" : "Κωδικός διαχείρισης";
	$("password").placeholder = firstRun ? "Νέος κωδικός" : "Κωδικός";
	$("password").autocomplete = firstRun ? "new-password" : "current-password";
	$("password2").hidden = !firstRun;
	$("loginSubmit").textContent = firstRun ? "Ορισμός κωδικού" : "Είσοδος";
	showForm(true);
	$("password").focus();
}

async function submit(e) {
	e.preventDefault();
	const password = $("password").value;
	showError("");
	if (!password) {
		showError("Πληκτρολογήστε τον κωδικό.");
		$("password").focus();
		return;
	}
	const button = $("loginSubmit");
	button.disabled = true;
	try {
		if (firstRun) {
			if (password.length < MIN_LENGTH) {
				showError(`Ο κωδικός πρέπει να έχει τουλάχιστον ${MIN_LENGTH} χαρακτήρες.`);
				$("password").focus();
				return;
			}
			if (password !== $("password2").value) {
				showError("Οι δύο κωδικοί δεν ταιριάζουν. Προσπαθήστε ξανά.");
				$("password2").value = "";
				$("password2").focus();
				return;
			}
			await setPassword(password);
			location.href = "admin.html";
		} else if (await login(password)) {
			location.href = "admin.html";
		} else {
			showError("Λάθος κωδικός. Προσπαθήστε ξανά.");
			$("password").select();
		}
	} catch (err) {
		showError(typeof err === "string" ? err : "Κάτι πήγε στραβά. Προσπαθήστε ξανά.");
	} finally {
		button.disabled = false;
	}
}

initializeTheme();
$("themeToggle").addEventListener("click", toggleTheme);
$("adminBtn").addEventListener("click", openAdmin);
$("loginForm").addEventListener("submit", submit);
$("loginCancel").addEventListener("click", () => showForm(false));
$("loginForm").addEventListener("keydown", e => {
	if (e.key === "Escape") showForm(false);
});
