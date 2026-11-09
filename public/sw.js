/* MOVIQ Service Worker
 * 1) Room-session video chunk cache: Range requests for movie streams are served from 2 MB chunks kept in
 *    CacheStorage (one cache per room session). Chunks are fetched with short Range requests, so a dropped
 *    connection never leaves the video stuck, and seeking / re-joining is instant for already cached parts.
 * 2) Static cinema assets (characters, theatre models, fonts) are cache-first for fast rendering.
 */
const SW_VERSION = "v2";
const ASSET_CACHE = "moviq-assets-" + SW_VERSION;
const ROOM_PREFIX = "moviq-room-";
const CHUNK = 2 * 1024 * 1024;
const MAX_SERVE_CHUNKS = 2; // serve up to 4 MB per response to keep first-byte latency ultra low
const MEDIA_RE = /^\/(api\/(video-proxy|gdrive-stream)|assets\/movies\/)/;
const ASSET_RE = /^\/(assets\/(characters|theater)\/|fonts\/)/;

const inflight = new Map();
const noRange = new Set();

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

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "CLEAR_ROOM" && data.roomId) {
    event.waitUntil(caches.delete(ROOM_PREFIX + data.roomId));
  } else if (data.type === "CLEAR_OTHER_ROOMS") {
    event.waitUntil(
      (async () => {
        const keep = ROOM_PREFIX + (data.keep || "");
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k.startsWith(ROOM_PREFIX) && k !== keep).map((k) => caches.delete(k))
        );
      })()
    );
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const room = url.searchParams.get("mq_room");
  if (room && MEDIA_RE.test(url.pathname)) {
    event.respondWith(handleMedia(req, url, room));
    return;
  }

  if (!req.headers.has("range") && ASSET_RE.test(url.pathname)) {
    event.respondWith(handleAsset(req));
  }
});

// Direct fetch helper that strictly bypasses service worker interception by stripping mq_room
function directFetch(req, baseUrl) {
  const headers = new Headers(req.headers);
  headers.delete("x-moviq-prefetch");
  return fetch(baseUrl, {
    method: "GET",
    headers,
    credentials: req.credentials || "same-origin"
  });
}

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

function chunkKey(baseUrl, idx) {
  return new Request(self.location.origin + "/__moviq_chunk__/" + idx + "?u=" + encodeURIComponent(baseUrl));
}

function metaKey(baseUrl) {
  return new Request(self.location.origin + "/__moviq_meta__?u=" + encodeURIComponent(baseUrl));
}

// Fetch one aligned chunk from network, store in room cache.
function fetchAndStore(cache, baseUrl, idx) {
  const key = baseUrl + "#" + idx + "#" + (cache === null ? "" : "c");
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const a = idx * CHUNK;
    const b = a + CHUNK - 1;
    const res = await fetch(baseUrl, { headers: { Range: "bytes=" + a + "-" + b } });
    if (res.status !== 206) {
      try { res.body && res.body.cancel(); } catch (e) {}
      return null;
    }
    const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") || "");
    const total = m ? parseInt(m[1], 10) : 0;
    if (!total) {
      try { res.body && res.body.cancel(); } catch (e) {}
      return null;
    }
    const type = res.headers.get("content-type") || "video/mp4";
    const buf = await res.arrayBuffer();
    const expected = Math.min(CHUNK, total - a);
    if (buf.byteLength !== expected) {
      return { buf, total, type, partial: true };
    }
    try {
      await cache.put(chunkKey(baseUrl, idx), new Response(buf.slice(0)));
      await cache.put(
        metaKey(baseUrl),
        new Response(JSON.stringify({ total, type }), { headers: { "Content-Type": "application/json" } })
      );
    } catch (e) {}
    return { buf, total, type };
  })();
  inflight.set(key, p);
  const clear = () => inflight.delete(key);
  p.then(clear, clear);
  return p;
}

async function getMeta(cache, baseUrl) {
  const hit = await cache.match(metaKey(baseUrl));
  if (hit) {
    try { return await hit.json(); } catch (e) {}
  }
  const c = await fetchAndStore(cache, baseUrl, 0);
  return c ? { total: c.total, type: c.type } : null;
}

async function getChunk(cache, baseUrl, idx) {
  const hit = await cache.match(chunkKey(baseUrl, idx));
  if (hit) return { buf: await hit.arrayBuffer() };
  const c = await fetchAndStore(cache, baseUrl, idx);
  return c ? { buf: c.buf } : null;
}

async function handleMedia(req, url, room) {
  const base = new URL(url.href);
  base.searchParams.delete("mq_room");
  const baseUrl = base.pathname + base.search;
  const prefetch = req.headers.has("x-moviq-prefetch");

  try {
    if (noRange.has(baseUrl)) {
      if (prefetch) return new Response(null, { status: 200, headers: { "X-Moviq-Total": "0" } });
      return directFetch(req, baseUrl);
    }

    const cache = await caches.open(ROOM_PREFIX + room);
    const meta = await getMeta(cache, baseUrl);
    if (!meta || !meta.total) {
      noRange.add(baseUrl);
      if (prefetch) return new Response(null, { status: 200, headers: { "X-Moviq-Total": "0" } });
      return directFetch(req, baseUrl);
    }
    const total = meta.total;
    const type = meta.type || "video/mp4";

    let start = 0;
    let end = total - 1;
    const rh = req.headers.get("range");
    if (rh) {
      const m = /bytes=(\d*)-(\d*)/.exec(rh);
      if (m) {
        if (m[1] === "" && m[2] !== "") {
          start = Math.max(0, total - parseInt(m[2], 10));
        } else {
          if (m[1] !== "") start = parseInt(m[1], 10);
          if (m[2] !== "") end = Math.min(total - 1, parseInt(m[2], 10));
        }
      }
    }
    if (start >= total) {
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + total } });
    }

    const firstIdx = Math.floor(start / CHUNK);

    if (prefetch) {
      const c = await getChunk(cache, baseUrl, firstIdx);
      return new Response(null, { status: 200, headers: { "X-Moviq-Total": String(total), "X-Moviq-Cached": c ? "1" : "0" } });
    }

    const maxLast = firstIdx * CHUNK + MAX_SERVE_CHUNKS * CHUNK - 1;
    const last = Math.min(end, maxLast, total - 1);
    const lastIdx = Math.floor(last / CHUNK);

    const parts = [];
    for (let idx = firstIdx; idx <= lastIdx; idx++) {
      const c = await getChunk(cache, baseUrl, idx);
      if (!c) {
        // Fall back directly to upstream range fetch if chunk couldn't be loaded
        return directFetch(req, baseUrl);
      }
      const a = idx * CHUNK;
      const from = Math.max(start, a) - a;
      const to = Math.min(last, a + c.buf.byteLength - 1) - a + 1;
      parts.push(c.buf.slice(from, to));
    }
    const blob = new Blob(parts, { type });
    return new Response(blob, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Range": "bytes " + start + "-" + (start + blob.size - 1) + "/" + total,
        "Content-Length": String(blob.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    if (prefetch) return new Response(null, { status: 200, headers: { "X-Moviq-Total": "0" } });
    return directFetch(req, baseUrl);
  }
}
