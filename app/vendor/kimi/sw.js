/**
 * sw.js — Service worker for offline PWA support.
 * Caches the app shell, assets, and data files.
 * The ASR model is cached automatically by the browser (transformers.js cache).
 */

const CACHE_NAME = 'qmt-shell-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './matcher.js',
  './quran-data.js',
  './manifest.json',
  './i18n/ar.json',
  './i18n/en.json',
  './i18n/ur.json',
  './i18n/id.json',
  './i18n/tr.json',
  './i18n/fr.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        // If offline and not cached, return a simple offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
