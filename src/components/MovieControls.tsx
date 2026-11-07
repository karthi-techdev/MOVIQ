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
  FiMoreHorizontal
} from "react-icons/fi";
import { HiBuildingLibrary, HiStar } from "react-icons/hi2";
import { AudioSpatialMode, MovieState, ScreenFrameMode, VideoQuality } from "../types/cinema";

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
  onPlayToggle: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
  onOpenSettings: () => void;
  onToggleFitMode?: () => void;
  onFrameModeChange?: (mode: ScreenFrameMode) => void;
  onToggleSpatialAudio?: () => void;
  onSpatialAudioModeChange?: (mode: AudioSpatialMode) => void;
  onQualityChange?: (quality: VideoQuality) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
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
  onPlayToggle,
  onSeek,
  onVolumeChange,
  onOpenSettings,
  onToggleFitMode,
  onFrameModeChange,
  onToggleSpatialAudio,
  onSpatialAudioModeChange,
  onQualityChange
}) => {
  const [isQualityMenuOpen, setIsQualityMenuOpen] = useState(false);
  const [isFrameMenuOpen, setIsFrameMenuOpen] = useState(false);
  const [isAudioMenuOpen, setIsAudioMenuOpen] = useState(false);

  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const frameMenuRef = useRef<HTMLDivElement>(null);
  const audioMenuRef = useRef<HTMLDivElement>(null);
  const progressVal = duration > 0 ? (currentTime / duration) * 1000 : 0;

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
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost) return;
    const val = Number(e.target.value);
    const targetTime = (val / 1000) * duration;
    onSeek(targetTime);
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
          {formatTime(currentTime)}
        </span>

        <input
          id="movie-progress"
          className="range-input progress-input"
          type="range"
          min="0"
          max="1000"
          value={isNaN(progressVal) ? 0 : progressVal}
          onChange={handleSliderChange}
          disabled={!isHost}
        />

        <span id="movie-duration" className="time-label">
          {formatTime(duration)}
        </span>

        <span className="volume-icon" style={{ display: "inline-flex", alignItems: "center" }}>
          <FiVolume2 />
        </span>
        <input
          id="movie-volume"
          className="range-input volume-input"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />

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
                color: quality === "auto" ? "#e2e8f0" : "#a78bfa",
                borderColor: "rgba(255,255,255,0.14)"
              }}
              title={`Video Quality: ${quality.toUpperCase()}`}
              aria-label="Select video quality"
              onClick={() => setIsQualityMenuOpen(!isQualityMenuOpen)}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                {quality.toUpperCase()} <FiChevronDown />
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
                  minWidth: "118px",
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
                    <span>{q === "auto" ? "Auto (Adaptive)" : q.toUpperCase()}</span>
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
                color: frameMode === "stretch" ? "#38bdf8" : "#cbd5e1",
                borderColor: frameMode === "stretch" ? "rgba(56,189,248,0.5)" : "rgba(255,255,255,0.14)",
                background: frameMode === "stretch" ? "rgba(56,189,248,0.14)" : "transparent",
                boxShadow: frameMode === "stretch" ? "0 0 10px rgba(56,189,248,0.25)" : "none"
              }}
              title="Screen Aspect Ratio & Frame Options (Stretch, Fill, Fit, 16:9, etc.)"
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
                {frameMode === "stretch" ? <><FiMaximize2 /> STRETCH</> :
                 frameMode === "stretch-max" ? <><FiMaximize2 /> STRETCH+</> :
                 frameMode === "fill" ? <><FiTv /> FILL</> :
                 frameMode === "fit" ? <><FiCrop /> FIT</> :
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
                  { id: "stretch", icon: <FiMaximize2 style={{ marginRight: 6 }} />, title: "Stretch (Hide Black Bars)", desc: "Expands height to eliminate top & bottom bars" },
                  { id: "stretch-max", icon: <FiMaximize2 style={{ marginRight: 6 }} />, title: "Stretch Max (Ultra Zoom)", desc: "Maximum vertical stretch for extra-wide letterbox" },
                  { id: "fill", icon: <FiTv style={{ marginRight: 6 }} />, title: "Fill Screen", desc: "100% curved screen cover" },
                  { id: "fit", icon: <FiCrop style={{ marginRight: 6 }} />, title: "Fit Screen", desc: "Auto original aspect ratio" },
                  { id: "16:9", icon: <FiFilm style={{ marginRight: 6 }} />, title: "16:9", desc: "Standard widescreen (1.78:1)" },
                  { id: "21:9", icon: <FiVideo style={{ marginRight: 6 }} />, title: "21:9", desc: "Cinema ultrawide (2.33:1)" },
                  { id: "2.35:1", icon: <FiFilm style={{ marginRight: 6 }} />, title: "2.35:1", desc: "CinemaScope widescreen" },
                  { id: "2.39:1", icon: <FiFilm style={{ marginRight: 6 }} />, title: "2.39:1", desc: "Theatrical anamorphic" },
                  { id: "4:3", icon: <FiTv style={{ marginRight: 6 }} />, title: "4:3", desc: "Classic academy ratio" }
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
