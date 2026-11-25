import type {
  ClientMessage,
  ClientRoomState,
  PublicRoomSummary,
  RoomNotification,
  RoomVisibility,
  ServerMessage,
} from '../server/roomTypes';

export interface MultiplayerCallbacks {
  onRoomState: (room: ClientRoomState) => void;
  onNotification: (notification: RoomNotification) => void;
  onError: (message: string) => void;
  onRoomClosed: (reason: string) => void;
  onConnectionChange: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
}

/**
 * Real-time WebSocket client for authoritative Last Donkey multiplayer rooms.
 * Session credentials are held strictly in memory (never written to localStorage).
 */
export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private callbacks: MultiplayerCallbacks;
  private sessionToken: string | null = null;
  private roomCode: string | null = null;
  private manualClose = false;
  private reconnectTimer: number | null = null;
  private pendingQueue: ClientMessage[] = [];

  constructor(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks;
  }

  private getWsUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.manualClose = false;

    const ws = new WebSocket(this.getWsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.callbacks.onConnectionChange('connected');
      // If we already have an active room session, automatically re-sync with the server!
      if (this.roomCode && this.sessionToken) {
        this.sendImmediate({
          type: 'reconnect',
          roomCode: this.roomCode,
          sessionToken: this.sessionToken,
        });
      }
      // Flush any queued messages (e.g., initial create_room or join_room)
      while (this.pendingQueue.length > 0) {
        const msg = this.pendingQueue.shift()!;
        this.sendImmediate(msg);
      }
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'session_established':
          this.sessionToken = msg.sessionToken;
          this.roomCode = msg.roomCode;
          break;
        case 'room_state':
          this.roomCode = msg.room.roomCode;
          this.callbacks.onRoomState(msg.room);
          break;
        case 'notification':
          this.callbacks.onNotification(msg.notification);
          break;
        case 'error':
          this.callbacks.onError(msg.message);
          break;
        case 'room_closed':
          this.sessionToken = null;
          this.roomCode = null;
          this.callbacks.onRoomClosed(msg.reason);
          break;
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.manualClose) {
        this.callbacks.onConnectionChange('disconnected');
        return;
      }
      if (this.sessionToken && this.roomCode) {
        this.callbacks.onConnectionChange('reconnecting');
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => this.connect(), 1400);
      } else {
        this.callbacks.onConnectionChange('disconnected');
      }
    };

    ws.onerror = () => {
      // Handled gracefully by onclose auto-reconnect
    };
  }

  private sendImmediate(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    this.pendingQueue.push(msg);
    this.connect();
  }

  public disconnect(): void {
    this.manualClose = true;
    this.sessionToken = null;
    this.roomCode = null;
    this.pendingQueue = [];
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export async function fetchPublicRooms(): Promise<PublicRoomSummary[]> {
  try {
    const res = await fetch('/api/rooms/public');
    if (!res.ok) return [];
    const data = (await res.json()) as { rooms?: PublicRoomSummary[] };
    return data.rooms ?? [];
  } catch {
    return [];
  }
}

export async function validateRoomInvite(
  code: string,
  invite?: string
): Promise<
  | { ok: true; room: PublicRoomSummary; visibility: RoomVisibility }
  | { ok: false; error: string }
> {
  try {
    const params = new URLSearchParams({ code: code.trim().toUpperCase() });
    if (invite) params.set('invite', invite);
    const res = await fetch(`/api/rooms/validate?${params.toString()}`);
    const data = (await res.json()) as
      | { ok: true; room: PublicRoomSummary; visibility: RoomVisibility }
      | { ok: false; error: string };
    return data;
  } catch {
    return { ok: false, error: 'Unable to reach game server right now.' };
  }
}
