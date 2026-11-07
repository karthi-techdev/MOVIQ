"use client";

import React, { useState } from "react";
import {
  FiCopy,
  FiEye,
  FiVideo,
  FiMessageSquare,
  FiSettings,
  FiMaximize,
  FiMinimize,
  FiMic,
  FiMicOff,
  FiVolume2,
  FiPhoneOff,
  FiArrowUp,
  FiArrowDown,
  FiArrowLeft,
  FiArrowRight,
  FiSmile
} from "react-icons/fi";
import {
  FaHandsClapping,
  FaHand,
  FaFaceLaughSquint,
  FaCommentDots,
  FaRotateRight
} from "react-icons/fa6";
import { CameraMode, SeatData } from "../types/cinema";

interface CinemaHUDProps {
  theatreName: string;
  roomId: string;
  userCount: number;
  cameraMode: CameraMode;
  currentSeat: SeatData | null;
  unreadCount: number;
  isChatOpen: boolean;
  inVoice: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  focusMode: boolean;
  seatTooltip: { visible: boolean; text: string; x: number; y: number } | null;
  movieControls: React.ReactNode;
  onCopyRoom: () => void;
  onEmote: (emote: string) => void;
  onToggleCamera: () => void;
  onToggleChat: () => void;
  onToggleSettings: () => void;
  onToggleFocus: () => void;
  onLeave: () => void;
  onStandUp: () => void;
  onToggleVoice: () => void;
  onLeaveVoice: () => void;
  onVirtualKey?: (code: string, pressed: boolean) => void;
}

export const CinemaHUD: React.FC<CinemaHUDProps> = ({
  theatreName,
  roomId,
  userCount,
  cameraMode,
  currentSeat,
  unreadCount,
  isChatOpen,
  inVoice,
  isMuted,
  isSpeaking,
  focusMode,
  seatTooltip,
  movieControls,
  onCopyRoom,
  onEmote,
  onToggleCamera,
  onToggleChat,
  onToggleSettings,
  onToggleFocus,
  onLeave,
  onStandUp,
  onToggleVoice,
  onLeaveVoice,
  onVirtualKey
}) => {
  const [mobileEmotesOpen, setMobileEmotesOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const handleKeyTouch = (code: string, pressed: boolean) => {
    if (onVirtualKey) {
      onVirtualKey(code, pressed);
    }
  };

  const toggleRun = () => {
    const next = !isRunning;
    setIsRunning(next);
    if (onVirtualKey) {
      onVirtualKey("ShiftLeft", next);
    }
  };

  return (
    <>
      {/* Top Navigation Bar */}
      <header className={`top-bar glass-panel auto-ui ${focusMode ? "hidden-by-focus" : ""}`}>
        <div className="top-bar-left">
          <div className="brand">
            <span className="brand-mark">M</span>
            <span className="brand-word">MOVIQ</span>
          </div>

          <div className="theatre-identity">
            <strong id="top-theatre-name">{theatreName}</strong>
            <button
              id="copy-room-button"
              className="room-code"
              title="Copy room ID"
              onClick={onCopyRoom}
            >
              Room <span id="top-room-id">{roomId}</span> <FiCopy style={{ marginLeft: 3, verticalAlign: "middle" }} />
            </button>
          </div>
        </div>

        <div className="top-bar-actions">
          <span id="connection-status" className="status-pill connected">
            Connected
          </span>
          <span className="user-count">
            <span className="live-dot"></span>
            <span id="user-count">{userCount}</span> here
          </span>

          {/* Desktop & Mobile Emotes */}
          <div className="emotes-group">
            <button
              id="clap-button"
              className="icon-button emote-btn"
              title="Cheer / Clap! (Shortcut: C)"
              aria-label="Cheer"
              onClick={() => onEmote("clap")}
            >
              <FaHandsClapping />
            </button>
            <button
              id="wave-button"
              className="icon-button emote-btn"
              title="Wave! (Shortcut: G)"
              aria-label="Wave"
              onClick={() => onEmote("wave")}
            >
              <FaHand />
            </button>
            <button
              id="laugh-button"
              className="icon-button emote-btn"
              title="Laugh! (Shortcut: L)"
              aria-label="Laugh"
              onClick={() => onEmote("laugh")}
            >
              <FaFaceLaughSquint />
            </button>
            <button
              id="talk-button"
              className="icon-button emote-btn"
              title="Talk! (Shortcut: T)"
              aria-label="Talk"
              onClick={() => onEmote("talk")}
            >
              <FaCommentDots />
            </button>
            <button
              id="spin-button"
              className="icon-button emote-btn"
              title="360° Spin! (Shortcut: R)"
              aria-label="Spin"
              onClick={() => onEmote("turn_360")}
            >
              <FaRotateRight />
            </button>
          </div>

          <button
            id="camera-mode-button"
            className="view-toggle-button"
            title={`Switch View (Current: ${cameraMode === "FPP" ? "First Person" : "Third Person"}, Press V)`}
            aria-label="Toggle camera view"
            onClick={onToggleCamera}
          >
            {cameraMode === "FPP" ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <FiEye /> FPP
              </span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <FiVideo /> TPP
              </span>
            )}
          </button>

          <button
            id="chat-toggle-button"
            className="icon-button"
            title="Toggle chat"
            aria-label="Toggle chat"
            onClick={onToggleChat}
          >
            <FiMessageSquare />
            {unreadCount > 0 && !isChatOpen && (
              <span id="unread-badge" className="notification-badge">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            id="settings-button"
            className="icon-button"
            title="Theatre and movie settings"
            aria-label="Theatre and movie settings"
            onClick={onToggleSettings}
          >
            <FiSettings />
          </button>

          <button
            id="focus-button"
            className="icon-button"
            title="Toggle cinema focus mode"
            aria-label="Toggle cinema focus mode"
            onClick={onToggleFocus}
          >
            {focusMode ? <FiMinimize /> : <FiMaximize />}
          </button>

          <button
            id="leave-button"
            className="button button-danger button-small"
            onClick={onLeave}
          >
            Leave
          </button>
        </div>
      </header>

      {/* Seat Status Panel */}
      <div className={`seat-panel glass-panel auto-ui ${focusMode ? "hidden-by-focus" : ""}`}>
        <span className="seat-panel-label">YOUR SEAT</span>
        <strong id="seat-status">
          {currentSeat ? `Row ${currentSeat.row}, Seat ${currentSeat.col}` : "Standing"}
        </strong>
        {currentSeat && (
          <button
            id="stand-button"
            className="button button-secondary button-small"
            onClick={onStandUp}
          >
            Stand up
          </button>
        )}
      </div>

      {/* Control Hints Bar */}
      <div className={`hint-bar glass-panel auto-ui ${focusMode ? "hidden-by-focus" : ""}`}>
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</span>
        <span><kbd>Shift</kbd> Run</span>
        <span><kbd>Z</kbd> Slouch</span>
        <span><kbd>Space</kbd> Jump</span>
        <span><kbd>C</kbd> Cheer</span>
        <span><kbd>G</kbd> Wave</span>
        <span><kbd>L</kbd> Laugh</span>
        <span><kbd>T</kbd> Talk</span>
        <span><kbd>R</kbd> 360° Spin</span>
        <span><kbd>V</kbd> FPP/TPP</span>
        <span>Click seat to sit</span>
      </div>

      {/* Mobile Touch Navigation Overlay: Virtual D-Pad & Action Buttons */}
      <div className={`mobile-touch-controls auto-ui ${focusMode ? "hidden-by-focus" : ""}`}>
        {/* Virtual D-Pad (Left bottom) */}
        <div className="virtual-dpad glass-panel">
          <button
            className="dpad-btn dpad-up"
            title="Move Forward"
            aria-label="Move Forward"
            onTouchStart={(e) => { e.preventDefault(); handleKeyTouch("KeyW", true); }}
            onTouchEnd={(e) => { e.preventDefault(); handleKeyTouch("KeyW", false); }}
            onMouseDown={() => handleKeyTouch("KeyW", true)}
            onMouseUp={() => handleKeyTouch("KeyW", false)}
          >
            <FiArrowUp />
          </button>
          <div className="dpad-middle">
            <button
              className="dpad-btn dpad-left"
              title="Move Left"
              aria-label="Move Left"
              onTouchStart={(e) => { e.preventDefault(); handleKeyTouch("KeyA", true); }}
              onTouchEnd={(e) => { e.preventDefault(); handleKeyTouch("KeyA", false); }}
              onMouseDown={() => handleKeyTouch("KeyA", true)}
              onMouseUp={() => handleKeyTouch("KeyA", false)}
            >
              <FiArrowLeft />
            </button>
            <div className="dpad-center-nub" />
            <button
              className="dpad-btn dpad-right"
              title="Move Right"
              aria-label="Move Right"
              onTouchStart={(e) => { e.preventDefault(); handleKeyTouch("KeyD", true); }}
              onTouchEnd={(e) => { e.preventDefault(); handleKeyTouch("KeyD", false); }}
              onMouseDown={() => handleKeyTouch("KeyD", true)}
              onMouseUp={() => handleKeyTouch("KeyD", false)}
            >
              <FiArrowRight />
            </button>
          </div>
          <button
            className="dpad-btn dpad-down"
            title="Move Backward"
            aria-label="Move Backward"
            onTouchStart={(e) => { e.preventDefault(); handleKeyTouch("KeyS", true); }}
            onTouchEnd={(e) => { e.preventDefault(); handleKeyTouch("KeyS", false); }}
            onMouseDown={() => handleKeyTouch("KeyS", true)}
            onMouseUp={() => handleKeyTouch("KeyS", false)}
          >
            <FiArrowDown />
          </button>
        </div>

        {/* Mobile Action Buttons (Right bottom) */}
        <div className="virtual-actions">
          {currentSeat ? (
            <button
              className="action-btn sit-stand-btn active"
              onClick={onStandUp}
              title="Stand Up"
            >
              Stand
            </button>
          ) : (
            <button
              className="action-btn jump-btn"
              onTouchStart={(e) => { e.preventDefault(); handleKeyTouch("Space", true); }}
              onTouchEnd={(e) => { e.preventDefault(); handleKeyTouch("Space", false); }}
              onMouseDown={() => handleKeyTouch("Space", true)}
              onMouseUp={() => handleKeyTouch("Space", false)}
              title="Jump"
            >
              Jump
            </button>
          )}

          <button
            className={`action-btn run-btn ${isRunning ? "active" : ""}`}
            onClick={toggleRun}
            title={isRunning ? "Running" : "Walking"}
          >
            {isRunning ? "Run ON" : "Run"}
          </button>
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <section className={`bottom-controls glass-panel auto-ui ${focusMode ? "hidden-by-focus" : ""}`}>
        <div className="voice-controls">
          <button
            id="mic-button"
            className={`round-control ${inVoice ? (isMuted ? "muted" : "active") : ""}`}
            title={inVoice ? (isMuted ? "Unmute mic (M)" : "Mute mic (M)") : "Join voice chat"}
            aria-label="Voice chat toggle"
            onClick={onToggleVoice}
          >
            <span id="mic-icon" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              {!inVoice ? <FiMic /> : isMuted ? <FiMicOff /> : isSpeaking ? <FiVolume2 /> : <FiMic />}
            </span>
          </button>
          <div className="control-text">
            <strong id="mic-label">{!inVoice ? "Join voice" : isMuted ? "Muted" : "Microphone on"}</strong>
            <span id="voice-status">
              {!inVoice ? "Click to join" : isSpeaking ? "Speaking" : "Active"}
            </span>
          </div>
          {inVoice && (
            <button
              id="leave-voice-button"
              className="icon-button"
              title="Leave voice chat"
              onClick={onLeaveVoice}
            >
              <FiPhoneOff />
            </button>
          )}
        </div>

        {movieControls}
      </section>

      {/* Seat Hover Tooltip */}
      {seatTooltip && seatTooltip.visible && (
        <div
          id="seat-tooltip"
          className="seat-tooltip"
          style={{
            position: "fixed",
            left: `${seatTooltip.x + 12}px`,
            top: `${seatTooltip.y + 12}px`,
            display: "block",
            pointerEvents: "none",
            zIndex: 9999
          }}
        >
          {seatTooltip.text}
        </div>
      )}
    </>
  );
};
