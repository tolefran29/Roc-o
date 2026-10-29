// Service worker de Rocío: la app funciona sin conexión; el tiempo se pide a la red cuando hay.
const CACHE = "rocio-__BUILD__";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png", __FONTS__];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // APIs externas: siempre red
  if (e.request.mode === "navigate") { e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put("./index.html", c)); return r; }).catch(() => caches.match("./index.html"))); return; }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return res; })));
});
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: "window" }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow("./"))); });
