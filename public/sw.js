// Afro Mart service worker: an installable, offline-friendly app shell.
const CACHE = 'afro-mart-v16';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/i18n.js',
  '/manifest.webmanifest',
  '/app-icon.svg',
  '/logo.png',
  '/products/produce.jpg',
  '/products/african-drinks.jpg',
  '/products/staples.jpg',
  '/products/coca-cola.jpg',
  '/products/pepsi.jpg',
  '/products/spices.jpg',
  '/products/wine.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve API responses from cache; always go to the network.
  if (url.pathname.startsWith('/api/')) return;

  // The page and its shell assets always come from the network when online so a
  // fresh index.html can never be paired with a stale cached script after a
  // deploy. The cache stays as the offline fallback.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        // Only the site root is the cached shell; a product page navigation must not
        // overwrite it, or offline visitors would get a product page for '/'.
        const url = new URL(request.url);
        const key = request.mode === 'navigate' && url.pathname === '/' ? '/index.html' : request;
        caches.open(CACHE).then((cache) => cache.put(key, copy));
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = (await caches.match('/index.html')) || (await caches.match('/'));
        if (shell) return shell;
      }
      throw new Error('offline');
    }
  })());
});
