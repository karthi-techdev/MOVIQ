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
  const room: RoomSession = {
    id: makeRoomId(),
    name: cleanString(data.name, 60) || "Midnight Premiere",
    public: data.isPublic !== false,
    hostId: owner.id,
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

function joinRoom(client: ClientSession, room: RoomSession, username: string) {
  leaveRoom(client, false);
  if (room.users.size >= (room.maxUsers || MAX_USERS_PER_ROOM)) {
    throw new Error("This theatre is full.");
  }
  client.username = cleanUsername(username) || client.username;
  client.room = room;
  client.colorIndex = room.users.size % AVATAR_COLORS.length;
  client.avatarColor = AVATAR_COLORS[client.colorIndex];
  room.users.set(client.id, client);

  if (!room.lighting) {
    room.lighting = { ...DEFAULT_LIGHTING };
  }

  // Send joined confirmation with full room snapshot
  send(client, {
    type: "joined",
    userId: client.id,
    selfId: client.id,
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

  // Promote next host if host left
  if (wasHost && room.users.size > 0) {
    const nextHost = room.users.values().next().value;
    if (nextHost) {
      room.hostId = nextHost.id;
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

  if (room.users.size === 0) {
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
  defaultContentType = "video/mp4"
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
        proxyRemoteMediaStream(proxyRes.headers.location, req, res, defaultContentType);
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

function getYtDlpRunner(): { command: string; prefixArgs: string[] } {
  // 1. Check local standalone binary in bin/yt-dlp (downloaded by install-ytdlp.js on Render)
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
  const localBin = path.join(process.cwd(), "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (fs.existsSync(localBin)) {
    try {
      fs.chmodSync(localBin, 0o755);
    } catch {}
    return localBin;
  }
  return "ffmpeg";
}

function resolveYouTubeStreamUrls(videoId: string, quality: string = "1080p"): Promise<CachedYtStream | null> {
  const cacheKey = `${videoId}_${quality}`;
  const cached = ytStreamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached);
  }

  let maxH = 1080;
  if (quality === "720p") maxH = 720;
  else if (quality === "480p") maxH = 480;
  else if (quality === "360p") maxH = 360;
  else if (quality === "1080p" || quality === "auto" || quality === "high") maxH = 1080;

  // Format selection strictly prioritizing 1080p Full HD AVC1 (H.264) video + high-fidelity audio
  const formatString = `bv*[height<=${maxH}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${maxH}][vcodec^=avc1]+ba/bv*[height<=${maxH}]+ba/b[height<=${maxH}][ext=mp4]/b[height<=${maxH}]/best`;

  return new Promise((resolve) => {
    const runner = getYtDlpRunner();
    const spawnArgs = [
      ...runner.prefixArgs,
      "--no-playlist",
      "--no-warnings",
      "--js-runtimes", "node:node",
      "--remote-components", "ejs:github",
      "-g",
      "-f", formatString,
      "--",
      `https://www.youtube.com/watch?v=${videoId}`
    ];

    const ytUrlProcess = spawn(runner.command, spawnArgs);

    let stdoutData = "";
    let stderrData = "";
    ytUrlProcess.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });
    ytUrlProcess.stderr.on("data", (chunk) => {
      stderrData += chunk.toString();
    });

    ytUrlProcess.on("close", (code) => {
      if (code !== 0 || !stdoutData.trim()) {
        console.error(`[YouTube Resolve] Error resolving ${videoId} (code ${code}):`, stderrData.slice(0, 300));
        resolve(null);
        return;
      }

      const lines = stdoutData.trim().split(/\r?\n/).filter((l) => l.startsWith("http"));
      if (lines.length === 0) {
        resolve(null);
        return;
      }

      const result: CachedYtStream = {
        videoUrl: lines[0],
        audioUrl: lines.length > 1 ? lines[1] : null,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
      };
      ytStreamCache.set(cacheKey, result);
      resolve(result);
    });

    ytUrlProcess.on("error", (err) => {
      console.error("[YouTube Resolve] Spawn error:", err);
      resolve(null);
    });
  });
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
      joinRoom(client, newRoom, username);
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
      client.characterType = cleanString(message.characterType || "character_406814", 32);
      try {
        joinRoom(client, targetRoom, username);
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
          movie.playing = false;
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
          movie.playing = false;
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
        movie.playing = false;
        movie.updatedAt = now;
        broadcast(room, {
          type: "movie-loaded",
          movie: movieState(room)
        });
        return;
      }

      switch (action) {
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
          movie.volume = Math.min(1.5, Math.max(0, Number(message.volume) || 0.8));
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

  proxyRemoteMediaStream(targetUrl, req, res, "video/mp4");
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

  // 10-second WebSocket heartbeat interval to keep Render connections alive & prune dead sockets
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((socket: any) => {
      if (socket.isAlive === false) return socket.terminate();
      socket.isAlive = false;
      socket.ping();
    });
  }, 10000);

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
      if (room.users.size > 0 && room.movie.playing) {
        const elapsed = (now - room.movie.updatedAt) / 1000;
        const curTime = Math.max(0, room.movie.time + elapsed);
        broadcast(room, {
          type: "movie-sync",
          time: curTime,
          playing: true,
          serverTime: now
        });
      }
    }
  }, 3000);

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
