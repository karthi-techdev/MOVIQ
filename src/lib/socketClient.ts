export type MessageHandler = (msg: any) => void;

export class SocketClient {
  private socket: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;

  constructor() {}

  public getSocketUrl(): string {
    if (typeof window !== "undefined") {
      if (process.env.NEXT_PUBLIC_WS_URL) {
        return process.env.NEXT_PUBLIC_WS_URL;
      }
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${window.location.host}/ws`;
    }
    return "";
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined") {
        return resolve();
      }

      if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
        return resolve();
      }

      const url = this.getSocketUrl();
      if (!url) {
        return reject(new Error("No WebSocket URL available."));
      }

      this.isConnecting = true;
      try {
        this.socket = new WebSocket(url);
      } catch (err) {
        this.isConnecting = false;
        this.scheduleReconnect();
        return reject(err);
      }

      this.socket.onopen = () => {
        this.isConnecting = false;
        this.emit("open", {});
        resolve();
      };

      this.socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.emit(msg.type, msg);
          this.emit("*", msg);
        } catch (e) {
          console.error("Invalid WS message:", e);
        }
      };

      this.socket.onclose = () => {
        this.isConnecting = false;
        this.emit("close", {});
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = (err) => {
        this.emit("error", err);
      };
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this.connect().catch(() => {});
      }
    }, 2500);
  }

  public on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  public off(type: string, handler: MessageHandler) {
    if (this.handlers.has(type)) {
      this.handlers.get(type)!.delete(handler);
    }
  }

  private emit(type: string, data: any) {
    const list = this.handlers.get(type);
    if (list) {
      list.forEach((cb) => {
        try {
          cb(data);
        } catch (e) {
          console.error("Handler error:", e);
        }
      });
    }
  }

  public send(msg: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  public disconnect() {
    this.shouldReconnect = false;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const socketClient = new SocketClient();
