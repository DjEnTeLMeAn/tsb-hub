const CACHE_NAME = 'tsb-hub-v0-8-31-finance-clean-ui';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css?v=0.8.21-dev',
  './css/mobile-first-cleanup.css?v=0.8.22-mobile-cleanup',
  './css/mobile-dashboard.css?v=0.8.25-today-core',
  './css/mobile-finance.css?v=0.8.31-finance-clean-ui',
  './js/app.js?v=0.8.21-dev',
  './js/mobile-first-cleanup.js?v=0.8.22-mobile-cleanup',
  './js/mobile-dashboard.js?v=0.8.24-lean',
  './js/mobile-finance.js?v=0.8.31-finance-clean-ui',
  './manifest.json?v=0.8.21-dev',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)); return response; }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); return response; })));
});
