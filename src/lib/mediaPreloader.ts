"use client";

/**
 * MOVIQ browser media cache manager.
 * Works with /sw.js: movie streams are cached as 2 MB chunks in CacheStorage (one cache per room session),
 * and static cinema assets (characters, theatre models) are cached for instant rendering.
 */

const CHUNK = 2 * 1024 * 1024; // must match public/sw.js
const AHEAD_CHUNKS = 30; // keep ~60 MB cached ahead of the playhead
const MEDIA_RE = /^\/(api\/(video-proxy|gdrive-stream)|assets\/movies\/)/;
const ROOM_CACHE_PREFIX = "moviq-room-";

export class MediaPreloader {
  private swInit: Promise<boolean> | null = null;
  private swReady = false;
  private token = 0;
  private abort: AbortController | null = null;

  /** Register the service worker (needs HTTPS or localhost). Resolves true when it controls the page. */
  public init(): Promise<boolean> {
    if (this.swInit) return this.swInit;
    this.swInit = (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) {
        return false;
      }
      try {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 3000);
            navigator.serviceWorker.addEventListener(
              "controllerchange",
              () => {
                clearTimeout(t);
                resolve();
              },
              { once: true }
            );
          });
        }
        this.swReady = !!navigator.serviceWorker.controller;
      } catch {
        this.swReady = false;
      }
      return this.swReady;
    })();
    return this.swInit;
  }

  public isReady(): boolean {
    return this.swReady;
  }

  /** Tag a movie stream URL with the room session so the service worker caches it per room. */
  public wrap(mediaUrl: string, roomId?: string | null): string {
    if (!this.swReady || !roomId || typeof window === "undefined") return mediaUrl;
    try {
      const u = new URL(mediaUrl, window.location.origin);
      if (u.origin !== window.location.origin || !MEDIA_RE.test(u.pathname)) return mediaUrl;
      u.searchParams.set("mq_room", roomId.toLowerCase());
      return u.pathname + u.search;
    } catch {
      return mediaUrl;
    }
  }

  /** Download static assets (characters, theatre models) so they land in the browser cache. */
  public async warmAssets(urls: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const list = Array.from(new Set(urls.filter(Boolean)));
    let done = 0;
    const total = list.length;
    onProgress?.(0, total);
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const url = list[cursor++];
        try {
          const res = await fetch(url);
          if (res.ok) await res.arrayBuffer();
        } catch {
          // best effort
        }
        done++;
        onProgress?.(done, total);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  private async prefetchChunk(wrappedUrl: string, idx: number, signal?: AbortSignal): Promise<number> {
    const start = idx * CHUNK;
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), 7000);
    try {
      const res = await fetch(wrappedUrl, {
        headers: { Range: `bytes=${start}-${start + CHUNK - 1}`, "X-Moviq-Prefetch": "1" },
        signal: signal || timeoutCtrl.signal
      });
      clearTimeout(timer);
      return parseInt(res.headers.get("X-Moviq-Total") || "0", 10) || 0;
    } catch {
      clearTimeout(timer);
      return 0;
    }
  }

  /** Make sure the chunks needed to start playback (head, tail index, chunks at the start position) are cached. */
  public async primeStart(wrappedUrl: string, startFraction: number): Promise<number> {
    if (!this.swReady || !wrappedUrl.includes("mq_room=")) return 0;
    try {
      const total = await this.prefetchChunk(wrappedUrl, 0);
      if (!total) return 0;
      const n = Math.ceil(total / CHUNK);
      const cur = Math.min(n - 1, Math.max(0, Math.floor(Math.max(0, Math.min(1, startFraction)) * n)));
      const wanted = new Set<number>([0, n - 1, cur, Math.min(n - 1, cur + 1), Math.min(n - 1, cur + 2)]);
      await Promise.all([...wanted].map((i) => this.prefetchChunk(wrappedUrl, i).catch(() => 0)));
      return total;
    } catch {
      return 0;
    }
  }

  /** Keep caching chunks ahead of the playhead in the background (also fills after seeks). */
  public async startBackgroundCache(
    wrappedUrl: string,
    getFraction: () => number,
    onProgress?: (cachedRatio: number) => void
  ): Promise<void> {
    this.cancel();
    if (!this.swReady || !wrappedUrl.includes("mq_room=")) return;

    const myToken = ++this.token;
    const ctrl = new AbortController();
    this.abort = ctrl;

    let total = 0;
    try {
      total = await this.prefetchChunk(wrappedUrl, 0, ctrl.signal);
    } catch {
      return;
    }
    if (!total) return;

    const n = Math.ceil(total / CHUNK);
    const cached = new Set<number>([0]);
    const active = new Set<number>();

    const nextIndex = (): number => {
      const cur = Math.min(n - 1, Math.max(0, Math.floor(getFraction() * n)));
      for (let i = cur; i < Math.min(n, cur + AHEAD_CHUNKS); i++) {
        if (!cached.has(i) && !active.has(i)) return i;
      }
      return -1;
    };

    const worker = async () => {
      while (myToken === this.token && !ctrl.signal.aborted) {
        const idx = nextIndex();
        if (idx < 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        active.add(idx);
        try {
          await this.prefetchChunk(wrappedUrl, idx, ctrl.signal);
          cached.add(idx);
          onProgress?.(cached.size / n);
        } catch (err: any) {
          if (err && err.name === "AbortError") return;
          await new Promise((r) => setTimeout(r, 1500));
        } finally {
          active.delete(idx);
        }
      }
    };

    await Promise.all([worker(), worker()]);
  }

  public cancel(): void {
    this.token++;
    if (this.abort) {
      try {
        this.abort.abort();
      } catch {}
      this.abort = null;
    }
  }

  /** Remove the cached movie data of a room session. */
  public async clearRoom(roomId: string): Promise<void> {
    this.cancel();
    const id = String(roomId || "").toLowerCase();
    if (!id) return;
    try {
      if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "CLEAR_ROOM", roomId: id });
      }
      if (typeof window !== "undefined" && "caches" in window) {
        await caches.delete(ROOM_CACHE_PREFIX + id);
      }
    } catch {}
  }

  /** Drop caches left over from other room sessions. */
  public purgeOtherRooms(keepRoomId: string): void {
    try {
      if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "CLEAR_OTHER_ROOMS",
          keep: String(keepRoomId || "").toLowerCase()
        });
      }
    } catch {}
  }
}

export const mediaPreloader = new MediaPreloader();
