// Service worker — versioned cache with activation cleanup (audit M7 fix:
// a deployed update must actually reach installed users, and old caches
// must be purged, not accumulate forever).
//
// Bump CACHE_VERSION on every deploy that changes any precached file.
var CACHE_VERSION = 'tasme3-v18';
var SHELL_CACHE = CACHE_VERSION + '-shell';
var RUNTIME_CACHE = CACHE_VERSION + '-runtime';
var RUNTIME_CAP = 50; // ~50-entry LRU-ish cap on runtime-cached page images/i18n/fonts

var SHELL_URLS = [
  './',
  'index.html',
  'style.css',
  'fonts.css',
  'config.js',
  'utils.js',
  'storage.js',
  'i18n.js',
  'account.js',
  'share.js',
  'certificate.js',
  'listen.js',
  'recorder.js',
  'app.js',
  'manifest.webmanifest',
  'surah-index.json',
  'basmala.json',
  'vendor/matcher.js',
  'i18n/ar.json', 'i18n/en.json', 'i18n/ur.json', 'i18n/fa.json',
  'i18n/tr.json', 'i18n/fr.json', 'i18n/es.json', 'i18n/id.json',
  'i18n/ms.json', 'i18n/ru.json', 'i18n/bn.json', 'i18n/sw.json',
  'i18n/ha.json', 'i18n/ps.json', 'i18n/so.json', 'i18n/uz.json',
  'i18n/az.json', 'i18n/bs.json', 'i18n/sq.json', 'i18n/de.json',
  'i18n/nl.json', 'i18n/pt.json', 'i18n/ta.json', 'i18n/ml.json',
  'i18n/zh.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(SHELL_URLS).catch(function () {
        // Best-effort precache: a single missing/blocked asset (e.g. run
        // from a subpath in local dev) must not fail installation outright.
        return Promise.all(SHELL_URLS.map(function (u) {
          return cache.add(u).catch(function () {});
        }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (n) { return n.indexOf('tasme3-') === 0 && n.indexOf(CACHE_VERSION) !== 0; })
          .map(function (n) { return caches.delete(n); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

function trimRuntimeCache(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= RUNTIME_CAP) return;
    var excess = keys.length - RUNTIME_CAP;
    var toDelete = keys.slice(0, excess); // insertion-order approximation of LRU
    return Promise.all(toDelete.map(function (req) { return cache.delete(req); }));
  });
}

function isRuntimeCacheable(url) {
  return /\/pages\/page-\d{3}\.(webp|json)$/.test(url.pathname) ||
    /\/i18n\/[a-z]{2}\.json$/.test(url.pathname) ||
    /\/fonts\.css$/.test(url.pathname) ||
    /\/icons\//.test(url.pathname);
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return; // never intercept POST/PUT (the /evaluate, /account, /progress API)

  var url = new URL(request.url);

  // Cross-origin: reference audio (everyayah.com) and any configured
  // SERVER_URL API host. Network-only — never cached (audio caching is
  // explicitly out of scope for the MVP listen feature; API responses are
  // always live data).
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request).catch(function () { return new Response('', { status: 503 }); }));
    return;
  }

  if (isRuntimeCacheable(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          if (cached) return cached;
          return fetch(request).then(function (resp) {
            if (resp && resp.ok) {
              cache.put(request, resp.clone());
              trimRuntimeCache(cache);
            }
            return resp;
          }).catch(function () { return cached; });
        });
      })
    );
    return;
  }

  // Shell files: cache-first, falling back to network (and refreshing the
  // shell cache entry so the NEXT activate cycle picks up a same-version
  // change without a full re-deploy).
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (resp) {
        if (resp && resp.ok) {
          caches.open(SHELL_CACHE).then(function (cache) { cache.put(request, resp.clone()); });
        }
        return resp;
      }).catch(function () { return cached; });
    })
  );
});
