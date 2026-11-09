"use client";

/**
 * MOVIQ High-Speed Browser Media Chunk Preloader
 * Proactively caches video chunks in the browser's CacheStorage and Memory Buffer
 * so playback starts instantly with zero buffering lag on individual viewers.
 */

const CACHE_NAME = "moviq-room-media-cache";
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per preloaded chunk
const MAX_PRELOAD_CHUNKS = 4; // Preload up to 20 MB in advance

export class MediaPreloader {
  private activeUrl: string | null = null;
  private abortController: AbortController | null = null;
  private preloadedBytes: number = 0;
  private isPreloading: boolean = false;

  constructor() {}

  public async preload(mediaUrl: string): Promise<void> {
    if (!mediaUrl || mediaUrl.includes(".m3u8")) {
      // HLS streams handle their own segment buffering
      return;
    }

    if (this.activeUrl === mediaUrl && this.isPreloading) {
      return;
    }

    // Cancel any previous preload job
    this.cancel();

    this.activeUrl = mediaUrl;
    this.abortController = new AbortController();
    this.isPreloading = true;
    this.preloadedBytes = 0;

    const signal = this.abortController.signal;

    try {
      let cache: Cache | null = null;
      if (typeof window !== "undefined" && "caches" in window) {
        try {
          cache = await caches.open(CACHE_NAME);
        } catch {
          cache = null;
        }
      }

      // Preload initial sequential chunks in the background
      for (let i = 0; i < MAX_PRELOAD_CHUNKS; i++) {
        if (signal.aborted) break;

        const start = i * CHUNK_SIZE;
        const end = start + CHUNK_SIZE - 1;

        try {
          const chunkReq = new Request(mediaUrl, {
            headers: {
              Range: `bytes=${start}-${end}`,
              "X-Moviq-Preload": "1"
            },
            signal
          });

          // Check if already in browser CacheStorage
          if (cache) {
            const cachedRes = await cache.match(chunkReq);
            if (cachedRes) {
              this.preloadedBytes += CHUNK_SIZE;
              continue;
            }
          }

          const res = await fetch(chunkReq);
          if (res.ok || res.status === 206) {
            this.preloadedBytes += CHUNK_SIZE;
            if (cache) {
              try {
                await cache.put(chunkReq, res.clone());
              } catch {}
            }
            // Consume the body stream to ensure browser disk/memory cache commit
            await res.arrayBuffer();
          } else {
            // Server might not support Range or returned error; stop preloading
            break;
          }
        } catch (err: any) {
          if (err.name === "AbortError") break;
          // Non-fatal preload error (e.g. CORS or network limit)
          break;
        }
      }
    } catch {
      // Preloading is best-effort optimization; ignore non-fatal errors
    } finally {
      this.isPreloading = false;
    }
  }

  public cancel(): void {
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
      this.abortController = null;
    }
    this.isPreloading = false;
  }

  public async clearCache(): Promise<void> {
    this.cancel();
    if (typeof window !== "undefined" && "caches" in window) {
      try {
        await caches.delete(CACHE_NAME);
      } catch {}
    }
  }
}

export const mediaPreloader = new MediaPreloader();

