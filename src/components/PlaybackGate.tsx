"use client";

import React from "react";

interface PlaybackGateProps {
  isOpen: boolean;
  onEnablePlayback: () => void;
}

export const PlaybackGate: React.FC<PlaybackGateProps> = ({ isOpen, onEnablePlayback }) => {
  if (!isOpen) return null;

  return (
    <div id="playback-gate" className="playback-gate">
      <div className="glass-panel playback-gate-card">
        <span className="gate-icon">▶</span>
        <h3>Ready for the movie?</h3>
        <p>Your browser needs a click to enable video and audio playback.</p>
        <button
          id="enable-playback-button"
          className="button button-primary"
          onClick={onEnablePlayback}
        >
          Enable movie playback
        </button>
      </div>
    </div>
  );
};

