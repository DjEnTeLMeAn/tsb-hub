const RELEASE = '0.10.1-full-refresh-20260807-0032';
const CACHE_NAME = `tsb-hub-${RELEASE}`;
const APP_SHELL = [
  `./index.html?v=${RELEASE}`,
  `./manifest.json?v=${RELEASE}`,
  `./css/style.css?v=${RELEASE}`,
  `./css/mobile-first-cleanup.css?v=${RELEASE}`,
  `./css/mobile-dashboard.css?v=${RELEASE}`,
  `./css/mobile-finance.css?v=${RELEASE}`,
  `./js/update-manager.js?v=${RELEASE}`,
  `./js/app.js?v=${RELEASE}`,
  `./js/mobile-first-cleanup.js?v=${RELEASE}`,
  `./js/mobile-dashboard.js?v=${RELEASE}`,
  `./js/finance-module-v1.js?v=${RELEASE}`,
  `./icons/icon-192.png?v=${RELEASE}`,
  `./icons/icon-512.png?v=${RELEASE}`
];

function absoluteUrl(path) {
  return new URL(path, self.registration.scope).href;
}

async function openCurrentCache() {
  return caches.open(CACHE_NAME);
}

async function fetchFresh(requestOrUrl) {
  const request = requestOrUrl instanceof Request
    ? new Request(requestOrUrl, { cache: 'reload' })
    : new Request(absoluteUrl(requestOrUrl), { cache: 'reload' });
  return fetch(request, { cache: 'reload' });
}

async function cacheFreshAsset(cache, path) {
  const request = new Request(absoluteUrl(path), { cache: 'reload' });
  const response = await fetchFresh(request);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  await cache.put(request, response.clone());
}

async function precacheFresh() {
  const cache = await openCurrentCache();
  await Promise.all(APP_SHELL.map(path => cacheFreshAsset(cache, path)));
}

async function clearOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
}

async function notifyClients(message) {
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clientsList.forEach(client => client.postMessage(message));
}

async function networkFirst(request, fallbackPath = '') {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response?.ok) {
      const cache = await openCurrentCache();
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const direct = await caches.match(request, { ignoreSearch: true });
    if (direct) return direct;
    if (fallbackPath) {
      const fallback = await caches.match(new Request(absoluteUrl(fallbackPath)), { ignoreSearch: true });
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(precacheFresh().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    clearOldCaches()
      .then(() => self.clients.claim())
      .then(() => notifyClients({ type: 'TSB_SW_ACTIVATED', release: RELEASE, cacheName: CACHE_NAME }))
  );
});

self.addEventListener('message', event => {
  const type = event.data?.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'TSB_FORCE_REFRESH') {
    event.waitUntil(
      precacheFresh()
        .then(() => clearOldCaches())
        .then(() => notifyClients({ type: 'TSB_SW_REFRESHED', release: RELEASE }))
    );
  }
  if (type === 'TSB_GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'TSB_SW_VERSION', release: RELEASE, cacheName: CACHE_NAME });
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, `./index.html?v=${RELEASE}`));
    return;
  }

  const isActiveAsset = /\.(?:js|css|json|html)$/i.test(url.pathname);
  if (isActiveAsset) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(request).then(async response => {
        if (response?.ok) {
          const cache = await openCurrentCache();
          await cache.put(request, response.clone());
        }
        return response;
      });
    })
  );
});
