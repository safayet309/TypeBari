// TypeBari — সার্ভিস ওয়ার্কার (সহজ সংস্করণ)
const CACHE = "typebari-v1";

self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// আগে নেট থেকে আনে, না পেলে সেভ করা কপি দেখায়।
// Supabase, YouTube, CDN-এর অনুরোধে হাত দেয় না।
self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () { return caches.match(req); })
  );
});
