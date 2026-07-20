// Service Worker for MyBidBook PWA
const CACHE_NAME = 'mybidbook-cache-v96';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css?v=3.0.35',
  './css/print.css?v=3.0.35',
  './js/app.js?v=3.0.35',
  './js/utils.js?v=3.0.35',
  './js/db.js?v=3.0.35',
  './js/catalog.js?v=3.0.35',
  './js/customers.js?v=3.0.35',
  './js/quote-builder.js?v=3.0.35',
  './js/quotes-list.js?v=3.0.35',
  './icon-192.png?v=3.0.35',
  './icon-512.png?v=3.0.35',
  './apple-touch-icon.png?v=3.0.35',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell assets');
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests within our scope (local origin)
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache the response dynamically
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If not in cache, let it fail naturally
        });
      })
  );
});
