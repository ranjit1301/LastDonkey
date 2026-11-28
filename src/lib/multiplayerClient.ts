import type {
  ClientMessage,
  ClientRoomState,
  LeaveRoomReason,
  PublicRoomSummary,
  RoomNotification,
  RoomVisibility,
  ServerMessage,
} from '../server/roomTypes';
import { computeSessionFingerprint } from './multiTabSession';

const SESSION_STORAGE_KEY = 'last_donkey_online_session_v1';
const KEEPALIVE_INTERVAL_MS = 25_000;
const RECONNECT_BACKOFF_MS = [1200, 2000, 3200, 5000] as const;
const RECONNECT_FAILED_THRESHOLD = 3;

const NON_QUEUEABLE_IN_ROOM_ACTIONS: ReadonlySet<ClientMessage['type']> = new Set([
  'play_card',
  'add_bot',
  'remove_seat',
  'update_avatar',
  'start_game',
  'cancel_room',
  'regenerate_code',
  'revoke_invite',
  'update_turn_timer',
  'transfer_host_request',
  'transfer_host_respond',
  'rematch_request',
  'rematch_respond',
  'rematch_start',
  'voluntary_exit',
]);

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'superseded'
  | 'disconnected';

export interface ConnectionStatusInfo {
  status: ConnectionStatus;
  attempt: number;
  reason?: string;
}

export interface StoredOnlineSession {
  roomCode: string;
  sessionToken: string;
}

/**
 * Public-safe session metadata (never exposes the raw sessionToken).
 */
export interface StoredSessionMeta {
  roomCode: string;
  fingerprint: string;
}

export interface MultiplayerCallbacks {
  onRoomState: (room: ClientRoomState) => void;
  onNotification: (notification: RoomNotification) => void;
  onError: (message: string, code?: string) => void;
  onLeftRoom: (reason: LeaveRoomReason, message?: string) => void;
  onRoomClosed: (reason: string) => void;
  onSessionExpired: (reason: string) => void;
  onConnectionChange: (status: ConnectionStatus, info?: ConnectionStatusInfo) => void;
  onSessionEstablished?: (meta: StoredSessionMeta) => void;
  onSessionActiveElsewhere?: (info: { roomCode: string; message: string }) => void;
  onSessionSuperseded?: (info: { roomCode: string; message: string }) => void;
  onReconnected?: (roomCode: string) => void;
}

function readStoredSession(): StoredOnlineSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredOnlineSession>;
    if (
      typeof parsed.roomCode === 'string' &&
      parsed.roomCode.trim().length > 0 &&
      typeof parsed.sessionToken === 'string' &&
      parsed.sessionToken.trim().length > 0
    ) {
      return {
        roomCode: parsed.roomCode.trim().toUpperCase(),
        sessionToken: parsed.sessionToken.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredOnlineSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!session) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage failures in restricted browser environments
  }
}

export function getReconnectDelayMs(attempt: number): number {
  const idx = Math.max(0, Math.min(RECONNECT_BACKOFF_MS.length - 1, attempt - 1));
  return RECONNECT_BACKOFF_MS[idx];
}

function toFriendlySessionExpiredMessage(code: string | undefined, serverMessage: string): string {
  if (code === 'ROOM_NOT_FOUND') {
    return 'That room or match is no longer available.';
  }
  if (code === 'SESSION_INVALID') {
    return 'Your game session expired or is no longer valid.';
  }
  return serverMessage || 'Your game session is no longer available.';
}

/**
 * Real-time WebSocket client for authoritative Last Donkey multiplayer rooms.
 * Reconnect tokens are scoped strictly to the active browser tab via sessionStorage
 * (never localStorage, never exposed to other players or UI) and cleared cleanly on exit/close.
 */
export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private callbacks: MultiplayerCallbacks;
  private sessionToken: string | null = null;
  private roomCode: string | null = null;
  private manualClose = false;
  private superseded = false;
  private reconnectTimer: number | null = null;
  private keepaliveTimer: number | null = null;
  private pendingQueue: ClientMessage[] = [];
  private reconnectAttempt = 0;
  private rejectIfActiveOnNextReconnect = false;
  private awaitingReconnectConfirmation = false;
  private hasEverEstablishedRoom = false;

  constructor(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks;
  }

  private getWsUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  private emitConnection(status: ConnectionStatus, attempt = 0, reason?: string): void {
    this.callbacks.onConnectionChange(status, { status, attempt, reason });
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      window.clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startKeepalive(): void {
    this.clearKeepalive();
    this.keepaliveTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendImmediate({ type: 'ping' });
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private clearSessionState(): void {
    this.sessionToken = null;
    this.roomCode = null;
    this.pendingQueue = [];
    this.reconnectAttempt = 0;
    this.rejectIfActiveOnNextReconnect = false;
    this.awaitingReconnectConfirmation = false;
    this.hasEverEstablishedRoom = false;
    this.superseded = false;
    writeStoredSession(null);
  }

  public hasStoredSession(): boolean {
    return readStoredSession() !== null;
  }

  /**
   * Returns safe metadata (roomCode + non-reversible fingerprint) for the stored session,
   * never exposing the raw sessionToken.
   */
  public getStoredSessionMeta(): StoredSessionMeta | null {
    const stored = readStoredSession();
    if (!stored) return null;
    return {
      roomCode: stored.roomCode,
      fingerprint: computeSessionFingerprint(stored.sessionToken),
    };
  }

  public clearStoredSession(): void {
    this.clearSessionState();
  }

  /**
   * Clears ONLY this tab's local sessionStorage & client session references without
   * sending leave_room to the server (used when stepping aside for another active tab).
   */
  public clearStoredSessionLocally(): void {
    this.clearSessionState();
    this.closeSocketCleanly();
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Restores an active tab session from sessionStorage after a page refresh or explicit tab takeover.
   * When `rejectIfActive` is true, the server will refuse takeover if another tab currently holds
   * an open socket for this exact seat, emitting `onSessionActiveElsewhere` without disconnecting
   * the active tab.
   */
  public restoreSession(options: { rejectIfActive?: boolean } = {}): boolean {
    const stored = readStoredSession();
    if (!stored) return false;
    this.clearReconnectTimer();
    this.roomCode = stored.roomCode;
    this.sessionToken = stored.sessionToken;
    this.pendingQueue = [];
    this.superseded = false;
    this.reconnectAttempt = 1;
    this.rejectIfActiveOnNextReconnect = Boolean(options.rejectIfActive);
    this.awaitingReconnectConfirmation = true;
    this.emitConnection('reconnecting', 1, 'Restoring your seat...');
    this.connect();
    return true;
  }

  /**
   * Immediately retries reconnecting when in a reconnecting or failed state.
   */
  public retryReconnectNow(): void {
    if (!this.roomCode || !this.sessionToken) {
      const stored = readStoredSession();
      if (!stored) return;
      this.roomCode = stored.roomCode;
      this.sessionToken = stored.sessionToken;
    }
    this.clearReconnectTimer();
    this.superseded = false;
    this.manualClose = false;
    this.reconnectAttempt = Math.max(1, this.reconnectAttempt);
    this.awaitingReconnectConfirmation = true;
    this.emitConnection('reconnecting', this.reconnectAttempt, 'Retrying connection...');
    this.connect();
  }

  /**
   * Marks this client as paused/superseded by another tab (triggered via cross-tab coordination)
   * without sending leave_room or clearing sessionStorage.
   */
  public markSupersededByOtherTab(reason = 'This game session was opened in another tab.'): void {
    if (this.superseded) return;
    const roomCode = this.roomCode ?? readStoredSession()?.roomCode ?? '';
    this.superseded = true;
    this.pendingQueue = [];
    this.clearReconnectTimer();
    this.closeSocketInternal(false);
    this.emitConnection('superseded', 0, reason);
    this.callbacks.onSessionSuperseded?.({ roomCode, message: reason });
  }

  public connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.manualClose = false;
    this.superseded = false;

    if (!this.roomCode && !this.sessionToken) {
      this.emitConnection('connecting', 0, 'Connecting to game server...');
    }

    const ws = new WebSocket(this.getWsUrl());
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectAttempt = 0;
      this.emitConnection('connected', 0);
      this.startKeepalive();

      // If we already have an active room session, automatically re-sync with the server
      if (this.roomCode && this.sessionToken) {
        const rejectIfActive = this.rejectIfActiveOnNextReconnect;
        this.rejectIfActiveOnNextReconnect = false;
        this.sendImmediate({
          type: 'reconnect',
          roomCode: this.roomCode,
          sessionToken: this.sessionToken,
          ...(rejectIfActive ? { rejectIfActive: true } : {}),
        });
      }

      // Flush any queued messages (excluding stale in-room actions)
      while (this.pendingQueue.length > 0) {
        const msg = this.pendingQueue.shift()!;
        if (NON_QUEUEABLE_IN_ROOM_ACTIONS.has(msg.type)) continue;
        this.sendImmediate(msg);
      }
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'pong':
          break;
        case 'session_established':
          this.sessionToken = msg.sessionToken;
          this.roomCode = msg.roomCode;
          this.hasEverEstablishedRoom = true;
          this.awaitingReconnectConfirmation = false;
          writeStoredSession({ roomCode: msg.roomCode, sessionToken: msg.sessionToken });
          this.callbacks.onSessionEstablished?.({
            roomCode: msg.roomCode,
            fingerprint: computeSessionFingerprint(msg.sessionToken),
          });
          break;
        case 'room_state': {
          this.roomCode = msg.room.roomCode;
          if (this.sessionToken) {
            writeStoredSession({ roomCode: msg.room.roomCode, sessionToken: this.sessionToken });
          }
          const shouldConfirmReconnect = this.awaitingReconnectConfirmation;
          this.awaitingReconnectConfirmation = false;
          this.hasEverEstablishedRoom = true;
          this.callbacks.onRoomState(msg.room);
          if (shouldConfirmReconnect) {
            this.callbacks.onReconnected?.(msg.room.roomCode);
          }
          break;
        }
        case 'notification':
          this.callbacks.onNotification(msg.notification);
          break;
        case 'session_superseded': {
          this.superseded = true;
          this.pendingQueue = [];
          this.clearReconnectTimer();
          this.closeSocketInternal(false);
          this.emitConnection('superseded', 0, msg.message);
          this.callbacks.onSessionSuperseded?.({
            roomCode: msg.roomCode,
            message: msg.message,
          });
          break;
        }
        case 'left_room':
          this.clearSessionState();
          this.closeSocketCleanly();
          this.callbacks.onLeftRoom(msg.reason, msg.message);
          break;
        case 'error':
          if (msg.code === 'SESSION_ACTIVE_ELSEWHERE') {
            const activeCode = this.roomCode ?? readStoredSession()?.roomCode ?? '';
            this.awaitingReconnectConfirmation = false;
            this.closeSocketInternal(false);
            this.emitConnection('superseded', 0, msg.message);
            this.callbacks.onSessionActiveElsewhere?.({
              roomCode: activeCode,
              message: msg.message,
            });
            break;
          }
          if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'SESSION_INVALID') {
            const friendly = toFriendlySessionExpiredMessage(msg.code, msg.message);
            this.clearSessionState();
            this.closeSocketCleanly();
            this.callbacks.onSessionExpired(friendly);
            break;
          }
          this.callbacks.onError(msg.message, msg.code);
          break;
        case 'room_closed':
          this.clearSessionState();
          this.closeSocketCleanly();
          this.callbacks.onRoomClosed(msg.reason);
          break;
      }
    };

    ws.onclose = (event) => {
      if (this.ws === ws) {
        this.ws = null;
      }
      this.clearKeepalive();
      // Never retain queued in-room mutations across socket drops to prevent stale or duplicate actions
      this.pendingQueue = this.pendingQueue.filter(
        (m) => !NON_QUEUEABLE_IN_ROOM_ACTIONS.has(m.type)
      );

      if (this.superseded) {
        return;
      }

      // Code 4001 indicates this socket was intentionally superseded by a newer connection
      if (event.code === 4001) {
        const roomCode = this.roomCode ?? readStoredSession()?.roomCode ?? '';
        const reason = 'This game session was opened in another tab or window.';
        this.superseded = true;
        this.clearReconnectTimer();
        this.emitConnection('superseded', 0, reason);
        this.callbacks.onSessionSuperseded?.({ roomCode, message: reason });
        return;
      }

      if (this.manualClose) {
        this.emitConnection('disconnected', 0);
        return;
      }

      if (this.sessionToken && this.roomCode) {
        this.reconnectAttempt += 1;
        this.awaitingReconnectConfirmation = true;
        const delayMs = getReconnectDelayMs(this.reconnectAttempt);
        if (this.reconnectAttempt > RECONNECT_FAILED_THRESHOLD) {
          this.emitConnection(
            'failed',
            this.reconnectAttempt,
            'Could not reach the game server. Retrying automatically or tap Retry Now.'
          );
        } else {
          this.emitConnection(
            'reconnecting',
            this.reconnectAttempt,
            this.hasEverEstablishedRoom
              ? 'Connection lost — reconnecting to your table...'
              : 'Connecting to your saved seat...'
          );
        }
        this.clearReconnectTimer();
        this.reconnectTimer = window.setTimeout(() => this.connect(), delayMs);
      } else {
        this.emitConnection('disconnected', 0);
      }
    };

    ws.onerror = () => {
      // Handled gracefully by onclose auto-reconnect
    };
  }

  private closeSocketInternal(emitDisconnected: boolean): void {
    this.manualClose = true;
    this.clearKeepalive();
    this.clearReconnectTimer();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      try {
        socket.close();
      } catch {
        // ignore close errors
      }
    }
    if (emitDisconnected) {
      this.emitConnection('disconnected', 0);
    }
  }

  private closeSocketCleanly(): void {
    this.closeSocketInternal(true);
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
    if (this.superseded) {
      this.callbacks.onError('This session is active in another tab. Switch back to play here.');
      return;
    }
    // Never buffer in-room mutations across a disconnected socket so reconnect cannot duplicate or apply stale actions
    if (msg.type === 'play_card') {
      this.callbacks.onError('Reconnecting to server — please play your card once connected.');
      this.connect();
      return;
    }
    if (NON_QUEUEABLE_IN_ROOM_ACTIONS.has(msg.type)) {
      this.callbacks.onError('Reconnecting to server — please try again once connected.');
      this.connect();
      return;
    }
    // Deduplicate pending create_room / join_room actions so rapid taps never send duplicates
    if (msg.type === 'create_room' || msg.type === 'join_room') {
      this.pendingQueue = this.pendingQueue.filter(
        (m) => m.type !== 'create_room' && m.type !== 'join_room'
      );
    }
    this.pendingQueue.push(msg);
    this.connect();
  }

  public disconnect(options: { preserveStoredSession?: boolean } = {}): void {
    if (!options.preserveStoredSession) {
      this.clearSessionState();
    } else {
      this.pendingQueue = [];
    }
    this.closeSocketCleanly();
  }
}

export async function fetchPublicRoomsResult(
  signal?: AbortSignal
): Promise<{ ok: true; rooms: PublicRoomSummary[] } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/rooms/public', { cache: 'no-store', signal });
    if (!res.ok) {
      return { ok: false, error: 'Could not load public rooms from the server.' };
    }
    const data = (await res.json()) as { rooms?: PublicRoomSummary[] };
    return { ok: true, rooms: Array.isArray(data.rooms) ? data.rooms : [] };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: '' };
    }
    return { ok: false, error: 'Unable to reach game server right now.' };
  }
}

export async function fetchPublicRooms(): Promise<PublicRoomSummary[]> {
  const res = await fetchPublicRoomsResult();
  return res.ok ? res.rooms : [];
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
    const res = await fetch(`/api/rooms/validate?${params.toString()}`, { cache: 'no-store' });
    const data = (await res.json()) as
      | { ok: true; room: PublicRoomSummary; visibility: RoomVisibility }
      | { ok: false; error: string };
    return data;
  } catch {
    return { ok: false, error: 'Unable to reach game server right now.' };
  }
}
