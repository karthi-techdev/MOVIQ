"use client";

import React, { useState } from "react";
import { RoomSummary } from "../types/cinema";
import { CHARACTER_PRESETS } from "../lib/constants";

interface LobbyProps {
  status: string;
  rooms: RoomSummary[];
  onRefreshRooms: () => void;
  onCreateRoom: (theatreName: string, username: string, charType: string, isPublic: boolean) => void;
  onJoinRoom: (roomId: string, username: string, charType: string) => void;
  defaultUsername?: string;
}

export const Lobby: React.FC<LobbyProps> = ({
  status,
  rooms,
  onRefreshRooms,
  onCreateRoom,
  onJoinRoom,
  defaultUsername = ""
}) => {
  const [username, setUsername] = useState(defaultUsername || `Guest${Math.floor(Math.random() * 9000 + 1000)}`);
  const [selectedChar, setSelectedChar] = useState("character_406814");
  const [theatreName, setTheatreName] = useState("Midnight Premiere");
  const [isPublic, setIsPublic] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError("Please choose a display name.");
      return;
    }
    setError("");
    onCreateRoom(theatreName.trim() || "Midnight Premiere", username.trim(), selectedChar, isPublic);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError("Please choose a display name.");
      return;
    }
    if (!joinCode.trim()) {
      setError("Please enter an 8-character room code.");
      return;
    }
    setError("");
    onJoinRoom(joinCode.trim().toUpperCase(), username.trim(), selectedChar);
  };

  const handleSelectRoom = (roomId: string) => {
    if (!username.trim()) {
      setError("Please choose a display name first.");
      return;
    }
    setError("");
    onJoinRoom(roomId, username.trim(), selectedChar);
  };

  return (
    <main id="lobby" className="lobby">
      <div className="lobby-ambient lobby-ambient-one"></div>
      <div className="lobby-ambient lobby-ambient-two"></div>

      <section className="lobby-hero">
        <div className="brand brand-large">
          <span className="brand-mark">VC</span>
          <span>VIRTUAL CINEMA</span>
        </div>

        <div className="hero-copy">
          <p className="eyebrow">YOUR SHARED BIG SCREEN</p>
          <h1>
            Better movies.<br />
            <span>Together.</span>
          </h1>
          <p className="hero-description">
            Enter a cinematic virtual auditorium, meet your audience,
            take your favorite seat, and watch together in real time.
          </p>
        </div>

        <div className="feature-row">
          <div className="feature">
            <span className="feature-dot"></span>
            Live multiplayer
          </div>
          <div className="feature">
            <span className="feature-dot"></span>
            Spatial-style presence
          </div>
          <div className="feature">
            <span className="feature-dot"></span>
            Voice &amp; chat
          </div>
        </div>
      </section>

      <section className="lobby-card glass-panel">
        <div className="lobby-card-header">
          <div>
            <p className="eyebrow">WELCOME</p>
            <h2>Enter the cinema</h2>
          </div>
          <span className={`status-pill ${status === "Connected" ? "connected" : ""}`}>
            {status}
          </span>
        </div>

        <label className="field-label" htmlFor="username-input">Display name</label>
        <input
          id="username-input"
          className="text-input"
          type="text"
          maxLength={18}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Your username"
        />

        <label className="field-label" style={{ marginTop: 14 }}>Choose 3D Character</label>
        <div id="character-picker" className="character-picker">
          {Object.entries(CHARACTER_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              className={`char-card ${selectedChar === key ? "active" : ""}`}
              onClick={() => setSelectedChar(key)}
            >
              <span className="char-icon">{preset.icon}</span>
              <span className="char-name">{preset.name}</span>
            </button>
          ))}
        </div>

        <div className="section-divider"></div>

        <label className="field-label" htmlFor="theatre-name-input">Create a theatre</label>
        <input
          id="theatre-name-input"
          className="text-input"
          type="text"
          maxLength={36}
          value={theatreName}
          onChange={(e) => setTheatreName(e.target.value)}
          placeholder="Theatre name"
        />

        <label className="checkbox-row">
          <input
            id="public-theatre-input"
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          <span>List as a public theatre</span>
        </label>

        <button
          id="create-button"
          className="button button-primary button-full"
          onClick={handleCreate}
        >
          Create theatre
        </button>

        <div className="or-divider"><span>OR JOIN WITH A CODE</span></div>

        <div className="join-row">
          <input
            id="room-id-input"
            className="text-input"
            type="text"
            maxLength={8}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ROOM ID"
          />
          <button
            id="join-button"
            className="button button-secondary"
            onClick={handleJoin}
          >
            Join
          </button>
        </div>

        {error && (
          <p id="lobby-error" className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="public-header">
          <div>
            <p className="eyebrow">NOW SHOWING</p>
            <h3>Public theatres</h3>
          </div>
          <button
            id="refresh-rooms-button"
            className="icon-button"
            title="Refresh public theatres"
            aria-label="Refresh public theatres"
            onClick={onRefreshRooms}
          >
            ↻
          </button>
        </div>

        <div id="public-room-list" className="public-room-list">
          {rooms.length === 0 ? (
            <div className="empty-state">No public theatres active. Create one above!</div>
          ) : (
            rooms.map((room) => (
              <div
                key={room.id}
                className="room-card"
                onClick={() => handleSelectRoom(room.id)}
              >
                <div className="room-card-info">
                  <div className="room-name">{room.name}</div>
                  <div className="room-meta">
                    <span>{room.movie?.title || "No movie loaded"}</span>
                    <span>•</span>
                    <span>{room.users} online</span>
                  </div>
                </div>
                <button className="button button-secondary button-small">
                  Join
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
};

