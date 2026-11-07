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
import {
  AudioSpatialMode,
  CameraMode,
  ChatMessage,
  MovieState,
  RoomDetail,
  RoomSummary,
  ScreenFrameMode,
  SeatData,
  UserData,
  VideoQuality
} from "../types/cinema";
import { DEFAULT_MOVIE } from "../lib/constants";

function CinemaApp() {
  const { showToast } = useToast();

  const [inRoom, setInRoom] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>("Connecting");
  const [selfId, setSelfId] = useState<string>("");
  const [publicRooms, setPublicRooms] = useState<RoomSummary[]>([]);
  const [currentRoom, setCurrentRoom] = useState<RoomDetail | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [movie, setMovie] = useState<MovieState>(DEFAULT_MOVIE);

  const [cameraMode, setCameraMode] = useState<CameraMode>("TPP");
  const [currentSeat, setCurrentSeat] = useState<SeatData | null>(null);
  const [seatTooltip, setSeatTooltip] = useState<{ visible: boolean; text: string; x: number; y: number } | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isPlaybackGateOpen, setIsPlaybackGateOpen] = useState<boolean>(false);
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const [frameMode, setFrameMode] = useState<ScreenFrameMode>("stretch");
  const [fitMode, setFitMode] = useState<"fit" | "fill">("fill");
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
  const isChatOpenRef = useRef<boolean>(false);
  const showToastRef = useRef(showToast);

  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);

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

  // Universal Media Loader: maps all videos directly onto the curved 3D cinema screen
  const applyMediaSource = useCallback((mediaUrl: string) => {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !mediaUrl) return;

    let targetUrl = mediaUrl.trim();

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "";

    // 1. YouTube links -> high-FPS cinema stream
    const ytMatch = targetUrl.match(
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
    );
    if (ytMatch && ytMatch[1] && !targetUrl.includes("/api/youtube-stream")) {
      targetUrl = `${apiBase}/api/youtube-stream?id=${ytMatch[1]}`;
    } else if (/^[a-zA-Z0-9_-]{11}$/.test(targetUrl) && !targetUrl.includes("/") && !targetUrl.includes(".")) {
      targetUrl = `${apiBase}/api/youtube-stream?id=${targetUrl}`;
    } else if (/^-[a-zA-Z0-9_-]{11}$/.test(targetUrl) && !targetUrl.includes("/")) {
      targetUrl = `${apiBase}/api/youtube-stream?id=${targetUrl.slice(1)}`;
    }

    // 2. Google Drive links -> EAC3 audio transcode stream
    const gdriveMatch = targetUrl.match(
      /(?:(?:drive\.google|drive\.usercontent\.google)\.com\/(?:file\/d\/|open\?id=|uc\?id=|download\?id=)|id=)([a-zA-Z0-9_-]{20,})/i
    );
    if (gdriveMatch && gdriveMatch[1] && !targetUrl.includes("/api/gdrive-stream")) {
      targetUrl = `${apiBase}/api/gdrive-stream?id=${gdriveMatch[1]}&eac3=1`;
    } else if (/^[a-zA-Z0-9_-]{25,45}$/.test(targetUrl) && !targetUrl.includes("/") && !targetUrl.includes(".")) {
      targetUrl = `${apiBase}/api/gdrive-stream?id=${targetUrl}&eac3=1`;
    }

    // 3. Route external URLs through CORS streaming proxy to prevent WebGL VideoTexture taint
    const isExternal =
      (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) &&
      typeof window !== "undefined" &&
      !targetUrl.startsWith(window.location.origin) &&
      !targetUrl.includes("localhost:3000") &&
      !targetUrl.includes("/api/");

    if (isExternal && !targetUrl.includes("/api/video-proxy")) {
      targetUrl = `${apiBase}/api/video-proxy?url=${encodeURIComponent(targetUrl)}`;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (targetUrl.includes(".m3u8")) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = targetUrl;
        video.load();
        if (engine) engine.setVideoSource(video);
      } else if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hls.loadSource(targetUrl);
        hls.attachMedia(video);
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
  }, []);

  // Video Element event listeners and CORS error fallback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => setVideoTime(video.currentTime);
    const onDurationChange = () => setVideoDuration(video.duration || 0);

    const onVideoError = () => {
      const src = video.src || "";
      if (src && src.startsWith("http") && !src.includes("/api/")) {
        console.warn("Direct video load failed (likely CORS or format). Retrying via streaming /api/video-proxy...", src);
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
        const proxyUrl = `${apiBase}/api/video-proxy?url=${encodeURIComponent(src)}`;
        video.src = proxyUrl;
        video.load();
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("loadedmetadata", onDurationChange);
    video.addEventListener("error", onVideoError);

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("loadedmetadata", onDurationChange);
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

    socketClient.on("joined", (msg: { userId: string; room: RoomDetail; movie: MovieState; users: UserData[] }) => {
      setSelfId(msg.userId);
      setCurrentRoom(msg.room);
      setUsers(msg.room.users || []);
      setInRoom(true);

      if (msg.movie) {
        setMovie(msg.movie);
      }

      showToastRef.current(`Welcome to ${msg.room.name}!`);

      // Initialize Three.js Cinema Engine
      setTimeout(() => {
        if (containerRef.current && videoRef.current) {
          if (engineRef.current) {
            engineRef.current.destroy();
          }

          const engine = new CinemaEngine(containerRef.current, videoRef.current, {
            onSeatClicked: (seatIdx) => {
              socketClient.send({ type: "take-seat", seat: seatIdx });
            },
            onSeatHover: (info) => {
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

          // Set movie video source
          if (msg.movie && msg.movie.url) {
            applyMediaSource(msg.movie.url);
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
      applyMediaSource(msg.movie.url);
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

      if (Math.abs(video.currentTime - targetTime) > 1.2) {
        video.currentTime = targetTime;
      }

      if (msg.state.playing && video.paused) {
        if (engine) {
          engine.showVideoTexture();
        }
        video.play().catch((err) => {
          if (err.name === "NotAllowedError") {
            setIsPlaybackGateOpen(true);
          }
        });
      } else if (!msg.state.playing && !video.paused) {
        video.pause();
        if (targetTime === 0 && engine) {
          engine.showStandbyTexture();
        }
      }

      if (typeof msg.state.volume === "number") {
        video.volume = msg.state.volume;
        setVideoVolume(msg.state.volume);
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
    socketClient.send({
      type: "join-room",
      roomId,
      username,
      characterType: charType
    });
  };

  const handleRefreshRooms = () => {
    socketClient.send({ type: "list-rooms" });
  };

  const handleLeaveTheatre = () => {
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
    if (!isHost || !videoRef.current) return;
    const nextState = !movie.playing;

    socketClient.send({
      type: "playback",
      action: nextState ? "play" : "pause",
      time: videoRef.current.currentTime
    });
  };

  const handleSeek = (targetTime: number) => {
    if (!isHost || !videoRef.current) return;

    socketClient.send({
      type: "playback",
      action: "seek",
      time: targetTime
    });
  };

  const handleVolumeChange = (vol: number) => {
    setVideoVolume(vol);
    if (videoRef.current) {
      videoRef.current.volume = vol;
    }
    if (isHost) {
      socketClient.send({
        type: "playback",
        action: "volume",
        volume: vol
      });
    }
  };

  const handleLoadMovie = (title: string, url: string) => {
    if (!isHost) return;
    socketClient.send({
      type: "playback",
      title,
      url
    });
  };

  const handleToggleFitMode = () => {
    if (!engineRef.current) return;
    const current = engineRef.current.getFrameMode();
    const next: ScreenFrameMode = current === "stretch" ? "fill" : current === "fill" ? "fit" : "stretch";
    handleFrameModeChange(next);
  };

  const handleFrameModeChange = (mode: ScreenFrameMode) => {
    if (!engineRef.current) return;
    engineRef.current.setFrameMode(mode);
    setFrameMode(mode);
    setFitMode(mode === "fill" || mode === "stretch" || mode === "stretch-max" ? "fill" : "fit");
    const labels: Record<ScreenFrameMode, string> = {
      stretch: "Stretch (Hide Black Bars)",
      "stretch-max": "Stretch Max (Ultra Zoom)",
      fill: "Fill Screen (100% Curved)",
      fit: "Fit Screen (Auto Original)",
      "16:9": "16:9 Widescreen (1.78:1)",
      "21:9": "21:9 Ultrawide (2.33:1)",
      "2.35:1": "2.35:1 CinemaScope",
      "2.39:1": "2.39:1 Theatrical Anamorphic",
      "4:3": "4:3 Classic Academy"
    };
    showToast(`Screen Frame: ${labels[mode] || mode}`);
  };

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
    }
    showToast(`Video Quality: ${q === "auto" ? "Auto (Adaptive)" : q.toUpperCase()}`);
  };

  const handleSendMessage = (text: string) => {
    socketClient.send({ type: "chat", text });
  };

  const handleEnablePlayback = () => {
    setIsPlaybackGateOpen(false);
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  const isHost = currentRoom?.hostId === selfId;

  return (
    <>
      {/* 3D WebGL Canvas Container */}
      <div id="scene-container" ref={containerRef} aria-label="Interactive 3D cinema" />

      {/* Hidden Video element for WebGL VideoTexture */}
      <video
        id="movie-video"
        ref={videoRef}
        className="hidden-video"
        playsInline
        preload="auto"
        crossOrigin="anonymous"
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
                duration={videoDuration}
                volume={videoVolume}
                fitMode={fitMode}
                frameMode={frameMode}
                quality={quality}
                spatialAudioEnabled={spatialAudioEnabled}
                spatialAudioMode={spatialAudioMode}
                onPlayToggle={handlePlayToggle}
                onSeek={handleSeek}
                onVolumeChange={handleVolumeChange}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onToggleFitMode={handleToggleFitMode}
                onFrameModeChange={handleFrameModeChange}
                onToggleSpatialAudio={handleToggleSpatialAudio}
                onSpatialAudioModeChange={handleSpatialAudioModeChange}
                onQualityChange={handleQualityChange}
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
            onToggleFocus={() => setFocusMode(!focusMode)}
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
            onLoadMovie={handleLoadMovie}
            onToggleFitMode={handleToggleFitMode}
            onFrameModeChange={handleFrameModeChange}
            onToggleSpatialAudio={handleToggleSpatialAudio}
            onSpatialAudioModeChange={handleSpatialAudioModeChange}
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
