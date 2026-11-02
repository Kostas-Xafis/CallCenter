// ── Backend access ───────────────────────────────────────────────────
//
// The only module that talks to the Tauri backend (see docs/CONTRACT.md).
// Outside Tauri (a plain browser, for development) it falls back to a mock
// that loads `dev-catalog.json` next to the pages and keeps edits in
// localStorage. The mock admin password is "admin".

const tauri = globalThis.__TAURI__?.core;

export const isTauri = Boolean(tauri);

/** Error thrown by saveCatalog when someone else saved in the meantime. */
export const CONFLICT = "conflict";

const MOCK_KEY = "callcenter-mock-catalog";
const MOCK_ADMIN = "callcenter-mock-admin";

const mock = {
	async load_catalog() {
		let catalog = null;
		try {
			catalog = JSON.parse(localStorage.getItem(MOCK_KEY) || "null");
		} catch {}
		if (!catalog) {
			const res = await fetch("dev-catalog.json");
			catalog = res.ok ? await res.json() : { schema: 3, updatedAt: null, title: null, info: [], sections: [], phones: [] };
		}
		return { catalog, version: catalog.updatedAt };
	},
	async catalog_version() {
		return (await mock.load_catalog()).version;
	},
	async save_catalog({ catalog, baseVersion }) {
		if (sessionStorage.getItem(MOCK_ADMIN) !== "1") throw "not-admin";
		const { version } = await mock.load_catalog();
		if (version !== baseVersion) throw CONFLICT;
		const saved = { ...catalog, updatedAt: new Date().toISOString() };
		localStorage.setItem(MOCK_KEY, JSON.stringify(saved));
		return saved.updatedAt;
	},
	async has_password() {
		return true;
	},
	async set_password() {
		sessionStorage.setItem(MOCK_ADMIN, "1");
	},
	async login({ password }) {
		const ok = password === "admin";
		if (ok) sessionStorage.setItem(MOCK_ADMIN, "1");
		return ok;
	},
	async logout() {
		sessionStorage.removeItem(MOCK_ADMIN);
	},
	async is_admin() {
		return sessionStorage.getItem(MOCK_ADMIN) === "1";
	},
	async change_password({ oldPassword }) {
		return oldPassword === "admin";
	}
};

const call = (cmd, args) => (tauri ? tauri.invoke(cmd, args) : mock[cmd](args ?? {}));

/** @returns {Promise<{ catalog: object, version: string|null }>} */
export const loadCatalog = () => call("load_catalog");
/** @returns {Promise<string|null>} */
export const catalogVersion = () => call("catalog_version");
/** Saves the whole catalog. Rejects with CONFLICT if it changed since `baseVersion`. @returns {Promise<string>} new version */
export const saveCatalog = (catalog, baseVersion) => call("save_catalog", { catalog, baseVersion });
export const hasPassword = () => call("has_password");
export const setPassword = password => call("set_password", { password });
export const login = password => call("login", { password });
export const logout = () => call("logout");
export const isAdmin = () => call("is_admin");
export const changePassword = (oldPassword, newPassword) => call("change_password", { oldPassword, newPassword });
