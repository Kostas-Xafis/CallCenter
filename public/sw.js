const CACHE_NAME = "callcenter-v1783980295057";
const STATIC_ASSETS = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

// Install: pre-cache static shell
self.addEventListener("install", event => {
	event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
	self.skipWaiting();
});

// Activate: drop old caches
self.addEventListener("activate", event => {
	event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
	self.clients.claim();
});

// Fetch strategy:
//  - API/auth requests → always network (no cache)
//  - Page navigations  → network-first with redirect:'manual' so that server-side
//                        auth redirects (e.g. / → /login) are returned as opaque
//                        redirects and followed natively by the browser, keeping
//                        the URL correct in the PWA window; fall back to cache only
//                        when offline
//  - Static assets     → cache-first for performance
self.addEventListener("fetch", event => {
	const url = new URL(event.request.url);

	// API and auth endpoints: always go to the network, never cache
	if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
		event.respondWith(fetch(event.request));
		return;
	}

	// HTML navigations: network-first with manual redirect handling.
	// redirect:'manual' means a 302 from the server comes back as an opaqueredirect
	// response (type === 'opaqueredirect'). Returning that to respondWith() tells the
	// browser to perform the redirect natively, so the PWA navigates to /login with
	// the correct URL instead of silently serving login HTML at the / URL.
	if (event.request.mode === "navigate") {
		event.respondWith(
			fetch(event.request, { redirect: "manual" })
				.then(response => {
					// Pass server-side redirects (auth guard → /login) straight through
					// to the browser so it handles them as real navigations.
					if (response.type === "opaqueredirect") {
						return response;
					}
					if (response.ok) {
						const clone = response.clone();
						caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
					}
					return response;
				})
				.catch(() => caches.match(event.request))
		);
		return;
	}

	// Static assets: cache-first
	event.respondWith(
		caches.match(event.request).then(cached => {
			if (cached) return cached;
			return fetch(event.request).then(response => {
				if (response.ok) {
					const clone = response.clone();
					caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
				}
				return response;
			});
		})
	);
});
