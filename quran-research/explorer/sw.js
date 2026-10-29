// Offline / repeat-visit cache for the Quran explorer (served by ../server.py).
// Core files are stored on the first visit; images, fonts and pre-generated
// answers are stored as they are first used. After that the explorer opens from
// the phone and makes no server requests except the live chat (/api/).
// The memorization app (/hifz/) has its own worker and is left alone here.
// Bump VERSION whenever a precached file changes.
var VERSION = 'qx-v6';
var CORE = ['./', 'index.html', 'data.json', 'text.json',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'].concat(
  ['shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js',
   'postprocessing/ShaderPass.js', 'postprocessing/UnrealBloomPass.js'].map(function (f) { return 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/' + f; }));

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('qx-') === 0 && k !== VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function fromCacheThenNetwork(req) {
  return caches.open(VERSION).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (r) {
        if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
        return r;
      });
      return hit || net;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (/^\/(api|hifz|hifz-api)(\/|$)/.test(url.pathname)) return; // live chat + memorization app
    if (url.pathname === '/' || /\.html$/.test(url.pathname)) {
      // the page: fresh when online (new versions), cached when offline
      e.respondWith(fetch(req).then(function (r) {
        var copy = r.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); return r;
      }).catch(function () { return caches.match(req).then(function (h) { return h || caches.match('index.html'); }); }));
      return;
    }
    e.respondWith(fromCacheThenNetwork(req));
    return;
  }
  if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) e.respondWith(fromCacheThenNetwork(req));
});
