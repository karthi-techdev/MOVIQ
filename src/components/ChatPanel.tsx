"use client";

import React, { useState, useRef, useEffect } from "react";
import { FiX, FiVolume2, FiMic, FiMicOff } from "react-icons/fi";
import { FaUser } from "react-icons/fa6";
import { ChatMessage, UserData } from "../types/cinema";
import { CHARACTER_PRESETS } from "../lib/constants";

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  users: UserData[];
  hostId: string;
  selfId: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  isOpen,
  onClose,
  messages,
  onSendMessage,
  users,
  hostId,
  selfId
}) => {
  const [activeTab, setActiveTab] = useState<"chat" | "people">("chat");
  const [text, setText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeTab]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSendMessage(text.trim());
    setText("");
  };

  return (
    <aside id="chat-panel" className="chat-panel glass-panel auto-ui">
      <div className="chat-header">
        <div className="tab-buttons">
          <button
            id="chat-tab-button"
            className={`tab-button ${activeTab === "chat" ? "active" : ""}`}
            onClick={() => setActiveTab("chat")}
          >
            Chat
          </button>
          <button
            id="people-tab-button"
            className={`tab-button ${activeTab === "people" ? "active" : ""}`}
            onClick={() => setActiveTab("people")}
          >
            Audience ({users.length})
          </button>
        </div>
        <button
          id="close-chat-button"
          className="icon-button"
          title="Close chat"
          aria-label="Close chat"
          onClick={onClose}
        >
          <FiX />
        </button>
      </div>

      {activeTab === "chat" ? (
        <div id="chat-pane" className="chat-pane">
          <div id="chat-messages" className="chat-messages" aria-live="polite">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`chat-bubble ${msg.system ? "system" : msg.userId === selfId ? "self" : ""}`}
              >
                {!msg.system && msg.username && (
                  <span className="chat-author">{msg.username}</span>
                )}
                <span className="chat-text">{msg.text}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <form className="chat-compose" onSubmit={handleSubmit}>
            <input
              id="chat-input"
              type="text"
              maxLength={300}
              placeholder="Message the theatre…"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              id="send-chat-button"
              type="submit"
              className="button button-primary button-small"
            >
              Send
            </button>
          </form>
        </div>
      ) : (
        <div id="people-pane" className="people-pane">
          <div id="people-list" className="people-list">
            {users.map((u) => {
              const preset = CHARACTER_PRESETS[u.characterType] || CHARACTER_PRESETS.character_406814;
              const isHost = u.id === hostId;
              const isSelf = u.id === selfId;

              return (
                <div key={u.id} className="people-item">
                  <span className="people-avatar">
                    <FaUser style={{ fontSize: "12px" }} />
                  </span>
                  <div className="people-info">
                    <span className="people-name">
                      {u.username} {isSelf && "(You)"}
                    </span>
                    <span className="people-role">
                      {isHost ? "Host" : u.seated ? `Seated (${u.seatIndex! + 1})` : "Standing"}
                    </span>
                  </div>
                  <div className="people-status-icons">
                    {u.speaking && (
                      <span className="mic-badge speaking" title="Speaking">
                        <FiVolume2 />
                      </span>
                    )}
                    {u.inVoice && !u.speaking && (
                      <span className="mic-badge" title={u.muted ? "Muted" : "Listening"}>
                        {u.muted ? <FiMicOff /> : <FiMic />}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};

