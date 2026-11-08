"use client";

import React, { useState, useEffect } from "react";
import {
  FiX,
  FiFilm,
  FiRadio,
  FiHeadphones,
  FiMaximize2,
  FiTv,
  FiCrop,
  FiVideo,
  FiSun,
  FiMoon,
  FiZap,
  FiActivity,
  FiHeart,
  FiFastForward
} from "react-icons/fi";
import {
  FaYoutube,
  FaVimeoV,
  FaTwitch,
  FaGoogleDrive,
  FaDropbox
} from "react-icons/fa6";
import { IoFlame, IoColorPaletteOutline, IoFlash } from "react-icons/io5";
import { HiBuildingLibrary } from "react-icons/hi2";
import { parseVideoUrl } from "../lib/videoUtils";
import { AudioSpatialMode, LightingState, ScreenFrameMode, SideLightMode } from "../types/cinema";
import { SIDE_LIGHT_ANIMATIONS } from "../lib/constants";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isHost: boolean;
  currentTitle: string;
  currentUrl: string;
  fitMode?: "fit" | "fill";
  frameMode?: ScreenFrameMode;
  spatialAudioEnabled?: boolean;
  spatialAudioMode?: AudioSpatialMode;
  lighting?: LightingState;
  onLoadMovie: (title: string, url: string) => void;
  onToggleFitMode?: () => void;
  onFrameModeChange?: (mode: ScreenFrameMode) => void;
  onToggleSpatialAudio?: () => void;
  onSpatialAudioModeChange?: (mode: AudioSpatialMode) => void;
  onLightingChange?: (partial: Partial<LightingState>) => void;
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

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  isHost,
  currentTitle,
  currentUrl,
  fitMode = "fit",
  frameMode = "2.35:1",
  spatialAudioEnabled = true,
  spatialAudioMode = "atmos",
  lighting = { ceiling: true, stairs: true, belowScreen: true, sideLights: "on" },
  onLoadMovie,
  onToggleFitMode,
  onFrameModeChange,
  onToggleSpatialAudio,
  onSpatialAudioModeChange,
  onLightingChange
}) => {
  const [title, setTitle] = useState(currentTitle);
  const [url, setUrl] = useState(currentUrl);

  useEffect(() => {
    setTitle(currentTitle);
    setUrl(currentUrl);
  }, [currentTitle, currentUrl, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onLoadMovie(title.trim() || "Shared Movie", url.trim());
    onClose();
  };

  const parsedInfo = parseVideoUrl(url);

  const getSourceBadge = () => {
    if (!url.trim()) return null;
    switch (parsedInfo.type) {
      case "youtube":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(239,68,68,0.2)", color: "#f87171", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>
            <FaYoutube /> YouTube
          </span>
        );
      case "vimeo":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(14,165,233,0.2)", color: "#38bdf8", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>
            <FaVimeoV /> Vimeo
          </span>
        );
      case "twitch":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(168,85,247,0.2)", color: "#c084fc", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>
            <FaTwitch /> Twitch
          </span>
        );
      case "hls":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(234,179,8,0.2)", color: "#facc15", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>
            <FiRadio /> HLS Stream
          </span>
        );
      default:
        if (url.includes("drive.google.com")) {
          return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(34,197,94,0.2)", color: "#4ade80", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>
              <FaGoogleDrive /> Google Drive
            </span>
          );
        }
        if (url.includes("dropbox.com")) {
          return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(59,130,246,0.2)", color: "#60a5fa", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>
              <FaDropbox /> Dropbox
            </span>
          );
        }
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(59,130,246,0.2)", color: "#60a5fa", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>
            <FiFilm /> Direct Video / CORS Proxy
          </span>
        );
    }
  };

  return (
    <div id="settings-modal" className="modal-backdrop">
      <section className="settings-dialog glass-panel" role="dialog" aria-modal="true" style={{ width: "min(100%, 480px)" }}>
        <div className="dialog-header">
          <div>
            <p className="eyebrow">THEATRE CONTROL</p>
            <h2 id="settings-title">Screen & Movie Settings</h2>
          </div>
          <button
            id="close-settings-button"
            className="icon-button"
            title="Close settings"
            onClick={onClose}
          >
            <FiX />
          </button>
        </div>

        <p id="host-settings-description" className="dialog-description" style={{ marginBottom: "14px" }}>
          {isHost
            ? "Play any movie link: Direct MP4/WebM, HLS Live Streams (.m3u8), YouTube, Vimeo, Twitch, or Google Drive."
            : "Only the theatre host can change the active video stream."}
        </p>

        {/* Screen Aspect Ratio & Frame Mode Selector */}
        <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.04)", borderRadius: "12px", marginBottom: "12px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#f1f5f9" }}>Screen Frame & Aspect Ratio</div>
              <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                Select how the video projects onto the curved cinema screen
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {[
              { id: "2.35:1", icon: <FiFilm style={{ marginRight: 4 }} />, label: "2.35:1 (Default)" },
              { id: "stretch", icon: <FiMaximize2 style={{ marginRight: 4 }} />, label: "Stretch (Hide Black Bars)" },
              { id: "fill", icon: <FiTv style={{ marginRight: 4 }} />, label: "Fill Screen" },
              { id: "fit", icon: <FiCrop style={{ marginRight: 4 }} />, label: "Auto Fit (Original)" },
              { id: "16:9", icon: <FiFilm style={{ marginRight: 4 }} />, label: "16:9 (Widescreen)" },
              { id: "21:9", icon: <FiVideo style={{ marginRight: 4 }} />, label: "21:9 (Ultrawide)" },
              { id: "2.39:1", icon: <FiFilm style={{ marginRight: 4 }} />, label: "2.39:1 (Theatrical)" }
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className="button button-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: "10px",
                  padding: "4px 8px",
                  minHeight: "auto",
                  background: frameMode === f.id ? "rgba(192,132,252,0.22)" : "rgba(255,255,255,0.04)",
                  borderColor: frameMode === f.id ? "rgba(192,132,252,0.55)" : "rgba(255,255,255,0.08)",
                  color: frameMode === f.id ? "#c084fc" : "#cbd5e1",
                  fontWeight: frameMode === f.id ? 700 : 500
                }}
                onClick={() => {
                  if (onFrameModeChange) {
                    onFrameModeChange(f.id as ScreenFrameMode);
                  } else if (onToggleFitMode) {
                    onToggleFitMode();
                  }
                }}
              >
                {f.icon} {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Theatre Audio Acoustics & Dolby Atmos System */}
        <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.04)", borderRadius: "12px", marginBottom: "16px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#f1f5f9" }}>Theatre Audio & Acoustics</div>
              <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                3D HRTF positional sound, subwoofer punch, hall echo & Dolby Atmos
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {[
              { id: "atmos", icon: <FiHeadphones style={{ marginRight: 5 }} />, label: "Dolby Atmos 3D", desc: "HRTF + Subwoofer + Height + Wall Echoes" },
              { id: "hall", icon: <HiBuildingLibrary style={{ marginRight: 5 }} />, label: "Multiplex Echo Hall", desc: "High Auditorium Echo & Grand Reverb" },
              { id: "stereo", icon: <FiHeadphones style={{ marginRight: 5 }} />, label: "Standard Stereo", desc: "Direct flat 2-channel stereo" }
            ].map((a) => (
              <button
                key={a.id}
                type="button"
                className="button button-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: "10px",
                  padding: "5px 10px",
                  minHeight: "auto",
                  background: spatialAudioMode === a.id ? (a.id === "atmos" ? "rgba(56,189,248,0.22)" : a.id === "hall" ? "rgba(192,132,252,0.22)" : "rgba(255,255,255,0.12)") : "rgba(255,255,255,0.04)",
                  borderColor: spatialAudioMode === a.id ? (a.id === "atmos" ? "rgba(56,189,248,0.6)" : a.id === "hall" ? "rgba(192,132,252,0.6)" : "rgba(255,255,255,0.25)") : "rgba(255,255,255,0.08)",
                  color: spatialAudioMode === a.id ? (a.id === "atmos" ? "#38bdf8" : a.id === "hall" ? "#c084fc" : "#f1f5f9") : "#cbd5e1",
                  fontWeight: spatialAudioMode === a.id ? 700 : 500
                }}
                onClick={() => {
                  if (onSpatialAudioModeChange) {
                    onSpatialAudioModeChange(a.id as AudioSpatialMode);
                  } else if (onToggleSpatialAudio) {
                    onToggleSpatialAudio();
                  }
                }}
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Theatre Lighting & Atmosphere System */}
        <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.04)", borderRadius: "12px", marginBottom: "16px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#f1f5f9", display: "flex", alignItems: "center", gap: "6px" }}>
                <FiSun style={{ color: "#fbbf24" }} /> Theatre Lighting & Atmosphere
              </div>
              <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                Individual fixture toggles, side wall wave animation & realistic video ambilight
              </div>
            </div>
            <span
              style={{
                fontSize: "9px",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "6px",
                background: isHost ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.06)",
                color: isHost ? "#fbbf24" : "#94a3b8",
                border: isHost ? "1px solid rgba(251,191,36,0.3)" : "1px solid rgba(255,255,255,0.1)"
              }}
            >
              {isHost ? "Host Controls" : "Host Only"}
            </span>
          </div>

          {/* HERO ENTRY Banner */}
          <button
            type="button"
            className={`hero-entry-banner-btn ${lighting.sideLights === "hero_entry" ? "active" : ""}`}
            style={{ marginBottom: "10px" }}
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
                  TRIGGER HERO ENTRY FANFARE
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

          {/* Presets */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "5px", marginBottom: "10px" }}>
            {[
              { id: "bright", label: "Bright", icon: <FiSun />, act: { ceiling: true, stairs: true, belowScreen: true, sideLights: "on" as const } },
              { id: "hero", label: "Hero Entry", icon: <FiZap />, act: { ceiling: false, stairs: true, belowScreen: false, sideLights: "hero_entry" as const } },
              { id: "wave", label: "Wave", icon: <FiActivity />, act: { ceiling: false, stairs: true, belowScreen: false, sideLights: "wave" as const } },
              { id: "dim", label: "Dim", icon: <FiFilm />, act: { ceiling: false, stairs: true, belowScreen: false, sideLights: "off" as const } },
              { id: "blackout", label: "Blackout", icon: <FiMoon />, act: { ceiling: false, stairs: false, belowScreen: false, sideLights: "off" as const } }
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                className="button button-secondary"
                disabled={!isHost}
                style={{
                  fontSize: "9.5px",
                  padding: "5px 3px",
                  minHeight: "auto",
                  textAlign: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px"
                }}
                onClick={() => onLightingChange?.(p.act)}
              >
                {p.icon} {p.label}
              </button>
            ))}
          </div>

          {/* Individual toggles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: "10.5px", color: "#e2e8f0" }}>Ceiling Grid</span>
              <button
                type="button"
                className={`lighting-toggle-pill ${lighting.ceiling ? "on" : "off"}`}
                disabled={!isHost}
                onClick={() => onLightingChange?.({ ceiling: !lighting.ceiling })}
              >
                {lighting.ceiling ? "ON" : "OFF"}
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: "10.5px", color: "#e2e8f0" }}>Stair Steps</span>
              <button
                type="button"
                className={`lighting-toggle-pill ${lighting.stairs ? "on" : "off"}`}
                disabled={!isHost}
                onClick={() => onLightingChange?.({ stairs: !lighting.stairs })}
              >
                {lighting.stairs ? "ON" : "OFF"}
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: "10.5px", color: "#e2e8f0" }}>Below Screen</span>
              <button
                type="button"
                className={`lighting-toggle-pill ${lighting.belowScreen ? "on" : "off"}`}
                disabled={!isHost}
                onClick={() => onLightingChange?.({ belowScreen: !lighting.belowScreen })}
              >
                {lighting.belowScreen ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          {/* Side Lights Animations Grid */}
          <div style={{ marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.05em", color: "#e2e8f0" }}>
                SIDE LIGHT ANIMATIONS
              </span>
              <span style={{ fontSize: "8.5px", color: "#94a3b8" }}>
                Soft ambient wash · No wall blotches
              </span>
            </div>
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

          {/* Ambilight callout */}
          <div className="ambilight-status-bar">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span className="ambilight-dot" />
              <span>Realistic Screen Ambilight active</span>
            </div>
            <span style={{ fontSize: "8.5px", color: "#64748b" }}>Live video ambient bounce</span>
          </div>
        </div>

        {isHost && (
          <>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                <label className="field-label" htmlFor="movie-title-input" style={{ margin: 0 }}>Movie title</label>
              </div>
              <input
                id="movie-title-input"
                className="text-input"
                type="text"
                maxLength={100}
                placeholder="Movie title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{ marginBottom: "12px" }}
              />

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                <label className="field-label" htmlFor="movie-url-input" style={{ margin: 0 }}>Video URL or Stream Link</label>
                {getSourceBadge()}
              </div>
              <input
                id="movie-url-input"
                className="text-input"
                type="text"
                placeholder="Direct MP4/WebM, HLS .m3u8, YouTube, or Google Drive URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />

              <p className="field-help" style={{ marginTop: "6px", marginBottom: "12px" }}>
                Supports all formats: YouTube videos & shorts, Vimeo, Twitch, HLS streams (.m3u8), and direct MP4/WebM. External links automatically proxy with full CORS support.
              </p>

              <button
                id="load-movie-button"
                type="submit"
                className="button button-primary button-full"
              >
                Load movie for everyone
              </button>
            </form>
          </>
        )}

        <div className="section-divider"></div>

        <p className="shortcut-help">
          Shortcuts: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>V</kbd> switch view · <kbd>Click seat</kbd> to sit · <kbd>Esc</kbd> close
        </p>
      </section>
    </div>
  );
};
