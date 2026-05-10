/* RaceNext Results — service worker.
 *
 * The service worker exists for two reasons:
 *   1. PWA "installable" status (Chrome's WebAPK builder requires a
 *      registered SW that handles fetch events AND can serve the
 *      start_url offline).
 *   2. The site keeps loading when the network is flaky — the static
 *      shell is cached, while race data continues to be fetched live.
 *
 * Important: API requests (the local /api/ proxy and any cross-origin
 * upstream) are NEVER intercepted, so the user always sees fresh data.
 */

const CACHE = "racenext-results-v1";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./style.css",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  // Use Promise.allSettled so one missing asset cannot abort the entire
  // install — partial caching is better than no SW at all.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(
        SHELL.map((url) =>
          cache
            .add(url)
            .catch((err) => console.warn("SW install: skipped", url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Cross-origin requests (RaceNext API direct, public CORS proxies) flow
  // straight to the network — we never want to cache live data.
  if (url.origin !== self.location.origin) return;
  // Same-origin /api/ proxy used by local server.py — also live data.
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests (HTML shell). Critical: must always resolve to a
  // valid Response when offline, otherwise Chrome refuses to mint a WebAPK.
  // Strategy: try network, fall back to the cached navigation, then to
  // index.html, then to the directory root — guaranteed to hit the shell.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((r) => r || caches.match("./index.html"))
            .then((r) => r || caches.match("./"))
        )
    );
    return;
  }

  // Static assets: network-first with cache fallback. Updates land
  // immediately while online; the page still loads when offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
