// Tebes School Management System — Service Worker
// Caches the app shell so the app loads with no internet connection.
// Actual school data lives in Supabase + a localStorage cache/queue
// (handled in index.html), not in this cache.

const CACHE_NAME = 'tsms-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return; // never cache writes; those go straight to Supabase or the queue

  // App shell (HTML/manifest/icons): network-first so edits deployed to
  // Netlify show up when online, falling back to cache when offline.
  const url = new URL(req.url);
  const isShell = url.origin === self.location.origin;

  // Supabase REST/Auth/Realtime calls (student, staff, grades, fees data —
  // i.e. anything read via sb.from(...).select(...)) must never be cached by
  // the service worker. They're GET requests, so without this check they'd
  // fall into the cache-first branch below meant for fonts/CDN scripts, and
  // every reconnect would silently replay the FIRST-ever response instead of
  // fetching current data. index.html already has its own offline queue/cache
  // for this data — the service worker should stay out of the way entirely.
  if(url.hostname.endsWith('.supabase.co')){
    event.respondWith(fetch(req));
    return;
  }

  if(isShell){
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match('./index.html')))
    );
    return;
  }

  // Third-party assets (fonts, the Supabase JS library from the CDN):
  // cache-first so the app still loads offline once they've been fetched once.
  event.respondWith(
    caches.match(req).then((cached) => {
      if(cached) return cached;
      return fetch(req).then((res) => {
        if(res && res.status === 200){
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
