// Network-first: alltid färskt när nätet finns, cache som reserv offline.
// Höj CACHE_VERSION om cachens form ändras. Rör bara samma origin; Drive, proxy och
// Google går alltid direkt mot nätet.
var CACHE_VERSION = "sg-v1";
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE_VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.match(req).then(function (hit) { return hit || caches.match("./"); }); })
  );
});
