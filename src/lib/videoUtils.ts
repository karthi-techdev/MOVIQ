export type VideoSourceType = "direct" | "hls" | "youtube" | "vimeo" | "twitch";

export interface ParsedVideoUrl {
  type: VideoSourceType;
  streamUrl: string; // The URL to give to HTML5 <video> or /api/video-proxy
  title?: string;
  id?: string;
}

export interface PresetMovie {
  title: string;
  url: string;
  category: string;
  badge: string;
}

export const PRESET_MOVIES: PresetMovie[] = [];

export function parseVideoUrl(input: string): ParsedVideoUrl {
  const raw = String(input || "").trim();
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
  if (!raw) {
    return { type: "direct", streamUrl: "/assets/movies/big_buck_bunny.mp4", title: "Default Movie" };
  }

  // 1. YouTube (standard watch, shorts, embed, youtu.be, mobile, or raw video ID)
  const ytMatch = raw.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
  );
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    return {
      type: "youtube",
      id: videoId,
      streamUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: "YouTube Video"
    };
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw) && !raw.includes("/") && !raw.includes(".")) {
    return {
      type: "youtube",
      id: raw,
      streamUrl: `https://www.youtube.com/watch?v=${raw}`,
      title: "YouTube Video"
    };
  }
  if (/^-[a-zA-Z0-9_-]{11}$/.test(raw) && !raw.includes("/")) {
    const cleanId = raw.slice(1);
    return {
      type: "youtube",
      id: cleanId,
      streamUrl: `https://www.youtube.com/watch?v=${cleanId}`,
      title: "YouTube Video"
    };
  }

  // 2. Google Drive (drive.google.com/file/d/FILE_ID/view or open?id=FILE_ID or drive.usercontent.google.com or raw file ID)
  const gdriveMatch = raw.match(
    /(?:(?:drive\.google|drive\.usercontent\.google)\.com\/(?:file\/d\/|open\?id=|uc\?id=|download\?id=)|id=)([a-zA-Z0-9_-]{20,})/i
  );
  if (gdriveMatch && gdriveMatch[1]) {
    const fileId = gdriveMatch[1];
    return {
      type: "direct",
      id: fileId,
      streamUrl: `/api/gdrive-stream?id=${fileId}`,
      title: "Google Drive Movie"
    };
  }
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(raw) && !raw.includes("/") && !raw.includes(".")) {
    return {
      type: "direct",
      id: raw,
      streamUrl: `/api/gdrive-stream?id=${raw}`,
      title: "Google Drive Movie"
    };
  }

  // 3. Dropbox (dropbox.com/s/.../video.mp4?dl=0 -> dl=1)
  if (raw.includes("dropbox.com")) {
    const cleanDb = raw.replace(/\?dl=0/i, "?dl=1").replace(/www\.dropbox\.com/i, "dl.dropboxusercontent.com");
    return {
      type: "direct",
      streamUrl: `${apiBase}/api/video-proxy?url=${encodeURIComponent(cleanDb)}`,
      title: "Dropbox Video"
    };
  }

  // 4. HLS Stream (.m3u8)
  if (raw.includes(".m3u8")) {
    return {
      type: "hls",
      streamUrl: raw,
      title: "HLS Stream"
    };
  }

  // 5. Local relative path (/assets/...)
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return {
      type: "direct",
      streamUrl: raw,
      title: "Local Movie"
    };
  }

  // 6. Direct Video (MP4, WebM, OGG, MOV, etc.)
  return {
    type: "direct",
    streamUrl: raw,
    title: "Online Video"
  };
}
