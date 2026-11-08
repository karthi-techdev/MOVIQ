"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  FiPlay,
  FiPause,
  FiVolume2,
  FiCheck,
  FiChevronDown,
  FiHeadphones,
  FiMaximize2,
  FiTv,
  FiCrop,
  FiFilm,
  FiVideo,
  FiMoreHorizontal,
  FiSun,
  FiMoon,
  FiZap,
  FiActivity,
  FiHeart,
  FiFastForward
} from "react-icons/fi";
import { IoFlame, IoColorPaletteOutline, IoFlash } from "react-icons/io5";
import { HiBuildingLibrary, HiStar } from "react-icons/hi2";
import {
  AudioSpatialMode,
  LightingState,
  MovieState,
  ScreenFrameMode,
  SideLightMode,
  VideoQuality
} from "../types/cinema";
import { SIDE_LIGHT_ANIMATIONS, SideLightAnimationMeta } from "../lib/constants";

interface MovieControlsProps {
  movie: MovieState;
  isHost: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  fitMode?: "fit" | "fill";
  frameMode?: ScreenFrameMode;
  quality?: VideoQuality;
  spatialAudioEnabled?: boolean;
  spatialAudioMode?: AudioSpatialMode;
  lighting?: LightingState;
  onPlayToggle: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
  onOpenSettings: () => void;
  onToggleFitMode?: () => void;
  onFrameModeChange?: (mode: ScreenFrameMode) => void;
  onToggleSpatialAudio?: () => void;
  onSpatialAudioModeChange?: (mode: AudioSpatialMode) => void;
  onQualityChange?: (quality: VideoQuality) => void;
  onLightingChange?: (partial: Partial<LightingState>) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function renderSideLightIcon(id: SideLightMode) {
  switch (id) {
    case "hero_entry":
      return <FiZap />;
    case "wave":
      return <FiActivity />;
    case "pulse":
      return <FiHeart />;
    case "chase":
      return <FiFastForward />;
    case "strobe":
      return <IoFlash />;
    case "rainbow":
      return <IoColorPaletteOutline />;
    case "fire":
      return <IoFlame />;
    case "ambilight_sync":
      return <FiFilm />;
    case "on":
      return <FiSun />;
    case "off":
      return <FiMoon />;
    default:
      return <FiSun />;
  }
}

export const MovieControls: React.FC<MovieControlsProps> = ({
  movie,
  isHost,
  currentTime,
  duration,
  volume,
  fitMode = "fill",
  frameMode = "fill",
  quality = "auto",
  spatialAudioEnabled = true,
  spatialAudioMode = "atmos",
  lighting = { ceiling: true, stairs: true, belowScreen: true, sideLights: "on" },
  onPlayToggle,
  onSeek,
  onVolumeChange,
  onOpenSettings,
  onToggleFitMode,
  onFrameModeChange,
  onToggleSpatialAudio,
  onSpatialAudioModeChange,
  onQualityChange,
  onLightingChange
}) => {
  const [isQualityMenuOpen, setIsQualityMenuOpen] = useState(false);
  const [isFrameMenuOpen, setIsFrameMenuOpen] = useState(false);
  const [isAudioMenuOpen, setIsAudioMenuOpen] = useState(false);
  const [isLightingMenuOpen, setIsLightingMenuOpen] = useState(false);

  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const frameMenuRef = useRef<HTMLDivElement>(null);
  const audioMenuRef = useRef<HTMLDivElement>(null);
  const lightingMenuRef = useRef<HTMLDivElement>(null);

  const scrubValueRef = useRef<number>(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [displayValue, setDisplayValue] = useState(0);

  const validDuration = isFinite(duration) && duration > 0 ? duration : 0;
  const currentProgress = validDuration > 0 ? (currentTime / validDuration) * 1000 : 0;
  const displayProgress = isScrubbing ? displayValue : (isNaN(currentProgress) ? 0 : currentProgress);
  const displayCurrentTime = isScrubbing && validDuration > 0 ? (displayValue / 1000) * validDuration : currentTime;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(target)) {
        setIsQualityMenuOpen(false);
      }
      if (frameMenuRef.current && !frameMenuRef.current.contains(target)) {
        setIsFrameMenuOpen(false);
      }
      if (audioMenuRef.current && !audioMenuRef.current.contains(target)) {
        setIsAudioMenuOpen(false);
      }
      if (lightingMenuRef.current && !lightingMenuRef.current.contains(target)) {
        setIsLightingMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!isHost) return;
    setIsScrubbing(true);
    const val = Number(e.currentTarget.value);
    scrubValueRef.current = val;
    setDisplayValue(val);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost) return;
    const val = Number(e.target.value);
    scrubValueRef.current = val;
    setDisplayValue(val);
    if (!isScrubbing && validDuration > 0) {
      onSeek((val / 1000) * validDuration);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    if (!isHost) return;
    setIsScrubbing(false);
    const inputEl = e.currentTarget as HTMLInputElement;
    const val = inputEl && typeof inputEl.value !== "undefined" ? Number(inputEl.value) : scrubValueRef.current;
    if (validDuration > 0) {
      const targetTime = (val / 1000) * validDuration;
      onSeek(targetTime);
    }
  };

  return (
    <div className="movie-controls">
      <div className="movie-title-row">
        <span className="now-playing-label">NOW SHOWING</span>
        <strong id="current-movie-title">{movie.title || "Loading theatre…"}</strong>
        <span id="host-note" className="host-note">
          {isHost ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <HiStar style={{ color: "#fbbf24" }} /> You are the Host
            </span>
          ) : (
            "Viewer Mode"
          )}
        </span>
      </div>

      <div className="playback-row">
        <button
          id="movie-play-button"
          className="round-control small"
          title={isHost ? (movie.playing ? "Pause movie" : "Play movie") : "Host controls playback"}
          aria-label="Play or pause movie"
          onClick={onPlayToggle}
          disabled={!isHost}
        >
          {movie.playing ? <FiPause /> : <FiPlay />}
        </button>

        <span id="movie-current-time" className="time-label">
          {formatTime(displayCurrentTime)}
        </span>

        <input
          id="movie-progress"
          className="range-input progress-input"
          type="range"
          min="0"
          max="1000"
          value={Math.round(displayProgress)}
          onPointerDown={handlePointerDown}
          onChange={handleSliderChange}
          onPointerUp={handlePointerUp}
          onMouseUp={handlePointerUp}
          onTouchEnd={handlePointerUp}
          disabled={!isHost}
          title={isHost ? `Seek to: ${formatTime(displayCurrentTime)} / ${formatTime(duration)}` : "Host controls playback"}
          aria-label="Seek video progress"
        />

        <span id="movie-duration" className="time-label">
          {formatTime(duration)}
        </span>

        <span className="volume-icon" style={{ display: "inline-flex", alignItems: "center" }} title={`Volume: ${Math.round(volume * 100)}%`}>
          <FiVolume2 />
        </span>
        <input
          id="movie-volume"
          className="range-input volume-input"
          type="range"
          min="0"
          max="1.5"
          step="0.01"
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          title={`Volume: ${Math.round(volume * 100)}% (Boost up to 150%)`}
          aria-label="Volume (up to 150%)"
        />
        <span style={{ fontSize: "9px", color: volume > 1.0 ? "#38bdf8" : "#94a3b8", fontWeight: 700, minWidth: "28px" }}>
          {Math.round(volume * 100)}%
        </span>

        {/* Dolby Atmos & Theater Echo Spatial Audio Dropdown */}
        {(onSpatialAudioModeChange || onToggleSpatialAudio) && (
          <div ref={audioMenuRef} style={{ position: "relative" }}>
            <button
              id="movie-spatial-audio-button"
              className="round-control small"
              style={{
                width: "auto",
                padding: "0 8px",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: spatialAudioMode === "atmos" ? "#38bdf8" : spatialAudioMode === "hall" ? "#c084fc" : "#94a3b8",
                borderColor: spatialAudioMode === "atmos" ? "rgba(56,189,248,0.5)" : spatialAudioMode === "hall" ? "rgba(192,132,252,0.5)" : "rgba(255,255,255,0.12)",
                background: spatialAudioMode === "atmos" ? "rgba(56,189,248,0.14)" : spatialAudioMode === "hall" ? "rgba(192,132,252,0.14)" : "transparent",
                boxShadow: spatialAudioMode === "atmos" ? "0 0 10px rgba(56,189,248,0.25)" : spatialAudioMode === "hall" ? "0 0 10px rgba(192,132,252,0.25)" : "none"
              }}
              title="Theatre Audio System: Dolby Atmos 3D, Echo Hall, or Stereo"
              aria-label="Toggle theatre audio acoustics"
              onClick={() => {
                if (onSpatialAudioModeChange) {
                  setIsAudioMenuOpen(!isAudioMenuOpen);
                } else if (onToggleSpatialAudio) {
                  onToggleSpatialAudio();
                }
              }}
            >
              {spatialAudioMode === "atmos" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <FiHeadphones /> ATMOS 3D <FiChevronDown />
                </span>
              ) : spatialAudioMode === "hall" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <HiBuildingLibrary /> ECHO HALL <FiChevronDown />
                </span>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <FiHeadphones /> STEREO <FiChevronDown />
                </span>
              )}
            </button>

            {isAudioMenuOpen && onSpatialAudioModeChange && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  right: 0,
                  background: "rgba(10, 14, 26, 0.95)",
                  backdropFilter: "blur(16px)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "10px",
                  padding: "4px",
                  minWidth: "168px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  zIndex: 60,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px"
                }}
              >
                {[
                  { id: "atmos", icon: <FiHeadphones style={{ marginRight: 6 }} />, title: "Dolby Atmos 3D", desc: "HRTF 3D + Subwoofer + Surround" },
                  { id: "hall", icon: <HiBuildingLibrary style={{ marginRight: 6 }} />, title: "Multiplex Echo Hall", desc: "Auditorium Wall Echoes & Reverb" },
                  { id: "stereo", icon: <FiHeadphones style={{ marginRight: 6 }} />, title: "Standard Stereo", desc: "Direct stereo bypass" }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      padding: "6px 8px",
                      background: spatialAudioMode === item.id ? "rgba(56,189,248,0.2)" : "transparent",
                      color: spatialAudioMode === item.id ? "#38bdf8" : "#cbd5e1",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "10px",
                      cursor: "pointer",
                      textAlign: "left"
                    }}
                    onClick={() => {
                      onSpatialAudioModeChange(item.id as AudioSpatialMode);
                      setIsAudioMenuOpen(false);
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", fontWeight: spatialAudioMode === item.id ? 700 : 500 }}>
                      <span style={{ display: "inline-flex", alignItems: "center" }}>
                        {item.icon} {item.title}
                      </span>
                      {spatialAudioMode === item.id && <FiCheck />}
                    </div>
                    <span style={{ fontSize: "8.5px", color: "#94a3b8", marginTop: "2px" }}>{item.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quality Selector Dropdown */}
        {onQualityChange && (
          <div ref={qualityMenuRef} style={{ position: "relative" }}>
            <button
              id="movie-quality-button"
              className="round-control small"
              style={{
                width: "auto",
                padding: "0 8px",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: quality === "auto" || quality === "1080p" ? "#60a5fa" : "#a78bfa",
                borderColor: "rgba(255,255,255,0.14)"
              }}
              title={`Video Quality: ${quality === "auto" ? "1080P AUTO" : quality.toUpperCase()}`}
              aria-label="Select video quality"
              onClick={() => setIsQualityMenuOpen(!isQualityMenuOpen)}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                {quality === "auto" ? "1080P AUTO" : quality.toUpperCase()} <FiChevronDown />
              </span>
            </button>

            {isQualityMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  right: 0,
                  background: "rgba(10, 14, 26, 0.95)",
                  backdropFilter: "blur(16px)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "10px",
                  padding: "4px",
                  minWidth: "135px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  zIndex: 60,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px"
                }}
              >
                {(["auto", "1080p", "720p", "480p", "360p"] as VideoQuality[]).map((q) => (
                  <button
                    key={q}
                    type="button"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 8px",
                      background: quality === q ? "rgba(96,165,250,0.2)" : "transparent",
                      color: quality === q ? "#60a5fa" : "#cbd5e1",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "10px",
                      fontWeight: quality === q ? 700 : 500,
                      cursor: "pointer",
                      textAlign: "left"
                    }}
                    onClick={() => {
                      onQualityChange(q);
                      setIsQualityMenuOpen(false);
                    }}
                  >
                    <span>{q === "auto" ? "Auto (1080P Max)" : q === "1080p" ? "1080P (Full HD)" : q.toUpperCase()}</span>
                    {quality === q && <FiCheck />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Aspect Ratio / Frame Options Dropdown (Fit Screen, Fill, 16:9, 21:9, 2.35:1, 2.39:1, 4:3) */}
        {(onFrameModeChange || onToggleFitMode) && (
          <div ref={frameMenuRef} style={{ position: "relative" }}>
            <button
              id="movie-fit-button"
              className="round-control small"
              style={{
                width: "auto",
                padding: "0 8px",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: frameMode === "2.35:1" ? "#38bdf8" : "#cbd5e1",
                borderColor: frameMode === "2.35:1" ? "rgba(56,189,248,0.5)" : "rgba(255,255,255,0.14)",
                background: frameMode === "2.35:1" ? "rgba(56,189,248,0.14)" : "transparent",
                boxShadow: frameMode === "2.35:1" ? "0 0 10px rgba(56,189,248,0.25)" : "none"
              }}
              title="Screen Aspect Ratio & Frame Options (2.35:1, Stretch, Fill, Fit, etc.)"
              aria-label="Select screen aspect ratio frame mode"
              onClick={() => {
                if (onFrameModeChange) {
                  setIsFrameMenuOpen(!isFrameMenuOpen);
                } else if (onToggleFitMode) {
                  onToggleFitMode();
                }
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                {frameMode === "2.35:1" ? <><FiFilm /> 2.35:1</> :
                 frameMode === "fit" ? <><FiCrop /> FIT</> :
                 frameMode === "stretch" ? <><FiMaximize2 /> STRETCH</> :
                 frameMode === "fill" ? <><FiTv /> FILL</> :
                 <><FiFilm /> {frameMode}</>}
                <FiChevronDown />
              </span>
            </button>

            {isFrameMenuOpen && onFrameModeChange && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  right: 0,
                  background: "rgba(10, 14, 26, 0.95)",
                  backdropFilter: "blur(16px)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "10px",
                  padding: "4px",
                  minWidth: "190px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  zIndex: 60,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px"
                }}
              >
                {[
                  { id: "2.35:1", icon: <FiFilm style={{ marginRight: 6 }} />, title: "2.35:1 (Default)", desc: "CinemaScope widescreen" },
                  { id: "stretch", icon: <FiMaximize2 style={{ marginRight: 6 }} />, title: "Stretch (Hide Black Bars)", desc: "Expands height to eliminate top & bottom bars" },
                  { id: "fill", icon: <FiTv style={{ marginRight: 6 }} />, title: "Fill Screen", desc: "100% curved screen cover" },
                  { id: "fit", icon: <FiCrop style={{ marginRight: 6 }} />, title: "Fit Screen", desc: "Auto original aspect ratio" },
                  { id: "16:9", icon: <FiFilm style={{ marginRight: 6 }} />, title: "16:9", desc: "Standard widescreen (1.78:1)" },
                  { id: "21:9", icon: <FiVideo style={{ marginRight: 6 }} />, title: "21:9", desc: "Cinema ultrawide (2.33:1)" },
                  { id: "2.39:1", icon: <FiFilm style={{ marginRight: 6 }} />, title: "2.39:1", desc: "Theatrical anamorphic" }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 8px",
                      background: frameMode === item.id ? "rgba(192,132,252,0.2)" : "transparent",
                      color: frameMode === item.id ? "#c084fc" : "#cbd5e1",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "10px",
                      fontWeight: frameMode === item.id ? 700 : 500,
                      cursor: "pointer",
                      textAlign: "left"
                    }}
                    onClick={() => {
                      onFrameModeChange(item.id as ScreenFrameMode);
                      setIsFrameMenuOpen(false);
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        {item.icon} {item.title}
                      </div>
                      <div style={{ fontSize: "8.5px", color: "#94a3b8" }}>{item.desc}</div>
                    </div>
                    {frameMode === item.id && <FiCheck />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Theatre Lighting & Side Lights Animations Popover */}
        <div ref={lightingMenuRef} style={{ position: "relative" }}>
          {(() => {
            let label = "LIGHTS";
            let color = "#fbbf24";
            let icon = <FiSun />;
            const allOff = !lighting.ceiling && !lighting.stairs && !lighting.belowScreen && lighting.sideLights === "off";

            if (lighting.sideLights === "hero_entry") {
              label = "HERO";
              color = "#f59e0b";
              icon = <FiZap />;
            } else if (lighting.sideLights === "wave") {
              label = "WAVE";
              color = "#38bdf8";
              icon = <FiActivity />;
            } else if (lighting.sideLights === "pulse") {
              label = "PULSE";
              color = "#ec4899";
              icon = <FiHeart />;
            } else if (lighting.sideLights === "chase") {
              label = "CHASE";
              color = "#06b6d4";
              icon = <FiFastForward />;
            } else if (lighting.sideLights === "strobe") {
              label = "STROBE";
              color = "#ef4444";
              icon = <IoFlash />;
            } else if (lighting.sideLights === "rainbow") {
              label = "CHROMA";
              color = "#a855f7";
              icon = <IoColorPaletteOutline />;
            } else if (lighting.sideLights === "fire") {
              label = "FIRE";
              color = "#f97316";
              icon = <IoFlame />;
            } else if (lighting.sideLights === "ambilight_sync") {
              label = "SYNC";
              color = "#10b981";
              icon = <FiFilm />;
            } else if (allOff) {
              label = "BLACKOUT";
              color = "#94a3b8";
              icon = <FiMoon />;
            } else if (lighting.sideLights === "off") {
              label = "DIM";
              color = "#94a3b8";
              icon = <FiMoon />;
            }

            return (
              <button
                id="movie-lighting-button"
                className="round-control small"
                style={{
                  width: "auto",
                  padding: "0 8px",
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color,
                  borderColor: allOff ? "rgba(255,255,255,0.14)" : `${color}80`,
                  background: allOff ? "transparent" : `${color}1a`,
                  boxShadow: allOff ? "none" : `0 0 10px ${color}40`
                }}
                title="Theatre Lighting: Ceiling, Stairs, Screen & Side Animations"
                aria-label="Theatre Lighting Controls"
                onClick={() => setIsLightingMenuOpen(!isLightingMenuOpen)}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  {icon} {label} <FiChevronDown />
                </span>
              </button>
            );
          })()}

          {isLightingMenuOpen && (
            <div className="lighting-popover">
              <div className="lighting-header">
                <span className="lighting-title">
                  <FiSun style={{ color: "#fbbf24" }} /> THEATRE LIGHTING
                </span>
                <span
                  className="lighting-badge"
                  style={{
                    background: isHost ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.06)",
                    color: isHost ? "#fbbf24" : "#94a3b8",
                    border: isHost ? "1px solid rgba(251,191,36,0.3)" : "1px solid rgba(255,255,255,0.1)"
                  }}
                >
                  {isHost ? "Host Control" : "Host Only"}
                </span>
              </div>

              {/* Special HERO ENTRY Action Banner */}
              <button
                type="button"
                className={`hero-entry-banner-btn ${lighting.sideLights === "hero_entry" ? "active" : ""}`}
                title="Trigger grand hero entrance fanfare strobe & gold/cyan shockwave across walls"
                disabled={!isHost}
                onClick={() =>
                  onLightingChange?.({
                    ceiling: false,
                    stairs: true,
                    belowScreen: false,
                    sideLights: "hero_entry"
                  })
                }
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="hero-lightning" style={{ display: "inline-flex", alignItems: "center" }}><FiZap /></span>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.04em", color: "#fef08a" }}>
                      TRIGGER HERO ENTRY
                    </div>
                    <div style={{ fontSize: "8.5px", color: "rgba(254,240,138,0.75)" }}>
                      Gold & cyan fanfare burst for character reveals
                    </div>
                  </div>
                </div>
                <span className="hero-trigger-pill">
                  {lighting.sideLights === "hero_entry" ? "ACTIVE" : "FIRE"}
                </span>
              </button>

              {/* Quick Scene Presets */}
              <div className="lighting-presets">
                <button
                  type="button"
                  className="preset-btn"
                  title="All theatre lights on"
                  disabled={!isHost}
                  onClick={() =>
                    onLightingChange?.({
                      ceiling: true,
                      stairs: true,
                      belowScreen: true,
                      sideLights: "on"
                    })
                  }
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}><FiSun /> Bright</span>
                </button>
                <button
                  type="button"
                  className="preset-btn"
                  title="Side neon wave animation with stair safety lights"
                  disabled={!isHost}
                  onClick={() =>
                    onLightingChange?.({
                      ceiling: false,
                      stairs: true,
                      belowScreen: false,
                      sideLights: "wave"
                    })
                  }
                  style={{
                    borderColor: lighting.sideLights === "wave" ? "rgba(56,189,248,0.5)" : undefined,
                    color: lighting.sideLights === "wave" ? "#38bdf8" : undefined
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}><FiActivity /> Wave</span>
                </button>
                <button
                  type="button"
                  className="preset-btn"
                  title="Cyberpunk rainbow chroma spectrum"
                  disabled={!isHost}
                  onClick={() =>
                    onLightingChange?.({
                      ceiling: false,
                      stairs: true,
                      belowScreen: false,
                      sideLights: "rainbow"
                    })
                  }
                  style={{
                    borderColor: lighting.sideLights === "rainbow" ? "rgba(168,85,247,0.5)" : undefined,
                    color: lighting.sideLights === "rainbow" ? "#c084fc" : undefined
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}><IoColorPaletteOutline /> Chroma</span>
                </button>
                <button
                  type="button"
                  className="preset-btn"
                  title="Cinema movie mode: ceiling and side off, stairs dimly lit"
                  disabled={!isHost}
                  onClick={() =>
                    onLightingChange?.({
                      ceiling: false,
                      stairs: true,
                      belowScreen: false,
                      sideLights: "off"
                    })
                  }
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}><FiFilm /> Cinema Dim</span>
                </button>
                <button
                  type="button"
                  className="preset-btn"
                  title="Total cinema blackout: all fixtures dark"
                  disabled={!isHost}
                  onClick={() =>
                    onLightingChange?.({
                      ceiling: false,
                      stairs: false,
                      belowScreen: false,
                      sideLights: "off"
                    })
                  }
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}><FiMoon /> Blackout</span>
                </button>
              </div>

              {/* Ceiling Lights Toggle (100% pitch black when off, zero glow) */}
              <div className="lighting-row">
                <div className="lighting-label-group">
                  <span className="lighting-name">Ceiling Lights</span>
                  <span className="lighting-sub">Overhead tube grid (zero glow when off)</span>
                </div>
                <button
                  type="button"
                  className={`lighting-toggle-pill ${lighting.ceiling ? "on" : "off"}`}
                  disabled={!isHost}
                  onClick={() => onLightingChange?.({ ceiling: !lighting.ceiling })}
                >
                  {lighting.ceiling ? "ON" : "OFF"}
                </button>
              </div>

              {/* Stair Lights Toggle */}
              <div className="lighting-row">
                <div className="lighting-label-group">
                  <span className="lighting-name">Stair Lights</span>
                  <span className="lighting-sub">Aisle & step LED treads</span>
                </div>
                <button
                  type="button"
                  className={`lighting-toggle-pill ${lighting.stairs ? "on" : "off"}`}
                  disabled={!isHost}
                  onClick={() => onLightingChange?.({ stairs: !lighting.stairs })}
                >
                  {lighting.stairs ? "ON" : "OFF"}
                </button>
              </div>

              {/* Below Screen Lights Toggle */}
              <div className="lighting-row">
                <div className="lighting-label-group">
                  <span className="lighting-name">Below Screen</span>
                  <span className="lighting-sub">Curved proscenium rim</span>
                </div>
                <button
                  type="button"
                  className={`lighting-toggle-pill ${lighting.belowScreen ? "on" : "off"}`}
                  disabled={!isHost}
                  onClick={() => onLightingChange?.({ belowScreen: !lighting.belowScreen })}
                >
                  {lighting.belowScreen ? "ON" : "OFF"}
                </button>
              </div>

              {/* Side Lights Animations Header */}
              <div style={{ marginTop: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.05em", color: "#e2e8f0" }}>
                    SIDE LIGHT ANIMATIONS
                  </span>
                  <span style={{ fontSize: "8.5px", color: "#94a3b8" }}>
                    Soft ambient glow · No wall blotches
                  </span>
                </div>

                {/* 10 Animated Light Modes Grid */}
                <div className="side-anim-grid">
                  {SIDE_LIGHT_ANIMATIONS.map((anim) => {
                    const isActive = lighting.sideLights === anim.id;
                    return (
                      <button
                        key={anim.id}
                        type="button"
                        className={`side-anim-card ${isActive ? "active" : ""}`}
                        style={{
                          borderColor: isActive ? anim.color : "rgba(255,255,255,0.08)",
                          background: isActive ? `${anim.color}22` : "rgba(255,255,255,0.03)",
                          boxShadow: isActive ? `0 0 10px ${anim.color}35` : "none"
                        }}
                        disabled={!isHost}
                        onClick={() => onLightingChange?.({ sideLights: anim.id })}
                        title={anim.desc}
                      >
                        <span style={{ fontSize: "13px", display: "inline-flex", alignItems: "center", color: anim.color }}>
                          {renderSideLightIcon(anim.id)}
                        </span>
                        <span
                          style={{
                            fontSize: "9px",
                            fontWeight: isActive ? 700 : 500,
                            color: isActive ? anim.color : "#cbd5e1",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {anim.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Video Ambilight Status */}
              <div className="ambilight-status-bar">
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="ambilight-dot" />
                  <span>Screen Ambilight: Active</span>
                </div>
                <span style={{ fontSize: "8.5px", color: "#64748b" }}>Live video ambient bounce</span>
              </div>
            </div>
          )}
        </div>

        <button
          id="movie-settings-button"
          className="icon-button"
          title="Change movie"
          aria-label="Change movie"
          onClick={onOpenSettings}
        >
          <FiMoreHorizontal />
        </button>
      </div>
    </div>
  );
};
