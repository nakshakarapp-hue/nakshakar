// Generated at build time from scripts/sw-template.js. Keeps the website working with no internet.
const CACHE = 'nakshakar-__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => (n.startsWith('nakshakar-') || n.startsWith('gharnirman-')) && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (request.mode === 'navigate') return caches.match('./index.html').then((page) => page ?? fetch(request));
      return fetch(request);
    }),
  );
});
