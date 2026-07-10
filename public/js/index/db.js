// ── IndexedDB cache for phone records ────────────────────────────────

const IDB_NAME = "callcenter-cache";
const IDB_VERSION = 1;

export function openIDB() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, IDB_VERSION);
		req.onupgradeneeded = e => {
			const db = e.target.result;
			if (!db.objectStoreNames.contains("records")) {
				db.createObjectStore("records", { keyPath: "id" });
			}
			if (!db.objectStoreNames.contains("meta")) {
				db.createObjectStore("meta");
			}
		};
		req.onsuccess = e => resolve(e.target.result);
		req.onerror = () => reject(req.error);
	});
}

export function idbGet(db, storeName, key) {
	return new Promise((resolve, reject) => {
		const req = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export function idbGetAll(db, storeName) {
	return new Promise((resolve, reject) => {
		const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export function idbPut(db, storeName, key, value) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readwrite");
		tx.objectStore(storeName).put(value, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/** Clears the store then writes all items in a single transaction. */
export function idbPutAll(db, storeName, items) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readwrite");
		const store = tx.objectStore(storeName);
		store.clear();
		for (const item of items) store.put(item);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}
