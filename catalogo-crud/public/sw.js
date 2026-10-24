// Bump this version when changing the offline page or one of its dependencies.
// Keep the namespace so activation removes older shells after the rebrand.
const CACHE_PREFIX = 'vidamix-offline-';
const CACHE_NAME = `${CACHE_PREFIX}v17`;
// Separate from the offline shell: image downloads survive app updates.
const IMAGE_CACHE = 'vidamix-images-v1';
const MAX_IMAGES = 240;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const imageRequests = new Map();
let imageWrites = Promise.resolve();
let imageSizes;

async function storeImage(cache, request, response) {
  // Serialize eviction so simultaneous thumbnail downloads respect the limits.
  imageWrites = imageWrites.catch(() => {}).then(async () => {
    if (!imageSizes) {
      const entries = [];
      for (const key of await cache.keys()) {
        const cached = await cache.match(key);
        entries.push([key.url, Number(cached?.headers.get('content-length')) || MAX_IMAGE_BYTES]);
      }
      imageSizes = new Map(entries);
    }
    const incoming = new URL(request.url);
    for (const key of imageSizes.keys()) {
      const previous = new URL(key);
      if (previous.pathname === incoming.pathname
        && previous.searchParams.get('variant') === incoming.searchParams.get('variant')
        && key !== incoming.href) {
        await cache.delete(key);
        imageSizes.delete(key);
      }
    }
    await cache.put(request, response);
    imageSizes.delete(request.url);
    imageSizes.set(request.url, Number(response.headers.get('content-length')));
    let bytes = [...imageSizes.values()].reduce((sum, size) => sum + size, 0);
    for (const [key, size] of imageSizes) {
      if (imageSizes.size <= MAX_IMAGES && bytes <= MAX_CACHE_BYTES) break;
      await cache.delete(key);
      imageSizes.delete(key);
      bytes -= size;
    }
  });
  return imageWrites;
}

async function cachedImage(request) {
  let cache;
  try {
    cache = await caches.open(IMAGE_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch { /* Storage may be disabled or full; the network still works. */ }
  if (!imageRequests.has(request.url)) {
    const pending = (async () => {
      const response = await fetch(request);
      const size = Number(response.headers.get('content-length'));
      if (cache && response.status === 200 && !response.redirected
        && response.headers.get('content-type')?.startsWith('image/')
        && response.headers.get('cache-control')?.includes('immutable')
        && size > 0 && size <= MAX_IMAGE_BYTES) {
        try { await storeImage(cache, request, response.clone()); } catch { /* Best effort. */ }
      }
      return response;
    })();
    imageRequests.set(request.url, pending);
    pending.finally(() => imageRequests.delete(request.url)).catch(() => {});
  }
  return (await imageRequests.get(request.url)).clone();
}
const OFFLINE_URL = '/offline.html';
const OFFLINE_ASSETS = [
  OFFLINE_URL,
  '/brand.css',
  '/pwa.css',
  '/theme.css',
  '/js/theme.js',
  '/app-shell.css',
  '/page-loading.css',
  '/js/page-loading.js',
  '/js/app-shell.js',
  '/js/pwa.js',
  '/branding/stackmedia-wordmark.svg',
  '/branding/stackmedia-wordmark-dark.svg',
  '/fonts/archivo-black-latin-400-normal.woff2',
  '/fonts/space-grotesk-latin-400-normal.woff2',
  '/fonts/space-grotesk-latin-500-normal.woff2',
  '/fonts/space-grotesk-latin-600-normal.woff2',
  '/fonts/space-grotesk-latin-700-normal.woff2',
];
const PAGE_PATHS = new Set([
  '/', '/catalogo', '/parceiros', '/artes/stories', '/artes/feed', '/artes/encarte', '/artes/indoor-h',
  '/index.html', '/catalogo.html', '/parceiros.html', '/stories.html', '/feed.html', '/encarte.html', '/indoor-h.html',
  OFFLINE_URL,
]);
const NAVIGATION_PATHS = new Set([
  ...PAGE_PATHS,
  '/login', '/login.html', '/usuarios', '/usuarios.html',
  '/backgrounds', '/backgrounds.html', '/revistas', '/revistas.html',
  '/import-produtos', '/import-produtos.html', '/apresentacao', '/apresentacao.html',
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(OFFLINE_ASSETS.map((url) => new Request(url, {
      credentials: 'same-origin',
      cache: 'reload',
    })));
    // Let existing editing sessions finish before activating an update.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    // Start the document request while the browser wakes the worker.
    try { await self.registration.navigationPreload?.enable(); } catch { /* Optional optimization. */ }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';
  if (request.mode !== 'navigate' && url.searchParams.has('v')
    && /^(?:\/assets\/imagens\/|\/(?:story|feed|encarte|indoor)-backgrounds\/).+\.(?:png|jpe?g|webp)$/i.test(pathname)) {
    event.respondWith(cachedImage(request));
    return;
  }
  if (request.mode === 'navigate' && NAVIGATION_PATHS.has(pathname)) {
    event.respondWith((async () => {
      try {
        // Never cache application pages, API responses, or authentication errors.
        const preloaded = await event.preloadResponse?.catch(() => undefined);
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch {
        if (!PAGE_PATHS.has(pathname)) return Response.error();
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }

  if (OFFLINE_ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(url.pathname)) || Response.error();
      }
    })());
  }
});
