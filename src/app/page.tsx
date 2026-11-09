"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import { ToastProvider, useToast } from "../components/ToastContainer";
import { Lobby } from "../components/Lobby";
import { CinemaHUD } from "../components/CinemaHUD";
import { MovieControls } from "../components/MovieControls";
import { ChatPanel } from "../components/ChatPanel";
import { SettingsModal } from "../components/SettingsModal";
import { PlaybackGate } from "../components/PlaybackGate";
import { CinemaEngine } from "../lib/cinemaEngine";
import { socketClient } from "../lib/socketClient";
import { VoiceManager } from "../lib/webrtc";
import { parseVideoUrl } from "../lib/videoUtils";
import { ittySync } from "../lib/ittySync";
import { mediaPreloader } from "../lib/mediaPreloader";
import {
  AudioSpatialMode,
  CameraMode,
  ChatMessage,
  LightingState,
  MovieState,
  RoomDetail,
  RoomSummary,
  ScreenFrameMode,
  SeatData,
  UserData,
  VideoQuality
} from "../types/cinema";
import { DEFAULT_LIGHTING, DEFAULT_MOVIE } from "../lib/constants";

function CinemaApp() {
  const { showToast } = useToast();

  const [inRoom, setInRoom] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>("Connecting");
  const [selfId, setSelfId] = useState<string>("");
  const [publicRooms, setPublicRooms] = useState<RoomSummary[]>([]);
  const [currentRoom, setCurrentRoom] = useState<RoomDetail | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [movie, setMovie] = useState<MovieState>(DEFAULT_MOVIE);
  const [lighting, setLighting] = useState<LightingState>(DEFAULT_LIGHTING);

  const [cameraMode, setCameraMode] = useState<CameraMode>("TPP");
  const [currentSeat, setCurrentSeat] = useState<SeatData | null>(null);
  const [seatTooltip, setSeatTooltip] = useState<{ visible: boolean; text: string; x: number; y: number } | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isPlaybackGateOpen, setIsPlaybackGateOpen] = useState<boolean>(false);
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const [frameMode, setFrameMode] = useState<ScreenFrameMode>("2.35:1");
  const [fitMode, setFitMode] = useState<"fit" | "fill">("fit");
  const [spatialAudioEnabled, setSpatialAudioEnabled] = useState<boolean>(true);
  const [spatialAudioMode, setSpatialAudioMode] = useState<AudioSpatialMode>("atmos");
  const [quality, setQuality] = useState<VideoQuality>("auto");

  const [inVoice, setInVoice] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  const [videoTime, setVideoTime] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoVolume, setVideoVolume] = useState<number>(0.8);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CinemaEngine | null>(null);
  const voiceManagerRef = useRef<VoiceManager | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const selfIdRef = useRef<string>("");
  const currentRoomRef = useRef<RoomDetail | null>(null);
  const currentSeatRef = useRef<SeatData | null>(null);
  const isChatOpenRef = useRef<boolean>(false);
  const showToastRef = useRef(showToast);
  const lastHardSeekTimeRef = useRef<number>(0);
  const isPlayPendingRef = useRef<boolean>(false);

  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    currentSeatRef.current = currentSeat;
  }, [currentSeat]);

  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
  }, [isChatOpen]);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  // Voice Chat WebRTC initialization
  useEffect(() => {
    const vm = new VoiceManager({
      onSpeakingChange: (speaking) => {
        setIsSpeaking(speaking);
        if (selfIdRef.current && engineRef.current) {
          engineRef.current.updateNameplate(selfIdRef.current, speaking, !vm.isMuted);
        }
      },
      onVoiceStateChange: (active, muted) => {
        setInVoice(active);
        setIsMuted(muted);
        if (selfIdRef.current && engineRef.current) {
          engineRef.current.updateNameplate(selfIdRef.current, vm.isSpeaking, !muted);
        }
      },
      onError: (errMsg) => {
        showToastRef.current(errMsg, true);
      }
    });

    if (audioContainerRef.current) {
      vm.setAudioContainer(audioContainerRef.current);
    }
    voiceManagerRef.current = vm;

    return () => {
      vm.leaveVoice();
    };
  }, []);

  const playVideoSafe = useCallback((video: HTMLVideoElement) => {
    const engine = engineRef.current;
    if (engine) engine.showVideoTexture();

    if (isPlayPendingRef.current) return;
    if (!video.paused) return;

    isPlayPendingRef.current = true;
    const p = video.play();
    if (p !== undefined) {
      p.then(() => {
        isPlayPendingRef.current = false;
        if (engine) engine.showVideoTexture();
      }).catch((err) => {
        isPlayPendingRef.current = false;
        if (err.name === "NotAllowedError") {
          // Autoplay blocked by browser policy: play muted immediately so cinema visual works, then prompt user to unmute
          video.muted = true;
          isPlayPendingRef.current = true;
          video.play()
            .then(() => {
              isPlayPendingRef.current = false;
              if (engine) engine.showVideoTexture();
              setIsPlaybackGateOpen(true);
            })
            .catch(() => {
              isPlayPendingRef.current = false;
              setIsPlaybackGateOpen(true);
            });
        } else if (err.name === "AbortError") {
          // Play request was interrupted by a pending seek or state change; safe to resume next frame
        }
      });
    } else {
      isPlayPendingRef.current = false;
    }
  }, []);

  // Universal Media Loader: maps all videos directly onto the curved 3D cinema screen
  const applyMediaSource = useCallback((mediaUrl: string, selectedQuality?: VideoQuality, resumeTime?: number, autoResume?: boolean) => {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !mediaUrl) return;

    let targetUrl = mediaUrl.trim();
    const currentQ = selectedQuality || quality || "1080p";

    const apiBase = (process.env.NEXT_PUBLIC_SERVER_URL || process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

    if (targetUrl.startsWith("/api/") && apiBase) {
      targetUrl = `${apiBase}${targetUrl}`;
    }

    // 1. YouTube links -> high-FPS cinema stream up to 1080p
    const ytMatch = targetUrl.match(
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
    );
    if (ytMatch && ytMatch[1] && !targetUrl.includes("/api/youtube-stream")) {
      targetUrl = `${apiBase}/api/youtube-stream?id=${ytMatch[1]}&quality=${currentQ}`;
    } else if (/^[a-zA-Z0-9_-]{11}$/.test(targetUrl) && !targetUrl.includes("/") && !targetUrl.includes(".")) {
      targetUrl = `${apiBase}/api/youtube-stream?id=${targetUrl}&quality=${currentQ}`;
    } else if (/^-[a-zA-Z0-9_-]{11}$/.test(targetUrl) && !targetUrl.includes("/")) {
      targetUrl = `${apiBase}/api/youtube-stream?id=${targetUrl.slice(1)}&quality=${currentQ}`;
    }

    // 2. Google Drive links -> direct streaming proxy
    const gdriveMatch = targetUrl.match(
      /(?:(?:drive\.google|drive\.usercontent\.google)\.com\/(?:file\/d\/|open\?id=|uc\?id=|download\?id=)|id=)([a-zA-Z0-9_-]{20,})/i
    );
    if (gdriveMatch && gdriveMatch[1] && !targetUrl.includes("/api/gdrive-stream")) {
      targetUrl = `${apiBase}/api/gdrive-stream?id=${gdriveMatch[1]}&quality=${currentQ}`;
    } else if (/^[a-zA-Z0-9_-]{25,45}$/.test(targetUrl) && !targetUrl.includes("/") && !targetUrl.includes(".")) {
      targetUrl = `/api/gdrive-stream?id=${targetUrl}&quality=${currentQ}`;
    }

    // Normalize localhost:3000 to relative path if viewing on tunnel or remote origin
    if (typeof window !== "undefined" && targetUrl.includes("localhost:3000") && !window.location.host.includes("localhost:3000")) {
      targetUrl = targetUrl.replace(/^https?:\/\/[^\/]+/, "");
    }

    // 3. Route external direct video URLs through CORS streaming proxy to prevent WebGL VideoTexture taint
    const isHls = targetUrl.includes(".m3u8");
    const isExternal =
      (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) &&
      typeof window !== "undefined" &&
      !targetUrl.startsWith(window.location.origin) &&
      !targetUrl.includes("/api/");

    if (isExternal && !targetUrl.includes("/api/video-proxy")) {
      targetUrl = `/api/video-proxy?url=${encodeURIComponent(targetUrl)}`;
    }

    // Set crossOrigin only for truly external URLs, remove for local/proxied streams to preserve tunnel/session cookies
    if ((targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) && typeof window !== "undefined" && !targetUrl.startsWith(window.location.origin)) {
      video.crossOrigin = "anonymous";
    } else {
      video.removeAttribute("crossorigin");
    }

    // Preload video chunks in browser cache / storage in background
    mediaPreloader.preload(targetUrl);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const targetResumeTime = typeof resumeTime === "number" ? Math.max(0, resumeTime) : 0;
    const shouldPlay = !!autoResume;

    let resumed = false;
    const onResume = () => {
      if (resumed) return;
      resumed = true;
      try {
        if (targetResumeTime > 0 && isFinite(targetResumeTime)) {
          video.currentTime = targetResumeTime;
          if (shouldPlay) {
            const onSeeked = () => {
              video.removeEventListener("seeked", onSeeked);
              playVideoSafe(video);
            };
            video.addEventListener("seeked", onSeeked, { once: true });
            setTimeout(() => {
              video.removeEventListener("seeked", onSeeked);
              if (video.paused) playVideoSafe(video);
            }, 400);
          }
        } else if (shouldPlay) {
          playVideoSafe(video);
        }
      } catch {}
    };

    if (video.readyState >= 1) {
      onResume();
    } else {
      video.addEventListener("loadedmetadata", onResume, { once: true });
      video.addEventListener("canplay", onResume, { once: true });
    }

    if (isHls || targetUrl.includes(".m3u8")) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = targetUrl;
        video.load();
        if (engine) engine.setVideoSource(video);
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false
        });
        hls.loadSource(targetUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, onResume);
        hlsRef.current = hls;
        if (engine) engine.setVideoSource(video);
      } else {
        video.src = targetUrl;
        video.load();
        if (engine) engine.setVideoSource(video);
      }
    } else {
      video.src = targetUrl;
      video.load();
      if (engine) engine.setVideoSource(video);
    }
  }, [quality, playVideoSafe]);

  // Video Element event listeners and CORS error fallback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      setVideoTime(video.currentTime);
      if (video.duration && isFinite(video.duration) && video.duration > 0 && videoDuration !== video.duration) {
        setVideoDuration(video.duration);
      }
    };
    const onDurationChange = () => {
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        setVideoDuration(video.duration);
      }
    };
    const onPlay = () => {
      if (engineRef.current) {
        engineRef.current.showVideoTexture();
      }
    };
    const onLoadedData = () => {
      if (engineRef.current && (video.currentTime > 0 || !video.paused)) {
        engineRef.current.showVideoTexture();
      }
    };

    // Stalled / waiting buffer auto-recovery
    let stallRecoveryTimeout: NodeJS.Timeout | null = null;
    const onStallOrWait = () => {
      if (stallRecoveryTimeout) clearTimeout(stallRecoveryTimeout);
      stallRecoveryTimeout = setTimeout(() => {
        if (video && !video.paused && video.readyState < 3) {
          video.play().catch(() => {});
        }
      }, 1200);
    };
    const onClearStall = () => {
      if (stallRecoveryTimeout) {
        clearTimeout(stallRecoveryTimeout);
        stallRecoveryTimeout = null;
      }
    };

    const onVideoError = () => {
      const src = video.src || "";
      const isLocalOrAsset = src.includes("/assets/movies/") || (typeof window !== "undefined" && src.includes(window.location.host));
      if (src && src.startsWith("http") && !isLocalOrAsset && !src.includes("/api/") && !src.includes(".m3u8")) {
        console.warn("Direct video load failed (likely CORS or format). Retrying via streaming /api/video-proxy...", src);
        const proxyUrl = `/api/video-proxy?url=${encodeURIComponent(src)}`;
        video.src = proxyUrl;
        video.load();
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("loadedmetadata", onDurationChange);
    video.addEventListener("play", onPlay);
    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("waiting", onStallOrWait);
    video.addEventListener("stalled", onStallOrWait);
    video.addEventListener("canplay", onClearStall);
    video.addEventListener("playing", onClearStall);
    video.addEventListener("error", onVideoError);

    return () => {
      if (stallRecoveryTimeout) clearTimeout(stallRecoveryTimeout);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("loadedmetadata", onDurationChange);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("waiting", onStallOrWait);
      video.removeEventListener("stalled", onStallOrWait);
      video.removeEventListener("canplay", onClearStall);
      video.removeEventListener("playing", onClearStall);
      video.removeEventListener("error", onVideoError);
    };
  }, []);

  // Connect WebSocket & Register Socket Handlers
  useEffect(() => {
    socketClient.connect().catch(() => {
      setConnectionStatus("Disconnected");
    });

    socketClient.on("open", () => {
      setConnectionStatus("Connected");
    });

    socketClient.on("close", () => {
      setConnectionStatus("Disconnected");
    });

    socketClient.on("connected", (msg: { userId: string; rooms: RoomSummary[] }) => {
      setSelfId(msg.userId);
      setConnectionStatus("Connected");
      if (msg.rooms) setPublicRooms(msg.rooms);
    });

    socketClient.on("room-list", (msg: { rooms: RoomSummary[] }) => {
      if (msg.rooms) setPublicRooms(msg.rooms);
    });

    socketClient.on("joined", (msg: { userId: string; room: RoomDetail; movie: MovieState; users: UserData[]; lighting?: LightingState; hostSecret?: string }) => {
      setSelfId(msg.userId);
      setCurrentRoom(msg.room);
      setUsers(msg.room.users || []);
      setInRoom(true);

      // Connect to itty-sockets room channel for instant, delay-free video playback synchronization
      const isCurrentHost = msg.room.hostId === msg.userId;
      ittySync.connectToRoom(msg.room.id, isCurrentHost ? "Host" : "Viewer");

      if (msg.hostSecret && typeof window !== "undefined") {
        try {
          sessionStorage.setItem(`moviq_host_secret_${msg.room.id.toUpperCase()}`, msg.hostSecret);
        } catch {}
      }

      if (msg.movie) {
        setMovie(msg.movie);
      }

      const initialLights = msg.lighting || msg.room?.lighting || DEFAULT_LIGHTING;
      setLighting(initialLights);

      showToastRef.current(`Welcome to ${msg.room.name}!`);

      // Initialize Three.js Cinema Engine
      setTimeout(() => {
        if (containerRef.current && videoRef.current) {
          if (engineRef.current) {
            engineRef.current.destroy();
          }

          const engine = new CinemaEngine(containerRef.current, videoRef.current, {
            onSeatClicked: (seatIdx) => {
              if (currentSeatRef.current !== null) return; // Do not switch seats while seated
              socketClient.send({ type: "take-seat", seat: seatIdx });
            },
            onSeatHover: (info) => {
              if (currentSeatRef.current !== null) {
                setSeatTooltip(null);
                return;
              }
              setSeatTooltip(info);
            },
            onLocalMovement: (pos, rot, pitch, yaw, action) => {
              socketClient.send({
                type: "move",
                position: pos,
                rotation: rot,
                headPitch: pitch,
                headYaw: yaw,
                action
              });
            },
            onCameraModeChanged: (mode) => {
              setCameraMode(mode);
              showToastRef.current(`View mode: ${mode === "FPP" ? "First Person (FPP)" : "Third Person (TPP)"}`);
            },
            onStandUp: () => {
              socketClient.send({ type: "stand" });
              setCurrentSeat(null);
            },
            onEmoteTriggered: (action) => {
              handleEmote(action);
            }
          });

          engine.localUserId = msg.userId;
          engine.setLightingState(initialLights);
          engineRef.current = engine;

          // Add all existing users' avatars
          if (msg.room.users) {
            msg.room.users.forEach((u) => {
              engine.createAvatar(u);
            });
          }

          // Populate existing seat occupancies
          if (msg.room.seats) {
            for (const [seatId, occupantId] of Object.entries(msg.room.seats)) {
              engine.updateSeatOccupancy(Number(seatId), occupantId);
            }
          }

          // Set movie video source with exact current playback time & auto-resume state
          if (msg.movie && msg.movie.url) {
            const currentPlaybackTime = Math.max(0, msg.movie.time || 0);
            const shouldAutoPlay = !!msg.movie.playing;
            applyMediaSource(msg.movie.url, quality, currentPlaybackTime, shouldAutoPlay);
          }
        }
      }, 50);
    });

    socketClient.on("user-joined", (msg: { user: UserData }) => {
      setUsers((prev) => [...prev.filter((u) => u.id !== msg.user.id), msg.user]);
      if (engineRef.current) {
        engineRef.current.createAvatar(msg.user);
      }
    });

    socketClient.on("user-left", (msg: { userId: string; username: string }) => {
      setUsers((prev) => prev.filter((u) => u.id !== msg.userId));
      if (engineRef.current) {
        engineRef.current.removeAvatar(msg.userId);
      }
    });

    socketClient.on("user-moved", (msg: { userId: string; position: any; rotation: number; headPitch: number; headYaw: number; action: string }) => {
      if (engineRef.current) {
        engineRef.current.updateRemoteAvatar(msg);
      }
    });

    socketClient.on("user-emote", (msg: { userId: string; action: string }) => {
      if (engineRef.current) {
        engineRef.current.handleRemoteEmote(msg);
      }
    });

    socketClient.on("seat-update", (msg: { seatId: number; userId: string | null; username: string | null }) => {
      if (engineRef.current) {
        engineRef.current.updateSeatOccupancy(msg.seatId, msg.userId);
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.id === msg.userId
            ? { ...u, seated: true, seatIndex: msg.seatId }
            : u.seatIndex === msg.seatId
            ? { ...u, seated: false, seatIndex: null }
            : u
        )
      );

      if (msg.userId === selfIdRef.current) {
        if (engineRef.current && engineRef.current.seats[msg.seatId]) {
          setCurrentSeat(engineRef.current.seats[msg.seatId]);
          showToastRef.current(`Seated at Row ${engineRef.current.seats[msg.seatId].row}, Seat ${engineRef.current.seats[msg.seatId].col}`);
        }
      } else if (msg.userId === null) {
        setCurrentSeat((prev) => (prev && prev.index === msg.seatId ? null : prev));
      }
    });

    socketClient.on("movie-loaded", (msg: { movie: MovieState }) => {
      setMovie(msg.movie);
      const isAutoPlay = !!msg.movie.playing;
      const initialTime = Math.max(0, msg.movie.time || 0);
      applyMediaSource(msg.movie.url, quality, initialTime, isAutoPlay);
      showToastRef.current(`Now Showing: ${msg.movie.title}`);
    });

    socketClient.on("movie-state", (msg: { state: MovieState; action?: string; by?: string }) => {
      setMovie(msg.state);
      const engine = engineRef.current;
      const video = videoRef.current;
      if (!video) return;

      const now = Date.now();
      const elapsed = msg.state.playing && msg.state.serverTime ? (now - msg.state.serverTime) / 1000 : 0;
      const targetTime = Math.max(0, msg.state.time + elapsed);

      // Only perform a hard seek on explicit seek actions or if out-of-sync by more than 2.0 seconds (NEVER on volume)
      if (msg.action === "seek" || (msg.action !== "volume" && Math.abs(video.currentTime - targetTime) > 2.0)) {
        if (!video.seeking && video.readyState >= 2) {
          lastHardSeekTimeRef.current = now;
          try {
            if (isFinite(targetTime) && targetTime >= 0) {
              video.currentTime = targetTime;
            }
          } catch {}
        }
      }

      if (msg.state.playing && video.paused) {
        if (video.seeking) {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            playVideoSafe(video);
          };
          video.addEventListener("seeked", onSeeked, { once: true });
        } else {
          playVideoSafe(video);
        }
      } else if (!msg.state.playing && !video.paused) {
        video.pause();
        if (!msg.state.url && engine) {
          engine.showStandbyTexture();
        }
      }

      if (typeof msg.state.volume === "number") {
        const clampedVol = Math.max(0, Math.min(1.5, msg.state.volume));
        try {
          video.volume = Math.min(1.0, clampedVol);
        } catch {}
        if (engine) {
          engine.setVolume(clampedVol);
        }
        setVideoVolume(clampedVol);
      }
    });

    socketClient.on("movie-sync", (msg: { time: number; playing: boolean; serverTime: number }) => {
      const video = videoRef.current;
      if (!video) return;

      // Host's player is the clock source: never interrupt or jitter the host!
      if (currentRoomRef.current?.hostId === selfIdRef.current) return;

      const now = Date.now();
      const latency = (now - msg.serverTime) / 1000;
      const targetTime = Math.max(0, msg.time + latency);
      const drift = targetTime - video.currentTime;

      // 1. Play / Pause state synchronization
      if (msg.playing && video.paused) {
        playVideoSafe(video);
        return; // Avoid seeking in the same tick as initiating play
      } else if (!msg.playing && !video.paused) {
        video.pause();
        return;
      }

      // CRITICAL: NEVER interrupt an in-progress seek!
      if (video.seeking) {
        return;
      }

      // 2. High-precision sync algorithm without stalls:
      // - If drift is minor/moderate (0.3s to 2.5s): smoothly slew playbackRate (+6% or -6%)
      // - If drift is large (> 2.5s) AND at least 4s since last seek AND video ready: throttled hard seek
      const absDrift = Math.abs(drift);
      const timeSinceLastSeek = now - lastHardSeekTimeRef.current;

      if (absDrift > 2.5 && timeSinceLastSeek > 3500 && video.readyState >= 2) {
        lastHardSeekTimeRef.current = now;
        try {
          video.currentTime = targetTime;
        } catch {}
        video.playbackRate = 1.0;
      } else if (drift > 1.0) {
        video.playbackRate = 1.08;
      } else if (drift < -1.0) {
        video.playbackRate = 0.92;
      } else if (drift > 0.25) {
        video.playbackRate = 1.05;
      } else if (drift < -0.25) {
        video.playbackRate = 0.95;
      } else if (drift > 0.04) {
        video.playbackRate = 1.02;
      } else if (drift < -0.04) {
        video.playbackRate = 0.98;
      } else {
        video.playbackRate = 1.0;
      }
    });

    socketClient.on("host-changed", (msg: { hostId: string; username: string }) => {
      setCurrentRoom((prev) => (prev ? { ...prev, hostId: msg.hostId } : null));
      showToastRef.current(`${msg.username} is now the theatre host.`);
    });

    socketClient.on("chat", (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      if (!isChatOpenRef.current) {
        setUnreadCount((prev) => prev + 1);
      }
    });

    socketClient.on("voice-state", (msg: { userId: string; muted?: boolean; speaking?: boolean }) => {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === msg.userId
            ? {
                ...u,
                muted: typeof msg.muted === "boolean" ? msg.muted : u.muted,
                speaking: typeof msg.speaking === "boolean" ? msg.speaking : u.speaking
              }
            : u
        )
      );
      if (engineRef.current) {
        engineRef.current.updateNameplate(msg.userId, msg.speaking || false, !(msg.muted ?? true));
      }
    });

    socketClient.on("lighting-state", (msg: { lighting: LightingState; by?: string }) => {
      if (msg.lighting) {
        setLighting(msg.lighting);
        if (engineRef.current) {
          engineRef.current.setLightingState(msg.lighting);
        }
      }
    });

    socketClient.on("error", (msg: { message: string }) => {
      showToastRef.current(msg.message, true);
    });

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      socketClient.disconnect();
    };
  }, [applyMediaSource]);

  // High-Speed Direct Video Synchronization via itty-sockets (Zero delay, independent of server disconnections)
  useEffect(() => {
    if (!inRoom || !currentRoom) return;

    const unsubs: Array<() => void> = [];

    unsubs.push(
      ittySync.on("movie-loaded", (msg: { movie: MovieState }) => {
        setMovie(msg.movie);
        const isAutoPlay = !!msg.movie.playing;
        const initialTime = Math.max(0, msg.movie.time || 0);
        applyMediaSource(msg.movie.url, quality, initialTime, isAutoPlay);
        showToastRef.current(`Now Showing: ${msg.movie.title}`);
      })
    );

    unsubs.push(
      ittySync.on("movie-state", (msg: { state: MovieState; action?: string; by?: string }) => {
        setMovie(msg.state);
        const engine = engineRef.current;
        const video = videoRef.current;
        if (!video) return;

        const now = Date.now();
        const elapsed = msg.state.playing && msg.state.serverTime ? (now - msg.state.serverTime) / 1000 : 0;
        const targetTime = Math.max(0, msg.state.time + elapsed);

        if (msg.action === "seek" || (msg.action !== "volume" && Math.abs(video.currentTime - targetTime) > 2.0)) {
          if (!video.seeking && video.readyState >= 2) {
            lastHardSeekTimeRef.current = now;
            try {
              if (isFinite(targetTime) && targetTime >= 0) {
                video.currentTime = targetTime;
              }
            } catch {}
          }
        }

        if (msg.state.playing && video.paused) {
          if (video.seeking) {
            const onSeeked = () => {
              video.removeEventListener("seeked", onSeeked);
              playVideoSafe(video);
            };
            video.addEventListener("seeked", onSeeked, { once: true });
          } else {
            playVideoSafe(video);
          }
        } else if (!msg.state.playing && !video.paused) {
          video.pause();
          if (!msg.state.url && engine) {
            engine.showStandbyTexture();
          }
        }

        if (typeof msg.state.volume === "number") {
          const clampedVol = Math.max(0, Math.min(1.5, msg.state.volume));
          try {
            video.volume = Math.min(1.0, clampedVol);
          } catch {}
          if (engine) {
            engine.setVolume(clampedVol);
          }
          setVideoVolume(clampedVol);
        }
      })
    );

    unsubs.push(
      ittySync.on("movie-sync", (msg: { time: number; playing: boolean; serverTime: number }) => {
        const video = videoRef.current;
        if (!video) return;

        if (currentRoomRef.current?.hostId === selfIdRef.current) return;

        const now = Date.now();
        const latency = (now - msg.serverTime) / 1000;
        const targetTime = Math.max(0, msg.time + latency);
        const drift = targetTime - video.currentTime;

        if (msg.playing && video.paused) {
          playVideoSafe(video);
          return;
        } else if (!msg.playing && !video.paused) {
          video.pause();
          return;
        }

        if (video.seeking) return;

        const absDrift = Math.abs(drift);
        const timeSinceLastSeek = now - lastHardSeekTimeRef.current;

        if (absDrift > 2.5 && timeSinceLastSeek > 3500 && video.readyState >= 2) {
          lastHardSeekTimeRef.current = now;
          try {
            video.currentTime = targetTime;
          } catch {}
          video.playbackRate = 1.0;
        } else if (drift > 1.0) {
          video.playbackRate = 1.08;
        } else if (drift < -1.0) {
          video.playbackRate = 0.92;
        } else if (drift > 0.25) {
          video.playbackRate = 1.05;
        } else if (drift < -0.25) {
          video.playbackRate = 0.95;
        } else if (drift > 0.04) {
          video.playbackRate = 1.02;
        } else if (drift < -0.04) {
          video.playbackRate = 0.98;
        } else {
          video.playbackRate = 1.0;
        }
      })
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [inRoom, currentRoom, quality, playVideoSafe]);

  // Host Clock Authority: The Host's player is the master clock for the room.
  // Periodically send lightweight playback heartbeats to anchor room time with zero drift.
  useEffect(() => {
    if (!inRoom || !currentRoom) return;
    const isCurrentHost = currentRoom.hostId === selfId;
    if (!isCurrentHost) return;

    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 1) return;

      // 1. Instant zero-latency edge broadcast via itty-sockets
      ittySync.broadcastMovieSync(video.currentTime, !video.paused);

      // 2. Also keep Render WebSocket backend synchronized
      socketClient.send({
        type: "playback",
        action: "sync",
        time: video.currentTime,
        playing: !video.paused
      });
    }, 1200);

    return () => clearInterval(timer);
  }, [inRoom, currentRoom, selfId]);

  // Actions
  const handleCreateRoom = (theatreName: string, username: string, charType: string, isPublic: boolean) => {
    socketClient.send({
      type: "create-room",
      theatreName,
      username,
      characterType: charType,
      isPublic
    });
  };

  const handleJoinRoom = (roomId: string, username: string, charType: string) => {
    let hostSecret: string | null = null;
    if (typeof window !== "undefined") {
      try {
        hostSecret = sessionStorage.getItem(`moviq_host_secret_${roomId.toUpperCase()}`);
      } catch {}
    }
    socketClient.send({
      type: "join-room",
      roomId,
      username,
      characterType: charType,
      hostSecret: hostSecret || undefined
    });
  };

  const handleRefreshRooms = () => {
    socketClient.send({ type: "list-rooms" });
  };

  const handleLeaveTheatre = () => {
    ittySync.disconnect();
    mediaPreloader.cancel();
    if (voiceManagerRef.current) {
      voiceManagerRef.current.leaveVoice();
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (engineRef.current) {
      engineRef.current.destroy();
      engineRef.current = null;
    }
    socketClient.send({ type: "leave" });
    setInRoom(false);
    setCurrentRoom(null);
    setCurrentSeat(null);
    setUsers([]);
    setMessages([]);
    setUnreadCount(0);
    setIsChatOpen(false);
    setIsSettingsOpen(false);
    setIsPlaybackGateOpen(false);
  };

  const handleCopyRoomId = () => {
    if (currentRoom) {
      navigator.clipboard.writeText(currentRoom.id);
      showToast(`Copied room code: ${currentRoom.id}`);
    }
  };

  const handleEmote = (emoteName: string) => {
    if (!inRoom) return;
    if (currentSeat && emoteName === "turn_360") {
      showToastRef.current("Stand up to do a 360° spin!");
      return;
    }
    socketClient.send({ type: "emote", emote: emoteName });
    if (engineRef.current) {
      engineRef.current.triggerLocalEmote(emoteName);
    }
  };

  const handleToggleCamera = () => {
    if (engineRef.current) {
      const mode = engineRef.current.toggleCameraMode();
      setCameraMode(mode);
      showToast(`View mode: ${mode === "FPP" ? "First Person (FPP)" : "Third Person (TPP)"}`);
    }
  };

  const handleStandUp = () => {
    socketClient.send({ type: "stand" });
    if (engineRef.current) {
      engineRef.current.standUp();
    }
    setCurrentSeat(null);
  };

  const handleToggleVoice = async () => {
    if (!voiceManagerRef.current) return;
    if (!inVoice) {
      try {
        await voiceManagerRef.current.joinVoice();
        showToast("Joined voice chat! (Microphone live)");
      } catch {
        // Error handled in voice manager
      }
    } else {
      const muted = voiceManagerRef.current.toggleMute();
      showToast(muted ? "Microphone muted." : "Microphone active.");
    }
  };

  const handleLeaveVoice = () => {
    if (voiceManagerRef.current) {
      voiceManagerRef.current.leaveVoice();
      showToast("Left voice chat.");
    }
  };

  const handlePlayToggle = () => {
    if (!isHost) return;
    const nextState = !movie.playing;
    const curTime = videoRef.current ? videoRef.current.currentTime || 0 : 0;

    const updatedState: MovieState = {
      ...movie,
      playing: nextState,
      time: curTime,
      updatedAt: Date.now(),
      serverTime: Date.now()
    };
    setMovie(updatedState);

    // Immediate local playback update for the host (zero latency)
    if (nextState) {
      if (videoRef.current) playVideoSafe(videoRef.current);
    } else {
      if (videoRef.current) videoRef.current.pause();
    }

    // 1. Direct zero-latency edge broadcast via itty-sockets (instant for viewers)
    ittySync.broadcastMovieState(updatedState, nextState ? "play" : "pause", "Host");

    // 2. Also keep Render WebSocket backend synchronized
    socketClient.send({
      type: "playback",
      action: nextState ? "play" : "pause",
      time: curTime
    });
  };

  const handleSeek = (targetTime: number) => {
    if (!isHost) return;

    if (videoRef.current) {
      const video = videoRef.current;
      if (isFinite(targetTime) && targetTime >= 0) {
        try {
          video.currentTime = targetTime;
        } catch (e) {
          console.warn("Seek error:", e);
        }
      }
    }
    setVideoTime(targetTime);

    const updatedState: MovieState = {
      ...movie,
      time: targetTime,
      updatedAt: Date.now(),
      serverTime: Date.now()
    };
    setMovie(updatedState);

    // 1. Direct zero-latency edge broadcast via itty-sockets (instant for viewers)
    ittySync.broadcastMovieState(updatedState, "seek", "Host");

    // 2. Also keep Render WebSocket backend synchronized
    socketClient.send({
      type: "playback",
      action: "seek",
      time: targetTime
    });
  };

  const handleVolumeChange = (vol: number) => {
    const clamped = Math.max(0, Math.min(1.5, vol));
    setVideoVolume(clamped);

    if (engineRef.current) {
      engineRef.current.spatialAudio.resume();
      engineRef.current.setVolume(clamped);
    }

    if (videoRef.current) {
      try {
        videoRef.current.volume = Math.min(1.0, clamped);
      } catch {}
    }
  };

  const handleLoadMovie = (title: string, url: string) => {
    if (!isHost) return;
    const parsed = parseVideoUrl(url);
    const updatedMovie: MovieState = {
      url: parsed.streamUrl,
      title: title || parsed.title || "Cinema Movie",
      playing: true,
      time: 0,
      volume: 0.8,
      updatedAt: Date.now()
    };
    setMovie(updatedMovie);

    // Preload video chunks in browser cache / storage immediately
    mediaPreloader.preload(parsed.streamUrl);
    applyMediaSource(parsed.streamUrl, quality, 0, true);

    // 1. Direct zero-latency movie load via itty-sockets
    ittySync.broadcastMovieLoaded(updatedMovie);

    // 2. Also keep Render WebSocket backend synchronized
    socketClient.send({
      type: "playback",
      title,
      url
    });
  };

  const handleToggleFitMode = () => {
    if (!engineRef.current) return;
    const current = engineRef.current.getFrameMode();
    const next: ScreenFrameMode = current === "2.35:1" ? "stretch" : current === "stretch" ? "fill" : current === "fill" ? "fit" : "2.35:1";
    handleFrameModeChange(next);
  };

  const handleFrameModeChange = (mode: ScreenFrameMode) => {
    if (!engineRef.current) return;
    engineRef.current.setFrameMode(mode);
    setFrameMode(mode);
    setFitMode(mode === "fill" || mode === "stretch" ? "fill" : "fit");
    const labels: Record<ScreenFrameMode, string> = {
      "2.35:1": "2.35:1 CinemaScope (Default)",
      stretch: "Stretch (Hide Black Bars)",
      fill: "Fill Screen (100% Curved)",
      fit: "Fit Screen (Original)",
      "16:9": "16:9 Widescreen (1.78:1)",
      "21:9": "21:9 Ultrawide (2.33:1)",
      "2.39:1": "2.39:1 Theatrical Anamorphic"
    };
    showToast(`Screen Frame: ${labels[mode] || mode}`);
  };

  const handleToggleFocus = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      showToast(`Cinema Focus Mode: ${next ? "Active (HUD Hidden)" : "Exited"}`);
      return next;
    });
  }, [showToast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["input", "textarea"].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) {
        return;
      }
      if (e.code === "KeyF") {
        e.preventDefault();
        handleToggleFocus();
      } else if (e.code === "Escape" && focusMode) {
        e.preventDefault();
        setFocusMode(false);
        showToast("Cinema Focus Mode: Exited");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, handleToggleFocus, showToast]);

  const handleToggleSpatialAudio = () => {
    if (!engineRef.current) return;
    const next = !spatialAudioEnabled;
    engineRef.current.spatialAudio.setEnabled(next);
    setSpatialAudioEnabled(next);
    setSpatialAudioMode(next ? "atmos" : "stereo");
    showToast(`Theatre Audio: ${next ? "Dolby Atmos 3D (Subwoofer & Wall Echoes)" : "Standard Stereo"}`);
  };

  const handleSpatialAudioModeChange = (mode: AudioSpatialMode) => {
    if (!engineRef.current) return;
    engineRef.current.spatialAudio.setAudioMode(mode);
    setSpatialAudioMode(mode);
    setSpatialAudioEnabled(mode !== "stereo");
    const labels: Record<AudioSpatialMode, string> = {
      atmos: "Dolby Atmos 3D (HRTF + Subwoofer + Height + Wall Echoes)",
      hall: "Multiplex Echo Hall (Auditorium Wall Echoes & Reverb)",
      stereo: "Standard Stereo Bypass"
    };
    showToast(`Theatre Audio: ${labels[mode]}`);
  };

  const handleQualityChange = (q: VideoQuality) => {
    setQuality(q);
    if (hlsRef.current) {
      if (q === "auto") {
        hlsRef.current.currentLevel = -1;
      } else {
        const targetHeight = parseInt(q, 10);
        const idx = hlsRef.current.levels.findIndex((l) => l.height === targetHeight);
        if (idx !== -1) {
          hlsRef.current.currentLevel = idx;
        }
      }
    } else if (movie && movie.url) {
      const video = videoRef.current;
      const curTime = video ? video.currentTime : 0;
      const isPlaying = video ? !video.paused : false;
      applyMediaSource(movie.url, q, curTime, isPlaying);
    }
    showToast(`Video Quality: ${q === "auto" ? "1080P (Full HD 60fps)" : q.toUpperCase()}`);
  };

  const handleLightingChange = (partial: Partial<LightingState>) => {
    if (!isHost) return;
    const nextLighting = { ...lighting, ...partial };
    setLighting(nextLighting);
    if (engineRef.current) {
      engineRef.current.setLightingState(nextLighting);
    }
    socketClient.send({
      type: "lighting-update",
      lighting: nextLighting
    });

    if (partial.sideLights) {
      const modeLabels: Record<string, string> = {
        on: "Side Lights: Steady Glow ON",
        wave: "Side Lights: Wave Animation Active",
        off: "Side Lights: OFF"
      };
      showToast(modeLabels[partial.sideLights] || "Side Lights Updated");
    } else if (partial.ceiling !== undefined) {
      showToast(`Ceiling Lights: ${partial.ceiling ? "ON" : "OFF (Dimmed)"}`);
    } else if (partial.stairs !== undefined) {
      showToast(`Stair Lights: ${partial.stairs ? "ON" : "OFF"}`);
    } else if (partial.belowScreen !== undefined) {
      showToast(`Below Screen Lights: ${partial.belowScreen ? "ON" : "OFF"}`);
    }
  };

  const handleSendMessage = (text: string) => {
    socketClient.send({ type: "chat", text });
  };

  const handleEnablePlayback = () => {
    setIsPlaybackGateOpen(false);
    if (videoRef.current) {
      videoRef.current.muted = false;
      videoRef.current.play().catch(() => {});
    }
    if (engineRef.current) {
      engineRef.current.spatialAudio.resume();
      engineRef.current.showVideoTexture();
    }
  };

  const isHost = currentRoom?.hostId === selfId;

  return (
    <>
      {/* 3D WebGL Canvas Container */}
      <div
        id="scene-container"
        ref={containerRef}
        aria-label="Interactive 3D cinema"
        onClick={() => {
          if (videoRef.current && videoRef.current.muted) {
            videoRef.current.muted = false;
            setIsPlaybackGateOpen(false);
          }
          if (engineRef.current) {
            engineRef.current.spatialAudio.resume();
          }
        }}
      />

      {/* Hidden Video element for WebGL VideoTexture */}
      <video
        id="movie-video"
        ref={videoRef}
        className="hidden-video"
        playsInline
        preload="auto"
      />

      {/* WebRTC Audio peers container */}
      <div id="remote-audio-container" ref={audioContainerRef} aria-hidden="true" />

      {/* Lobby View */}
      {!inRoom && (
        <Lobby
          status={connectionStatus}
          rooms={publicRooms}
          onRefreshRooms={handleRefreshRooms}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
        />
      )}

      {/* In-Cinema HUD & Controls */}
      {inRoom && currentRoom && (
        <>
          <CinemaHUD
            theatreName={currentRoom.name}
            roomId={currentRoom.id}
            userCount={users.length}
            cameraMode={cameraMode}
            currentSeat={currentSeat}
            unreadCount={unreadCount}
            isChatOpen={isChatOpen}
            inVoice={inVoice}
            isMuted={isMuted}
            isSpeaking={isSpeaking}
            focusMode={focusMode}
            seatTooltip={seatTooltip}
            movieControls={
              <MovieControls
                movie={movie}
                isHost={isHost}
                currentTime={videoTime}
                duration={videoDuration || (movie.url?.includes("big_buck_bunny") ? 10.0 : 0)}
                volume={videoVolume}
                fitMode={fitMode}
                frameMode={frameMode}
                quality={quality}
                spatialAudioEnabled={spatialAudioEnabled}
                spatialAudioMode={spatialAudioMode}
                lighting={lighting}
                onPlayToggle={handlePlayToggle}
                onSeek={handleSeek}
                onVolumeChange={handleVolumeChange}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onToggleFitMode={handleToggleFitMode}
                onFrameModeChange={handleFrameModeChange}
                onToggleSpatialAudio={handleToggleSpatialAudio}
                onSpatialAudioModeChange={handleSpatialAudioModeChange}
                onQualityChange={handleQualityChange}
                onLightingChange={handleLightingChange}
              />
            }
            onCopyRoom={handleCopyRoomId}
            onEmote={handleEmote}
            onToggleCamera={handleToggleCamera}
            onToggleChat={() => {
              setIsChatOpen(!isChatOpen);
              if (!isChatOpen) setUnreadCount(0);
            }}
            onToggleSettings={() => setIsSettingsOpen(!isSettingsOpen)}
            onToggleFocus={handleToggleFocus}
            onLeave={handleLeaveTheatre}
            onStandUp={handleStandUp}
            onToggleVoice={handleToggleVoice}
            onLeaveVoice={handleLeaveVoice}
            onVirtualKey={(code, pressed) => {
              if (engineRef.current) {
                engineRef.current.setVirtualKey(code, pressed);
              }
            }}
          />

          <ChatPanel
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            messages={messages}
            onSendMessage={handleSendMessage}
            users={users}
            hostId={currentRoom.hostId}
            selfId={selfId}
          />

          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            isHost={isHost}
            currentTitle={movie.title}
            currentUrl={movie.url}
            fitMode={fitMode}
            frameMode={frameMode}
            spatialAudioEnabled={spatialAudioEnabled}
            spatialAudioMode={spatialAudioMode}
            lighting={lighting}
            onLoadMovie={handleLoadMovie}
            onToggleFitMode={handleToggleFitMode}
            onFrameModeChange={handleFrameModeChange}
            onToggleSpatialAudio={handleToggleSpatialAudio}
            onSpatialAudioModeChange={handleSpatialAudioModeChange}
            onLightingChange={handleLightingChange}
          />
        </>
      )}

      {/* Browser Autoplay Permission Gate */}
      <PlaybackGate
        isOpen={isPlaybackGateOpen}
        onEnablePlayback={handleEnablePlayback}
      />
    </>
  );
}

export default function Page() {
  return (
    <ToastProvider>
      <CinemaApp />
    </ToastProvider>
  );
}
