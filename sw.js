// Money Tracker service worker — lets the app open without signal.
// The page itself is fetched fresh when online (so updates show up right away)
// and served from the cache when offline. Calls to Apps Script are never cached.
var CACHE = 'money-tracker-v7';
var SHELL = ['./', './index.html', './manifest.json', './css/app.css',
  './js/core.js', './js/dashboard.js', './js/transactions.js', './js/accounts.js',
  './js/holdings.js', './js/settings.js', './js/projects.js', './js/reports.js', './js/portfolio.js', './js/suggest.js',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) {
    return Promise.all(SHELL.map(function(u) { return c.add(u).catch(function(){}); }));
  }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;                                  // API calls are POST
  var url = new URL(req.url);
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;

  if (req.mode === 'navigate' || url.origin === location.origin) {
    // network first, cache fallback
    e.respondWith(fetch(req).then(function(res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }
      return res;
    }).catch(function() {
      return caches.match(req).then(function(hit) { return hit || caches.match('./index.html'); });
    }));
    return;
  }
  // other static files (SheetJS, icons): cache first
  e.respondWith(caches.match(req).then(function(hit) {
    return hit || fetch(req).then(function(res) {
      if (res && (res.ok || res.type === 'opaque')) { var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }
      return res;
    });
  }));
});
