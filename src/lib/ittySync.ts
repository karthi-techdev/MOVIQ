"use client";

import { connect, IttySocket } from "itty-sockets";
import { MovieState } from "../types/cinema";

export type IttyMovieHandler = (data: any) => void;

export class IttyVideoSyncManager {
  private socket: IttySocket | null = null;
  private currentRoomId: string | null = null;
  private isConnected: boolean = false;
  private handlers: Map<string, Set<IttyMovieHandler>> = new Map();

  constructor() {}

  public connectToRoom(roomId: string, alias: string = "Audience"): void {
    const cleanId = String(roomId || "").trim().toLowerCase();
    if (!cleanId) return;

    if (this.currentRoomId === cleanId && this.socket && this.isConnected) {
      return;
    }

    this.disconnect();
    this.currentRoomId = cleanId;

    try {
      const channel = `moviq-sync-${cleanId}`;
      const sock = connect(channel, { as: alias });

      sock.on("open", () => {
        this.isConnected = true;
      });

      sock.on("close", () => {
        this.isConnected = false;
      });

      sock.on("message", (event: any) => {
        const payload = event?.message || event;
        if (!payload || typeof payload !== "object") return;
        const msgType = payload.type;
        if (msgType && this.handlers.has(msgType)) {
          this.handlers.get(msgType)?.forEach((fn) => {
            try {
              fn(payload);
            } catch (err: any) {
              console.warn("[IttySync] Handler error:", err.message);
            }
          });
        }
      });

      this.socket = sock;
      this.isConnected = true;
    } catch (err: any) {
      console.warn("[IttySync] Connection error:", err.message);
    }
  }

  public on(type: string, handler: IttyMovieHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)?.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  public broadcastMovieLoaded(movie: MovieState): void {
    if (!this.socket) return;
    try {
      this.socket.send({
        type: "movie-loaded",
        movie,
        timestamp: Date.now()
      });
    } catch {}
  }

  public broadcastMovieState(state: MovieState, action: string, by: string): void {
    if (!this.socket) return;
    try {
      this.socket.send({
        type: "movie-state",
        state,
        action,
        by,
        timestamp: Date.now()
      });
    } catch {}
  }

  public broadcastMovieSync(time: number, playing: boolean): void {
    if (!this.socket) return;
    try {
      this.socket.send({
        type: "movie-sync",
        time,
        playing,
        serverTime: Date.now()
      });
    } catch {}
  }

  public disconnect(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this.currentRoomId = null;
    this.isConnected = false;
  }
}

export const ittySync = new IttyVideoSyncManager();

