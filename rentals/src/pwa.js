// ============================================================================
// pwa.js — Progressive Web App manifest + service worker
// ============================================================================
// Installable, mobile-first. The service worker caches the app shell
// (HTML, manifest, icons) cache-first so the app opens offline; API calls
// are always network-only (fresh prices/availability), and navigations fall
// back to the cached shell when offline.
// ============================================================================

export const MANIFEST = {
  name: "Naptivity — RV, Camper & Boat Rentals",
  short_name: "Naptivity",
  description: "Rent RVs, camper vans, bus conversions, boats and yachts from local hosts — stationary stays or road trips, priced transparently.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#0d2233",
  theme_color: "#0d2233",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export const SERVICE_WORKER = `
// Naptivity service worker — app-shell cache, network-only API.
var CACHE = "naptivity-shell-v1";
var SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (url.pathname.indexOf("/api/") === 0 || url.pathname.indexOf("/photos/") === 0) return; // network only
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then(function (r) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put("/", copy); });
      return r;
    }).catch(function () { return caches.match("/"); }));
    return;
  }
  e.respondWith(caches.match(e.request).then(function (hit) { return hit || fetch(e.request); }));
});
`;
