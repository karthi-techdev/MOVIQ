/* =========================================================
   VIRTUAL CINEMA - Comprehensive Frontend Controller
   Three.js 3D Theater, WebSocket Multiplayer, Synchronized Video & WebRTC Voice
   ========================================================= */

"use strict";

const $ = (id) => document.getElementById(id);

// --- Global UI Elements Mapping ---
const ui = {
  lobby: $("lobby"),
  lobbyStatus: $("lobby-status"),
  usernameInput: $("username-input"),
  theatreNameInput: $("theatre-name-input"),
  publicTheatreInput: $("public-theatre-input"),
  createButton: $("create-button"),
  roomIdInput: $("room-id-input"),
  joinButton: $("join-button"),
  lobbyError: $("lobby-error"),
  refreshRoomsButton: $("refresh-rooms-button"),
  publicRoomList: $("public-room-list"),

  cinemaUI: $("cinema-ui"),
  topTheatreName: $("top-theatre-name"),
  copyRoomButton: $("copy-room-button"),
  topRoomId: $("top-room-id"),
  connectionStatus: $("connection-status"),
  userCount: $("user-count"),
  chatToggleButton: $("chat-toggle-button"),
  unreadBadge: $("unread-badge"),
  settingsButton: $("settings-button"),
  focusButton: $("focus-button"),
  leaveButton: $("leave-button"),

  chatPanel: $("chat-panel"),
  chatTabButton: $("chat-tab-button"),
  peopleTabButton: $("people-tab-button"),
  closeChatButton: $("close-chat-button"),
  chatPane: $("chat-pane"),
  chatMessages: $("chat-messages"),
  chatInput: $("chat-input"),
  sendChatButton: $("send-chat-button"),
  peoplePane: $("people-pane"),
  peopleList: $("people-list"),

  seatStatus: $("seat-status"),
  standButton: $("stand-button"),
  hintBar: $("hint-bar"),

  micButton: $("mic-button"),
  micIcon: $("mic-icon"),
  micLabel: $("mic-label"),
  voiceStatus: $("voice-status"),
  leaveVoiceButton: $("leave-voice-button"),

  currentMovieTitle: $("current-movie-title"),
  hostNote: $("host-note"),
  moviePlayButton: $("movie-play-button"),
  movieCurrentTime: $("movie-current-time"),
  movieProgress: $("movie-progress"),
  movieDuration: $("movie-duration"),
  movieVolume: $("movie-volume"),
  movieSettingsButton: $("movie-settings-button"),

  settingsModal: $("settings-modal"),
  closeSettingsButton: $("close-settings-button"),
  movieTitleInput: $("movie-title-input"),
  movieUrlInput: $("movie-url-input"),
  loadMovieButton: $("load-movie-button"),
  qualitySelect: $("quality-select"),

  playbackGate: $("playback-gate"),
  enablePlaybackButton: $("enable-playback-button"),
  revealUiButton: $("reveal-ui-button"),
  seatTooltip: $("seat-tooltip"),
  toastContainer: $("toast-container"),

  movieVideo: $("movie-video"),
  remoteAudioContainer: $("remote-audio-container"),
  sceneContainer: $("scene-container"),

  // Character selection & dynamic controls
  characterPicker: $("character-picker"),
  cameraModeButton: $("camera-mode-button"),
  clapButton: $("clap-button"),
  waveButton: $("wave-button"),
  laughButton: $("laugh-button"),
  talkButton: $("talk-button"),
  spinButton: $("spin-button")
};

// --- App State ---
const AVATAR_PALETTE = [
  0x8170e8, 0x4c8edc, 0xb369b8, 0x3f9b91, 0xb87758, 0x6b7ac9, 0xa45f6d
];

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

const App = {
  socket: null,
  socketReady: false,
  socketPromise: null,
  userId: null,
  username: "Guest",
  characterType: localStorage.getItem("vc-character") || "character_406814",
  cameraMode: localStorage.getItem("vc-cameramode") || "TPP",
  roomId: null,
  roomName: "",
  isHost: false,
  inRoom: false,

  // Presence & users
  users: new Map(), // userId -> userData
  avatars: new Map(), // userId -> THREE.Group
  seats: [], // Array of seat definitions { index, row, col, x, y, z, occupantId }
  currentSeatIndex: null,

  // Local movement, physics & camera
  position: new THREE.Vector3(-7.08, 0.68, -3.5),
  rotation: 0,
  verticalVelocity: 0,
  isGrounded: true,
  isJumping: false,
  isClapping: false,
  activeEmote: null,
  emoteTimeout: null,
  isSlouchWalk: false,
  currentActionName: "idle",
  clapTimeout: null,

  cameraYaw: 0,
  cameraPitch: 0.15,
  cameraDistance: 2.0,
  fppFov: 56,
  targetFppFov: 56,
  seatedTppDistance: 1.15,
  isPointerDown: false,
  dragStartX: 0,
  dragStartY: 0,
  hasDragged: false,
  lastPointerX: 0,
  lastPointerY: 0,
  activeKeys: new Set(),
  lastMoveSendTime: 0,

  // Three.js instances
  scene: null,
  camera: null,
  renderer: null,
  clock: null,
  screenMesh: null,
  screenTexture: null,
  screenLight: null,
  seatHitboxes: [],
  hoveredSeat: null,

  // Movie
  movie: {
    url: "",
    title: "",
    playing: false,
    time: 0,
    volume: 0.8,
    updatedAt: Date.now()
  },
  suppressVideoEvents: false,
  userInteracted: false,

  // WebRTC Voice
  localStream: null,
  audioContext: null,
  analyser: null,
  inVoice: false,
  isMuted: true,
  isSpeaking: false,
  peerConnections: new Map(), // userId -> RTCPeerConnection

  // UI
  chatOpen: false,
  unreadCount: 0,
  activeSideTab: "chat",
  focusMode: false,
  quality: localStorage.getItem("vc-quality") || "balanced"
};

// --- Helpers & Utilities ---

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toast(message, isError = false) {
  if (!ui.toastContainer) return;
  const el = document.createElement("div");
  el.className = `toast${isError ? " error" : ""}`;
  el.textContent = message;
  ui.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(10px)";
    el.style.transition = "all 0.3s ease";
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// --- WebSocket Connection ---

function getSocketUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

function connectSocket() {
  if (App.socket && App.socket.readyState === WebSocket.OPEN) {
    return Promise.resolve(App.socket);
  }
  if (App.socketPromise) return App.socketPromise;

  App.socketPromise = new Promise((resolve, reject) => {
    try {
      const socket = new WebSocket(getSocketUrl());
      App.socket = socket;

      socket.addEventListener("open", () => {
        App.socketReady = true;
        if (ui.lobbyStatus) {
          ui.lobbyStatus.textContent = "Online";
          ui.lobbyStatus.classList.add("online");
        }
        if (ui.connectionStatus) {
          ui.connectionStatus.textContent = "Connected";
          ui.connectionStatus.className = "status-pill connected";
        }
        sendSocket({ type: "list-rooms" });
        resolve(socket);
      });

      socket.addEventListener("message", (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        handleServerMessage(msg);
      });

      socket.addEventListener("close", () => {
        App.socketReady = false;
        App.socketPromise = null;
        if (ui.lobbyStatus) {
          ui.lobbyStatus.textContent = "Offline";
          ui.lobbyStatus.classList.remove("online");
        }
        if (ui.connectionStatus) {
          ui.connectionStatus.textContent = "Disconnected";
          ui.connectionStatus.className = "status-pill";
        }
      });

      socket.addEventListener("error", () => {
        if (!App.socketReady) {
          if (ui.lobbyError) {
            ui.lobbyError.textContent = "Could not connect to cinema server.";
          }
          reject(new Error("WebSocket error"));
        }
      });
    } catch (err) {
      reject(err);
    }
  });

  return App.socketPromise;
}

function sendSocket(message) {
  if (App.socket && App.socket.readyState === WebSocket.OPEN) {
    App.socket.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// --- Lobby Logic ---

function getCleanUsername() {
  const val = (ui.usernameInput?.value || "").trim().replace(/\s+/g, " ").slice(0, 20);
  return val || `Guest${Math.floor(Math.random() * 9000 + 1000)}`;
}

function validateUsername() {
  const name = getCleanUsername();
  if (name.length < 2) {
    if (ui.lobbyError) ui.lobbyError.textContent = "Enter a name with at least 2 characters.";
    ui.usernameInput?.focus();
    return null;
  }
  localStorage.setItem("vc-username", name);
  App.username = name;
  return name;
}

async function createTheatre() {
  const name = validateUsername();
  if (!name) return;

  setLobbyBusy(true);
  try {
    await connectSocket();
    sendSocket({
      type: "create-room",
      username: name,
      characterType: App.characterType,
      name: ui.theatreNameInput?.value.trim() || "Midnight Premiere",
      isPublic: ui.publicTheatreInput?.checked !== false
    });
  } catch (err) {
    setLobbyBusy(false);
    if (ui.lobbyError) ui.lobbyError.textContent = "Failed to connect to server.";
  }
}

async function joinTheatre(roomId) {
  const name = validateUsername();
  if (!name) return;

  const targetId = String(roomId || ui.roomIdInput?.value || "").trim().toUpperCase();
  if (!targetId) {
    if (ui.lobbyError) ui.lobbyError.textContent = "Please enter a Theatre Room ID.";
    ui.roomIdInput?.focus();
    return;
  }

  setLobbyBusy(true);
  try {
    await connectSocket();
    sendSocket({
      type: "join-room",
      roomId: targetId,
      characterType: App.characterType,
      username: name
    });
  } catch (err) {
    setLobbyBusy(false);
    if (ui.lobbyError) ui.lobbyError.textContent = "Failed to connect to server.";
  }
}

function setLobbyBusy(busy) {
  if (ui.createButton) ui.createButton.disabled = busy;
  if (ui.joinButton) ui.joinButton.disabled = busy;
  if (ui.refreshRoomsButton) ui.refreshRoomsButton.disabled = busy;
  if (ui.createButton) {
    ui.createButton.textContent = busy ? "Connecting…" : "Create theatre";
  }
}

function renderPublicRooms(rooms) {
  if (!ui.publicRoomList) return;
  ui.publicRoomList.innerHTML = "";

  if (!rooms || rooms.length === 0) {
    ui.publicRoomList.innerHTML = `
      <div class="empty-state">No public theatres currently showing. Create one above!</div>
    `;
    return;
  }

  rooms.forEach((room) => {
    const card = document.createElement("article");
    card.className = "room-card glass-panel";

    const info = document.createElement("div");
    info.className = "room-info";

    const title = document.createElement("strong");
    title.textContent = room.name;

    const movie = document.createElement("span");
    movie.className = "room-movie";
    movie.textContent = room.movie?.title ? `▶ ${room.movie.title}` : "No movie selected";

    const meta = document.createElement("small");
    meta.textContent = `Room ${room.id} · ${room.users} spectator${room.users === 1 ? "" : "s"}`;

    info.append(title, movie, meta);

    const joinBtn = document.createElement("button");
    joinBtn.className = "button button-secondary button-small";
    joinBtn.textContent = "Join";
    joinBtn.addEventListener("click", () => joinTheatre(room.id));

    card.append(info, joinBtn);
    ui.publicRoomList.appendChild(card);
  });
}

// --- Server Message Router ---

function handleServerMessage(msg) {
  switch (msg.type) {
    case "connected":
      App.userId = msg.userId;
      if (msg.rooms) renderPublicRooms(msg.rooms);
      break;

    case "room-list":
      renderPublicRooms(msg.rooms || []);
      break;

    case "joined":
      enterTheatre(msg);
      break;

    case "user-joined":
      addUser(msg.user);
      appendSystemChat(`${msg.user.username} entered the theatre.`);
      break;

    case "user-left":
      removeUser(msg.userId, msg.username);
      appendSystemChat(`${msg.username || "Someone"} left the theatre.`);
      break;

    case "user-moved":
      updateRemoteAvatarMovement(msg);
      break;

    case "user-emote":
      handleRemoteEmote(msg);
      break;

    case "seat-update":
      updateSeatOccupancy(msg.seatId, msg.userId, msg.username);
      break;

    case "chat":
      appendChatMessage(msg);
      break;

    case "movie-loaded":
      applyMovieState(msg.movie, true);
      break;

    case "movie-state":
      applyMovieState(msg.state || msg.movie, false);
      break;

    case "host-changed":
      App.isHost = msg.hostId === App.userId;
      updateHostUI();
      appendSystemChat(App.isHost ? "You are now the theatre host." : `Host changed.`);
      break;

    case "voice-peers":
      if (msg.peers) {
        msg.peers.forEach((peerId) => createVoicePeerConnection(peerId, true));
      }
      break;

    case "voice-peer-joined":
      if (App.inVoice && msg.userId !== App.userId) {
        createVoicePeerConnection(msg.userId, false);
      }
      break;

    case "voice-peer-left":
      closeVoicePeerConnection(msg.userId);
      break;

    case "webrtc-offer":
      handleRemoteOffer(msg.from, msg.offer || msg.data);
      break;

    case "webrtc-answer":
      handleRemoteAnswer(msg.from, msg.answer || msg.data);
      break;

    case "webrtc-ice":
      handleRemoteIceCandidate(msg.from, msg.candidate);
      break;

    case "voice-state":
      updateRemoteVoiceState(msg);
      break;

    case "error":
      setLobbyBusy(false);
      if (ui.lobbyError) ui.lobbyError.textContent = msg.message || "An error occurred.";
      toast(msg.message || "Error", true);
      break;
  }
}

// --- Theatre Initialization & Transition ---

function enterTheatre(data) {
  setLobbyBusy(false);
  App.userId = data.userId || App.userId;
  App.roomId = data.room.id;
  App.roomName = data.room.name;
  App.isHost = data.room.hostId === App.userId;
  App.inRoom = true;

  // Update top bar HUD
  if (ui.topTheatreName) ui.topTheatreName.textContent = data.room.name;
  if (ui.topRoomId) ui.topRoomId.textContent = data.room.id;

  // Hide lobby, show cinema HUD
  if (ui.lobby) {
    ui.lobby.classList.add("leaving");
    setTimeout(() => {
      ui.lobby.hidden = true;
      if (ui.cinemaUI) ui.cinemaUI.hidden = false;
    }, 300);
  }

  // Restore local user position if provided by server
  if (data.user && data.user.position) {
    App.position.set(data.user.position.x, data.user.position.y, data.user.position.z);
  } else if (data.users) {
    const me = data.users.find((u) => u.id === App.userId);
    if (me && me.position) {
      App.position.set(me.position.x, me.position.y, me.position.z);
    }
  }

  // Initialize Three.js 3D auditorium
  initThree();

  // Populate users & avatars
  App.users.clear();
  if (data.users) {
    data.users.forEach((u) => addUser(u));
  }

  // Restore occupied seats
  if (data.room.seats) {
    Object.entries(data.room.seats).forEach(([seatId, occupantId]) => {
      const u = App.users.get(occupantId);
      updateSeatOccupancy(Number(seatId), occupantId, u?.username);
    });
  }

  // Synchronize movie state
  if (data.room.movie) {
    applyMovieState(data.room.movie, true);
  }

  updateHostUI();
  updatePeopleList();
  toast(`Welcome to ${data.room.name}! Click any seat to sit down.`);
}

function leaveTheatre() {
  if (App.inVoice) leaveVoiceChat();
  sendSocket({ type: "leave" });

  App.inRoom = false;
  App.currentSeatIndex = null;
  App.users.clear();

  // Remove avatars from 3D scene
  App.avatars.forEach((avatar) => {
    if (App.scene) App.scene.remove(avatar);
  });
  App.avatars.clear();

  // Reset UI back to lobby
  if (ui.cinemaUI) ui.cinemaUI.hidden = true;
  if (ui.lobby) {
    ui.lobby.hidden = false;
    ui.lobby.classList.remove("leaving");
  }
  sendSocket({ type: "list-rooms" });
}

function updateHostUI() {
  if (ui.hostNote) {
    ui.hostNote.textContent = App.isHost ? "(Host controls active)" : "(Viewer mode)";
  }
  if (ui.moviePlayButton) {
    ui.moviePlayButton.style.opacity = App.isHost ? "1" : "0.5";
    ui.moviePlayButton.title = App.isHost ? "Play / Pause" : "Only the host can control playback";
  }
}

function addUser(userData) {
  if (!userData) return;
  App.users.set(userData.id, userData);

  // Create 3D avatar
  createAvatar(userData);
  updatePeopleList();
  if (ui.userCount) ui.userCount.textContent = App.users.size;
}

function removeUser(userId, username) {
  closeVoicePeerConnection(userId);

  const avatar = App.avatars.get(userId);
  if (avatar && App.scene) {
    App.scene.remove(avatar);
  }
  App.avatars.delete(userId);
  App.users.delete(userId);

  // Clear any seat user occupied
  App.seats.forEach((seat) => {
    if (seat.occupantId === userId) {
      updateSeatOccupancy(seat.index, null, null);
    }
  });

  updatePeopleList();
  if (ui.userCount) ui.userCount.textContent = App.users.size;
}

// --- Three.js Cinema Environment ---

function initThree() {
  if (App.scene) return; // Already initialized

  const container = ui.sceneContainer;
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070914);
  scene.fog = new THREE.FogExp2(0x070914, 0.010);
  App.scene = scene;

  // Camera - realistic 56 degree FOV with instant framing behind player
  const camera = new THREE.PerspectiveCamera(56, width / height, 0.05, 120);
  const initTarget = App.position.clone().add(new THREE.Vector3(0, 1.25, 0));
  camera.position.set(App.position.x, App.position.y + 1.55, App.position.z + (App.cameraDistance || 2.0));
  camera.lookAt(initTarget);
  App.camera = camera;

  // Clock
  App.clock = new THREE.Clock();

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(width, height);
  applyRenderingQuality(renderer, App.quality);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  App.renderer = renderer;

  // Build 3D World
  buildAuditorium(scene);
  setupScreen(scene);
  buildSeats(scene);
  setupLighting(scene);

  // Bind mouse / touch events on canvas
  bindThreeInteractionEvents(renderer.domElement);

  // Start Animation Loop
  animate();
}

function applyRenderingQuality(renderer, mode) {
  if (!renderer) return;
  const maxDpr = window.devicePixelRatio || 1;
  if (mode === "high") {
    renderer.setPixelRatio(Math.min(maxDpr, 2.0));
  } else if (mode === "performance") {
    renderer.setPixelRatio(1.0);
  } else {
    // balanced
    renderer.setPixelRatio(Math.min(maxDpr, 1.5));
  }
}

// --- Procedural Multiplex Textures ---

function createCeilingGridTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // Deep dark navy base
  ctx.fillStyle = "#070a14";
  ctx.fillRect(0, 0, 512, 512);

  // Subtle acoustic tile fill variation
  const tileSize = 64;
  for (let x = 0; x < 512; x += tileSize) {
    for (let y = 0; y < 512; y += tileSize) {
      ctx.fillStyle = (x + y) % (tileSize * 2) === 0 ? "#090d1a" : "#070a14";
      ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
    }
  }

  // Thin grid lines with soft blue neon glow
  ctx.strokeStyle = "#1b253e";
  ctx.lineWidth = 2.5;
  for (let i = 0; i <= 512; i += tileSize) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(14, 18);
  return texture;
}

function createCarpetTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#090c17";
  ctx.fillRect(0, 0, 256, 256);

  // Fine acoustic weave noise
  ctx.fillStyle = "rgba(25, 34, 58, 0.4)";
  for (let i = 0; i < 4000; i++) {
    const rx = Math.random() * 256;
    const ry = Math.random() * 256;
    ctx.fillRect(rx, ry, 1.5, 1.5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(16, 24);
  return texture;
}

function createScreenStandbyTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");

  // Rich royal blue / multiplex cobalt blue gradient exactly like the uploaded screenshots
  const grad = ctx.createRadialGradient(960, 540, 150, 960, 540, 1150);
  grad.addColorStop(0, "#2563eb");
  grad.addColorStop(0.35, "#1d4ed8");
  grad.addColorStop(0.7, "#1e3a8a");
  grad.addColorStop(1, "#0c152e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1920, 1080);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// --- Auditorium Construction ---

function buildAuditorium(scene) {
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x090c18,
    roughness: 0.92,
    metalness: 0.05
  });

  const carpetMat = new THREE.MeshStandardMaterial({
    map: createCarpetTexture(),
    roughness: 0.95,
    metalness: 0.02
  });

  const ceilingMat = new THREE.MeshStandardMaterial({
    map: createCeilingGridTexture(),
    roughness: 0.85,
    metalness: 0.1
  });

  // Main Auditorium Floor (Spans wall-to-wall)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 38), carpetMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  // Suspended Grid Ceiling
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(32, 38), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 15.0, 0);
  scene.add(ceiling);

  // Outer Enclosure Walls (Encloses seating with zero gaps)
  const addWall = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };

  addWall(32, 16.0, 0.6, 0, 7.5, -19.0); // Front Proscenium Wall
  addWall(32, 16.0, 0.6, 0, 7.5, 19.0);  // Back Rear Wall
  addWall(0.6, 16.0, 38, -16.0, 7.5, 0); // Left Side Wall
  addWall(0.6, 16.0, 38, 16.0, 7.5, 0);  // Right Side Wall

  // Curved Multiplex Front Stage & Steps
  buildCurvedStage(scene);

  // Signature Angular Neon Light Bars on Side Walls
  buildNeonLightBars(scene);

  // Rear Projection Booth Window
  buildProjectionBooth(scene);
}

function buildCurvedStage(scene) {
  const stageTopMat = new THREE.MeshStandardMaterial({
    color: 0x0c0f1c,
    roughness: 0.85,
    metalness: 0.1
  });

  const stageEdgeMat = new THREE.MeshStandardMaterial({
    color: 0x181e30,
    roughness: 0.7,
    metalness: 0.2
  });

  const stageGroup = new THREE.Group();

  // Main Stage Apron Platform (Curved front edge, clean multiplex design without fence)
  const stageWidth = 30;
  const stageDepth = 4.0;
  const stageBase = new THREE.Mesh(new THREE.BoxGeometry(stageWidth, 0.45, stageDepth), stageTopMat);
  stageBase.position.set(0, 0.225, -16.0);
  stageBase.receiveShadow = true;
  stageGroup.add(stageBase);

  // 3 Tiered Curved Steps Leading Down to Floor
  const stepCount = 3;
  const stepHeights = [0.35, 0.23, 0.11];
  const stepR = 34; // Matches the panoramic screen curve radius

  for (let s = 0; s < stepCount; s++) {
    const h = stepHeights[s];
    const zOffset = -14.0 + s * 0.45;
    const curvePoints = [];

    // Curved step geometry
    for (let i = 0; i <= 36; i++) {
      const u = (i / 36) * 2 - 1; // -1 to 1
      const x = u * 14.5;
      const z = zOffset - (x * x) / (2 * stepR);
      curvePoints.push(new THREE.Vector3(x, h, z));
    }

    // Step front riser strip
    for (let i = 0; i < curvePoints.length - 1; i++) {
      const p1 = curvePoints[i];
      const p2 = curvePoints[i + 1];
      const mid = p1.clone().add(p2).multiplyScalar(0.5);
      const len = p1.distanceTo(p2);
      const angle = Math.atan2(p2.x - p1.x, p2.z - p1.z);

      const riserMesh = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.12), stageEdgeMat);
      riserMesh.position.set(mid.x, h / 2, mid.z);
      riserMesh.rotation.y = angle - Math.PI / 2;
      riserMesh.receiveShadow = true;
      stageGroup.add(riserMesh);
    }
  }

  scene.add(stageGroup);
}

// --- Signature Neon LED Light Strips on Walls ---

function buildNeonLightBars(scene) {
  const neonGroup = new THREE.Group();

  // Core bright neon material (high emissive intensity)
  const neonCoreMat = new THREE.MeshBasicMaterial({
    color: 0x93c5fd
  });

  // Soft translucent bloom casing
  const neonGlowMat = new THREE.MeshBasicMaterial({
    color: 0x2563eb,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending
  });

  // Helper to create an angled neon cylinder between two 3D points
  const createNeonBar = (p1, p2) => {
    const distance = p1.distanceTo(p2);
    const mid = p1.clone().add(p2).multiplyScalar(0.5);

    // Inner emissive core
    const coreGeo = new THREE.CylinderGeometry(0.045, 0.045, distance, 12);
    const core = new THREE.Mesh(coreGeo, neonCoreMat);

    // Outer glow casing
    const glowGeo = new THREE.CylinderGeometry(0.12, 0.12, distance, 12);
    const glow = new THREE.Mesh(glowGeo, neonGlowMat);

    const bar = new THREE.Group();
    bar.add(core);
    bar.add(glow);

    bar.position.copy(mid);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
    neonGroup.add(bar);
  };

  // Define Wall Neon Paths running right along the side walls and seating slope
  [-15.65, 15.65].forEach((xSide) => {
    // 1. Front Proscenium Vertical Corner Accent
    createNeonBar(
      new THREE.Vector3(xSide, 0.4, -18.2),
      new THREE.Vector3(xSide, 14.5, -18.2)
    );

    // 2. Diagonal Slashing V-Patterns on Side Wall
    createNeonBar(
      new THREE.Vector3(xSide, 14.0, -16.5),
      new THREE.Vector3(xSide, 1.2, -7.0)
    );

    createNeonBar(
      new THREE.Vector3(xSide, 1.2, -7.0),
      new THREE.Vector3(xSide, 14.0, 1.5)
    );

    createNeonBar(
      new THREE.Vector3(xSide, 14.0, 1.5),
      new THREE.Vector3(xSide, 4.5, 9.5)
    );

    createNeonBar(
      new THREE.Vector3(xSide, 4.5, 9.5),
      new THREE.Vector3(xSide, 14.0, 17.5)
    );

    // Rear vertical corner accent
    createNeonBar(
      new THREE.Vector3(xSide, 2.92, 18.8),
      new THREE.Vector3(xSide, 14.5, 18.8)
    );

    // Dynamic blue neon point lights along the side wall to illuminate the room
    [-14, -6, 2, 10, 17].forEach((zLight) => {
      const pl = new THREE.PointLight(0x3b82f6, 3.5, 24, 1.5);
      pl.position.set(xSide * 0.92, 7.5, zLight);
      neonGroup.add(pl);
    });
  });

  scene.add(neonGroup);
}

// --- Rear Projection Booth Window ---

function buildProjectionBooth(scene) {
  const boothGroup = new THREE.Group();

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x070912,
    roughness: 0.8
  });

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.1,
    metalness: 0.9,
    transparent: true,
    opacity: 0.75
  });

  // Projection window outer frame at top center of back wall
  const boothFrame = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.0, 0.25), frameMat);
  boothFrame.position.set(0, 11.0, 18.8);
  boothGroup.add(boothFrame);

  // Dual glass window panes
  [-1.2, 1.2].forEach((x) => {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 0.05), glassMat);
    glass.position.set(x, 11.0, 18.75);
    boothGroup.add(glass);
  });

  // Soft warm projection booth interior glow
  const boothLight = new THREE.PointLight(0x93c5fd, 4.0, 26, 1.8);
  boothLight.position.set(0, 11.0, 18.4);
  boothGroup.add(boothLight);

  // Cinema Projector Light Beam shining from booth towards screen
  const projectorBeam = new THREE.SpotLight(0xcfd8ff, 4.0, 48, Math.PI / 10, 0.4, 1.1);
  projectorBeam.position.set(0, 11.0, 18.2);
  projectorBeam.target.position.set(0, 7.30, -18.2);
  boothGroup.add(projectorBeam);
  boothGroup.add(projectorBeam.target);

  scene.add(boothGroup);
}

// --- Massive Curved Multiplex IMAX Screen ---

function setupScreen(scene) {
  const screenWidth = 30.0;
  const screenHeight = 13.8;
  const curveRadius = 34.0;

  // Custom curved plane geometry
  const screenGeo = new THREE.PlaneGeometry(screenWidth, screenHeight, 64, 1);
  const pos = screenGeo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    // Panoramic horizontal curve
    const zOffset = (x * x) / (2 * curveRadius);
    pos.setZ(i, zOffset);
  }
  screenGeo.computeVertexNormals();

  // Screen Materials
  App.defaultScreenTexture = createScreenStandbyTexture();

  const video = ui.movieVideo;
  video.crossOrigin = "anonymous";
  video.playsInline = true;

  const videoTex = new THREE.VideoTexture(video);
  videoTex.minFilter = THREE.LinearFilter;
  videoTex.magFilter = THREE.LinearFilter;
  if (THREE.SRGBColorSpace) videoTex.colorSpace = THREE.SRGBColorSpace;
  App.screenTexture = videoTex;

  // Standby multiplex blue texture by default until video plays
  const screenMat = new THREE.MeshBasicMaterial({
    map: App.defaultScreenTexture,
    color: 0xffffff
  });
  App.screenMaterial = screenMat;

  const screenMesh = new THREE.Mesh(screenGeo, screenMat);
  screenMesh.position.set(0, 7.30, -18.2);
  scene.add(screenMesh);
  App.screenMesh = screenMesh;

  // Beveled Black Border Frame around the curved screen
  const borderMat = new THREE.MeshStandardMaterial({
    color: 0x04060a,
    roughness: 0.95,
    metalness: 0.05
  });

  const frameThickness = 0.45;
  const frameGeo = new THREE.PlaneGeometry(screenWidth + frameThickness * 2, screenHeight + frameThickness * 2, 64, 1);
  const fPos = frameGeo.attributes.position;
  for (let i = 0; i < fPos.count; i++) {
    const x = fPos.getX(i);
    fPos.setZ(i, (x * x) / (2 * curveRadius));
  }
  frameGeo.computeVertexNormals();

  const frameMesh = new THREE.Mesh(frameGeo, borderMat);
  frameMesh.position.set(0, 7.30, -18.25);
  scene.add(frameMesh);

  // Dynamic projection bounce light casting rich blue glow onto stage and auditorium
  const screenBounceLight = new THREE.PointLight(0x3b82f6, 4.5, 38, 1.2);
  screenBounceLight.position.set(0, 7.30, -15.8);
  scene.add(screenBounceLight);
  App.screenLight = screenBounceLight;
}

// --- Stadium Seating & Glowing Blue Stairways (1,224 Seats Capacity, Continuous Multiplex Coverage) ---

function buildSeats(scene) {
  App.seats = [];
  App.seatHitboxes = [];

  const stadiumGroup = new THREE.Group();

  const riserPlatformMat = new THREE.MeshStandardMaterial({
    map: createCarpetTexture(),
    roughness: 0.95,
    metalness: 0.02
  });

  // Stair Tread LED Light Material: vibrant electric blue neon
  const stairLedMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8
  });

  const stairLedGlowMat = new THREE.MeshBasicMaterial({
    color: 0x2563eb,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending
  });

  // Theater Theme Materials
  const themeFabricMat = new THREE.MeshStandardMaterial({
    color: 0x16243f, // Deep dark midnight navy velvet
    roughness: 0.82,
    metalness: 0.05
  });

  const themeFrameMat = new THREE.MeshStandardMaterial({
    color: 0x090c14, // Dark cinema polymer frame & cupholders
    roughness: 0.55,
    metalness: 0.18
  });

  // 18 Rows of Stadium Seating spanning to the back wall
  const rowCount = 18;
  const startZ = -7.0;
  const rowSpacing = 1.35;
  const tierHeight = 0.16; // Low, gentle stadium tier elevation: 8cm step height (matching reference)

  // 40 Twin Modules per row = 80 continuous seats per row (Total = 1,440 seats!)
  // Fills every gap completely with additional seats matching the reference cinema!
  const moduleCols = [];
  let colNum = 1;

  // Left section: 11 twin modules (22 seats, cols 1-22, fills ramp gap right up to outer wall)
  [-15.24, -14.52, -13.80, -13.08, -12.36, -11.64, -10.92, -10.20, -9.48, -8.76, -8.04].forEach((modX) => {
    moduleCols.push({ modX: Number(modX.toFixed(2)), colA: colNum++, colB: colNum++ });
  });

  // Center section: 18 twin modules (36 seats, cols 23-58, +2 extra seats on each side closing stair gap)
  [-6.12, -5.40, -4.68, -3.96, -3.24, -2.52, -1.80, -1.08, -0.36, 0.36, 1.08, 1.80, 2.52, 3.24, 3.96, 4.68, 5.40, 6.12].forEach((modX) => {
    moduleCols.push({ modX: Number(modX.toFixed(2)), colA: colNum++, colB: colNum++ });
  });

  // Right section: 11 twin modules (22 seats, cols 59-80, fills ramp gap right up to outer wall)
  [8.04, 8.76, 9.48, 10.20, 10.92, 11.64, 12.36, 13.08, 13.80, 14.52, 15.24].forEach((modX) => {
    moduleCols.push({ modX: Number(modX.toFixed(2)), colA: colNum++, colB: colNum++ });
  });

  // 1. Build Stadium Tier Risers, Front Entrance Steps & Glowing Blue Stairways (Wall-to-Wall, No Gaps!)
  for (let r = 0; r < rowCount; r++) {
    const rowZ = startZ + r * rowSpacing;
    const rowY = 0.20 + r * tierHeight;
    const riserDepth = rowSpacing + 0.02;
    // Tier platform ("ramp") extends forward all the way to the back of the row in front
    const platZ = rowZ - 0.785;

    // Left Platform Section (width 8.04, centered at x = -11.70, seamlessly meets left stairs at x = -7.68)
    const leftPlat = new THREE.Mesh(new THREE.BoxGeometry(8.04, rowY, riserDepth), riserPlatformMat);
    leftPlat.position.set(-11.70, rowY / 2, platZ);
    leftPlat.receiveShadow = true;
    stadiumGroup.add(leftPlat);

    // Center Platform Section (width 12.96, centered at x = 0, seamlessly meets aisles at x = ±6.48)
    const centerPlat = new THREE.Mesh(new THREE.BoxGeometry(12.96, rowY, riserDepth), riserPlatformMat);
    centerPlat.position.set(0, rowY / 2, platZ);
    centerPlat.receiveShadow = true;
    stadiumGroup.add(centerPlat);

    // Right Platform Section (width 8.04, centered at x = 11.70, seamlessly meets right stairs at x = 7.68)
    const rightPlat = new THREE.Mesh(new THREE.BoxGeometry(8.04, rowY, riserDepth), riserPlatformMat);
    rightPlat.position.set(11.70, rowY / 2, platZ);
    rightPlat.receiveShadow = true;
    stadiumGroup.add(rightPlat);

    // Two Glowing Blue Stairways (Left Aisle at x = -7.08, Right Aisle at x = 7.08, width 1.20m, ZERO GAPS to seats!)
    [-7.08, 7.08].forEach((stairX) => {
      const stepWidth = 1.20;
      const stepD = rowSpacing / 2;
      for (let s = 0; s < 2; s++) {
        const stepY = (rowY - tierHeight) + (s + 1) * (tierHeight / 2);
        const stepZ = (platZ - stepD / 2) + s * stepD;

        const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(stepWidth, stepY, stepD), riserPlatformMat);
        stepMesh.position.set(stairX, stepY / 2, stepZ);
        stepMesh.receiveShadow = true;
        stadiumGroup.add(stepMesh);

        // Dark tread nose edge
        const noseTrim = new THREE.Mesh(new THREE.BoxGeometry(stepWidth, 0.015, 0.05), themeFrameMat);
        noseTrim.position.set(stairX, stepY + 0.008, stepZ + stepD / 2 - 0.025);
        stadiumGroup.add(noseTrim);

        // GLOWING BLUE LED STRIP ON STAIR NOSE (Low sleek step profile)
        const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(stepWidth - 0.04, 0.02, 0.03), stairLedMat);
        ledStrip.position.set(stairX, stepY + 0.01, stepZ + stepD / 2);
        stadiumGroup.add(ledStrip);

        // LED Glow halo
        const ledHalo = new THREE.Mesh(new THREE.BoxGeometry(stepWidth, 0.05, 0.05), stairLedGlowMat);
        ledHalo.position.copy(ledStrip.position);
        stadiumGroup.add(ledHalo);
      }
    });
  }

  // Front entrance transition steps connecting flat floor (y=0) to row 0 (y=0.20)
  const frontSteps = [
    { z: -8.89, y: 0.07, d: 0.28 },
    { z: -8.61, y: 0.14, d: 0.28 }
  ];
  frontSteps.forEach((fs) => {
    const stepM = new THREE.Mesh(new THREE.BoxGeometry(32.0, fs.y, fs.d), riserPlatformMat);
    stepM.position.set(0, fs.y / 2, fs.z);
    stepM.receiveShadow = true;
    stadiumGroup.add(stepM);

    [-7.08, 7.08].forEach((ax) => {
      const led = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.02, 0.03), stairLedMat);
      led.position.set(ax, fs.y + 0.01, fs.z + fs.d / 2);
      stadiumGroup.add(led);
    });
  });

  // Top rear walkway platform connecting seating directly to back wall (No gap in back!)
  const topTierY = 0.20 + (rowCount - 1) * tierHeight;
  const rearWalkway = new THREE.Mesh(
    new THREE.BoxGeometry(32.0, topTierY, 3.0),
    riserPlatformMat
  );
  rearWalkway.position.set(0, topTierY / 2, 17.5);
  rearWalkway.receiveShadow = true;
  stadiumGroup.add(rearWalkway);

  // 2. Pre-create All Seat Records & Raycast Hitboxes
  let seatIndex = 0;
  for (let r = 0; r < rowCount; r++) {
    const rowZ = startZ + r * rowSpacing;
    const rowY = 0.20 + r * tierHeight;
    const rowNumber = r + 1;

    moduleCols.forEach((colInfo) => {
      // Left Seat in twin module (seat spacing: ±0.18)
      const leftX = colInfo.modX - 0.18;
      const hitboxLeft = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 1.10, 0.65),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitboxLeft.position.set(leftX, rowY + 0.55, rowZ - 0.25);
      hitboxLeft.userData = { seatIndex, row: rowNumber, col: colInfo.colA, x: leftX, y: rowY, z: rowZ - 0.25 };
      stadiumGroup.add(hitboxLeft);
      App.seatHitboxes.push(hitboxLeft);

      App.seats.push({
        index: seatIndex,
        row: rowNumber,
        col: colInfo.colA,
        x: leftX,
        y: rowY,
        z: rowZ - 0.25,
        occupantId: null,
        group: null,
        fabricMeshes: []
      });
      seatIndex++;

      // Right Seat in twin module (seat spacing: ±0.18)
      const rightX = colInfo.modX + 0.18;
      const hitboxRight = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 1.10, 0.65),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitboxRight.position.set(rightX, rowY + 0.55, rowZ - 0.25);
      hitboxRight.userData = { seatIndex, row: rowNumber, col: colInfo.colB, x: rightX, y: rowY, z: rowZ - 0.25 };
      stadiumGroup.add(hitboxRight);
      App.seatHitboxes.push(hitboxRight);

      App.seats.push({
        index: seatIndex,
        row: rowNumber,
        col: colInfo.colB,
        x: rightX,
        y: rowY,
        z: rowZ - 0.25,
        occupantId: null,
        group: null,
        fabricMeshes: []
      });
      seatIndex++;
    });
  }

  scene.add(stadiumGroup);

  // 3. Load the GLB Theater Seat Model and Clone onto all Seats
  if (typeof THREE.GLTFLoader === "function") {
    const loader = new THREE.GLTFLoader();
    loader.load(
      "./assets/theater/cinema_chair.glb",
      (gltf) => {
        // Apply theme materials to the GLTF model
        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            const matName = (child.material && child.material.name) ? child.material.name.toLowerCase() : "";
            const isFabric = matName.includes("fabric") || matName.includes("denim") || matName.includes("brown") || matName.includes("cushion") || matName.includes("seat");
            if (isFabric) {
              child.material = themeFabricMat;
              child.userData.isFabric = true;
            } else {
              child.material = themeFrameMat;
            }
          }
        });

        // Scale seat to commercial cinema proportions (reduced by 25% from 0.255)
        const seatScale = 0.192;
        gltf.scene.scale.setScalar(seatScale);
        gltf.scene.updateMatrixWorld(true);

        const rawBox = new THREE.Box3().setFromObject(gltf.scene);
        const center = rawBox.getCenter(new THREE.Vector3());

        const pivotGroup = new THREE.Group();
        gltf.scene.position.set(-center.x, -rawBox.min.y, -center.z);
        pivotGroup.add(gltf.scene);
        pivotGroup.rotation.y = Math.PI; // Face the screen (-Z)

        let currentSeatIdx = 0;
        for (let r = 0; r < rowCount; r++) {
          const rowZ = startZ + r * rowSpacing;
          const rowY = 0.20 + r * tierHeight;

          moduleCols.forEach((colInfo) => {
            const moduleClone = pivotGroup.clone(true);

            // Eliminate duplicate armrests & cupholders between adjacent twin chair modules
            const isLastInBlock = colInfo.colB === 22 || colInfo.colB === 58 || colInfo.colB === 80;
            if (!isLastInBlock) {
              const toRemove = [];
              moduleClone.traverse((child) => {
                if (child.name === "Object_8" || child.name === "Object_16") {
                  toRemove.push(child);
                }
              });
              toRemove.forEach((child) => {
                if (child.parent) child.parent.remove(child);
              });
            }

            moduleClone.position.set(colInfo.modX, rowY, rowZ - 0.25);
            stadiumGroup.add(moduleClone);
            moduleClone.updateMatrixWorld(true);

            // Separate fabric meshes into left and right seat
            const leftFabrics = [];
            const rightFabrics = [];

            moduleClone.traverse((child) => {
              if (child.isMesh && child.userData.isFabric) {
                child.material = themeFabricMat.clone();
                const childCenter = new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3());
                if (childCenter.x < colInfo.modX) {
                  leftFabrics.push(child);
                } else {
                  rightFabrics.push(child);
                }
              }
            });

            // Associate with registered seat records
            if (App.seats[currentSeatIdx]) {
              App.seats[currentSeatIdx].group = moduleClone;
              App.seats[currentSeatIdx].fabricMeshes = leftFabrics;
            }
            currentSeatIdx++;

            if (App.seats[currentSeatIdx]) {
              App.seats[currentSeatIdx].group = moduleClone;
              App.seats[currentSeatIdx].fabricMeshes = rightFabrics;
            }
            currentSeatIdx++;
          });
        }
      },
      undefined,
      (err) => {
        console.warn("Could not load GLB theater seats, using fallback", err);
      }
    );
  }
}

// --- Cinematic Multiplex Lighting ---

function setupLighting(scene) {
  // Deep ambient multiplex blue fill
  const ambient = new THREE.HemisphereLight(0x1e293b, 0x070913, 0.65);
  scene.add(ambient);

  // Soft overhead downlight casting gentle shadows on seats
  const downlight = new THREE.DirectionalLight(0x64748b, 0.45);
  downlight.position.set(0, 11.5, 3.0);
  downlight.castShadow = true;
  downlight.shadow.mapSize.width = 1024;
  downlight.shadow.mapSize.height = 1024;
  scene.add(downlight);

  // Soft blue ambient bounce from the ceiling
  const ceilingBounce = new THREE.PointLight(0x2563eb, 1.8, 25, 2.0);
  ceilingBounce.position.set(0, 11.0, 5.0);
  scene.add(ceilingBounce);
}


// --- 3D Character Models, Skeletal Animations & Presets ---

const SHARED_ANIM_MAP = {
  idle: "Idle",
  walk: "Walk",
  run: "Run",
  slouch_walk: "Slouch walk",
  jump: "Jump",
  cheer: "Cheer",
  wave: "Wave",
  laugh: "Laugh",
  talk: "Talk",
  turn_left_45: "Turn left 45°",
  turn_right_45: "Turn right 45°",
  turn_left_90: "Turn left 90°",
  turn_right_90: "Turn right 90°",
  turn_360: "Full turn 360°",
  sit_down: "Sit down (chair)",
  stand_up: "Stand up (chair)",
  sitting: "Sit down (chair)",
  standing: "Stand up (chair)",
  clap: "Cheer"
};

const CHARACTER_PRESETS = {
  // --- Female Characters (6 models) ---
  character_406814: {
    name: "Female 1",
    icon: "",
    url: "./assets/characters/female/character_406814.glb",
    modelScale: 0.539, // Reduced 10% from 0.60
    targetHeight: 0.67,
    seatYOffset: 0.076,
    seatZOffset: -0.271,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406815: {
    name: "Female 2",
    icon: "‍️",
    url: "./assets/characters/female/character_406815.glb",
    modelScale: 0.447,
    targetHeight: 0.68,
    seatYOffset: 0.063,
    seatZOffset: -0.279,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406816: {
    name: "Female 3",
    icon: "‍️",
    url: "./assets/characters/female/character_406816.glb",
    modelScale: 0.495,
    targetHeight: 0.67,
    seatYOffset: 0.069,
    seatZOffset: -0.277,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406817: {
    name: "Female 4",
    icon: "‍️",
    url: "./assets/characters/female/character_406817.glb",
    modelScale: 0.519,
    targetHeight: 0.66,
    seatYOffset: 0.073,
    seatZOffset: -0.276,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406825: {
    name: "Female 5",
    icon: "",
    url: "./assets/characters/female/character_406825.glb",
    modelScale: 0.486,
    targetHeight: 0.68,
    seatYOffset: 0.076,
    seatZOffset: -0.270,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406826: {
    name: "Female 6",
    icon: "‍️",
    url: "./assets/characters/female/character_406826.glb",
    modelScale: 0.483,
    targetHeight: 0.68,
    seatYOffset: 0.067,
    seatZOffset: -0.277,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },

  // --- Male Characters (7 models) ---
  character_406818: {
    name: "Male 1",
    icon: "",
    url: "./assets/characters/male/character_406818.glb",
    modelScale: 0.475,
    targetHeight: 0.71,
    seatYOffset: 0.069,
    seatZOffset: -0.280,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406819: {
    name: "Male 2",
    icon: "",
    url: "./assets/characters/male/character_406819.glb",
    modelScale: 0.471,
    targetHeight: 0.71,
    seatYOffset: 0.059,
    seatZOffset: -0.287,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406820: {
    name: "Male 3",
    icon: "‍️",
    url: "./assets/characters/male/character_406820.glb",
    modelScale: 0.472,
    targetHeight: 0.71,
    seatYOffset: 0.054,
    seatZOffset: -0.290,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406821: {
    name: "Male 4",
    icon: "‍️",
    url: "./assets/characters/male/character_406821.glb",
    modelScale: 0.477,
    targetHeight: 0.70,
    seatYOffset: 0.072,
    seatZOffset: -0.284,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406822: {
    name: "Male 5",
    icon: "‍️",
    url: "./assets/characters/male/character_406822.glb",
    modelScale: 0.421,
    targetHeight: 0.73,
    seatYOffset: 0.044,
    seatZOffset: -0.293,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406823: {
    name: "Male 6",
    icon: "",
    url: "./assets/characters/male/character_406823.glb",
    modelScale: 0.423,
    targetHeight: 0.72,
    seatYOffset: 0.051,
    seatZOffset: -0.290,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406824: {
    name: "Male 7",
    icon: "",
    url: "./assets/characters/male/character_406824.glb",
    modelScale: 0.421,
    targetHeight: 0.72,
    seatYOffset: 0.052,
    seatZOffset: -0.290,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  }
};

const DEFAULT_CHARACTER = "character_406814";

// Aliases for legacy saved keys so clients with stored localStorage won't fail
[
  "man_casual",
  "man_longsleeves",
  "man_sporty",
  "woman_casual",
  "woman_tank",
  "woman_sporty",
  "businessman",
  "hoodie",
  "animated_woman",
  "sporty_woman",
  "female_casual"
].forEach((k) => {
  CHARACTER_PRESETS[k] = CHARACTER_PRESETS.character_406814;
});

// Strictly supported animations matching ticked export
const ALLOWED_ACTIONS = new Set([
  "idle",
  "walk",
  "run",
  "slouch_walk",
  "jump",
  "cheer",
  "wave",
  "laugh",
  "talk",
  "turn_left_45",
  "turn_right_45",
  "turn_left_90",
  "turn_right_90",
  "turn_360",
  "sit_down",
  "stand_up",
  "sitting",
  "standing",
  "clap"
]);

// Shared GLTF cache so models only download once across all spectators
const MODEL_CACHE = new Map();

function loadCharacterModel(presetKey) {
  const preset = CHARACTER_PRESETS[presetKey] || CHARACTER_PRESETS[DEFAULT_CHARACTER];
  if (MODEL_CACHE.has(preset.url)) {
    return MODEL_CACHE.get(preset.url);
  }

  const promise = new Promise((resolve, reject) => {
    if (typeof THREE.GLTFLoader !== "function") {
      reject(new Error("THREE.GLTFLoader is not available"));
      return;
    }
    const loader = new THREE.GLTFLoader();
    loader.load(
      preset.url,
      async (gltf) => {
        resolve({ scene: gltf.scene, animations: gltf.animations || [] });
      },
      undefined,
      (err) => {
        console.error("Failed to load character model from:", preset.url, err);
        reject(err);
      }
    );
  });

  MODEL_CACHE.set(preset.url, promise);
  return promise;
}

function findActionClip(animations, animMap, key) {
  if (!animations || animations.length === 0) return null;

  // 1. Explicit mapping from preset
  if (animMap && animMap[key]) {
    const mapped = animations.find((a) => a.name === animMap[key]);
    if (mapped) return mapped;
  }

  // 2. Exact name match (case-insensitive)
  const exact = animations.find((a) => a.name.toLowerCase() === key.toLowerCase());
  if (exact) return exact;

  // 3. Keyword heuristic search
  const keywordMap = {
    idle: ["idle", "neutral"],
    walk: ["walk"],
    run: ["run", "sprint"],
    slouch_walk: ["slouch walk", "slouch", "walk"],
    jump: ["jump"],
    cheer: ["cheer", "clap"],
    wave: ["wave"],
    laugh: ["laugh"],
    talk: ["talk", "speak"],
    turn_left_45: ["turn left 45", "turn left"],
    turn_right_45: ["turn right 45", "turn right"],
    turn_left_90: ["turn left 90", "turn left"],
    turn_right_90: ["turn right 90", "turn right"],
    turn_360: ["full turn 360", "turn 360", "spin"],
    sit_down: ["sit down", "sit"],
    stand_up: ["stand up", "stand"],
    sitting: ["sit down (chair)", "sit down", "sit"],
    standing: ["stand up (chair)", "stand up", "stand"],
    clap: ["cheer", "clap"]
  };

  const candidates = keywordMap[key] || [key];
  for (const c of candidates) {
    const match = animations.find((a) => a.name.toLowerCase().includes(c.toLowerCase()));
    if (match) return match;
  }

  return animations[0];
}

function playAvatarAction(avatar, actionName, duration = 0.2) {
  if (!avatar || !avatar.userData || !ALLOWED_ACTIONS.has(actionName)) return;

  const actions = avatar.userData.actions;
  if (!actions) return;

  // If seated and triggering an emote, play the seated upper-body variant while remaining seated strictly
  if (avatar.userData.currentActionName === "sitting" && actions[`${actionName}_seated`]) {
    const seatedAction = actions[`${actionName}_seated`];
    if (avatar.userData.activeSeatedEmote && actions[avatar.userData.activeSeatedEmote] && avatar.userData.activeSeatedEmote !== `${actionName}_seated`) {
      actions[avatar.userData.activeSeatedEmote].fadeOut(duration);
    }
    seatedAction.reset().fadeIn(duration).play();
    avatar.userData.activeSeatedEmote = `${actionName}_seated`;
    return;
  }

  if (avatar.userData.currentActionName === actionName) return;

  // If moving out of seated state or switching standing actions, stop any seated emote
  if (avatar.userData.activeSeatedEmote && actions[avatar.userData.activeSeatedEmote]) {
    actions[avatar.userData.activeSeatedEmote].fadeOut(duration);
    avatar.userData.activeSeatedEmote = null;
  }

  const targetAction = actions[actionName] || actions["idle"];
  if (!targetAction) return;

  const prevActionName = avatar.userData.currentActionName;
  const prevAction = prevActionName ? actions[prevActionName] : null;

  if (prevAction && prevAction !== targetAction) {
    prevAction.fadeOut(duration);
  }

  if (actionName === "sitting") {
    targetAction.reset();
    targetAction.setEffectiveWeight(1);
    targetAction.setLoop(THREE.LoopOnce);
    targetAction.clampWhenFinished = true;
    targetAction.time = targetAction.getClip().duration;
    targetAction.paused = false;
    targetAction.play();
    avatar.userData.currentActionName = actionName;
    return;
  }

  targetAction.reset().fadeIn(duration).play();
  avatar.userData.currentActionName = actionName;
}

function createAvatar(user) {
  if (App.avatars.has(user.id)) return App.avatars.get(user.id);

  const group = new THREE.Group();
  group.name = `avatar_${user.id}`;
  const charType = user.characterType || (user.id === App.userId ? App.characterType : DEFAULT_CHARACTER);
  const preset = CHARACTER_PRESETS[charType] || CHARACTER_PRESETS[DEFAULT_CHARACTER];

  // Floating Nameplate
  const nameplate = createNameplateSprite(user.username, user.speaking, user.inVoice && !user.muted);
  nameplate.position.y = (preset.targetHeight || 0.70) + 0.15;
  if (user.id === App.userId) {
    nameplate.visible = false;
  }
  group.add(nameplate);

  // Initial transform
  const initPos = user.position || (user.id === App.userId ? App.position : { x: -7.08, y: 0.68, z: -3.5 });
  group.position.set(initPos.x, initPos.y, initPos.z);
  group.rotation.y = user.rotation || 0;

  group.userData = {
    userId: user.id,
    characterType: charType,
    targetPosition: group.position.clone(),
    targetRotation: group.rotation.y,
    targetHeadPitch: 0,
    targetHeadYaw: 0,
    currentHeadPitch: 0,
    currentHeadYaw: 0,
    nameplate,
    headBone: null,
    leftEyeBone: null,
    rightEyeBone: null,
    headMeshes: [],
    mixer: null,
    actions: {},
    currentActionName: null
  };

  group.visible = (user.id !== App.userId || App.cameraMode !== "FPP");

  App.scene.add(group);
  App.avatars.set(user.id, group);

  loadCharacterModel(charType)
    .then(({ scene, animations }) => {
      let model;
      if (typeof THREE.SkeletonUtils !== "undefined" && THREE.SkeletonUtils.clone) {
        model = THREE.SkeletonUtils.clone(scene);
      } else {
        model = scene.clone(true);
      }

      // Apply exact calibrated scale strictly matching cinema seating
      const scale = preset.modelScale || 0.60;
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);

      const headMeshes = [];
      let headBone = null;
      let leftEyeBone = null;
      let rightEyeBone = null;
      let leftLegBone = null;
      let rightLegBone = null;

      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.name && (child.name.includes("Head") || child.name.includes("head") || child.name.includes("Face") || child.name.includes("Hair"))) {
            headMeshes.push(child);
          }
        }
        if (child.isBone) {
          if (!headBone && (child.name === "Head" || child.name.endsWith("Head") || child.name.endsWith("head"))) {
            headBone = child;
            headBone.userData.baseRotX = child.rotation.x;
            headBone.userData.baseRotY = child.rotation.y;
            headBone.userData.baseRotZ = child.rotation.z;
          }
          if (!leftEyeBone && (child.name === "LeftEye" || child.name.endsWith("LeftEye") || child.name.endsWith("Eye_L"))) {
            leftEyeBone = child;
          }
          if (!rightEyeBone && (child.name === "RightEye" || child.name.endsWith("RightEye") || child.name.endsWith("Eye_R"))) {
            rightEyeBone = child;
          }
          if (child.name === "LeftLeg" || child.name.endsWith("LeftLeg") || child.name.endsWith("Leg_L")) {
            leftLegBone = child;
          }
          if (child.name === "RightLeg" || child.name.endsWith("RightLeg") || child.name.endsWith("Leg_R")) {
            rightLegBone = child;
          }
        }
      });

      // Align character shoe soles strictly to floor y = 0
      model.updateMatrixWorld(true);
      const mBox = new THREE.Box3().setFromObject(model);
      model.position.y = -mBox.min.y;

      group.userData.headBone = headBone;
      group.userData.leftEyeBone = leftEyeBone;
      group.userData.rightEyeBone = rightEyeBone;
      group.userData.headMeshes = headMeshes;
      group.userData.leftLegBone = leftLegBone;
      group.userData.rightLegBone = rightLegBone;

      const mixer = new THREE.AnimationMixer(model);
      group.userData.mixer = mixer;

      const actions = {};
      const loopOnceKeys = new Set([
        "jump", "cheer", "wave", "laugh", "talk",
        "turn_left_45", "turn_right_45", "turn_left_90", "turn_right_90", "turn_360",
        "sit_down", "stand_up", "standing", "clap", "sitting"
      ]);

      const seatedUpperEmotes = new Set(["cheer", "clap", "wave", "laugh", "talk"]);
      const lowerBodyBones = new Set([
        "Hips", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase", "LeftToe_End", "RightToe_End"
      ]);

      ALLOWED_ACTIONS.forEach((key) => {
        const clip = findActionClip(animations, preset.animMap, key);
        if (clip) {
          const action = mixer.clipAction(clip);
          if (loopOnceKeys.has(key)) {
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
          } else {
            action.setLoop(THREE.LoopRepeat);
          }
          actions[key] = action;

          // Seated upper-body emote clips allowing gestures while sitting firmly
          if (seatedUpperEmotes.has(key)) {
            const upperTracks = clip.tracks.filter((t) => {
              const bone = t.name.split(".")[0];
              return !lowerBodyBones.has(bone);
            });
            if (upperTracks.length > 0) {
              const seatedClip = new THREE.AnimationClip(`${key}_seated`, clip.duration, upperTracks);
              const seatedAction = mixer.clipAction(seatedClip);
              seatedAction.setLoop(THREE.LoopOnce);
              seatedAction.clampWhenFinished = false;
              actions[`${key}_seated`] = seatedAction;
            }
          }
        }
      });

      group.userData.actions = actions;
      group.add(model);

      if (user.seated && user.seatIndex !== null) {
        playAvatarAction(group, "sitting", 0.0);
        snapAvatarToSeat(user.id, user.seatIndex);
      } else {
        playAvatarAction(group, user.action || "idle", 0.0);
      }

      if (user.id === App.userId) {
        updateLocalAvatarVisibility();
      }
    })
    .catch((err) => {
      console.warn("Could not load character model:", err);
      createFallbackAvatarMesh(group, user);
    });

  if (user.seated && user.seatIndex !== null) {
    snapAvatarToSeat(user.id, user.seatIndex);
  }

  return group;
}

function createFallbackAvatarMesh(group, user) {
  const color = user.avatarColor || AVATAR_PALETTE[user.colorIndex % AVATAR_PALETTE.length] || 0x8170e8;
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd4a373, roughness: 0.7 });
  const shirtMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e2029, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 8), shirtMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
  head.position.y = 1.82;
  head.castShadow = true;
  group.add(head);
  group.userData.headMeshes = [head];
}

function createNameplateSprite(name, isSpeaking = false, isMicOn = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");

  // Rounded pill background
  ctx.fillStyle = "rgba(12, 14, 22, 0.85)";
  ctx.beginPath();
  ctx.roundRect(32, 12, 448, 72, 36);
  ctx.fill();

  // Border glow if speaking
  if (isSpeaking) {
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // Label text
  ctx.font = "600 32px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isSpeaking ? "#34d399" : "#f3f4f6";

  const prefix = isSpeaking ? "● " : isMicOn ? " " : "";
  ctx.fillText(`${prefix}${name}`.slice(0, 22), 256, 48);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(2.2, 0.42, 1);
  return sprite;
}

function updateNameplate(userId) {
  const user = App.users.get(userId);
  const avatar = App.avatars.get(userId);
  if (!user || !avatar) return;

  if (avatar.userData.nameplate) {
    avatar.remove(avatar.userData.nameplate);
    if (avatar.userData.nameplate.material.map) {
      avatar.userData.nameplate.material.map.dispose();
    }
  }

  const nameplate = createNameplateSprite(user.username, user.speaking, user.inVoice && !user.muted);
  nameplate.position.y = 1.50;
  if (userId === App.userId) {
    nameplate.visible = false;
  }
  avatar.add(nameplate);
  avatar.userData.nameplate = nameplate;
}

function snapAvatarToSeat(userId, seatIndex) {
  const seat = App.seats[seatIndex];
  const avatar = App.avatars.get(userId);
  if (!seat || !avatar) return;

  const charType = avatar.userData.characterType || DEFAULT_CHARACTER;
  const preset = CHARACTER_PRESETS[charType] || CHARACTER_PRESETS[DEFAULT_CHARACTER];

  const yOffset = preset.seatYOffset !== undefined ? preset.seatYOffset : 0.065;
  const zOffset = preset.seatZOffset !== undefined ? preset.seatZOffset : -0.280;

  // Natural seating placement facing the cinema screen (-Z)
  avatar.position.set(seat.x, seat.y + yOffset, seat.z + zOffset);
  avatar.rotation.y = Math.PI; // Strictly face screen (-Z)
  avatar.userData.targetPosition.copy(avatar.position);
  avatar.userData.targetRotation = Math.PI;

  if (userId === App.userId) {
    App.rotation = Math.PI;
    App.position.copy(avatar.position);
  }

  const actions = avatar.userData.actions;
  if (avatar.userData.activeSeatedEmote && actions) {
    const emoteAct = actions[avatar.userData.activeSeatedEmote];
    if (emoteAct) emoteAct.stop();
    avatar.userData.activeSeatedEmote = null;
  }
  if (actions) {
    const sitAct = actions.sitting || actions.sit_down;
    if (sitAct) {
      sitAct.reset();
      sitAct.setEffectiveWeight(1);
      sitAct.setLoop(THREE.LoopOnce);
      sitAct.clampWhenFinished = true;
      sitAct.time = sitAct.getClip().duration;
      sitAct.paused = false;
      sitAct.play();
      if (avatar.userData.currentActionName && avatar.userData.currentActionName !== "sitting") {
        const prev = actions[avatar.userData.currentActionName];
        if (prev && prev !== sitAct) prev.fadeOut(0.15);
      }
      avatar.userData.currentActionName = "sitting";
    }
  } else {
    playAvatarAction(avatar, "sitting", 0.15);
  }

  if (avatar.userData.nameplate) {
    avatar.userData.nameplate.position.y = 0.78;
  }

  if (userId === App.userId) {
    updateLocalAvatarVisibility();
  }
}

function updateRemoteAvatarMovement(msg) {
  const avatar = App.avatars.get(msg.userId);
  if (!avatar) return;

  if (msg.position) {
    avatar.userData.targetPosition.set(msg.position.x, msg.position.y, msg.position.z);
  }
  if (typeof msg.rotation === "number") {
    avatar.userData.targetRotation = msg.rotation;
  }
  if (typeof msg.headPitch === "number") {
    avatar.userData.targetHeadPitch = msg.headPitch;
  }
  if (typeof msg.headYaw === "number") {
    avatar.userData.targetHeadYaw = msg.headYaw;
  }
  if (msg.action) {
    playAvatarAction(avatar, msg.action, msg.action === "jump" ? 0.1 : 0.2);
  }
}

function handleRemoteEmote(msg) {
  if (msg.userId === App.userId) return; // Prevent local loopback override
  const avatar = App.avatars.get(msg.userId);
  if (!avatar) return;

  const seatIdx = App.seats.findIndex((s) => s.occupantId === msg.userId);
  const isSeated = seatIdx !== -1;
  const action = msg.action || msg.emote || "cheer";

  if (isSeated) {
    // Keep avatar strictly in the seat!
    snapAvatarToSeat(msg.userId, seatIdx);
  }

  playAvatarAction(avatar, action, 0.15);

  const emoteDurations = {
    cheer: 2200,
    clap: 2200,
    wave: 1800,
    laugh: 3000,
    talk: 3500,
    turn_360: 3600
  };
  const duration = emoteDurations[action] || 2200;

  setTimeout(() => {
    if (seatIdx !== -1) {
      if (avatar.userData.activeSeatedEmote && avatar.userData.actions) {
        const act = avatar.userData.actions[avatar.userData.activeSeatedEmote];
        if (act) act.fadeOut(0.25);
        avatar.userData.activeSeatedEmote = null;
      }
    } else {
      playAvatarAction(avatar, "idle", 0.2);
    }
  }, duration);
}

function toggleCameraMode() {
  App.cameraMode = App.cameraMode === "FPP" ? "TPP" : "FPP";
  localStorage.setItem("vc-cameramode", App.cameraMode);
  updateCameraModeUI();
  updateLocalAvatarVisibility();
  toast(`View mode: ${App.cameraMode === "FPP" ? "First Person (FPP)" : "Third Person (TPP)"}`);
}

function updateCameraModeUI() {
  if (ui.cameraModeButton) {
    ui.cameraModeButton.textContent = App.cameraMode === "FPP" ? " FPP" : " TPP";
    ui.cameraModeButton.title = `Switch View (Current: ${App.cameraMode === "FPP" ? "First Person" : "Third Person"}, Press V)`;
  }
}

function updateLocalAvatarVisibility() {
  const myAvatar = App.avatars.get(App.userId);
  if (!myAvatar) return;

  const isFPP = App.cameraMode === "FPP";

  if (isFPP) {
    // In FPP, hide the local avatar mesh completely from the local player's view:
    // This eliminates inner body clipping (eyeballs, teeth, inner neck/torso),
    // and places the player's view cleanly through their avatar's eyes!
    myAvatar.visible = false;
    if (myAvatar.userData.nameplate) {
      myAvatar.userData.nameplate.visible = false;
    }
  } else {
    // In TPP, restore full avatar visibility
    myAvatar.visible = true;
    if (myAvatar.userData.headBone) {
      myAvatar.userData.headBone.scale.set(1, 1, 1);
    }
    if (myAvatar.userData.nameplate) {
      myAvatar.userData.nameplate.visible = false;
    }
  }
}

function triggerEmote(actionName = "cheer") {
  if (!App.inRoom) return;

  const myAvatar = App.avatars.get(App.userId);
  const wasSeatedIndex = App.currentSeatIndex;

  App.activeEmote = actionName;
  App.isClapping = (actionName === "cheer" || actionName === "clap");

  // STRICT REQUIREMENT: If seated, stay strictly in seat and perform seated emote in place
  if (myAvatar) {
    playAvatarAction(myAvatar, actionName, 0.15);
  }

  sendSocket({
    type: "emote",
    action: actionName,
    emote: actionName
  });

  const emoteDurations = {
    cheer: 2200,
    clap: 2200,
    wave: 1800,
    laugh: 3000,
    talk: 3500,
    turn_360: 3600,
    turn_left_45: 1000,
    turn_right_45: 1000,
    turn_left_90: 1000,
    turn_right_90: 1000
  };
  const duration = emoteDurations[actionName] || 2200;

  if (App.emoteTimeout) clearTimeout(App.emoteTimeout);
  if (App.clapTimeout) clearTimeout(App.clapTimeout);

  App.emoteTimeout = setTimeout(() => {
    App.activeEmote = null;
    App.isClapping = false;
    if (myAvatar) {
      if (wasSeatedIndex !== null && App.currentSeatIndex === wasSeatedIndex) {
        if (myAvatar.userData.activeSeatedEmote && myAvatar.userData.actions) {
          const act = myAvatar.userData.actions[myAvatar.userData.activeSeatedEmote];
          if (act) act.fadeOut(0.25);
          myAvatar.userData.activeSeatedEmote = null;
        }
      } else if (App.currentSeatIndex === null) {
        playAvatarAction(myAvatar, "idle", 0.2);
      }
    }
  }, duration);
}

function triggerClap() {
  triggerEmote("cheer");
}

// --- Seat Interaction & Seating Logic ---

function updateSeatOccupancy(seatId, occupantId, occupantName) {
  const seat = App.seats[seatId];
  if (!seat) return;

  seat.occupantId = occupantId;

  // Visual seat cushion feedback
  if (seat.fabricMeshes && seat.fabricMeshes.length > 0) {
    const targetColor = occupantId ? 0x5b3570 : 0x16243f;
    seat.fabricMeshes.forEach((mesh) => {
      if (mesh.material && mesh.material.color) {
        mesh.material.color.set(targetColor);
      }
    });
  } else if (seat.cushion && seat.cushion.material) {
    seat.cushion.material.color.set(occupantId ? 0x523260 : 0x161c2e);
  }

  // Update user state in users collection
  if (occupantId) {
    const u = App.users.get(occupantId);
    if (u) {
      u.seated = true;
      u.seatIndex = seatId;
    }
    snapAvatarToSeat(occupantId, seatId);
  } else {
    for (const u of App.users.values()) {
      if (u.seatIndex === seatId) {
        u.seated = false;
        u.seatIndex = null;
      }
    }
  }

  // If local user took or left seat
  if (occupantId === App.userId) {
    App.currentSeatIndex = seatId;
    if (ui.seatStatus) ui.seatStatus.textContent = `Row ${seat.row}, Seat ${seat.col}`;
    if (ui.standButton) ui.standButton.hidden = false;
    App.cameraYaw = 0;
    App.cameraPitch = 0.08;
    snapAvatarToSeat(App.userId, seatId);
  } else if (App.currentSeatIndex === seatId && occupantId === null) {
    App.currentSeatIndex = null;
    if (ui.seatStatus) ui.seatStatus.textContent = "Standing";
    if (ui.standButton) ui.standButton.hidden = true;
    const myAvatar = App.avatars.get(App.userId);
    if (myAvatar) {
      myAvatar.visible = true;
      if (myAvatar.userData.nameplate) {
        myAvatar.userData.nameplate.position.y = 0.88;
      }
    }
    App.cameraPitch = 0.24;
  }
}

function handleSeatClick(event) {
  if (!App.inRoom || !App.renderer || !App.camera) return;

  // STRICT CHECK: If user just dragged to rotate camera, DO NOT select a seat!
  if (App.hasDragged) {
    App.hasDragged = false;
    return;
  }
  const clickDist = Math.hypot(event.clientX - (App.dragStartX || 0), event.clientY - (App.dragStartY || 0));
  if (clickDist > 6) {
    return;
  }

  const rect = App.renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, App.camera);
  const intersects = raycaster.intersectObjects(App.seatHitboxes, false);

  if (intersects.length > 0) {
    const seatIdx = intersects[0].object.userData.seatIndex;
    if (seatIdx === App.currentSeatIndex) {
      return; // Already seated in this seat
    }
    const seat = App.seats[seatIdx];
    if (seat.occupantId && seat.occupantId !== App.userId) {
      toast("This seat is currently occupied.", true);
      return;
    }
    sendSocket({ type: "take-seat", seat: seatIdx });
  }
}

function handlePointerMove(event) {
  if (!App.inRoom || !App.renderer || !App.camera) return;

  // Free-look camera drag
  if (App.isPointerDown) {
    const totalDist = Math.hypot(event.clientX - App.dragStartX, event.clientY - App.dragStartY);
    if (totalDist > 5) {
      App.hasDragged = true;
      if (ui.seatTooltip) ui.seatTooltip.hidden = true;
    }
    const deltaX = event.clientX - App.lastPointerX;
    const deltaY = event.clientY - App.lastPointerY;
    App.lastPointerX = event.clientX;
    App.lastPointerY = event.clientY;

    App.cameraYaw -= deltaX * 0.004;
    App.cameraPitch = Math.max(-Math.PI / 2.6, Math.min(Math.PI / 2.4, App.cameraPitch - deltaY * 0.004));
    return;
  }

  // Hover detection over seats
  const rect = App.renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, App.camera);
  const intersects = raycaster.intersectObjects(App.seatHitboxes, false);

  if (intersects.length > 0) {
    const seatIdx = intersects[0].object.userData.seatIndex;
    const seat = App.seats[seatIdx];
    App.hoveredSeat = seat;
    document.body.style.cursor = "pointer";

    if (ui.seatTooltip) {
      ui.seatTooltip.hidden = false;
      ui.seatTooltip.style.left = `${event.clientX + 14}px`;
      ui.seatTooltip.style.top = `${event.clientY - 24}px`;
      ui.seatTooltip.textContent = seat.occupantId
        ? `Row ${seat.row}, Seat ${seat.col} (Occupied)`
        : `Click to sit: Row ${seat.row}, Seat ${seat.col}`;
    }
  } else {
    App.hoveredSeat = null;
    document.body.style.cursor = "default";
    if (ui.seatTooltip) ui.seatTooltip.hidden = true;
  }
}

function standUp() {
  if (App.currentSeatIndex === null) return;
  const currentSeat = App.seats[App.currentSeatIndex];

  sendSocket({ type: "stand" });
  App.currentSeatIndex = null;
  if (ui.seatStatus) ui.seatStatus.textContent = "Standing";
  if (ui.standButton) ui.standButton.hidden = true;

  // Stand directly in front of the seat in the row walkway (safely on the tier platform!)
  if (currentSeat) {
    App.position.set(currentSeat.x, currentSeat.y, currentSeat.z - 0.32);
    App.rotation = Math.PI; // Face the screen
    App.isGrounded = true;
    App.verticalVelocity = 0;
    const myAvatar = App.avatars.get(App.userId);
    if (myAvatar) {
      if (myAvatar.userData.activeSeatedEmote && myAvatar.userData.actions) {
        const act = myAvatar.userData.actions[myAvatar.userData.activeSeatedEmote];
        if (act) act.stop();
        myAvatar.userData.activeSeatedEmote = null;
      }
      myAvatar.position.copy(App.position);
      myAvatar.rotation.y = App.rotation;
      myAvatar.userData.targetPosition.copy(App.position);
      if (myAvatar.userData.nameplate) {
        myAvatar.userData.nameplate.position.y = 0.88;
      }
      playAvatarAction(myAvatar, "stand_up", 0.15);
      setTimeout(() => {
        if (App.currentSeatIndex === null && !App.activeEmote) {
          playAvatarAction(myAvatar, "idle", 0.2);
        }
      }, 700);
      updateLocalAvatarVisibility();
    }
    broadcastLocalMovement("stand_up");
  }
  App.cameraPitch = 0.15;
}

// Exact stadium riser & glowing stair step ground height calculation
function getExactTheaterGround(x, z) {
  // Front flat area before first stadium riser
  if (z < -9.03) return 0.0;
  // Front entry steps / ramp
  if (z < -8.47) {
    return z < -8.75 ? 0.07 : 0.14;
  }
  // Top rear walkway platform behind last row
  if (z >= 16.05) return 2.92;

  const isStairs = Math.abs(x - (-7.08)) <= 0.65 || Math.abs(x - 7.08) <= 0.65;
  const relZ = z - (-8.47);
  const r = Math.max(0, Math.min(17, Math.floor(relZ / 1.35)));
  const rowY = 0.20 + r * 0.16;

  if (isStairs) {
    const fraction = (relZ - r * 1.35) / 1.35;
    // Step 0 (front half of tier) is rowY - 0.08; Step 1 (back half) is rowY
    return (fraction < 0.5) ? (rowY - 0.08) : rowY;
  }
  return rowY;
}

// Strict collision detection preventing players from walking through chairs, stage, screen, or walls
function checkTheaterCollision(x, z, radius = 0.14) {
  // 1. Outer theater walls and stage/screen boundary
  if (x - radius < -15.6 || x + radius > 15.6) return true;
  if (z - radius < -12.8 || z + radius > 17.8) return true;

  // 2. Stadium seating blocks (18 rows of physical chairs)
  // Chair depth is rowZ - 0.42 to rowZ + 0.05
  // Walkway in front of chairs (rowZ - 0.675 to rowZ - 0.44) is OPEN for walking along the row
  const startZ = -7.0;
  const rowSpacing = 1.35;
  const rowCount = 18;

  for (let r = 0; r < rowCount; r++) {
    const rowZ = startZ + r * rowSpacing;
    const chairZMin = rowZ - 0.42;
    const chairZMax = rowZ + 0.05;

    // Check if player circle overlaps this row's chair depth
    if (z + radius > chairZMin && z - radius < chairZMax) {
      // Left block of chairs: x from -15.65 to -7.60
      if (x + radius > -15.65 && x - radius < -7.60) return true;
      // Center block of chairs: x from -6.55 to 6.55
      if (x + radius > -6.55 && x - radius < 6.55) return true;
      // Right block of chairs: x from 7.60 to 15.65
      if (x + radius > 7.60 && x - radius < 15.65) return true;
    }
  }

  return false;
}

// --- Player Movement & Follow Camera ---

function updateLocalMovement(delta) {
  if (!App.inRoom) return;

  // If seated, pressing any movement or jump key automatically stands up and begins locomotion
  if (App.currentSeatIndex !== null) {
    const hasMoveKey = App.activeKeys.has("KeyW") || App.activeKeys.has("KeyS") ||
                       App.activeKeys.has("KeyA") || App.activeKeys.has("KeyD") ||
                       App.activeKeys.has("ArrowUp") || App.activeKeys.has("ArrowDown") ||
                       App.activeKeys.has("ArrowLeft") || App.activeKeys.has("ArrowRight") ||
                       App.activeKeys.has("Space");
    if (hasMoveKey) {
      standUp();
    } else {
      return;
    }
  }

  const myAvatar = App.avatars.get(App.userId);

  const moveDir = new THREE.Vector3();
  if (App.activeKeys.has("KeyW") || App.activeKeys.has("ArrowUp")) moveDir.z -= 1;
  if (App.activeKeys.has("KeyS") || App.activeKeys.has("ArrowDown")) moveDir.z += 1;
  if (App.activeKeys.has("KeyA") || App.activeKeys.has("ArrowLeft")) moveDir.x -= 1;
  if (App.activeKeys.has("KeyD") || App.activeKeys.has("ArrowRight")) moveDir.x += 1;

  const isMoving = moveDir.lengthSq() > 0;
  const isRunning = isMoving && (App.activeKeys.has("ShiftLeft") || App.activeKeys.has("ShiftRight"));
  const isSlouch = isMoving && !isRunning && App.isSlouchWalk;

  // Exact step and tier height calculation matching every physical mesh
  const targetGroundY = getExactTheaterGround(App.position.x, App.position.z);

  // Jump physics trigger
  if (App.activeKeys.has("Space") && App.isGrounded && !App.isJumping) {
    App.verticalVelocity = 4.2;
    App.isGrounded = false;
    App.isJumping = true;
    if (myAvatar) playAvatarAction(myAvatar, "jump", 0.1);
  }

  // Vertical physics & gravity
  if (!App.isGrounded) {
    App.verticalVelocity -= 14.0 * delta;
    App.position.y += App.verticalVelocity * delta;
    if (App.position.y <= targetGroundY) {
      App.position.y = targetGroundY;
      App.verticalVelocity = 0;
      App.isGrounded = true;
      App.isJumping = false;
    }
  } else {
    // Smooth stepping when walking up/down stairs or across tiers (no sudden drops or clips!)
    if (Math.abs(App.position.y - targetGroundY) < 0.005) {
      App.position.y = targetGroundY;
    } else {
      App.position.y = THREE.MathUtils.damp(App.position.y, targetGroundY, 22.0, delta);
    }
  }

  if (isMoving) {
    // If emote/clapping while moving, cancel emote
    if (App.activeEmote || App.isClapping) {
      App.activeEmote = null;
      App.isClapping = false;
      if (App.emoteTimeout) clearTimeout(App.emoteTimeout);
      if (App.clapTimeout) clearTimeout(App.clapTimeout);
    }

    moveDir.normalize();
    // Move relative to camera yaw
    moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), App.cameraYaw);

    // Smooth, realistic cinema locomotion speed (reduced by 40% for calm, controllable movement)
    const speed = isRunning ? 2.52 : 1.32;
    const dx = moveDir.x * delta * speed;
    const dz = moveDir.z * delta * speed;

    const nextX = App.position.x + dx;
    const nextZ = App.position.z + dz;

    // Strict collision resolution against seats, walls, stage, and screen
    const currBlocked = checkTheaterCollision(App.position.x, App.position.z);
    if (!checkTheaterCollision(nextX, nextZ)) {
      App.position.x = nextX;
      App.position.z = nextZ;
    } else {
      let moved = false;
      // Slide along X if X direction is free
      if (!checkTheaterCollision(nextX, App.position.z)) {
        App.position.x = nextX;
        moved = true;
      }
      // Slide along Z if Z direction is free
      if (!checkTheaterCollision(App.position.x, nextZ)) {
        App.position.z = nextZ;
        moved = true;
      }
      // Unstuck safeguard: if player is ever trapped, allow moving freely to exit
      if (!moved && currBlocked) {
        App.position.x = nextX;
        App.position.z = nextZ;
      }
    }

    App.rotation = Math.atan2(moveDir.x, moveDir.z);
  }

  // In standing FPP, if not actively moving, smoothly orient avatar body to face forward with camera view
  if (App.cameraMode === "FPP" && App.currentSeatIndex === null) {
    if (!isMoving) {
      App.rotation = THREE.MathUtils.lerp(App.rotation, App.cameraYaw + Math.PI, 0.25);
    }
  }

  if (myAvatar) {
    myAvatar.position.copy(App.position);
    myAvatar.rotation.y = App.rotation;
    myAvatar.userData.targetPosition.copy(App.position);
  }

  // Strictly select from the permitted actions
  let currentAction = "idle";
  if (App.activeEmote) {
    currentAction = App.activeEmote;
  } else if (!App.isGrounded || App.isJumping) {
    currentAction = "jump";
  } else if (isMoving) {
    currentAction = isRunning ? "run" : (isSlouch ? "slouch_walk" : "walk");
  } else {
    currentAction = "idle";
  }

  if (myAvatar) {
    playAvatarAction(myAvatar, currentAction, currentAction === "jump" ? 0.1 : 0.2);
  }

  broadcastLocalMovement(currentAction);
}

function broadcastLocalMovement(action = "idle") {
  const now = performance.now();
  if (now - App.lastMoveSendTime > 75) {
    App.lastMoveSendTime = now;

    const myAvatar = App.avatars.get(App.userId);
    const headPitch = (myAvatar && myAvatar.userData.currentHeadPitch !== undefined)
      ? myAvatar.userData.currentHeadPitch
      : Math.max(-0.65, Math.min(0.65, App.cameraPitch));
    const headYaw = (myAvatar && myAvatar.userData.currentHeadYaw !== undefined)
      ? myAvatar.userData.currentHeadYaw
      : 0;

    sendSocket({
      type: "move",
      position: { x: App.position.x, y: App.position.y, z: App.position.z },
      rotation: App.rotation,
      headPitch: headPitch,
      headYaw: headYaw,
      action: action
    });
  }
}

function updateCamera(delta) {
  if (!App.camera) return;

  // Dynamic smooth zoom adjustment for FPP (adjusting Field of View)
  if (App.cameraMode === "FPP") {
    if (App.targetFppFov === undefined) App.targetFppFov = 56;
    if (App.fppFov === undefined) App.fppFov = App.camera.fov || 56;
    App.fppFov = THREE.MathUtils.damp(App.fppFov, App.targetFppFov, 12.0, delta || 0.016);
    if (Math.abs(App.camera.fov - App.fppFov) > 0.02) {
      App.camera.fov = App.fppFov;
      App.camera.updateProjectionMatrix();
    }
  } else {
    // In TPP mode, restore standard cinema FOV
    if (Math.abs(App.camera.fov - 56) > 0.05) {
      App.camera.fov = THREE.MathUtils.damp(App.camera.fov, 56, 10.0, delta || 0.016);
      App.camera.updateProjectionMatrix();
    }
  }

  if (!App.smoothedCameraTarget) {
    App.smoothedCameraTarget = new THREE.Vector3();
  }

  const myAvatar = App.avatars.get(App.userId);

  // Compute exact skeletal eye position dynamically from character bones
  let exactEyePos = null;
  if (myAvatar) {
    myAvatar.updateMatrixWorld(true);
    if (myAvatar.userData.leftEyeBone && myAvatar.userData.rightEyeBone) {
      const pL = new THREE.Vector3();
      const pR = new THREE.Vector3();
      myAvatar.userData.leftEyeBone.getWorldPosition(pL);
      myAvatar.userData.rightEyeBone.getWorldPosition(pR);
      exactEyePos = pL.add(pR).multiplyScalar(0.5);
    } else if (myAvatar.userData.headBone) {
      exactEyePos = new THREE.Vector3();
      myAvatar.userData.headBone.getWorldPosition(exactEyePos);
      exactEyePos.y += 0.02; // Up from head joint to eye level
    }
  }

  const lookDir = new THREE.Vector3(
    -Math.sin(App.cameraYaw) * Math.cos(App.cameraPitch),
    Math.sin(App.cameraPitch),
    -Math.cos(App.cameraYaw) * Math.cos(App.cameraPitch)
  );

  if (App.currentSeatIndex !== null) {
    // Seated Camera
    const seat = App.seats[App.currentSeatIndex];
    if (seat) {
      if (App.cameraMode === "FPP") {
        // True First Person inside seat: placed precisely at character eye position with 20% increased height
        const baseHeight = exactEyePos ? (exactEyePos.y - seat.y) : 0.54;
        const elevatedY = seat.y + baseHeight * 1.20;
        const eyePos = exactEyePos
          ? exactEyePos.clone()
          : new THREE.Vector3(seat.x, elevatedY, seat.z - 0.14);
        eyePos.y = elevatedY;
        eyePos.addScaledVector(lookDir, 0.04);

        App.camera.position.lerp(eyePos, 0.35);

        const targetLook = eyePos.clone().add(lookDir.clone().multiplyScalar(10));
        App.camera.lookAt(targetLook);
      } else {
        // Seated Third Person (TPP): Orbit camera above and behind the seat
        const seatCenter = new THREE.Vector3(seat.x, seat.y + 0.56, seat.z - 0.12);
        const dist = App.seatedTppDistance || 1.15;
        const offset = new THREE.Vector3(
          Math.sin(App.cameraYaw) * Math.cos(App.cameraPitch),
          Math.sin(App.cameraPitch) + 0.22,
          Math.cos(App.cameraYaw) * Math.cos(App.cameraPitch)
        ).multiplyScalar(dist);
        const desiredPos = seatCenter.clone().add(offset);
        App.camera.position.lerp(desiredPos, 0.22);
        App.camera.lookAt(seatCenter);
      }
    }
  } else {
    // Standing Camera
    if (App.cameraMode === "FPP") {
      // First Person (FPP): Camera positioned precisely at avatar eye level with 20% increased height
      const baseHeight = exactEyePos ? (exactEyePos.y - App.position.y) : 0.65;
      const elevatedY = App.position.y + baseHeight * 1.20;
      const eyePos = exactEyePos
        ? exactEyePos.clone()
        : App.position.clone().add(new THREE.Vector3(0, elevatedY, 0));
      eyePos.y = elevatedY;
      eyePos.addScaledVector(lookDir, 0.04);

      App.camera.position.lerp(eyePos, 0.35);

      const targetLook = eyePos.clone().add(lookDir.clone().multiplyScalar(10));
      App.camera.lookAt(targetLook);
    } else {
      // Third Person (TPP): Orbit follow camera behind avatar with smooth vertical damping
      const rawTarget = App.position.clone().add(new THREE.Vector3(0, 0.58, 0));
      App.smoothedCameraTarget.x = rawTarget.x;
      App.smoothedCameraTarget.z = rawTarget.z;
      if (App.smoothedCameraTarget.y === 0) {
        App.smoothedCameraTarget.y = rawTarget.y;
      } else {
        App.smoothedCameraTarget.y = THREE.MathUtils.damp(App.smoothedCameraTarget.y, rawTarget.y, 14.0, delta);
      }

      const dist = App.cameraDistance || 1.30;
      const offset = new THREE.Vector3(
        Math.sin(App.cameraYaw) * Math.cos(App.cameraPitch),
        Math.sin(App.cameraPitch) + 0.22,
        Math.cos(App.cameraYaw) * Math.cos(App.cameraPitch)
      ).multiplyScalar(dist);

      const desiredCameraPos = App.smoothedCameraTarget.clone().add(offset);
      App.camera.position.lerp(desiredCameraPos, 0.22);
      App.camera.lookAt(App.smoothedCameraTarget);
    }
  }
}

// --- Animation Loop ---

function animate() {
  requestAnimationFrame(animate);

  const delta = App.clock ? Math.min(App.clock.getDelta(), 0.1) : 0.016;

  if (App.inRoom) {
    updateLocalMovement(delta);
    updateCamera(delta);

    // 1. Advance skeletal animation mixers for all avatars
    App.avatars.forEach((avatar) => {
      if (avatar.userData.mixer) {
        avatar.userData.mixer.update(delta);
      }
      if (avatar.userData.currentActionName === "sitting") {
        const sitAct = avatar.userData.actions ? (avatar.userData.actions.sitting || avatar.userData.actions.sit_down) : null;
        if (sitAct && (sitAct.getEffectiveWeight() < 0.9 || !sitAct.isRunning())) {
          sitAct.setEffectiveWeight(1);
          sitAct.play();
        }
        if (avatar.userData.leftLegBone) avatar.userData.leftLegBone.rotation.x = -1.50;
        if (avatar.userData.rightLegBone) avatar.userData.rightLegBone.rotation.x = -1.50;
      }
    });

    // 2. Realistic Head Movement Tracking in FPP/Seated/Standing
    const myAvatar = App.avatars.get(App.userId);
    if (myAvatar) {
      // In FPP mode, keep local avatar strictly hidden from local camera to prevent any inner body clipping
      const shouldBeVisible = App.cameraMode !== "FPP";
      if (myAvatar.visible !== shouldBeVisible) {
        myAvatar.visible = shouldBeVisible;
      }

      if (myAvatar.userData.headBone) {
        const bone = myAvatar.userData.headBone;

        const lookDirX = -Math.sin(App.cameraYaw);
        const lookDirZ = -Math.cos(App.cameraYaw);
        const camAngle = Math.atan2(lookDirX, lookDirZ);
        const isSeated = App.currentSeatIndex !== null;
        const avatarAngle = isSeated ? Math.PI : App.rotation;
        const diff = Math.atan2(Math.sin(camAngle - avatarAngle), Math.cos(camAngle - avatarAngle));

        // Natural human head limit: neck turns comfortably up to ~75 degrees (1.309 rad)
        const maxHeadTurn = 75 * (Math.PI / 180);

        // Smooth continuous human head yaw without sudden snaps:
        // In front arc (|diff| <= 90 deg), head turns up to maxHeadTurn.
        // In rear arc (camera orbiting behind character), head smoothly eases back toward center
        let targetYaw = 0;
        if (Math.abs(diff) <= Math.PI / 2) {
          targetYaw = Math.max(-maxHeadTurn, Math.min(maxHeadTurn, diff));
        } else {
          const factor = Math.max(0, (Math.PI - Math.abs(diff)) / (Math.PI / 2));
          targetYaw = Math.sign(diff) * maxHeadTurn * factor;
        }

        const targetPitch = Math.max(-0.65, Math.min(0.65, App.cameraPitch));

        if (myAvatar.userData.currentHeadYaw === undefined) myAvatar.userData.currentHeadYaw = 0;
        if (myAvatar.userData.currentHeadPitch === undefined) myAvatar.userData.currentHeadPitch = 0;

        // Smooth, slow human head damping (speed factor 4.5 gives realistic, organic neck motion)
        myAvatar.userData.currentHeadYaw = THREE.MathUtils.damp(myAvatar.userData.currentHeadYaw, targetYaw, 4.5, delta);
        myAvatar.userData.currentHeadPitch = THREE.MathUtils.damp(myAvatar.userData.currentHeadPitch, targetPitch, 4.5, delta);

        const baseRotX = bone.userData.baseRotX !== undefined ? bone.userData.baseRotX : -0.478;
        // In sitting animation, compensate for the +0.245 spine twist so head faces 180° dead forward
        const baseRotY = isSeated ? -0.245 : (bone.userData.baseRotY !== undefined ? bone.userData.baseRotY : 0);

        // Pitch: looking up tilts head up, looking down tilts head down
        bone.rotation.x = baseRotX - myAvatar.userData.currentHeadPitch;
        // Yaw: looking left turns head left, looking right turns head right
        bone.rotation.y = baseRotY + myAvatar.userData.currentHeadYaw;
      }
    }

    // 3. Remote Avatars Interpolation & Head Tracking
    App.avatars.forEach((avatar, id) => {
      if (id !== App.userId) {
        avatar.position.lerp(avatar.userData.targetPosition, 0.2);
        avatar.rotation.y = THREE.MathUtils.lerp(avatar.rotation.y, avatar.userData.targetRotation, 0.2);

        if (avatar.userData.headBone) {
          const bone = avatar.userData.headBone;
          const isSeated = avatar.userData.currentActionName === "sitting";
          const targetPitch = Math.max(-0.65, Math.min(0.65, avatar.userData.targetHeadPitch || 0));
          const targetYaw = Math.max(-1.31, Math.min(1.31, avatar.userData.targetHeadYaw || 0));

          if (avatar.userData.currentHeadYaw === undefined) avatar.userData.currentHeadYaw = 0;
          if (avatar.userData.currentHeadPitch === undefined) avatar.userData.currentHeadPitch = 0;

          // Smooth, slow human neck damping for remote avatars
          avatar.userData.currentHeadYaw = THREE.MathUtils.damp(avatar.userData.currentHeadYaw, targetYaw, 4.5, delta);
          avatar.userData.currentHeadPitch = THREE.MathUtils.damp(avatar.userData.currentHeadPitch, targetPitch, 4.5, delta);

          const baseRotX = bone.userData.baseRotX !== undefined ? bone.userData.baseRotX : -0.478;
          const baseRotY = isSeated ? -0.245 : (bone.userData.baseRotY !== undefined ? bone.userData.baseRotY : 0);

          bone.rotation.x = baseRotX - avatar.userData.currentHeadPitch;
          bone.rotation.y = baseRotY + avatar.userData.currentHeadYaw;
        }
      }
    });
  }

  if (App.renderer && App.scene && App.camera) {
    App.renderer.render(App.scene, App.camera);
  }
}

// --- Synchronized Movie Playback ---

function applyMovieState(movie, isFullReload = false) {
  if (!movie) return;
  const video = ui.movieVideo;
  App.movie = { ...movie };

  if (ui.currentMovieTitle) {
    ui.currentMovieTitle.textContent = movie.title || "Shared Movie";
  }

  // URL changed
  if (isFullReload || (movie.url && video.src !== movie.url)) {
    video.src = movie.url;
    video.load();
    video.volume = typeof movie.volume === "number" ? movie.volume : 0.8;
    if (ui.movieVolume) ui.movieVolume.value = video.volume;
  }

  // Calculate synchronized target time with server clock drift
  let targetTime = Number(movie.time) || 0;
  if (movie.playing && movie.updatedAt) {
    const elapsedSec = Math.max(0, (Date.now() - movie.updatedAt) / 1000);
    targetTime += elapsedSec;
  }

  // Seek if drift is larger than 1.5 seconds
  if (Math.abs(video.currentTime - targetTime) > 1.5) {
    App.suppressVideoEvents = true;
    video.currentTime = targetTime;
    setTimeout(() => { App.suppressVideoEvents = false; }, 200);
  }

  // Play / Pause state
  if (movie.playing) {
    if (App.screenMesh && App.screenTexture) {
      App.screenMesh.material.map = App.screenTexture;
      App.screenMesh.material.needsUpdate = true;
    }
    video.play().then(() => {
      if (ui.playbackGate) ui.playbackGate.hidden = true;
      if (ui.moviePlayButton) ui.moviePlayButton.textContent = "";
    }).catch(() => {
      // Browser blocked autoplay audio/video
      if (ui.playbackGate) ui.playbackGate.hidden = false;
    });
  } else {
    video.pause();
    if (ui.moviePlayButton) ui.moviePlayButton.textContent = "▶";
    if (!movie.url && App.screenMesh && App.defaultScreenTexture) {
      App.screenMesh.material.map = App.defaultScreenTexture;
      App.screenMesh.material.needsUpdate = true;
    }
  }
}

function bindVideoEvents() {
  const video = ui.movieVideo;

  video.addEventListener("timeupdate", () => {
    if (!video.duration) return;
    if (ui.movieCurrentTime) ui.movieCurrentTime.textContent = formatTime(video.currentTime);
    if (ui.movieDuration) ui.movieDuration.textContent = formatTime(video.duration);
    if (ui.movieProgress) {
      ui.movieProgress.value = (video.currentTime / video.duration) * 1000;
    }
  });

  video.addEventListener("play", () => {
    if (App.screenMesh && App.screenTexture) {
      App.screenMesh.material.map = App.screenTexture;
      App.screenMesh.material.needsUpdate = true;
    }
    if (ui.moviePlayButton) ui.moviePlayButton.textContent = "";
    if (App.isHost && !App.suppressVideoEvents) {
      sendSocket({ type: "playback", action: "play", time: video.currentTime });
    }
  });

  video.addEventListener("pause", () => {
    if (ui.moviePlayButton) ui.moviePlayButton.textContent = "▶";
    if (App.isHost && !App.suppressVideoEvents) {
      sendSocket({ type: "playback", action: "pause", time: video.currentTime });
    }
  });

  video.addEventListener("seeked", () => {
    if (App.isHost && !App.suppressVideoEvents) {
      sendSocket({ type: "playback", action: "seek", time: video.currentTime });
    }
  });

  // Autoplay recovery button
  if (ui.enablePlaybackButton) {
    ui.enablePlaybackButton.addEventListener("click", () => {
      video.play().then(() => {
        if (ui.playbackGate) ui.playbackGate.hidden = true;
      }).catch((err) => {
        toast("Click anywhere to allow video audio playback.");
      });
    });
  }
}

function hostLoadMovie() {
  if (!App.isHost) {
    toast("Only the host can change the movie.", true);
    return;
  }
  const url = (ui.movieUrlInput?.value || "").trim();
  const title = (ui.movieTitleInput?.value || "").trim() || "Cinema Feature";

  if (!url) {
    toast("Please enter a direct video URL.", true);
    return;
  }

  sendSocket({
    type: "playback",
    url,
    title
  });

  if (ui.settingsModal) ui.settingsModal.hidden = true;
  toast("Loading movie for everyone…");
}

// --- Text Chat ---

function sendChatMessage() {
  if (!ui.chatInput) return;
  const text = ui.chatInput.value.trim();
  if (!text) return;

  sendSocket({ type: "chat", text });
  ui.chatInput.value = "";
}

function appendChatMessage(msg) {
  if (!ui.chatMessages) return;

  const item = document.createElement("div");
  item.className = `chat-message${msg.system ? " system" : ""}`;

  if (msg.system) {
    item.textContent = msg.text;
  } else {
    const isSelf = msg.userId === App.userId;
    item.innerHTML = `
      <div class="message-meta">
        <strong>${escapeHTML(msg.username)}${isSelf ? " (You)" : ""}</strong>
        <span>${new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <p>${escapeHTML(msg.text)}</p>
    `;
  }

  ui.chatMessages.appendChild(item);
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;

  // If chat panel is closed, show unread badge
  if (!App.chatOpen && !msg.system && msg.userId !== App.userId) {
    App.unreadCount++;
    if (ui.unreadBadge) {
      ui.unreadBadge.hidden = false;
      ui.unreadBadge.textContent = App.unreadCount;
    }
  }
}

function appendSystemChat(text) {
  appendChatMessage({ system: true, text, timestamp: Date.now() });
}

function updatePeopleList() {
  if (!ui.peopleList) return;
  ui.peopleList.innerHTML = "";

  App.users.forEach((user) => {
    const row = document.createElement("div");
    row.className = "people-item";

    const isSelf = user.id === App.userId;
    const isHost = user.id === App.hostId || (App.isHost && isSelf);

    row.innerHTML = `
      <div class="people-info">
        <span class="user-dot ${user.speaking ? "speaking" : ""}"></span>
        <strong class="user-name">${escapeHTML(user.username)}${isSelf ? " (You)" : ""}</strong>
        ${isHost ? '<span class="host-pill">HOST</span>' : ""}
      </div>
      <div class="people-status">
        <span class="seat-badge">${user.seated ? `Seat ${user.seatIndexLabel || ""}` : "Standing"}</span>
        <span class="voice-badge">${user.inVoice ? (user.muted ? "" : "") : ""}</span>
      </div>
    `;

    ui.peopleList.appendChild(row);
  });
}

// --- WebRTC Voice Chat ---

async function joinVoiceChat() {
  if (App.inVoice) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    App.localStream = stream;
    App.inVoice = true;
    App.isMuted = false;

    // Setup Voice Activity Detection
    setupVoiceActivityDetection(stream);

    // Notify server
    sendSocket({ type: "voice-join" });
    updateLocalVoiceUI();
    toast("Connected to voice chat.");
  } catch (err) {
    toast("Microphone access was denied or unavailable.", true);
  }
}

function toggleMute() {
  if (!App.inVoice) {
    joinVoiceChat();
    return;
  }

  App.isMuted = !App.isMuted;
  if (App.localStream) {
    App.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !App.isMuted;
    });
  }

  sendSocket({ type: "voice-state", muted: App.isMuted });
  updateLocalVoiceUI();
  updateNameplate(App.userId);
}

function leaveVoiceChat() {
  if (!App.inVoice) return;

  if (App.localStream) {
    App.localStream.getTracks().forEach((t) => t.stop());
    App.localStream = null;
  }

  if (App.audioContext) {
    App.audioContext.close();
    App.audioContext = null;
  }

  App.peerConnections.forEach((pc) => pc.close());
  App.peerConnections.clear();

  if (ui.remoteAudioContainer) {
    ui.remoteAudioContainer.innerHTML = "";
  }

  App.inVoice = false;
  App.isMuted = true;
  App.isSpeaking = false;

  sendSocket({ type: "voice-leave" });
  updateLocalVoiceUI();
  updateNameplate(App.userId);
  toast("Left voice chat.");
}

function updateLocalVoiceUI() {
  if (!ui.micButton) return;

  if (!App.inVoice) {
    ui.micButton.classList.remove("active", "muted");
    if (ui.micIcon) ui.micIcon.textContent = "";
    if (ui.micLabel) ui.micLabel.textContent = "Join voice";
    if (ui.voiceStatus) ui.voiceStatus.textContent = "Microphone off";
    if (ui.leaveVoiceButton) ui.leaveVoiceButton.hidden = true;
  } else if (App.isMuted) {
    ui.micButton.classList.remove("active");
    ui.micButton.classList.add("muted");
    if (ui.micIcon) ui.micIcon.textContent = "";
    if (ui.micLabel) ui.micLabel.textContent = "Unmute";
    if (ui.voiceStatus) ui.voiceStatus.textContent = "Microphone muted";
    if (ui.leaveVoiceButton) ui.leaveVoiceButton.hidden = false;
  } else {
    ui.micButton.classList.add("active");
    ui.micButton.classList.remove("muted");
    if (ui.micIcon) ui.micIcon.textContent = "";
    if (ui.micLabel) ui.micLabel.textContent = "Mute";
    if (ui.voiceStatus) ui.voiceStatus.textContent = "Microphone live";
    if (ui.leaveVoiceButton) ui.leaveVoiceButton.hidden = false;
  }
}

function setupVoiceActivityDetection(stream) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    App.audioContext = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);

    setInterval(() => {
      if (!App.inVoice || App.isMuted) {
        if (App.isSpeaking) {
          App.isSpeaking = false;
          sendSocket({ type: "speaking", speaking: false });
          updateNameplate(App.userId);
        }
        return;
      }

      analyser.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      const avg = sum / buffer.length;
      const speakingNow = avg > 20;

      if (speakingNow !== App.isSpeaking) {
        App.isSpeaking = speakingNow;
        sendSocket({ type: "speaking", speaking: speakingNow });
        updateNameplate(App.userId);
      }
    }, 150);
  } catch (err) {
    console.warn("VAD init warning:", err);
  }
}

async function createVoicePeerConnection(peerId, isInitiator) {
  if (App.peerConnections.has(peerId)) return App.peerConnections.get(peerId);

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  App.peerConnections.set(peerId, pc);

  if (App.localStream) {
    App.localStream.getTracks().forEach((track) => pc.addTrack(track, App.localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSocket({ type: "webrtc-ice", target: peerId, candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    let audio = document.getElementById(`audio-${peerId}`);
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = `audio-${peerId}`;
      audio.autoplay = true;
      audio.playsInline = true;
      if (ui.remoteAudioContainer) ui.remoteAudioContainer.appendChild(audio);
    }
    audio.srcObject = event.streams[0];
    audio.play().catch(() => {});
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      closeVoicePeerConnection(peerId);
    }
  };

  if (isInitiator) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSocket({ type: "webrtc-offer", target: peerId, offer });
    } catch (err) {
      console.error("Create offer error:", err);
    }
  }

  return pc;
}

async function handleRemoteOffer(fromId, offer) {
  if (!App.inVoice) return;
  const pc = await createVoicePeerConnection(fromId, false);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSocket({ type: "webrtc-answer", target: fromId, answer });
  } catch (err) {
    console.error("Handle offer error:", err);
  }
}

async function handleRemoteAnswer(fromId, answer) {
  const pc = App.peerConnections.get(fromId);
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (err) {
    console.error("Handle answer error:", err);
  }
}

async function handleRemoteIceCandidate(fromId, candidate) {
  const pc = App.peerConnections.get(fromId);
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error("Add ICE candidate error:", err);
  }
}

function closeVoicePeerConnection(peerId) {
  const pc = App.peerConnections.get(peerId);
  if (pc) {
    pc.close();
    App.peerConnections.delete(peerId);
  }
  const el = document.getElementById(`audio-${peerId}`);
  if (el) el.remove();
}

function updateRemoteVoiceState(msg) {
  const user = App.users.get(msg.userId);
  if (!user) return;

  if (typeof msg.speaking === "boolean") user.speaking = msg.speaking;
  if (typeof msg.muted === "boolean") user.muted = msg.muted;

  updateNameplate(msg.userId);
  updatePeopleList();
}

// --- DOM & Interaction Events Binding ---

function bindThreeInteractionEvents(domElement) {
  domElement.addEventListener("pointerdown", (e) => {
    if (e.button === 0) {
      App.isPointerDown = true;
      App.dragStartX = e.clientX;
      App.dragStartY = e.clientY;
      App.hasDragged = false;
      App.lastPointerX = e.clientX;
      App.lastPointerY = e.clientY;
    }
  });

  window.addEventListener("pointerup", (e) => {
    if (e.button === 0) {
      App.isPointerDown = false;
      // Debounce resetting hasDragged by 120ms to ensure following click event is swallowed
      setTimeout(() => {
        App.hasDragged = false;
      }, 120);
    }
  });

  domElement.addEventListener("pointermove", handlePointerMove);
  domElement.addEventListener("click", handleSeatClick);

  domElement.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (App.cameraMode === "FPP") {
      // Mouse scroll zoom in/out in FPP: adjust Field of View (FOV)
      // deltaY < 0 (scroll up) zooms in (narrow FOV down to 20°)
      // deltaY > 0 (scroll down) zooms out (widen FOV up to 85°)
      const step = e.deltaY * 0.04;
      App.targetFppFov = Math.max(20, Math.min(85, (App.targetFppFov || 56) + step));
    } else {
      // Third Person (TPP) follow distance zoom
      if (App.currentSeatIndex !== null) {
        App.seatedTppDistance = Math.max(0.65, Math.min(3.2, (App.seatedTppDistance || 1.15) + e.deltaY * 0.002));
      } else {
        App.cameraDistance = Math.max(1.3, Math.min(4.5, (App.cameraDistance || 2.0) + e.deltaY * 0.003));
      }
    }
  }, { passive: false });
}

function bindUIEvents() {
  // Lobby events
  if (ui.createButton) ui.createButton.addEventListener("click", createTheatre);
  if (ui.joinButton) ui.joinButton.addEventListener("click", () => joinTheatre());
  if (ui.refreshRoomsButton) ui.refreshRoomsButton.addEventListener("click", () => {
    sendSocket({ type: "list-rooms" });
    toast("Refreshing theatres…");
  });

  if (ui.roomIdInput) {
    ui.roomIdInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") joinTheatre();
    });
  }

  // Copy Room Code Button
  if (ui.copyRoomButton) {
    ui.copyRoomButton.addEventListener("click", () => {
      if (App.roomId) {
        navigator.clipboard.writeText(App.roomId).then(() => {
          toast(`Copied room code: ${App.roomId}`);
        });
      }
    });
  }

  // Leave Theatre
  if (ui.leaveButton) ui.leaveButton.addEventListener("click", leaveTheatre);

  // Stand Up
  if (ui.standButton) ui.standButton.addEventListener("click", standUp);

  // Character Picker in Lobby
  if (ui.characterPicker) {
    const cards = ui.characterPicker.querySelectorAll(".char-card");
    let hasActive = false;
    cards.forEach((card) => {
      if (card.dataset.char === App.characterType) {
        card.classList.add("active");
        hasActive = true;
      } else {
        card.classList.remove("active");
      }
      card.addEventListener("click", () => {
        cards.forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        App.characterType = card.dataset.char || DEFAULT_CHARACTER;
        localStorage.setItem("vc-character", App.characterType);
      });
    });
    if (!hasActive && cards[0]) {
      cards[0].classList.add("active");
      App.characterType = cards[0].dataset.char || DEFAULT_CHARACTER;
      localStorage.setItem("vc-character", App.characterType);
    }
  }

  // Camera Mode Toggle (FPP / TPP)
  if (ui.cameraModeButton) {
    ui.cameraModeButton.addEventListener("click", toggleCameraMode);
    updateCameraModeUI();
  }

  // Emote Action Buttons
  if (ui.clapButton) {
    ui.clapButton.addEventListener("click", () => triggerEmote("cheer"));
  }
  if (ui.waveButton) {
    ui.waveButton.addEventListener("click", () => triggerEmote("wave"));
  }
  if (ui.laughButton) {
    ui.laughButton.addEventListener("click", () => triggerEmote("laugh"));
  }
  if (ui.talkButton) {
    ui.talkButton.addEventListener("click", () => triggerEmote("talk"));
  }
  if (ui.spinButton) {
    ui.spinButton.addEventListener("click", () => triggerEmote("turn_360"));
  }

  // Chat Drawer Toggle & Tabs
  if (ui.chatToggleButton) {
    ui.chatToggleButton.addEventListener("click", () => {
      App.chatOpen = !App.chatOpen;
      if (ui.chatPanel) ui.chatPanel.classList.toggle("open", App.chatOpen);
      if (App.chatOpen) {
        App.unreadCount = 0;
        if (ui.unreadBadge) ui.unreadBadge.hidden = true;
        ui.chatInput?.focus();
      }
    });
  }

  if (ui.closeChatButton) {
    ui.closeChatButton.addEventListener("click", () => {
      App.chatOpen = false;
      if (ui.chatPanel) ui.chatPanel.classList.remove("open");
    });
  }

  if (ui.chatTabButton && ui.peopleTabButton) {
    ui.chatTabButton.addEventListener("click", () => {
      ui.chatTabButton.classList.add("active");
      ui.peopleTabButton.classList.remove("active");
      if (ui.chatPane) ui.chatPane.hidden = false;
      if (ui.peoplePane) ui.peoplePane.hidden = true;
    });

    ui.peopleTabButton.addEventListener("click", () => {
      ui.peopleTabButton.classList.add("active");
      ui.chatTabButton.classList.remove("active");
      if (ui.chatPane) ui.chatPane.hidden = true;
      if (ui.peoplePane) ui.peoplePane.hidden = false;
      updatePeopleList();
    });
  }

  if (ui.sendChatButton) ui.sendChatButton.addEventListener("click", sendChatMessage);
  if (ui.chatInput) {
    ui.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChatMessage();
    });
  }

  // Voice buttons
  if (ui.micButton) ui.micButton.addEventListener("click", toggleMute);
  if (ui.leaveVoiceButton) ui.leaveVoiceButton.addEventListener("click", leaveVoiceChat);

  // Movie Playback Controls
  if (ui.moviePlayButton) {
    ui.moviePlayButton.addEventListener("click", () => {
      if (!App.isHost) {
        toast("Only the host can control video playback.", true);
        return;
      }
      const video = ui.movieVideo;
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    });
  }

  if (ui.movieProgress) {
    ui.movieProgress.addEventListener("input", (e) => {
      if (!App.isHost) return;
      const video = ui.movieVideo;
      if (video.duration) {
        const target = (e.target.value / 1000) * video.duration;
        video.currentTime = target;
        sendSocket({ type: "playback", action: "seek", time: target });
      }
    });
  }

  if (ui.movieVolume) {
    ui.movieVolume.addEventListener("input", (e) => {
      const vol = parseFloat(e.target.value);
      ui.movieVideo.volume = vol;
    });
  }

  // Settings Modal
  const openSettings = () => {
    if (ui.settingsModal) ui.settingsModal.hidden = false;
    if (ui.movieUrlInput) ui.movieUrlInput.value = App.movie.url || "";
    if (ui.movieTitleInput) ui.movieTitleInput.value = App.movie.title || "";
  };

  if (ui.settingsButton) ui.settingsButton.addEventListener("click", openSettings);
  if (ui.movieSettingsButton) ui.movieSettingsButton.addEventListener("click", openSettings);
  if (ui.closeSettingsButton) {
    ui.closeSettingsButton.addEventListener("click", () => {
      if (ui.settingsModal) ui.settingsModal.hidden = true;
    });
  }

  if (ui.loadMovieButton) ui.loadMovieButton.addEventListener("click", hostLoadMovie);

  // Quality selector
  if (ui.qualitySelect) {
    ui.qualitySelect.value = App.quality;
    ui.qualitySelect.addEventListener("change", (e) => {
      App.quality = e.target.value;
      localStorage.setItem("vc-quality", App.quality);
      applyRenderingQuality(App.renderer, App.quality);
      toast(`Rendering quality set to ${App.quality}`);
    });
  }

  // Focus Mode
  const toggleFocus = () => {
    App.focusMode = !App.focusMode;
    document.body.classList.toggle("focus-mode", App.focusMode);
    if (ui.revealUiButton) ui.revealUiButton.hidden = !App.focusMode;
  };

  if (ui.focusButton) ui.focusButton.addEventListener("click", toggleFocus);
  if (ui.revealUiButton) ui.revealUiButton.addEventListener("click", toggleFocus);

  // Window Resize
  window.addEventListener("resize", () => {
    if (App.renderer && App.camera) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      App.camera.aspect = width / height;
      App.camera.updateProjectionMatrix();
      App.renderer.setSize(width, height);
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    // If typing in input, don't trigger game shortcuts
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      if (e.key === "Escape") document.activeElement.blur();
      return;
    }

    App.activeKeys.add(e.code);

    if (e.code === "KeyV") {
      toggleCameraMode();
    } else if (e.code === "KeyC") {
      triggerEmote("cheer");
    } else if (e.code === "KeyG") {
      triggerEmote("wave");
    } else if (e.code === "KeyL") {
      triggerEmote("laugh");
    } else if (e.code === "KeyT") {
      triggerEmote("talk");
    } else if (e.code === "KeyR") {
      triggerEmote("turn_360");
    } else if (e.code === "KeyZ") {
      App.isSlouchWalk = !App.isSlouchWalk;
      toast(`Slouch walk: ${App.isSlouchWalk ? "ON" : "OFF"}`);
    } else if (e.code === "KeyQ") {
      triggerEmote("turn_left_45");
    } else if (e.code === "KeyE") {
      triggerEmote("turn_right_45");
    } else if (e.key === "m" || e.key === "M") {
      toggleMute();
    } else if (e.key === "h" || e.key === "H" || e.key === "f" || e.key === "F") {
      toggleFocus();
    } else if (e.key === "Escape") {
      if (ui.settingsModal && !ui.settingsModal.hidden) {
        ui.settingsModal.hidden = true;
      } else if (App.chatOpen) {
        ui.closeChatButton?.click();
      }
    } else if (e.key === "Enter") {
      if (!App.chatOpen) ui.chatToggleButton?.click();
      ui.chatInput?.focus();
    }
  });

  window.addEventListener("keyup", (e) => {
    App.activeKeys.delete(e.code);
  });
}

// --- Application Entry Point ---

function initialize() {
  const savedUsername = localStorage.getItem("vc-username");
  if (savedUsername && ui.usernameInput) {
    ui.usernameInput.value = savedUsername;
    App.username = savedUsername;
  }

  bindUIEvents();
  bindVideoEvents();

  // Connect to server socket
  connectSocket().catch((err) => {
    console.warn("Lobby auto-connect deferred:", err.message);
  });
}

// Ensure execution when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
