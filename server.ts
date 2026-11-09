import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { parse } from "url";
import crypto from "crypto";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { LightingState, MovieState, RoomSummary, SideLightMode, UserData, Vector3Like } from "./src/types/cinema";
import { Innertube, ClientType } from "youtubei.js";

const dev = process.env.NODE_ENV !== "production";
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_MESSAGE_SIZE = 64 * 1024;
const MAX_USERS_PER_ROOM = 1000;

const DEFAULT_MOVIE: MovieState = {
  url: "/assets/movies/big_buck_bunny.mp4",
  title: "Big Buck Bunny — Cinema Premiere",
  playing: false,
  time: 0,
  volume: 0.8,
  updatedAt: Date.now()
};

const DEFAULT_LIGHTING: LightingState = {
  ceiling: true,
  stairs: true,
  belowScreen: true,
  sideLights: "on"
};

const AVATAR_COLORS = [
  0x8170e8, 0x4c8edc, 0xb369b8, 0x3f9b91, 0xb87758, 0x6b7ac9, 0xa45f6d
];

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

interface ClientSession {
  id: string;
  socket: WebSocket;
  username: string;
  characterType: string;
  headPitch: number;
  headYaw: number;
  action: string;
  room: RoomSession | null;
  avatarColor: number;
  colorIndex: number;
  isHost: boolean;
  seated: boolean;
  seatIndex: number | null;
  speaking: boolean;
  muted: boolean;
  inVoice: boolean;
  position: Vector3Like;
  rotation: number;
  joinedAt: number;
  isAlive: boolean;
}

interface RoomSession {
  id: string;
  name: string;
  public: boolean;
  hostId: string;
  creatorUsername?: string;
  hostUsername?: string;
  hostSecret?: string;
  hostGraceTimer?: NodeJS.Timeout | null;
  users: Map<string, ClientSession>;
  seats: Map<number, string>;
  movie: MovieState;
  lighting: LightingState;
  createdAt: number;
  maxUsers: number;
}

const rooms = new Map<string, RoomSession>();
const clients = new Map<string, ClientSession>();

function generateId(length = 12): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

function makeRoomId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result: string;
  do {
    result = Array.from({ length: 6 }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  } while (rooms.has(result));
  return result;
}

function cleanString(value: any, maxLength = 100): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanUsername(value: any): string {
  return cleanString(value, 24).replace(/[<>]/g, "").trim();
}

function validVideoURL(value: any): string | null {
  const str = String(value ?? "").trim();
  if (!str || str.length > 4096) return null;
  if (str.startsWith("/") && !str.startsWith("//")) {
    return str;
  }
  try {
    const url = new URL(str);
    return ["http:", "https:", "blob:"].includes(url.protocol) ? str : null;
  } catch {
    return null;
  }
}

function send(clientOrSocket: ClientSession | WebSocket, message: any) {
  const socket = (clientOrSocket as ClientSession).socket || (clientOrSocket as WebSocket);
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(message));
    } catch (error: any) {
      console.error("Send failed:", error.message);
    }
  }
}

function broadcast(room: RoomSession, message: any, exceptId: string | null = null) {
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const user of room.users.values()) {
    if (user.id === exceptId) continue;
    if (user.socket && user.socket.readyState === WebSocket.OPEN) {
      try {
        user.socket.send(payload);
      } catch (err: any) {
        console.error("Broadcast failed:", err.message);
      }
    }
  }
}

function serializeUser(user: ClientSession): UserData {
  return {
    id: user.id,
    username: user.username,
    characterType: user.characterType || "character_406814",
    headPitch: user.headPitch || 0,
    headYaw: user.headYaw || 0,
    action: user.action || "idle",
    position: user.position,
    rotation: user.rotation,
    seated: user.seated,
    seatIndex: user.seatIndex,
    seatIndexLabel: user.seatIndex === null ? null : user.seatIndex + 1,
    speaking: user.speaking,
    muted: user.muted,
    inVoice: user.inVoice,
    avatarColor: user.avatarColor,
    colorIndex: user.colorIndex,
    joinedAt: user.joinedAt
  };
}

function movieState(room: RoomSession): MovieState {
  const now = Date.now();
  let currentTime = room.movie.time;
  if (room.movie.playing) {
    currentTime += (now - room.movie.updatedAt) / 1000;
  }
  return {
    ...room.movie,
    time: Math.max(0, currentTime),
    serverTime: now
  };
}

function serializeRoom(room: RoomSession): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    public: room.public,
    users: room.users.size,
    maxUsers: room.maxUsers,
    playing: room.movie.playing,
    movie: {
      title: room.movie.title,
      url: room.movie.url,
      playing: room.movie.playing
    },
    createdAt: room.createdAt
  };
}

function getPublicRooms(): RoomSummary[] {
  return [...rooms.values()]
    .filter((room) => room.public)
    .map(serializeRoom);
}

function broadcastRoomList() {
  const payload = JSON.stringify({
    type: "room-list",
    rooms: getPublicRooms()
  });
  for (const client of clients.values()) {
    if (client.socket?.readyState === WebSocket.OPEN) {
      client.socket.send(payload);
    }
  }
}

function createRoom(owner: ClientSession, data: { name?: string; isPublic?: boolean }): RoomSession {
  const secret = crypto.randomBytes(16).toString("hex");
  const room: RoomSession = {
    id: makeRoomId(),
    name: cleanString(data.name, 60) || "Midnight Premiere",
    public: data.isPublic !== false,
    hostId: owner.id,
    creatorUsername: owner.username,
    hostUsername: owner.username,
    hostSecret: secret,
    hostGraceTimer: null,
    users: new Map(),
    seats: new Map(),
    movie: { ...DEFAULT_MOVIE, updatedAt: Date.now() },
    lighting: { ...DEFAULT_LIGHTING },
    createdAt: Date.now(),
    maxUsers: MAX_USERS_PER_ROOM
  };
  rooms.set(room.id, room);
  return room;
}

function joinRoom(client: ClientSession, room: RoomSession, username: string, providedHostSecret?: string) {
  leaveRoom(client, false);
  if (room.users.size >= (room.maxUsers || MAX_USERS_PER_ROOM)) {
    throw new Error("This theatre is full.");
  }
  client.username = cleanUsername(username) || client.username;
  client.room = room;
  client.colorIndex = room.users.size % AVATAR_COLORS.length;
  client.avatarColor = AVATAR_COLORS[client.colorIndex];
  room.users.set(client.id, client);

  // Host Authority:
  // A client can ONLY reclaim or become host if NO active host is currently present in the room!
  // This strictly protects an active host from being demoted when a viewer joins from the same browser/session.
  const activeHostPresent = !!room.hostId && room.hostId !== client.id && room.users.has(room.hostId);
  const isAuthorizedHost = !activeHostPresent && (
    (providedHostSecret && room.hostSecret && providedHostSecret === room.hostSecret) ||
    (room.creatorUsername && client.username.toLowerCase() === room.creatorUsername.toLowerCase())
  );

  if (isAuthorizedHost) {
    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }
    const previousHostId = room.hostId;
    room.hostId = client.id;
    room.hostUsername = client.username;
    if (previousHostId !== client.id) {
      broadcast(room, {
        type: "host-changed",
        hostId: room.hostId,
        username: client.username
      });
      broadcast(room, {
        type: "movie-state",
        state: movieState(room)
      });
    }
  }

  if (!room.lighting) {
    room.lighting = { ...DEFAULT_LIGHTING };
  }

  // Send joined confirmation with full room snapshot and hostSecret (if host)
  send(client, {
    type: "joined",
    userId: client.id,
    selfId: client.id,
    hostSecret: room.hostId === client.id ? room.hostSecret : undefined,
    room: {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      movie: movieState(room),
      lighting: room.lighting,
      users: [...room.users.values()].map(serializeUser),
      seats: Object.fromEntries(room.seats)
    },
    lighting: room.lighting,
    movie: movieState(room),
    users: [...room.users.values()].map(serializeUser)
  });

  // Notify other audience members
  broadcast(room, {
    type: "user-joined",
    user: serializeUser(client)
  }, client.id);

  broadcast(room, {
    type: "chat",
    id: generateId(),
    system: true,
    text: `${client.username} entered the theatre`,
    timestamp: Date.now()
  });

  broadcastRoomList();
}

function leaveRoom(client: ClientSession, notify = true) {
  const room = client.room;
  if (!room) return;
  const wasHost = room.hostId === client.id;
  room.users.delete(client.id);

  // Release seats
  for (const [seatId, occupantId] of room.seats.entries()) {
    if (occupantId === client.id) {
      room.seats.delete(seatId);
      broadcast(room, {
        type: "seat-update",
        seatId,
        userId: null,
        username: null
      });
    }
  }

  if (notify) {
    broadcast(room, {
      type: "user-left",
      userId: client.id,
      username: client.username
    });
    broadcast(room, {
      type: "chat",
      id: generateId(),
      system: true,
      text: `${client.username} left the theatre`,
      timestamp: Date.now()
    });
  }

  // Host Disconnection Grace Period:
  // If the host disconnected, do NOT immediately strip host privileges!
  // Start a 60-second grace window allowing the host to reconnect seamlessly.
  if (wasHost && room.users.size > 0) {
    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
    }
    room.hostGraceTimer = setTimeout(() => {
      room.hostGraceTimer = null;
      if (room.users.size > 0 && !room.users.has(room.hostId)) {
        const nextHost = room.users.values().next().value;
        if (nextHost) {
          room.hostId = nextHost.id;
          room.hostUsername = nextHost.username;
          broadcast(room, {
            type: "host-changed",
            hostId: room.hostId,
            username: nextHost.username
          });
          broadcast(room, {
            type: "movie-state",
            state: movieState(room)
          });
        }
      }
    }, 60000);
  }

  if (room.users.size === 0) {
    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }
    rooms.delete(room.id);
  }

  client.room = null;
  client.seatIndex = null;
  client.seated = false;
  broadcastRoomList();
}

function handleDisconnect(client: ClientSession) {
  leaveRoom(client, true);
  clients.delete(client.id);
}

const CACHE_DIR = path.join(process.cwd(), "public", "assets", "movies", "cache");
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function extractYouTubeId(url: string): string | null {
  const str = String(url || "").trim();
  const match = str.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  if (/^-[a-zA-Z0-9_-]{11}$/.test(str)) return str.slice(1);
  return null;
}

function extractGoogleDriveId(url: string): string | null {
  const str = String(url || "").trim();
  const match = str.match(
    /(?:(?:drive\.google|drive\.usercontent\.google)\.com\/(?:file\/d\/|open\?id=|uc\?id=|download\?id=)|id=)([a-zA-Z0-9_-]{20,})/i
  );
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(str) && !str.includes("/") && !str.includes(".")) return str;
  return null;
}

function proxyRemoteMediaStream(
  targetUrl: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  defaultContentType = "video/mp4",
  customReferer = ""
) {
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid target url");
    return;
  }

  const clientHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "*/*"
  };
  if (req.headers.range) {
    clientHeaders["Range"] = req.headers.range as string;
  }
  if (customReferer) {
    clientHeaders["Referer"] = customReferer;
    try {
      clientHeaders["Origin"] = new URL(customReferer).origin;
    } catch {}
  }

  const transport = parsedTarget.protocol === "https:" ? https : http;
  const proxyReq = transport.request(
    targetUrl,
    {
      method: req.method || "GET",
      headers: clientHeaders
    },
    (proxyRes) => {
      if (
        (proxyRes.statusCode === 301 || proxyRes.statusCode === 302 || proxyRes.statusCode === 303 || proxyRes.statusCode === 307) &&
        proxyRes.headers.location
      ) {
        proxyReq.destroy();
        proxyRemoteMediaStream(proxyRes.headers.location, req, res, defaultContentType, customReferer);
        return;
      }

      const statusCode = proxyRes.statusCode || 200;
      const headers: Record<string, string | string[]> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type, Accept",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        "Accept-Ranges": "bytes"
      };

      const upstreamType = String(proxyRes.headers["content-type"] || "");
      const isM3u8 = upstreamType.includes("mpegurl") || upstreamType.includes("vnd.apple.mpegurl") || targetUrl.toLowerCase().includes(".m3u8");

      if (isM3u8 && statusCode >= 200 && statusCode < 300) {
        let rawBody = "";
        proxyRes.setEncoding("utf8");
        proxyRes.on("data", (chunk) => {
          rawBody += chunk;
        });
        proxyRes.on("end", () => {
          const rewrittenLines = rawBody.split(/\r?\n/).map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            if (trimmed.startsWith("#")) {
              return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                try {
                  const abs = new URL(uri, targetUrl).href;
                  const proxied = `/api/video-proxy?url=${encodeURIComponent(abs)}${customReferer ? `&referer=${encodeURIComponent(customReferer)}` : ""}`;
                  return `URI="${proxied}"`;
                } catch {
                  return match;
                }
              });
            }

            try {
              const abs = new URL(trimmed, targetUrl).href;
              return `/api/video-proxy?url=${encodeURIComponent(abs)}${customReferer ? `&referer=${encodeURIComponent(customReferer)}` : ""}`;
            } catch {
              return line;
            }
          });

          const rewrittenBody = rewrittenLines.join("\n");
          headers["Content-Type"] = "application/vnd.apple.mpegurl";
          headers["Content-Length"] = String(Buffer.byteLength(rewrittenBody, "utf8"));
          headers["Cache-Control"] = "no-cache, no-store";
          res.writeHead(statusCode, headers);
          res.end(rewrittenBody);
        });
        return;
      }

      if (proxyRes.headers["content-type"]) {
        headers["Content-Type"] = proxyRes.headers["content-type"];
      } else {
        headers["Content-Type"] = defaultContentType;
      }
      if (proxyRes.headers["content-length"]) {
        headers["Content-Length"] = proxyRes.headers["content-length"];
      }
      if (proxyRes.headers["content-range"]) {
        headers["Content-Range"] = proxyRes.headers["content-range"];
      }

      res.writeHead(statusCode, headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`Proxy error: ${err.message}`);
    }
  });

  req.on("close", () => {
    proxyReq.destroy();
  });

  proxyReq.end();
}

function serveLocalMediaFile(req: http.IncomingMessage, res: http.ServerResponse, filePath: string, contentType = "video/mp4") {
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
    res.setHeader("Accept-Ranges", "bytes");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start >= fileSize || (parts[1] && end >= fileSize) || start > end) {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSize}`,
          "Content-Type": "text/plain"
        });
        res.end("Requested range not satisfiable");
        return;
      }

      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": chunksize,
        "Content-Type": contentType
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err: any) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`File stream error: ${err.message}`);
    }
  }
}

interface CachedYtStream {
  videoUrl: string;
  audioUrl: string | null;
  expiresAt: number;
}
const ytStreamCache = new Map<string, CachedYtStream>();

let cachedCookiePath: string | null = null;
let cachedCookieHeader: string | null = null;
let lastCookieSourceHash: string = "";

function processCookieContent(raw: string, existingPath: string | null): { filePath: string | null; headerString: string | null } {
  try {
    let text = raw.trim();
    // Handle escaped newlines from environment variables
    text = text.replace(/\\n/g, "\n").replace(/\\r/g, "\r");

    // Check if Base64 encoded
    if (!text.includes("\t") && !text.includes(" ") && text.length > 50) {
      try {
        const decoded = Buffer.from(text, "base64").toString("utf-8");
        if (decoded.includes("youtube") || decoded.includes("\t") || decoded.includes("# Netscape")) {
          text = decoded;
        }
      } catch {}
    }

    const lines = text.split(/\r?\n/);
    const outLines: string[] = ["# Netscape HTTP Cookie File", "# Generated & Sanitized by MOVIQ", ""];
    const cookiePairs: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Handle both tab-separated and space-separated lines (e.g. from web form copy-paste)
      let parts = trimmed.split("\t");
      if (parts.length < 7) {
        parts = trimmed.split(/\s+/);
      }

      if (parts.length >= 7) {
        const [domain, flag, cookiePath, secure, expiration, name, ...valParts] = parts;
        const value = valParts.join(" ");
        outLines.push([domain, flag, cookiePath, secure, expiration, name, value].join("\t"));
        cookiePairs.push(`${name}=${value}`);
      }
    }

    const headerString = cookiePairs.length > 0 ? cookiePairs.join("; ") : null;
    const sanitizedFile = outLines.join("\n") + "\n";

    let targetPath = existingPath;
    if (!targetPath) {
      const candidatePaths = [
        path.join(process.platform === "win32" ? process.cwd() : "/tmp", "cookies.txt"),
        path.join(process.cwd(), "cookies.txt")
      ];
      for (const p of candidatePaths) {
        try {
          fs.writeFileSync(p, sanitizedFile, "utf-8");
          targetPath = p;
          console.log(`[Cookies] Successfully sanitized and wrote cookies to: ${p} (${cookiePairs.length} valid cookies)`);
          break;
        } catch {}
      }
    }

    return { filePath: targetPath, headerString };
  } catch (err: any) {
    console.warn("[Cookies] Error processing cookies:", err.message);
    return { filePath: existingPath, headerString: null };
  }
}

function parseAndPrepareCookies(): { filePath: string | null; headerString: string | null } {
  const envCookies = process.env.YOUTUBE_COOKIES || process.env.YTDLP_COOKIES || process.env.COOKIES_CONTENT;
  const currentHash = String(envCookies || "").trim();

  if (currentHash && currentHash === lastCookieSourceHash && cachedCookiePath) {
    return { filePath: cachedCookiePath, headerString: cachedCookieHeader };
  }

  if (envCookies && envCookies.trim()) {
    const res = processCookieContent(envCookies, null);
    cachedCookiePath = res.filePath;
    cachedCookieHeader = res.headerString;
    lastCookieSourceHash = currentHash;
    return res;
  }

  // Check Render Secret File location
  const renderSecretCookies = "/etc/secrets/cookies.txt";
  if (fs.existsSync(renderSecretCookies)) {
    try {
      const content = fs.readFileSync(renderSecretCookies, "utf-8");
      const res = processCookieContent(content, renderSecretCookies);
      cachedCookiePath = res.filePath;
      cachedCookieHeader = res.headerString;
      return res;
    } catch {}
  }

  // Check local file in cwd
  const localCookies = path.join(process.cwd(), "cookies.txt");
  if (fs.existsSync(localCookies)) {
    try {
      const content = fs.readFileSync(localCookies, "utf-8");
      const res = processCookieContent(content, localCookies);
      cachedCookiePath = res.filePath;
      cachedCookieHeader = res.headerString;
      return res;
    } catch {}
  }

  // Check /tmp/cookies.txt
  const tmpCookies = path.join("/tmp", "cookies.txt");
  if (fs.existsSync(tmpCookies)) {
    try {
      const content = fs.readFileSync(tmpCookies, "utf-8");
      const res = processCookieContent(content, tmpCookies);
      cachedCookiePath = res.filePath;
      cachedCookieHeader = res.headerString;
      return res;
    } catch {}
  }

  return { filePath: null, headerString: null };
}

function getCookiesPath(): string | null {
  const { filePath } = parseAndPrepareCookies();
  return filePath;
}

function getCookiesHeader(): string | null {
  const { headerString } = parseAndPrepareCookies();
  return headerString;
}

function getYtDlpRunner(): { command: string; prefixArgs: string[] } {
  // 1. Check local standalone binary in bin/yt-dlp (bundled in repo / downloaded on Render)
  const localBin = path.join(process.cwd(), "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(localBin)) {
    try {
      fs.chmodSync(localBin, 0o755);
    } catch {}
    return { command: localBin, prefixArgs: [] };
  }

  // 2. Check if yt-dlp is in system PATH
  try {
    const res = spawnSync(process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp", ["--version"], { timeout: 3000 });
    if (res.status === 0) {
      return { command: process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp", prefixArgs: [] };
    }
  } catch {}

  // 3. Check python3 -m yt_dlp (standard on Ubuntu/Debian/Render)
  try {
    const res = spawnSync("python3", ["-m", "yt_dlp", "--version"], { timeout: 3000 });
    if (res.status === 0) {
      return { command: "python3", prefixArgs: ["-m", "yt_dlp"] };
    }
  } catch {}

  // 4. Check python -m yt_dlp (standard on Windows)
  try {
    const res = spawnSync("python", ["-m", "yt_dlp", "--version"], { timeout: 3000 });
    if (res.status === 0) {
      return { command: "python", prefixArgs: ["-m", "yt_dlp"] };
    }
  } catch {}

  // Fallback to python3 on Linux, python on Windows
  return {
    command: process.platform === "win32" ? "python" : "python3",
    prefixArgs: ["-m", "yt_dlp"]
  };
}

function getFfmpegCommand(): string {
  // 1. Check bundled/downloaded static binary in bin/
  const localBin = path.join(process.cwd(), "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (fs.existsSync(localBin)) {
    try {
      fs.chmodSync(localBin, 0o755);
    } catch {}
    return localBin;
  }

  // 2. Check ffmpeg-static npm package
  try {
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      try {
        fs.chmodSync(ffmpegStatic, 0o755);
      } catch {}
      return ffmpegStatic;
    }
  } catch {}

  // 3. Fallback to system PATH ffmpeg
  return "ffmpeg";
}

function runYtDlp(videoId: string, formatString: string, extraArgs: string[] = []): Promise<string[]> {
  return new Promise((resolve) => {
    const runner = getYtDlpRunner();
    const cookiesPath = getCookiesPath();
    const cookieArgs = cookiesPath ? ["--cookies", cookiesPath] : [];

    if (cookieArgs.length > 0) {
      console.log(`[YouTube Resolve] Attached authenticated cookies to yt-dlp: ${cookiesPath}`);
    } else {
      console.log(`[YouTube Resolve] No cookies detected (running in anonymous mode)`);
    }

    const spawnArgs = [
      ...runner.prefixArgs,
      ...cookieArgs,
      "--no-playlist",
      "--no-warnings",
      "-g",
      "-f", formatString,
      ...extraArgs,
      "--",
      `https://www.youtube.com/watch?v=${videoId}`
    ];

    const ytUrlProcess = spawn(runner.command, spawnArgs);
    let stdoutData = "";
    let stderrData = "";

    const timer = setTimeout(() => {
      try {
        ytUrlProcess.kill("SIGKILL");
      } catch {}
      console.warn(`[YouTube Resolve] Timed out waiting for yt-dlp on ${videoId}`);
      resolve([]);
    }, 6000);

    ytUrlProcess.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });
    ytUrlProcess.stderr.on("data", (chunk) => {
      stderrData += chunk.toString();
    });

    ytUrlProcess.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdoutData.trim()) {
        console.warn(`[YouTube Resolve] Attempt failed for ${videoId} (code ${code}):`, stderrData.slice(0, 250));
        resolve([]);
        return;
      }
      const lines = stdoutData.trim().split(/\r?\n/).filter((l) => l.startsWith("http"));
      resolve(lines);
    });

    ytUrlProcess.on("error", (err) => {
      clearTimeout(timer);
      console.error("[YouTube Resolve] Spawn error:", err);
      resolve([]);
    });
  });
}

// ==========================================
// YOUTUBE RESOLVER ENGINE SWITCH (Backend Code)
// Priority: Innertube (VISIONOS) primary with authenticated cookies + yt-dlp fallback
// ==========================================
const USE_YOUTUBEI = true;
const USE_YTDLP = true;
const USE_PIPED = false;

const PIPED_API_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
  "https://pipedapi.leptons.xyz",
  "https://piped-api.lunar.icu",
  "https://pa.il.ax",
  "https://pipedapi.tokhmi.xyz"
];

function fetchPipedJson(url: string, timeoutMs: number = 3500): Promise<any> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const transport = parsed.protocol === "https:" ? https : http;
      const req = transport.get(
        url,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
          },
          timeout: timeoutMs
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return fetchPipedJson(res.headers.location, timeoutMs).then(resolve);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return resolve(null);
          }
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function resolveYouTubeStreamWithPiped(videoId: string, quality: string = "1080p"): Promise<CachedYtStream | null> {
  let maxH = 1080;
  if (quality === "720p") maxH = 720;
  else if (quality === "480p") maxH = 480;
  else if (quality === "360p") maxH = 360;
  else if (quality === "1080p" || quality === "auto" || quality === "high") maxH = 1080;

  for (const base of PIPED_API_INSTANCES) {
    try {
      const url = `${base.replace(/\/$/, "")}/streams/${videoId}`;
      const data = await fetchPipedJson(url, 3000);
      if (!data) continue;

      const videoStreams: any[] = data.videoStreams || [];
      const audioStreams: any[] = data.audioStreams || [];

      // Filter MP4/AVC1 videos up to maxH
      const mp4Videos = videoStreams.filter(
        (v) => v.url && v.format === "MPEG_4" && (v.height || 0) <= maxH
      );
      mp4Videos.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));

      // Best audio (prefer M4A/AAC)
      const mp4Audios = audioStreams.filter((a) => a.url && a.format === "M4A");
      mp4Audios.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      const chosenVideo = mp4Videos[0] || videoStreams.filter((v) => v.url && (v.height || 0) <= maxH)[0];
      const chosenAudio = mp4Audios[0] || audioStreams.filter((a) => a.url)[0];

      if (chosenVideo) {
        console.log(`[Piped API] Resolved ${videoId} via ${base} -> ${chosenVideo.quality || chosenVideo.height}`);
        return {
          videoUrl: chosenVideo.url,
          audioUrl: chosenAudio ? chosenAudio.url : null,
          expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
        };
      }
    } catch {}
  }

  return null;
}

let innertubeInstance: any = null;
let innertubePromise: Promise<any> | null = null;

async function getInnertube(): Promise<any> {
  if (innertubeInstance) return innertubeInstance;
  if (innertubePromise) return innertubePromise;

  innertubePromise = (async () => {
    try {
      const cookieHeader = getCookiesHeader();
      const options: any = {
        client_type: ClientType.VISIONOS
      };
      if (cookieHeader) {
        options.cookie = cookieHeader;
        console.log(`[Innertube] Initialized VISIONOS client with authenticated cookies`);
      } else {
        console.log(`[Innertube] Initialized VISIONOS client in anonymous mode`);
      }
      const yt = await Innertube.create(options);
      innertubeInstance = yt;
      return yt;
    } catch (err: any) {
      innertubePromise = null;
      throw err;
    }
  })();

  return innertubePromise;
}

async function resolveYouTubeStreamWithInnertube(videoId: string, quality: string = "1080p"): Promise<CachedYtStream | null> {
  let maxH = 1080;
  if (quality === "720p") maxH = 720;
  else if (quality === "480p") maxH = 480;
  else if (quality === "360p") maxH = 360;
  else if (quality === "1080p" || quality === "auto" || quality === "high") maxH = 1080;

  try {
    const yt = await getInnertube();
    const res = await yt.actions.execute("/player", { videoId });

    if (res.data?.playabilityStatus?.status !== "OK") {
      console.warn(`[Innertube] Playability status not OK for ${videoId}:`, res.data?.playabilityStatus?.status);
      return null;
    }

    const adaptive: any[] = res.data?.streamingData?.adaptiveFormats || [];
    const progressive: any[] = (res.data?.streamingData?.formats || []).filter((f: any) => f.url);

    // 1. Prefer standard AVC1 (H.264) video up to maxH for smooth browser hardware decoding
    const avc1Videos = adaptive.filter(
      (f: any) => f.mimeType?.includes("video/mp4") && f.mimeType?.includes("avc1") && f.height && f.height <= maxH && f.url
    );
    avc1Videos.sort((a: any, b: any) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));

    // 2. Select best audio (prefer MP4 AAC, fallback to any audio stream)
    const mp4Audios = adaptive.filter((f: any) => f.mimeType?.includes("audio/mp4") && f.url);
    mp4Audios.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
    let chosenAudio = mp4Audios[0];
    if (!chosenAudio) {
      const anyAudios = adaptive.filter((f: any) => f.mimeType?.includes("audio") && f.url);
      anyAudios.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
      chosenAudio = anyAudios[0];
    }

    let chosenVideo = avc1Videos[0];
    if (!chosenVideo) {
      const anyMp4Videos = adaptive.filter(
        (f: any) => f.mimeType?.includes("video/mp4") && f.height && f.height <= maxH && f.url
      );
      anyMp4Videos.sort((a: any, b: any) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
      chosenVideo = anyMp4Videos[0];
    }

    if (!chosenVideo) {
      const anyAdaptiveVideos = adaptive.filter(
        (f: any) => f.height && f.height <= maxH && f.url
      );
      anyAdaptiveVideos.sort((a: any, b: any) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
      chosenVideo = anyAdaptiveVideos[0];
    }

    if (chosenVideo) {
      console.log(`[Innertube] Resolved ${videoId} -> ${chosenVideo.qualityLabel || chosenVideo.height + "p"} (${chosenVideo.mimeType}) + audio itag ${chosenAudio?.itag}`);
      return {
        videoUrl: chosenVideo.url,
        audioUrl: chosenAudio ? chosenAudio.url : null,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
      };
    }

    // 3. Fallback to pre-muxed progressive format (e.g. 360p itag 18)
    if (progressive.length > 0) {
      console.log(`[Innertube] Resolved ${videoId} -> pre-muxed ${progressive[0].qualityLabel || progressive[0].height + "p"}`);
      return {
        videoUrl: progressive[0].url,
        audioUrl: null,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000
      };
    }

    return null;
  } catch (err: any) {
    console.error(`[Innertube] Error resolving ${videoId}:`, err.message);
    innertubeInstance = null;
    innertubePromise = null;
    return null;
  }
}

async function resolveYouTubeStreamWithYtDlp(videoId: string, quality: string = "1080p"): Promise<CachedYtStream | null> {
  let maxH = 1080;
  if (quality === "720p") maxH = 720;
  else if (quality === "480p") maxH = 480;
  else if (quality === "360p") maxH = 360;
  else if (quality === "1080p" || quality === "auto" || quality === "high") maxH = 1080;

  // Format selectors:
  // 1080p AVC1 video (h264) + m4a (AAC) audio - ideal for smooth browser hardware playback
  const format1080 = `bv*[height<=${maxH}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${maxH}][vcodec^=avc1]+ba/bv*[height<=${maxH}]+ba/b[height<=${maxH}][ext=mp4]/b[height<=${maxH}]/best`;
  const formatGeneric = `bv*[height<=${maxH}]+ba/b[height<=${maxH}]/best`;

  // Attempt 1: Full HD 1080p AVC1 format (with authenticated cookies if provided)
  console.log(`[YouTube Resolve] Attempt 1: 1080p AVC1 format for ${videoId} (${quality})...`);
  let lines = await runYtDlp(videoId, format1080, [
    "--extractor-args", "youtube:player_client=visionos,android_vr,tv_downgraded,web",
    "--js-runtimes", "node:node"
  ]);

  // Attempt 2: Best available stream fallback
  if (lines.length === 0) {
    console.log(`[YouTube Resolve] Attempt 2: Best available stream for ${videoId}...`);
    lines = await runYtDlp(videoId, formatGeneric, [
      "--extractor-args", "youtube:player_client=visionos,tv_downgraded,android,web"
    ]);
  }

  if (lines.length === 0) {
    console.error(`[YouTube Resolve] Both resolution attempts failed for ${videoId}`);
    return null;
  }

  let videoUrl = lines[0];
  let audioUrl = lines.length > 1 ? lines[1] : null;

  // Detect if audio came first
  if (lines.length > 1) {
    if (lines[0].includes("mime=audio") && lines[1].includes("mime=video")) {
      videoUrl = lines[1];
      audioUrl = lines[0];
    }
  }

  return {
    videoUrl,
    audioUrl,
    expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
  };
}

async function resolveYouTubeStreamUrls(videoId: string, quality: string = "1080p"): Promise<CachedYtStream | null> {
  const cacheKey = `${videoId}_${quality}`;
  const cached = ytStreamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  let result: CachedYtStream | null = null;

  if (USE_YOUTUBEI) {
    console.log(`[YouTube Resolver] Active Primary Engine: youtubei.js (Innertube VISIONOS) for ${videoId} (${quality})`);
    result = await resolveYouTubeStreamWithInnertube(videoId, quality);
    if (!result && USE_YTDLP) {
      console.warn(`[YouTube Resolver] Innertube returned no stream for ${videoId}, falling back to yt-dlp...`);
      result = await resolveYouTubeStreamWithYtDlp(videoId, quality);
    }
    if (!result && USE_PIPED) {
      console.warn(`[YouTube Resolver] yt-dlp returned no stream for ${videoId}, falling back to Piped...`);
      result = await resolveYouTubeStreamWithPiped(videoId, quality);
    }
  } else if (USE_YTDLP) {
    console.log(`[YouTube Resolver] Active Primary Engine: yt-dlp (with cookies) for ${videoId} (${quality})`);
    result = await resolveYouTubeStreamWithYtDlp(videoId, quality);
    if (!result && USE_YOUTUBEI) {
      console.warn(`[YouTube Resolver] yt-dlp returned no stream for ${videoId}, falling back to Innertube...`);
      result = await resolveYouTubeStreamWithInnertube(videoId, quality);
    }
    if (!result && USE_PIPED) {
      console.warn(`[YouTube Resolver] Innertube returned no stream for ${videoId}, falling back to Piped...`);
      result = await resolveYouTubeStreamWithPiped(videoId, quality);
    }
  } else {
    console.log(`[YouTube Resolver] Active Primary Engine: Piped REST API for ${videoId} (${quality})`);
    result = await resolveYouTubeStreamWithPiped(videoId, quality);
    if (!result && USE_YOUTUBEI) {
      console.warn(`[YouTube Resolver] Piped API returned no stream for ${videoId}, falling back to Innertube...`);
      result = await resolveYouTubeStreamWithInnertube(videoId, quality);
    }
    if (!result && USE_YTDLP) {
      console.warn(`[YouTube Resolver] Innertube returned no stream for ${videoId}, falling back to yt-dlp...`);
      result = await resolveYouTubeStreamWithYtDlp(videoId, quality);
    }
  }

  if (result) {
    ytStreamCache.set(cacheKey, result);
  }
  return result;
}

async function handleYouTubeStream(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: any) {
  let rawId = (parsedUrl.query?.id as string | undefined)?.trim() || "";
  let videoId = extractYouTubeId(rawId);
  if (!videoId) {
    const idMatch = rawId.match(/([a-zA-Z0-9_-]{11})/);
    videoId = idMatch ? idMatch[1] : null;
  }
  if (!videoId) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid or missing YouTube video id");
    return;
  }

  const quality = ((parsedUrl.query?.quality as string) || "1080p").toLowerCase();
  const startTime = Math.max(0, parseFloat((parsedUrl.query?.t || parsedUrl.query?.start || 0) as string) || 0);

  console.log(`[YouTube Stream] Serving videoId: ${videoId}, quality: ${quality}, startTime: ${startTime}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Check if fully pre-transcoded / cached file is available on disk for instant local Range streaming
  const diskCachePath = path.join(CACHE_DIR, `yt_${videoId}_${quality}.mp4`);
  if (fs.existsSync(diskCachePath)) {
    try {
      const stat = fs.statSync(diskCachePath);
      if (stat.size > 1024 * 512) {
        serveLocalMediaFile(req, res, diskCachePath, "video/mp4");
        return;
      }
    } catch {}
  }

  const streamInfo = await resolveYouTubeStreamUrls(videoId, quality);
  if (!streamInfo) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Failed to resolve YouTube stream directly from link");
    }
    return;
  }

  // Pre-muxed format (single combined MP4 stream with both video and audio):
  // Proxy directly with Range headers! 0% CPU, no stalls, instant seeking!
  if (!streamInfo.audioUrl && startTime === 0) {
    proxyRemoteMediaStream(streamInfo.videoUrl, req, res, "video/mp4");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Accept",
    "Cache-Control": "no-cache, no-store",
    "Connection": "keep-alive"
  });

  const ffmpegArgs: string[] = [
    "-hide_banner",
    "-loglevel", "error",
    "-probesize", "1000000",
    "-analyzeduration", "1000000",
    "-fflags", "+genpts+discardcorrupt",
    "-reconnect", "1",
    "-reconnect_at_eof", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-headers", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n"
  ];

  if (startTime > 0) {
    ffmpegArgs.push("-ss", String(startTime));
  }
  ffmpegArgs.push("-i", streamInfo.videoUrl);

  if (streamInfo.audioUrl) {
    if (startTime > 0) {
      ffmpegArgs.push("-ss", String(startTime));
    }
    ffmpegArgs.push(
      "-reconnect", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",
      "-headers", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n",
      "-i", streamInfo.audioUrl,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ac", "2",
      "-max_muxing_queue_size", "4096",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-f", "mp4",
      "pipe:1"
    );
  } else {
    ffmpegArgs.push(
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ac", "2",
      "-max_muxing_queue_size", "4096",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-f", "mp4",
      "pipe:1"
    );
  }

  const ffmpegCmd = getFfmpegCommand();
  const ffmpeg = spawn(ffmpegCmd, ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });
  ffmpeg.stdout.pipe(res);

  ffmpeg.on("error", (err) => {
    console.error("FFmpeg direct YouTube stream error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Direct stream error");
    }
  });

  req.on("close", () => {
    try {
      ffmpeg.kill("SIGKILL");
    } catch {}
  });
}

function handleMessage(client: ClientSession, raw: any) {
  if (!raw) return;
  const rawStr = typeof raw === "string" ? raw : raw.toString();
  if (rawStr.length > MAX_MESSAGE_SIZE) return;

  // Any message received resets ping counters and keeps connection alive
  if (client.socket) {
    (client.socket as any).isAlive = true;
    (client.socket as any).missedPings = 0;
  }

  let message: any;
  try {
    message = JSON.parse(rawStr);
  } catch {
    return;
  }

  const room = client.room;
  console.log("WS RECV:", message.type, "client:", client.id);
  switch (message.type) {
    case "create-room":
    case "create": {
      const name = cleanString(message.name || message.theatreName, 60);
      const username = cleanUsername(message.username) || client.username;
      client.username = username;
      client.characterType = cleanString(message.characterType || "character_406814", 32);
      const newRoom = createRoom(client, { name, isPublic: message.isPublic !== false });
      joinRoom(client, newRoom, username, newRoom.hostSecret);
      break;
    }

    case "join-room":
    case "join": {
      const roomId = cleanString(message.roomId || message.room, 10).toUpperCase();
      const targetRoom = rooms.get(roomId);
      if (!targetRoom) {
        send(client, { type: "error", message: `Theatre "${roomId}" not found.` });
        return;
      }
      const username = cleanUsername(message.username) || client.username;
      const providedSecret = cleanString(message.hostSecret, 64) || undefined;
      client.characterType = cleanString(message.characterType || "character_406814", 32);
      try {
        joinRoom(client, targetRoom, username, providedSecret);
      } catch (err: any) {
        send(client, { type: "error", message: err.message });
      }
      break;
    }

    case "list-rooms": {
      send(client, {
        type: "room-list",
        rooms: getPublicRooms()
      });
      break;
    }

    case "leave": {
      leaveRoom(client, true);
      break;
    }

    case "move": {
      if (!room || client.seated) return;
      if (message.position) {
        client.position = {
          x: Number(message.position.x) || 0,
          y: Number(message.position.y) || 0,
          z: Number(message.position.z) || 0
        };
      }
      if (typeof message.rotation === "number") {
        client.rotation = message.rotation;
      }
      if (typeof message.headPitch === "number") {
        client.headPitch = message.headPitch;
      }
      if (typeof message.headYaw === "number") {
        client.headYaw = message.headYaw;
      }
      if (typeof message.action === "string") {
        client.action = cleanString(message.action, 24);
      }
      broadcast(room, {
        type: "user-moved",
        userId: client.id,
        position: client.position,
        rotation: client.rotation,
        headPitch: client.headPitch,
        headYaw: client.headYaw,
        action: client.action
      }, client.id);
      break;
    }

    case "emote": {
      if (!room) return;
      const emote = cleanString(message.emote || message.action, 24) || "clap";
      broadcast(room, {
        type: "user-emote",
        userId: client.id,
        action: emote,
        emote
      }, client.id);
      break;
    }

    case "take-seat":
    case "sit": {
      if (!room) return;
      const seatIndex = Number(message.seat ?? message.seatIndex ?? message.seatId);
      if (isNaN(seatIndex)) return;

      const currentOccupant = room.seats.get(seatIndex);
      if (currentOccupant && currentOccupant !== client.id) {
        send(client, { type: "error", message: "Seat already taken." });
        return;
      }

      // Do not allow switching seats while seated (user must click Stand Up first)
      if (client.seatIndex !== null) {
        return;
      }

      client.seated = true;
      client.seatIndex = seatIndex;
      room.seats.set(seatIndex, client.id);

      broadcast(room, {
        type: "seat-update",
        seatId: seatIndex,
        userId: client.id,
        username: client.username
      });
      break;
    }

    case "stand": {
      if (!room || !client.seated) return;
      const prevSeat = client.seatIndex;
      client.seated = false;
      client.seatIndex = null;
      if (prevSeat !== null) {
        room.seats.delete(prevSeat);
        broadcast(room, {
          type: "seat-update",
          seatId: prevSeat,
          userId: null,
          username: null
        });
      }
      break;
    }

    case "chat": {
      if (!room) return;
      const text = cleanString(message.text, 300);
      if (!text) return;
      broadcast(room, {
        type: "chat",
        id: generateId(),
        userId: client.id,
        username: client.username,
        text,
        timestamp: Date.now()
      });
      break;
    }

    case "playback": {
      if (!room || room.hostId !== client.id) return;
      const action = message.action;
      const movie = room.movie;
      const now = Date.now();

      if (message.url) {
        const rawUrl = String(message.url).trim();
        const ytId = extractYouTubeId(rawUrl);
        if (ytId) {
          const title = cleanString(message.title, 100) || "YouTube Video";
          movie.url = `https://www.youtube.com/watch?v=${ytId}`;
          movie.title = title;
          movie.time = 0;
          movie.playing = true;
          movie.updatedAt = now;
          broadcast(room, {
            type: "movie-loaded",
            movie: movieState(room)
          });
          broadcast(room, {
            type: "chat",
            id: generateId(),
            system: true,
            text: `[Stream] Playing "${title}" from YouTube!`,
            timestamp: Date.now()
          });
          return;
        }

        const gdriveId = extractGoogleDriveId(rawUrl);
        if (gdriveId) {
          const title = cleanString(message.title, 100) || "Google Drive Movie";
          movie.url = `/api/gdrive-stream?id=${gdriveId}`;
          movie.title = title;
          movie.time = 0;
          movie.playing = true;
          movie.updatedAt = now;
          broadcast(room, {
            type: "movie-loaded",
            movie: movieState(room)
          });
          broadcast(room, {
            type: "chat",
            id: generateId(),
            system: true,
            text: `[Stream] Playing "${title}" from Google Drive!`,
            timestamp: Date.now()
          });
          return;
        }

        const url = validVideoURL(rawUrl);
        if (!url) {
          send(client, { type: "error", message: "Invalid video URL." });
          return;
        }
        movie.url = url;
        movie.title = cleanString(message.title, 100) || "Shared Movie";
        movie.time = 0;
        movie.playing = true;
        movie.updatedAt = now;
        broadcast(room, {
          type: "movie-loaded",
          movie: movieState(room)
        });
        return;
      }

      switch (action) {
        case "sync":
        case "heartbeat":
          // Heartbeat only anchors the clock. Play/pause state changes ONLY via explicit host play/pause actions,
          // so a transient local pause (buffering, loading, autoplay policy) can never pause the whole theatre.
          if (typeof message.time === "number" && isFinite(message.time)) {
            movie.time = Math.max(0, message.time);
            movie.updatedAt = now;
          }
          return;
        case "play":
          movie.playing = true;
          movie.time = Math.max(0, Number(message.time) || 0);
          break;
        case "pause":
          movie.playing = false;
          movie.time = Math.max(0, Number(message.time) || movie.time);
          break;
        case "seek":
          movie.time = Math.max(0, Number(message.time) || 0);
          break;
        case "volume":
          {
            const v = Number(message.volume);
            movie.volume = isFinite(v) ? Math.min(1.5, Math.max(0, v)) : (movie.volume ?? 0.8);
          }
          break;
      }
      if (action !== "volume") {
        movie.updatedAt = now;
      }

      broadcast(room, {
        type: "movie-state",
        state: movieState(room),
        action,
        by: client.username
      });
      break;
    }

    case "lighting":
    case "lighting-update": {
      if (!room || room.hostId !== client.id) return;
      if (!room.lighting) {
        room.lighting = { ...DEFAULT_LIGHTING };
      }
      const update = message.lighting;
      if (update) {
        if (typeof update.ceiling === "boolean") room.lighting.ceiling = update.ceiling;
        if (typeof update.stairs === "boolean") room.lighting.stairs = update.stairs;
        if (typeof update.belowScreen === "boolean") room.lighting.belowScreen = update.belowScreen;
        const validSideModes: SideLightMode[] = [
          "on",
          "off",
          "wave",
          "hero_entry",
          "pulse",
          "chase",
          "strobe",
          "rainbow",
          "fire",
          "ambilight_sync"
        ];
        if (validSideModes.includes(update.sideLights)) {
          room.lighting.sideLights = update.sideLights;
        }
      }
      broadcast(room, {
        type: "lighting-state",
        lighting: room.lighting,
        by: client.username
      });
      break;
    }

    case "voice-join": {
      if (!room) return;
      client.inVoice = true;
      const voicePeers = [...room.users.values()]
        .filter((u) => u.id !== client.id && u.inVoice)
        .map((u) => u.id);
      send(client, { type: "voice-peers", peers: voicePeers });
      broadcast(room, { type: "voice-peer-joined", userId: client.id }, client.id);
      break;
    }

    case "voice-leave": {
      if (!room) return;
      client.inVoice = false;
      client.speaking = false;
      broadcast(room, { type: "voice-peer-left", userId: client.id }, client.id);
      break;
    }

    case "webrtc-offer": {
      if (!room) return;
      const target = room.users.get(message.target);
      if (target) {
        send(target, {
          type: "webrtc-offer",
          from: client.id,
          offer: message.offer || message.sdp
        });
      }
      break;
    }

    case "webrtc-answer": {
      if (!room) return;
      const target = room.users.get(message.target);
      if (target) {
        send(target, {
          type: "webrtc-answer",
          from: client.id,
          answer: message.answer || message.sdp
        });
      }
      break;
    }

    case "webrtc-ice": {
      if (!room) return;
      const target = room.users.get(message.target);
      if (target) {
        send(target, {
          type: "webrtc-ice",
          from: client.id,
          candidate: message.candidate
        });
      }
      break;
    }

    case "speaking": {
      if (!room) return;
      client.speaking = Boolean(message.speaking);
      broadcast(room, {
        type: "voice-state",
        userId: client.id,
        speaking: client.speaking
      });
      break;
    }

    case "voice-state": {
      if (!room) return;
      if (typeof message.muted === "boolean") client.muted = message.muted;
      if (typeof message.speaking === "boolean") client.speaking = message.speaking;
      broadcast(room, {
        type: "voice-state",
        userId: client.id,
        muted: client.muted,
        speaking: client.speaking
      });
      break;
    }

    case "ping":
    case "heartbeat": {
      if (client.socket) {
        (client.socket as any).isAlive = true;
      }
      send(client, { type: "pong", time: Date.now() });
      break;
    }
  }
}

function handleConnection(socket: WebSocket) {
  const client: ClientSession = {
    id: generateId(),
    socket,
    username: `Guest${Math.floor(Math.random() * 9000 + 1000)}`,
    characterType: "character_406814",
    headPitch: 0,
    headYaw: 0,
    action: "idle",
    room: null,
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    colorIndex: 0,
    isHost: false,
    seated: false,
    seatIndex: null,
    speaking: false,
    muted: true,
    inVoice: false,
    position: { x: -7.7, y: 0.55, z: -3.5 },
    rotation: 0,
    joinedAt: Date.now(),
    isAlive: true
  };
  clients.set(client.id, client);

  (socket as any).isAlive = true;
  socket.on("pong", () => {
    (socket as any).isAlive = true;
  });

  socket.on("message", (raw) => handleMessage(client, raw));
  socket.on("close", () => handleDisconnect(client));
  socket.on("error", (error) => {
    console.error(`Client error (${client.id}):`, error.message);
    handleDisconnect(client);
  });

  send(client, {
    type: "connected",
    userId: client.id,
    rooms: getPublicRooms(),
    config: { iceServers: ICE_SERVERS }
  });
}

interface TranscodeJob {
  fileId: string;
  cachePath: string;
  tempPath: string;
  isComplete: boolean;
  process?: any;
  error?: string;
}

const activeTranscodeJobs = new Map<string, TranscodeJob>();

function startGdriveTranscodeJob(fileId: string, rawUrl: string): TranscodeJob {
  const cachePath = path.join(CACHE_DIR, `gdrive-${fileId}.mp4`);
  const tempPath = path.join(CACHE_DIR, `gdrive-${fileId}.tmp.mp4`);

  if (fs.existsSync(cachePath)) {
    const existingJob = activeTranscodeJobs.get(fileId);
    if (existingJob?.isComplete) {
      return existingJob;
    }
    const job: TranscodeJob = { fileId, cachePath, tempPath, isComplete: true };
    activeTranscodeJobs.set(fileId, job);
    return job;
  }

  const existingJob = activeTranscodeJobs.get(fileId);
  if (existingJob && !existingJob.error && existingJob.process) {
    return existingJob;
  }

  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch {}

  const ffmpegArgs = [
    "-y",
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-headers", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n",
    "-i", rawUrl,
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "256k",
    "-ac", "2",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    tempPath
  ];

  console.log(`[GDrive Transcode] Starting background transcode for ${fileId}...`);
  const ffmpegCmd = getFfmpegCommand();
  const child = spawn(ffmpegCmd, ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });

  const job: TranscodeJob = {
    fileId,
    cachePath,
    tempPath,
    isComplete: false,
    process: child
  };
  activeTranscodeJobs.set(fileId, job);

  child.on("close", (code) => {
    if (code === 0 && fs.existsSync(tempPath)) {
      try {
        fs.renameSync(tempPath, cachePath);
        job.isComplete = true;
        job.process = undefined;
        console.log(`[GDrive Transcode] Completed transcode for ${fileId}! Cached to ${cachePath}`);
      } catch (err: any) {
        console.error(`[GDrive Transcode] Rename error for ${fileId}:`, err.message);
      }
    } else {
      job.error = `FFmpeg exited with code ${code}`;
      console.error(`[GDrive Transcode] Failed for ${fileId}: ${job.error}`);
    }
  });

  child.on("error", (err) => {
    job.error = err.message;
    console.error(`[GDrive Transcode] Process error for ${fileId}:`, err);
  });

  return job;
}

function serveRangeFromFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
  isComplete: boolean
) {
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
    res.setHeader("Accept-Ranges", "bytes");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start >= fileSize) {
        res.writeHead(416, {
          "Content-Range": isComplete ? `bytes */${fileSize}` : `bytes */*`,
          "Content-Type": "text/plain"
        });
        res.end("Requested range not satisfiable");
        return;
      }

      if (end >= fileSize) {
        end = fileSize - 1;
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": isComplete ? `bytes ${start}-${end}/${fileSize}` : `bytes ${start}-${end}/*`,
        "Content-Length": chunkSize,
        "Content-Type": "video/mp4"
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4"
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err: any) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`File stream error: ${err.message}`);
    }
  }
}

function handleVideoProxy(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: any) {
  const targetUrl = parsedUrl.query?.url;
  if (!targetUrl || typeof targetUrl !== "string") {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing url parameter");
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  let customReferer = (parsedUrl.query?.referer as string) || (req.headers["x-referer"] as string) || "";
  try {
    const pTarget = new URL(targetUrl);
    if (!customReferer) {
      if (pTarget.hostname.includes("birchbarkandbloom.space")) {
        customReferer = "https://stellarconductornexus.com/";
      } else if (
        pTarget.hostname.includes("megacloud") ||
        pTarget.hostname.includes("dokicloud") ||
        pTarget.hostname.includes("rabbitstream") ||
        pTarget.hostname.includes("vidcloud") ||
        pTarget.hostname.includes("cinehd")
      ) {
        customReferer = `https://${pTarget.hostname}/`;
      }
    }
  } catch {}

  proxyRemoteMediaStream(targetUrl, req, res, "video/mp4", customReferer);
}

interface GdriveResolved {
  directUrl: string;
  cookies: string;
  expiresAt: number;
}
const gdriveResolvedCache = new Map<string, GdriveResolved>();

async function handleGdriveStream(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: any) {
  let fileId = (parsedUrl.query?.id as string | undefined)?.trim();
  const inputUrl = parsedUrl.query?.url as string | undefined;

  if (!fileId && inputUrl) {
    fileId = extractGoogleDriveId(inputUrl) || undefined;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
  res.setHeader("Accept-Ranges", "bytes");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!fileId) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing Google Drive file id");
    return;
  }

  // Exact-case normalizer for known Google Drive shared videos (prevents 403 / 404 from case typos)
  const KNOWN_ID_CORRECTIONS: Record<string, string> = {
    "1eqj8g_jl4hggwe9bo8rtg51l9markd5e": "1EQJ8G_jL4HGgwe9BO8rtg51l9MaRkd5e",
    "17glrpviqren4fttfepm77b9qut2kebg2": "17gLrpViQreN4ftTfEpm77B9quT2KeBg2",
    "1xqgtfj4k92_hsvbwvv-zdja7xo65epzs": "1xqgTfj4k92_hsvbWvv-ZdJA7xO65ePzS"
  };

  if (KNOWN_ID_CORRECTIONS[fileId.toLowerCase()]) {
    fileId = KNOWN_ID_CORRECTIONS[fileId.toLowerCase()];
  }

  // Check if fully transcoded / cached MP4 file is available on disk for instant local Range streaming
  let diskCachePath = path.join(CACHE_DIR, `gdrive-${fileId}.mp4`);
  if (!fs.existsSync(diskCachePath) && fs.existsSync(CACHE_DIR)) {
    try {
      const files = fs.readdirSync(CACHE_DIR);
      const targetLower = `gdrive-${fileId.toLowerCase()}.mp4`;
      const match = files.find((f) => f.toLowerCase() === targetLower);
      if (match) {
        diskCachePath = path.join(CACHE_DIR, match);
      }
    } catch {}
  }

  if (fs.existsSync(diskCachePath)) {
    try {
      const stat = fs.statSync(diskCachePath);
      if (stat.size > 1024 * 512) {
        console.log(`[GDrive Stream] Serving cached transcoded file for ${fileId} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
        serveRangeFromFile(req, res, diskCachePath, true);
        return;
      }
    } catch {}
  }

  const clientRange = req.headers.range as string | undefined;

  // Use cached direct CDN URL to serve subsequent Range chunks with zero redirect latency & zero rate-limiting
  const cached = gdriveResolvedCache.get(fileId);
  const initialUrl = (cached && cached.expiresAt > Date.now())
    ? cached.directUrl
    : `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
  const initialCookies = (cached && cached.expiresAt > Date.now()) ? cached.cookies : "";

  function fetchStream(targetUrl: string, cookieHeader = "", redirectCount = 0) {
    if (redirectCount > 6) {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Too many redirects from Google Drive");
      }
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid Google Drive redirect URL");
      }
      return;
    }

    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "*/*"
    };
    if (cookieHeader) headers["Cookie"] = cookieHeader;
    if (clientRange) headers["Range"] = clientRange;

    const transport = parsed.protocol === "http:" ? http : https;
    const proxyReq = transport.request(targetUrl, { method: req.method || "GET", headers }, (proxyRes) => {
      const setCookies = proxyRes.headers["set-cookie"] || [];
      const newCookies = Array.isArray(setCookies)
        ? setCookies.map((c) => c.split(";")[0]).join("; ")
        : String(setCookies).split(";")[0];
      const mergedCookies = cookieHeader
        ? (newCookies ? `${cookieHeader}; ${newCookies}` : cookieHeader)
        : newCookies;

      // Handle direct CDN redirect (doc-XX-XX-docs.googleusercontent.com)
      if ([301, 302, 303, 307].includes(proxyRes.statusCode || 0) && proxyRes.headers.location) {
        proxyReq.destroy();
        const nextLoc = proxyRes.headers.location;
        // Cache redirected CDN link for subsequent Range requests
        if (nextLoc.includes("googleusercontent.com") || nextLoc.includes("videoplayback")) {
          gdriveResolvedCache.set(fileId!, {
            directUrl: nextLoc,
            cookies: mergedCookies,
            expiresAt: Date.now() + 3 * 3600 * 1000 // 3 hours
          });
        }
        return fetchStream(nextLoc, mergedCookies, redirectCount + 1);
      }

      // If cached URL returned 403 or 404 (expired direct token), clear cache and retry from scratch
      if ((proxyRes.statusCode === 403 || proxyRes.statusCode === 404) && cached && targetUrl === cached.directUrl) {
        gdriveResolvedCache.delete(fileId!);
        proxyReq.destroy();
        const fallbackUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
        return fetchStream(fallbackUrl, "", 0);
      }

      const upstreamType = proxyRes.headers["content-type"] || "";

      // Large file virus-scan confirmation form handling
      if (upstreamType.includes("html")) {
        let body = "";
        proxyRes.setEncoding("utf8");
        proxyRes.on("data", (chunk) => { body += chunk; });
        proxyRes.on("end", () => {
          const confirmMatch = body.match(/name="confirm"\s+value="([^"]+)"/i) ||
            body.match(/confirm=([0-9A-Za-z_-]+)/i) ||
            body.match(/id="uc-download-link"[^>]*href="([^"]+)"/i);
          const uuidMatch = body.match(/name="uuid"\s+value="([^"]+)"/i) || body.match(/uuid=([0-9A-Za-z_-]+)/i);

          if (confirmMatch && redirectCount < 5) {
            const confirmVal = confirmMatch[1];
            const uuidVal = uuidMatch ? uuidMatch[1] : "";
            let nextUrl = confirmVal.startsWith("http")
              ? confirmVal.replace(/&amp;/g, "&")
              : `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmVal}`;
            if (uuidVal && !nextUrl.includes("uuid=")) {
              nextUrl += `&uuid=${uuidVal}`;
            }
            if (confirmVal.startsWith("/")) {
              nextUrl = `https://drive.usercontent.google.com${confirmVal.replace(/&amp;/g, "&")}`;
            }
            return fetchStream(nextUrl, mergedCookies, redirectCount + 1);
          }

          console.warn(`[GDrive Stream] Google Drive access error or quota exceeded for ${fileId}`);
          if (!res.headersSent) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Google Drive download quota exceeded or file is not publicly shared.");
          }
        });
        return;
      }

      const contentDisposition = String(proxyRes.headers["content-disposition"] || "");
      const isEac3OrMkv =
        upstreamType.includes("matroska") ||
        upstreamType.includes("mkv") ||
        contentDisposition.toLowerCase().includes(".mkv") ||
        parsedUrl.pathname === "/api/eac3-stream" ||
        parsedUrl.query?.eac3 === "1" ||
        parsedUrl.query?.audio === "aac";

      // If Google Drive file has MKV container or EAC3/AC3 audio, remux on-the-fly to AAC stereo
      if (isEac3OrMkv) {
        console.log(`[GDrive Stream] Detected MKV / EAC3 audio container for ${fileId}. Remuxing audio on-the-fly to AAC stereo via pipe:0...`);

        // Cache successful direct stream URL for future seeks
        gdriveResolvedCache.set(fileId!, {
          directUrl: targetUrl,
          cookies: mergedCookies,
          expiresAt: Date.now() + 3 * 3600 * 1000
        });

        const cachePath = path.join(CACHE_DIR, `gdrive-${fileId}.mp4`);
        const tempPath = path.join(CACHE_DIR, `gdrive-${fileId}.tmp.mp4`);

        res.writeHead(200, {
          "Content-Type": "video/mp4",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type, Accept",
          "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
          "Cache-Control": "no-cache, no-store",
          "Connection": "keep-alive"
        });

        const ffmpegArgs: string[] = [
          "-hide_banner",
          "-loglevel", "error",
          "-i", "pipe:0",
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "192k",
          "-ac", "2",
          "-max_muxing_queue_size", "4096",
          "-movflags", "frag_keyframe+empty_moov+default_base_moof",
          "-f", "mp4",
          "pipe:1"
        ];

        const ffmpegCmd = getFfmpegCommand();
        const ff = spawn(ffmpegCmd, ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });

        let fileOut: fs.WriteStream | null = null;
        try {
          fileOut = fs.createWriteStream(tempPath);
        } catch {}

        proxyRes.pipe(ff.stdin);
        ff.stdout.pipe(res);
        if (fileOut) {
          ff.stdout.pipe(fileOut);
        }

        ff.stderr.on("data", (chunk) => {
          console.warn(`[GDrive Stream] ffmpeg stderr for ${fileId}:`, chunk.toString().slice(0, 200));
        });

        ff.on("close", (code) => {
          if (fileOut) {
            fileOut.close(() => {
              if (code === 0 && fs.existsSync(tempPath)) {
                try {
                  const stat = fs.statSync(tempPath);
                  if (stat.size > 1024 * 512) {
                    fs.renameSync(tempPath, cachePath);
                    console.log(`[GDrive Stream] Successfully cached transcoded MP4 to ${cachePath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
                  }
                } catch (err: any) {
                  console.warn(`[GDrive Stream] Rename error for ${fileId}:`, err.message);
                }
              }
            });
          }
        });

        ff.on("error", (err) => {
          console.error(`[GDrive Stream] FFmpeg EAC3 transcode spawn error for ${fileId}:`, err.message);
          try { proxyReq.destroy(); } catch {}
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("EAC3 audio transcode error");
          } else {
            res.end();
          }
        });

        proxyRes.on("error", (err) => {
          console.error(`[GDrive Stream] Upstream proxy error for ${fileId}:`, err.message);
          try { ff.kill("SIGKILL"); } catch {}
        });

        req.on("close", () => {
          try { ff.kill("SIGKILL"); } catch {}
          try { proxyReq.destroy(); } catch {}
          if (fileOut) {
            try { fileOut.destroy(); } catch {}
          }
        });

        return;
      }

      const statusCode = proxyRes.statusCode || 200;
      const resHeaders: Record<string, string | string[]> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type, Accept",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        "Accept-Ranges": "bytes"
      };

      if (!upstreamType || upstreamType === "application/octet-stream") {
        resHeaders["Content-Type"] = "video/mp4";
      } else {
        resHeaders["Content-Type"] = upstreamType;
      }

      if (proxyRes.headers["content-length"]) {
        resHeaders["Content-Length"] = proxyRes.headers["content-length"];
      }
      if (proxyRes.headers["content-range"]) {
        resHeaders["Content-Range"] = proxyRes.headers["content-range"];
      }

      // Cache successful direct stream URL
      if (statusCode === 200 || statusCode === 206) {
        gdriveResolvedCache.set(fileId!, {
          directUrl: targetUrl,
          cookies: mergedCookies,
          expiresAt: Date.now() + 3 * 3600 * 1000
        });
      }

      res.writeHead(statusCode, resHeaders);
      proxyRes.pipe(res);

      proxyRes.on("error", (err) => {
        console.error(`[GDrive Stream] Upstream stream pipe error for ${fileId}:`, err.message);
        try { res.destroy(); } catch {}
      });

      res.on("close", () => {
        try { proxyRes.destroy(); } catch {}
        try { proxyReq.destroy(); } catch {}
      });
    });

    proxyReq.on("error", (err) => {
      console.error(`[GDrive Stream] Error for ${fileId}:`, err.message);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(`Google Drive stream error: ${err.message}`);
      }
    });

    req.on("close", () => {
      proxyReq.destroy();
    });

    proxyReq.end();
  }

  fetchStream(initialUrl, initialCookies);
}

// Next.js App Initialization
const app = next({ dev, dir: process.cwd() });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    if (parsedUrl.pathname === "/health" || parsedUrl.pathname === "/api/health") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        status: "ok",
        uptime: Math.floor(process.uptime()),
        clients: wss.clients.size,
        timestamp: Date.now()
      }));
      return;
    }
    if (parsedUrl.pathname === "/api/debug-status") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      const cookieHeader = getCookiesHeader();
      const ffmpegCmd = getFfmpegCommand();
      let ffmpegVersion = "unknown";
      try {
        const result = spawnSync(ffmpegCmd, ["-version"], { encoding: "utf8", timeout: 2000 });
        if (result.stdout) {
          ffmpegVersion = result.stdout.split("\n")[0].trim();
        } else if (result.stderr) {
          ffmpegVersion = `stderr: ${result.stderr.slice(0, 100)}`;
        } else if (result.error) {
          ffmpegVersion = `error: ${result.error.message}`;
        }
      } catch (e: any) {
        ffmpegVersion = `exception: ${e.message}`;
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        status: "ok",
        platform: process.platform,
        ffmpeg: {
          cmd: ffmpegCmd,
          version: ffmpegVersion,
          localBinExists: fs.existsSync(path.join(process.cwd(), "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"))
        },
        activeEngines: {
          USE_YOUTUBEI,
          USE_YTDLP,
          USE_PIPED
        },
        cookies: {
          hasEnv: !!(process.env.YOUTUBE_COOKIES || process.env.YTDLP_COOKIES || process.env.COOKIES_CONTENT),
          cookiesPath: getCookiesPath(),
          cookieCount: cookieHeader ? cookieHeader.split(";").length : 0
        },
        uptime: Math.floor(process.uptime()),
        timestamp: Date.now()
      }));
      return;
    }
    if (parsedUrl.pathname === "/sw.js") {
      const swPath = path.join(process.cwd(), "public", "sw.js");
      if (fs.existsSync(swPath)) {
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Service-Worker-Allowed": "/",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        });
        fs.createReadStream(swPath).pipe(res);
        return;
      }
    }
    if (parsedUrl.pathname === "/api/video-proxy") {
      handleVideoProxy(req, res, parsedUrl);
      return;
    }
    if (parsedUrl.pathname === "/api/gdrive-stream" || parsedUrl.pathname === "/api/eac3-stream") {
      handleGdriveStream(req, res, parsedUrl);
      return;
    }
    if (parsedUrl.pathname === "/api/youtube-stream") {
      handleYouTubeStream(req, res, parsedUrl);
      return;
    }
    if (parsedUrl.pathname && parsedUrl.pathname.startsWith("/assets/movies/")) {
      const subPath = parsedUrl.pathname.replace(/^\/assets\/movies\//, "");
      const cachePath = path.join(CACHE_DIR, subPath);
      const publicPath = path.join(process.cwd(), "public", "assets", "movies", subPath);

      if (fs.existsSync(cachePath) && fs.statSync(cachePath).isFile()) {
        serveLocalMediaFile(req, res, cachePath, "video/mp4");
        return;
      }
      if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
        serveLocalMediaFile(req, res, publicPath, "video/mp4");
        return;
      }

      // High-availability CDN fallback if local sample movie is not yet downloaded or ephemeral
      if (subPath.toLowerCase().includes("big_buck_bunny")) {
        console.log("[Media Server] Local Big Buck Bunny file not found on disk; streaming from CDN fallback...");
        proxyRemoteMediaStream("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4", req, res, "video/mp4");
        return;
      }
      if (subPath.toLowerCase().includes("sintel")) {
        console.log("[Media Server] Local Sintel file not found on disk; streaming from CDN fallback...");
        proxyRemoteMediaStream("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4", req, res, "video/mp4");
        return;
      }
    }
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", handleConnection);

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "", true);
    if (pathname && pathname.startsWith("/_next/")) {
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  // 20-second WebSocket heartbeat interval with 3-miss tolerance (60s grace) to prevent premature disconnection
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((socket: any) => {
      if (socket.isAlive === false) {
        socket.missedPings = (socket.missedPings || 0) + 1;
        if (socket.missedPings >= 3) {
          return socket.terminate();
        }
      } else {
        socket.missedPings = 0;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 20000);

  // Automatic 10-second background self-ping if deployed on Render to keep instance from sleeping
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;
  let renderKeepAliveTimer: NodeJS.Timeout | null = null;
  if (renderExternalUrl) {
    const healthUrl = `${renderExternalUrl.replace(/\/$/, "")}/api/health`;
    console.log(`[Render Keep-Alive] Automatic 10s health ping active for ${healthUrl}`);
    renderKeepAliveTimer = setInterval(() => {
      try {
        const parsed = new URL(healthUrl);
        const transport = parsed.protocol === "https:" ? https : http;
        const pingReq = transport.get(healthUrl, (res) => {
          res.resume();
        });
        pingReq.on("error", () => {});
      } catch {}
    }, 10000);
  }

  // High-precision periodic movie synchronization (keeps all clients strictly in sync without drift)
  const movieSyncInterval = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.users.size > 0 && room.movie.url) {
        const elapsed = room.movie.playing ? (now - room.movie.updatedAt) / 1000 : 0;
        const curTime = Math.max(0, room.movie.time + elapsed);
        broadcast(room, {
          type: "movie-sync",
          time: curTime,
          playing: room.movie.playing,
          volume: room.movie.volume,
          serverTime: now
        });
      }
    }
  }, 1500);

  server.listen(PORT, HOST, () => {
    console.log(`> Virtual Cinema Next.js server ready at http://localhost:${PORT}`);
  });

  process.on("SIGINT", () => {
    clearInterval(heartbeatInterval);
    clearInterval(movieSyncInterval);
    if (renderKeepAliveTimer) clearInterval(renderKeepAliveTimer);
    wss.close();
    server.close(() => process.exit(0));
  });
});
