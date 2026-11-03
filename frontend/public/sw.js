// Minimal service worker: makes the site installable. It deliberately caches nothing, so signed-in data is never served stale.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
