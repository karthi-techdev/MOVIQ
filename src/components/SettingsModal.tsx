"use client";

import React, { useState, useEffect } from "react";
import { parseVideoUrl, PRESET_MOVIES, PresetMovie } from "../lib/videoUtils";
import { AudioSpatialMode, ScreenFrameMode } from "../types/cinema";

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
  onLoadMovie: (title: string, url: string) => void;
  onToggleFitMode?: () => void;
  onFrameModeChange?: (mode: ScreenFrameMode) => void;
  onToggleSpatialAudio?: () => void;
  onSpatialAudioModeChange?: (mode: AudioSpatialMode) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  isHost,
  currentTitle,
  currentUrl,
  fitMode = "fit",
  frameMode = "fill",
  spatialAudioEnabled = true,
  spatialAudioMode = "atmos",
  onLoadMovie,
  onToggleFitMode,
  onFrameModeChange,
  onToggleSpatialAudio,
  onSpatialAudioModeChange
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

  const handleSelectPreset = (preset: PresetMovie) => {
    setTitle(preset.title);
    setUrl(preset.url);
  };

  const parsedInfo = parseVideoUrl(url);

  const getSourceBadge = () => {
    if (!url.trim()) return null;
    switch (parsedInfo.type) {
      case "youtube":
        return <span style={{ background: "rgba(239,68,68,0.2)", color: "#f87171", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>🔴 YouTube</span>;
      case "vimeo":
        return <span style={{ background: "rgba(14,165,233,0.2)", color: "#38bdf8", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>🔵 Vimeo</span>;
      case "twitch":
        return <span style={{ background: "rgba(168,85,247,0.2)", color: "#c084fc", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>🟣 Twitch</span>;
      case "hls":
        return <span style={{ background: "rgba(234,179,8,0.2)", color: "#facc15", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>⚡ HLS Stream</span>;
      default:
        if (url.includes("drive.google.com")) {
          return <span style={{ background: "rgba(34,197,94,0.2)", color: "#4ade80", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>📁 Google Drive</span>;
        }
        if (url.includes("dropbox.com")) {
          return <span style={{ background: "rgba(59,130,246,0.2)", color: "#60a5fa", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>📦 Dropbox</span>;
        }
        return <span style={{ background: "rgba(59,130,246,0.2)", color: "#60a5fa", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600 }}>🎬 Direct Video / CORS Proxy</span>;
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
            ×
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
              { id: "stretch", label: "↔️ Stretch (Hide Black Bars)" },
              { id: "stretch-max", label: "↔️ Stretch Max (Ultra Zoom)" },
              { id: "fill", label: "📺 Fill Screen (100%)" },
              { id: "fit", label: "📐 Auto Fit (Original)" },
              { id: "16:9", label: "🎬 16:9 (Widescreen)" },
              { id: "21:9", label: "🎥 21:9 (Ultrawide)" },
              { id: "2.35:1", label: "🎞️ 2.35:1 (CinemaScope)" },
              { id: "2.39:1", label: "🍿 2.39:1 (Theatrical)" },
              { id: "4:3", label: "📺 4:3 (Classic)" }
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className="button button-secondary"
                style={{
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
                {f.label}
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
              { id: "atmos", label: "🎧 Dolby Atmos 3D", desc: "HRTF + Subwoofer + Height + Wall Echoes" },
              { id: "hall", label: "🏛️ Multiplex Echo Hall", desc: "High Auditorium Echo & Grand Reverb" },
              { id: "stereo", label: "🎧 Standard Stereo", desc: "Direct flat 2-channel stereo" }
            ].map((a) => (
              <button
                key={a.id}
                type="button"
                className="button button-secondary"
                style={{
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
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {isHost && (
          <>
            {/* Quick Presets */}
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", marginBottom: "6px" }}>
                QUICK DEMO MOVIES & STREAMS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {PRESET_MOVIES.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "7px 10px",
                      background: url === preset.url ? "rgba(96,165,250,0.18)" : "rgba(255,255,255,0.03)",
                      border: url === preset.url ? "1px solid rgba(96,165,250,0.5)" : "1px solid rgba(255,255,255,0.06)",
                      borderRadius: "8px",
                      color: "#e2e8f0",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: "11px",
                      transition: "all 0.15s ease"
                    }}
                  >
                    <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: "8px" }}>
                      {preset.title}
                    </span>
                    <span style={{ fontSize: "9px", padding: "2px 6px", borderRadius: "6px", background: "rgba(255,255,255,0.08)", color: "#cbd5e1", whiteSpace: "nowrap" }}>
                      {preset.badge}
                    </span>
                  </button>
                ))}
              </div>
            </div>

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
