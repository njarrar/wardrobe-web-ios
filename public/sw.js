const CACHE = "open-wardrobe-shell-v3";
const ASSET_CACHE = "wardrobe-assets-v1";
const IMAGE_CACHE = "wardrobe-images-v2";
const ACTIVE_CACHES = new Set([CACHE, ASSET_CACHE, IMAGE_CACHE]);
const MAX_IMAGE_ENTRIES = 800;
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];
const LIBRARY_IMAGE_PATH = /^\/api\/import\/(?:library|outfits)\/[^/]+\.(?:png|jpe?g|webp)$/i;

async function trimImages(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_IMAGE_ENTRIES;
  if (overflow > 0) await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
}

async function fetchAndCacheImage(request, cache) {
  const response = await fetch(request);
  const contentType = response.headers.get("content-type") || "";
  if (response.ok && !response.redirected && contentType.startsWith("image/")) {
    await cache.put(request, response.clone());
    await trimImages(cache);
  }
  return response;
}

async function fetchAndCacheAsset(request, cache) {
  const response = await fetch(request);
  if (response.ok && !response.redirected) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => !ACTIVE_CACHES.has(key)).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Clear cached private garment images on logout / server switch.
self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type === "CLEAR_IMAGE_CACHE" || type === "LOGOUT" || type === "WARDROBE_LOGOUT") {
    event.waitUntil(caches.delete(IMAGE_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Cache authenticated library/outfit images (keyed by full request URL with
  // short-lived image key) and evict on logout via the message listener above.
  if (LIBRARY_IMAGE_PATH.test(url.pathname)) {
    event.respondWith(caches.open(IMAGE_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      return fetchAndCacheImage(request, cache);
    }));
    return;
  }

  if (url.pathname.startsWith("/api/")) return;

  // Cache Vite's hashed JS/CSS/font bundles so offline boot actually works.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const update = fetchAndCacheAsset(request, cache);
      if (cached) {
        event.waitUntil(update.catch(() => undefined));
        return cached;
      }
      return update;
    }));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok && !response.redirected) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
  }
});
