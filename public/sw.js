/* MOVIQ Service Worker
 * Static cinema assets (characters, theatre models, fonts) are cached cache-first for fast rendering.
 * Media streams are passed directly to the browser's native hardware-accelerated video streaming pipeline.
 */
const SW_VERSION = "v3";
const ASSET_CACHE = "moviq-assets-" + SW_VERSION;
const ASSET_RE = /^\/(assets\/(characters|theater)\/|fonts\/)/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("moviq-assets-") && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Static cinema assets cache-first
  if (!req.headers.has("range") && ASSET_RE.test(url.pathname)) {
    event.respondWith(handleAsset(req));
  }
});

async function handleAsset(req) {
  try {
    const cache = await caches.open(ASSET_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.status === 200) {
      try {
        await cache.put(req, res.clone());
      } catch (e) {}
    }
    return res;
  } catch (e) {
    return fetch(req);
  }
}
