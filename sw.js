// Service Worker for MyBidBook PWA
const CACHE_NAME = 'mybidbook-cache-v91';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css?v=91',
  './css/print.css?v=91',
  './js/app.js?v=91',
  './js/utils.js?v=91',
  './js/db.js?v=91',
  './js/catalog.js?v=91',
  './js/customers.js?v=91',
  './js/quote-builder.js?v=91',
  './js/quotes-list.js?v=91',
  './icon-192.png?v=91',
  './icon-512.png?v=91',
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
