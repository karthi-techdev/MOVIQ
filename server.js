"use strict";

/**
 * VIRTUAL CINEMA
 * Node.js HTTP static server + WebSocket multiplayer/signaling server.
 *
 * Run: npm install && npm start
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = __dirname;
const MAX_MESSAGE_SIZE = 64 * 1024;
const MAX_USERS_PER_ROOM = 1000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json"
};

const DEFAULT_MOVIE = {
  url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  title: "For Bigger Blazes — Demo Movie",
  playing: false,
  time: 0,
  volume: 0.8,
  updatedAt: Date.now()
};

const AVATAR_COLORS = [
  0x8170e8, 0x4c8edc, 0xb369b8, 0x3f9b91, 0xb87758, 0x6b7ac9, 0xa45f6d
];

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

const rooms = new Map();
const clients = new Map();

// --- HTTP static file server ---
const server = http.createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (reqPath === "/" || reqPath === "") {
    reqPath = "/index.html";
  }

  let safePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }

  if (!fs.existsSync(safePath)) {
    // Support styles.css mapping to style.css
    if (reqPath === "/styles.css" && fs.existsSync(path.join(PUBLIC_DIR, "style.css"))) {
      safePath = path.join(PUBLIC_DIR, "style.css");
    } else {
      res.statusCode = 404;
      return res.end("Not Found");
    }
  }

  try {
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      safePath = path.join(safePath, "index.html");
      if (!fs.existsSync(safePath)) {
        res.statusCode = 404;
        return res.end("Not Found");
      }
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.setHeader("Content-Type", contentType);

    fs.createReadStream(safePath).pipe(res);
  } catch (err) {
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server });

function id(length = 12) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}
const generateId = id;

function makeRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result;
  do {
    result = Array.from({ length: 6 }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  } while (rooms.has(result));
  return result;
}

function cleanString(value, maxLength = 100) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanUsername(value) {
  return cleanString(value, 24).replace(/[<>]/g, "").trim();
}

function validVideoURL(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:", "blob:"].includes(url.protocol) && url.toString().length <= 4096
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function send(clientOrSocket, message) {
  const socket = clientOrSocket?.socket || clientOrSocket;
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      console.error("Send failed:", error.message);
    }
  }
}
const sendTo = send;
const socketSend = send;

function broadcast(room, message, exceptId = null) {
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const user of room.users.values()) {
    if (user.id === exceptId) continue;
    if (user.socket && user.socket.readyState === WebSocket.OPEN) {
      try {
        user.socket.send(payload);
      } catch (err) {
        console.error("Broadcast failed:", err.message);
      }
    }
  }
}
const broadcastToRoom = broadcast;

function publicUser(user) {
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
const serializeUser = publicUser;

function movieState(room) {
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
const serializeMovie = (movie) => ({ ...movie });

function roomSummary(room) {
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
const serializeRoom = roomSummary;

function getPublicRooms() {
  return [...rooms.values()]
    .filter((room) => room.public)
    .map(roomSummary);
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
const updateRoomList = broadcastRoomList;

function createRoom(owner, data) {
  const room = {
    id: makeRoomId(),
    name: cleanString(data.name, 60) || "Midnight Premiere",
    public: data.isPublic !== false,
    hostId: owner.id,
    users: new Map(),
    seats: new Map(),
    movie: { ...DEFAULT_MOVIE, updatedAt: Date.now() },
    createdAt: Date.now(),
    maxUsers: MAX_USERS_PER_ROOM,
    lastChatAt: new Map()
  };
  rooms.set(room.id, room);
  return room;
}

function joinRoom(client, room, username) {
  leaveRoom(client, false);
  if (room.users.size >= (room.maxUsers || MAX_USERS_PER_ROOM)) {
    throw new Error("This theatre is full.");
  }
  client.roomId = room.id;
  client.username = cleanUsername(username) || client.username;
  client.room = room;
  client.colorIndex = room.users.size % AVATAR_COLORS.length;
  client.avatarColor = AVATAR_COLORS[client.colorIndex];
  room.users.set(client.id, client);

  // Send joined confirmation with current room state
  send(client, {
    type: "joined",
    userId: client.id,
    selfId: client.id,
    room: {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      movie: movieState(room),
      users: [...room.users.values()].map(publicUser),
      seats: Object.fromEntries(room.seats)
    },
    movie: movieState(room),
    users: [...room.users.values()].map(publicUser)
  });

  // Notify others in room
  broadcast(room, {
    type: "user-joined",
    user: publicUser(client)
  }, client.id);

  broadcast(room, {
    type: "chat",
    id: id(),
    system: true,
    text: `${client.username} entered the theatre`,
    timestamp: Date.now()
  });

  broadcastRoomList();
}

function leaveRoom(client, notify = true) {
  const room = client.room;
  if (!room) return;
  const wasHost = room.hostId === client.id;
  room.users.delete(client.id);

  // Release any occupied seats
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
      id: id(),
      system: true,
      text: `${client.username} left the theatre`,
      timestamp: Date.now()
    });
  }

  // Pass host privilege if current host leaves
  if (wasHost && room.users.size > 0) {
    const nextHost = room.users.values().next().value;
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

  if (room.users.size === 0) {
    rooms.delete(room.id);
  }

  client.room = null;
  client.seatIndex = null;
  client.seated = false;
  broadcastRoomList();
}

function handleDisconnect(client) {
  leaveRoom(client, true);
  clients.delete(client.id);
}

function handleMessage(client, raw) {
  if (!raw) return;
  const rawStr = typeof raw === "string" ? raw : raw.toString();
  if (rawStr.length > MAX_MESSAGE_SIZE) return;

  let message;
  try {
    message = JSON.parse(rawStr);
  } catch {
    return;
  }

  const room = client.room;
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
      } catch (err) {
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
      const seatIndex = Number(message.seat ?? message.seatIndex);
      if (isNaN(seatIndex)) return;

      const currentOccupant = room.seats.get(seatIndex);
      if (currentOccupant && currentOccupant !== client.id) {
        send(client, { type: "error", message: "Seat already taken." });
        return;
      }

      // Vacate prior seat if any
      if (client.seatIndex !== null) {
        room.seats.delete(client.seatIndex);
        broadcast(room, {
          type: "seat-update",
          seatId: client.seatIndex,
          userId: null,
          username: null
        });
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
        id: id(),
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
        const url = validVideoURL(message.url);
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
          movie.volume = Math.min(1, Math.max(0, Number(message.volume) || 0.8));
          break;
      }
      movie.updatedAt = now;

      broadcast(room, {
        type: "movie-state",
        state: movieState(room),
        action,
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

    case "voice-signal": {
      if (!room) return;
      const targetId = message.target || message.to;
      const target = room.users.get(targetId);
      if (target?.socket?.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify({
          type: message.signal?.type === "offer" ? "webrtc-offer" :
                message.signal?.type === "answer" ? "webrtc-answer" :
                message.data?.description?.type === "offer" ? "webrtc-offer" :
                message.data?.description?.type === "answer" ? "webrtc-answer" :
                "voice-signal",
          from: client.id,
          userId: client.id,
          signal: message.signal || message.data,
          data: message.data || message.signal,
          sdp: message.signal?.sdp || message.data?.description?.sdp
        }));
      }
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

    case "heartbeat": {
      send(client, { type: "pong", time: Date.now() });
      break;
    }
  }
}

function handleConnection(socket) {
  const client = {
    id: id(),
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

  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });

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

wss.on("connection", handleConnection);

function heartbeat() {
  wss.clients.forEach((socket) => {
    if (socket.isAlive === false) return socket.terminate();
    socket.isAlive = false;
    socket.ping();
  });
}
const heartbeatInterval = setInterval(heartbeat, 30000);

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

server.listen(PORT, () => {
  console.log(`Virtual Cinema server running at http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  clearInterval(heartbeatInterval);
  clearInterval(movieSyncInterval);
  wss.close();
  server.close(() => process.exit(0));
});
