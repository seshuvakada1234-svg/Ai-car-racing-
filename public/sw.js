/**
 * AI Race Arena PWA Service Worker
 * @license Apache-2.0
 */

const CACHE_NAME = "ai-race-arena-cache-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/assets/manifest.json",
  "/manifest.webmanifest",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Cache-first strategy for media components, textures and large 3D models (.glb, .mp3, .png, .jpg)
  const isCachableAsset =
    url.pathname.endsWith(".glb") ||
    url.pathname.endsWith(".mp3") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.origin.includes("pub-a248afed72844944a7565dc9cbaacbb0.r2.dev");

  if (isCachableAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
              // Keep cors responses cacheable if status is ok
              if (networkResponse.status === 200) {
                const cacheCopy = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, cacheCopy);
                });
              }
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
            return networkResponse;
          })
          .catch(() => {
            return new Response("Offline asset not found", { status: 503, statusText: "Offline" });
          });
      }),
    );
  } else {
    // Default network first or cache fallback for code components
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      }),
    );
  }
});
