import crypto from 'node:crypto';
import {
  canVoluntarilyExit,
  chooseBotCard,
  continueAfterTrick,
  createInitialGameState,
  formatCard,
  handleMissedTurn,
  isDifficultyMode,
  markPlayerConnection,
  playCard,
  removePlayerAndRedistribute,
  type DifficultyMode,
  type GameState,
  type PlayerConfig,
} from '../engine/index.ts';
import type { TurnTimerSeconds } from '../lib/settings.ts';
import type {
  ClientGameStateView,
  ClientRoomState,
  PendingHostTransfer,
  PublicRoomSummary,
  RematchState,
  RoomNotification,
  RoomSeat,
  RoomStatus,
  RoomVisibility,
} from './roomTypes.ts';

const BOT_NAMES = ['Bot Raju', 'Bot Pinky', 'Bot Golu', 'Bot Meera', 'Bot Kabir', 'Bot Priya'];
const AVATAR_COLORS = ['#E59A00', '#2E6340', '#D95732', '#3A6B8A', '#8B5E83', '#B57435'];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const ALLOWED_TURN_TIMER_SECONDS = [0, 10, 15, 20, 30] as const;
const MAX_EXPIRED_CODES = 1000;

export function isValidTurnTimerSeconds(value: unknown): value is TurnTimerSeconds {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (ALLOWED_TURN_TIMER_SECONDS as readonly number[]).includes(value)
  );
}

function sanitizeDisplayText(raw: string, maxLen: number): string {
  // Strip control characters and collapse repeated whitespace
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export interface InternalRoom {
  roomCode: string;
  tableName: string;
  visibility: RoomVisibility;
  capacity: number;
  status: RoomStatus;
  difficulty: DifficultyMode;
  inviteToken: string;
  revokedTokens: Set<string>;
  hostPlayerId: string | null;
  aiHostActive: boolean;
  suspendedHostId: string | null;
  pendingHostTransfer: PendingHostTransfer | null;
  turnTimerSeconds: TurnTimerSeconds;
  turnDeadlineAt: number | null;
  vacancyExpiresAt: number | null;
  seats: RoomSeat[];
  sessionTokens: Map<string, string>; // sessionToken -> playerId
  removedPlayerIds: Set<string>;
  gameState: GameState | null;
  rematch: RematchState | null;
  closeReason: string | null;
  createdAt: number;
  lastActivityAt: number;
  finishedAt: number | null;
  // Server timers
  turnTimer?: ReturnType<typeof setTimeout>;
  botTimer?: ReturnType<typeof setTimeout>;
  trickTimer?: ReturnType<typeof setTimeout>;
  vacancyTimer?: ReturnType<typeof setTimeout>;
  rematchTimer?: ReturnType<typeof setTimeout>;
  aiStartTimer?: ReturnType<typeof setTimeout>;
}

export interface RoomEventSink {
  onRoomUpdated: (room: InternalRoom) => void;
  onNotification: (room: InternalRoom, notification: RoomNotification) => void;
  onRoomClosed: (roomCode: string, reason: string, memberPlayerIds: string[]) => void;
  onPlayerKicked?: (roomCode: string, playerId: string, reason: string) => void;
  onRoomCodeChanged?: (oldCode: string, newCode: string, room: InternalRoom) => void;
  onPlayerDetached?: (roomCode: string, playerId: string, reason: string) => void;
}

export interface RoomManagerOptions {
  publicVacancyTimeoutMs?: number; // Default: 120_000 (2 minutes per Section 18)
  rematchTimeoutMs?: number; // Default: 30_000 (30 seconds per Section 20)
  botDelayMs?: number; // Default: 750ms
  trickSuccessDelayMs?: number; // Default: 1500ms
  trickFailDelayMs?: number; // Default: 2100ms
  aiAutoStartDelayMs?: number; // Default: 1200ms
  disconnectedFallbackTimerSeconds?: number; // Default: 15s fallback when turnTimerSeconds === 0
  maxActiveRooms?: number; // Default: 200
  idleWaitingTimeoutMs?: number; // Default: 30 minutes
  abandonedWaitingTimeoutMs?: number; // Default: 5 minutes (0 connected humans in waiting room)
  finishedRoomTimeoutMs?: number; // Default: 15 minutes
  cleanupIntervalMs?: number; // Default: 60s (0 disables background sweeper)
  rng?: () => number;
}

export class RoomManager {
  private rooms = new Map<string, InternalRoom>();
  private expiredRoomCodes = new Set<string>();
  private sink: RoomEventSink;
  private opts: Required<RoomManagerOptions>;
  private readonly hasCustomRng: boolean;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(sink: RoomEventSink, options: RoomManagerOptions = {}) {
    this.sink = sink;
    this.hasCustomRng = typeof options.rng === 'function';
    this.opts = {
      publicVacancyTimeoutMs: options.publicVacancyTimeoutMs ?? 120_000,
      rematchTimeoutMs: options.rematchTimeoutMs ?? 30_000,
      botDelayMs: options.botDelayMs ?? 750,
      trickSuccessDelayMs: options.trickSuccessDelayMs ?? 1500,
      trickFailDelayMs: options.trickFailDelayMs ?? 2100,
      aiAutoStartDelayMs: options.aiAutoStartDelayMs ?? 1200,
      disconnectedFallbackTimerSeconds: options.disconnectedFallbackTimerSeconds ?? 15,
      maxActiveRooms: options.maxActiveRooms ?? 200,
      idleWaitingTimeoutMs: options.idleWaitingTimeoutMs ?? 30 * 60 * 1000,
      abandonedWaitingTimeoutMs: options.abandonedWaitingTimeoutMs ?? 5 * 60 * 1000,
      finishedRoomTimeoutMs: options.finishedRoomTimeoutMs ?? 15 * 60 * 1000,
      cleanupIntervalMs: options.cleanupIntervalMs ?? 60_000,
      rng: options.rng ?? Math.random,
    };

    if (this.opts.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupStaleRooms();
      }, this.opts.cleanupIntervalMs);
      if (typeof this.cleanupTimer.unref === 'function') {
        this.cleanupTimer.unref();
      }
    }
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        const idx = this.hasCustomRng
          ? Math.floor(this.opts.rng() * CODE_CHARS.length)
          : crypto.randomInt(CODE_CHARS.length);
        code += CODE_CHARS[idx];
      }
      if (!this.rooms.has(code) && !this.expiredRoomCodes.has(code)) return code;
    }
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  private generateToken(): string {
    return crypto.randomBytes(18).toString('hex');
  }

  private emitNote(
    room: InternalRoom,
    kind: RoomNotification['kind'],
    message: string,
    targetPlayerId?: string
  ): void {
    this.sink.onNotification(room, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      message,
      timestamp: Date.now(),
      targetPlayerId,
    });
  }

  private clearAllTimers(room: InternalRoom): void {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.botTimer) clearTimeout(room.botTimer);
    if (room.trickTimer) clearTimeout(room.trickTimer);
    if (room.vacancyTimer) clearTimeout(room.vacancyTimer);
    if (room.rematchTimer) clearTimeout(room.rematchTimer);
    if (room.aiStartTimer) clearTimeout(room.aiStartTimer);
    room.turnTimer = undefined;
    room.botTimer = undefined;
    room.trickTimer = undefined;
    room.vacancyTimer = undefined;
    room.rematchTimer = undefined;
    room.aiStartTimer = undefined;
  }

  private recordExpiredCode(code: string): void {
    this.expiredRoomCodes.add(code);
    if (this.expiredRoomCodes.size > MAX_EXPIRED_CODES) {
      const oldest = this.expiredRoomCodes.values().next().value;
      if (oldest) this.expiredRoomCodes.delete(oldest);
    }
  }

  private touchRoom(room: InternalRoom): void {
    room.lastActivityAt = Date.now();
  }

  private revokePlayerTokens(room: InternalRoom, playerId: string): void {
    for (const [tok, pid] of room.sessionTokens.entries()) {
      if (pid === playerId) room.sessionTokens.delete(tok);
    }
  }

  private cancelAiStartTimer(room: InternalRoom): void {
    if (room.aiStartTimer) {
      clearTimeout(room.aiStartTimer);
      room.aiStartTimer = undefined;
    }
  }

  private isConnectedHost(room: InternalRoom, playerId: string): boolean {
    if (room.hostPlayerId !== playerId) return false;
    return room.seats.some((s) => s.playerId === playerId && s.type === 'human' && s.connected);
  }

  private buildPublicRoomSummary(room: InternalRoom): PublicRoomSummary {
    const hostSeat = room.hostPlayerId
      ? room.seats.find((s) => s.playerId === room.hostPlayerId)
      : null;
    const hostName = hostSeat
      ? hostSeat.name
      : room.aiHostActive
        ? 'AI Room Host'
        : room.seats.find((s) => s.type === 'human')?.name ?? 'Host';
    const availableSeats = Math.max(0, room.capacity - room.seats.length);
    const isFull = room.seats.length >= room.capacity;
    const joinable = room.status === 'waiting' && !isFull;

    return {
      roomCode: room.roomCode,
      tableName: room.tableName,
      hostName,
      capacity: room.capacity,
      playerCount: room.seats.length,
      availableSeats,
      isFull,
      joinable,
      status: room.status,
      difficulty: room.difficulty,
      turnTimerSeconds: room.turnTimerSeconds,
      aiHostActive: room.aiHostActive,
      vacancyExpiresAt: room.vacancyExpiresAt,
    };
  }

  public getRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * Cleans up abandoned waiting rooms, idle waiting rooms, and completed finished rooms.
   * NEVER removes an active game in 'playing' status.
   */
  public cleanupStaleRooms(now = Date.now()): number {
    const toClose: Array<{ room: InternalRoom; reason: string }> = [];

    for (const room of this.rooms.values()) {
      // Safety invariant: NEVER clean up active games while playing!
      if (room.status === 'playing') continue;

      if (room.status === 'waiting') {
        const connectedHumans = room.seats.filter((s) => s.type === 'human' && s.connected).length;
        const idleMs = now - room.lastActivityAt;
        if (connectedHumans === 0 && idleMs >= this.opts.abandonedWaitingTimeoutMs) {
          toClose.push({
            room,
            reason: 'Room closed automatically because all players disconnected.',
          });
        } else if (idleMs >= this.opts.idleWaitingTimeoutMs) {
          toClose.push({
            room,
            reason: 'Room closed automatically due to inactivity.',
          });
        }
      } else if (room.status === 'finished') {
        const refTime = Math.max(room.lastActivityAt, room.finishedAt ?? room.lastActivityAt);
        const elapsedMs = now - refTime;
        const hasActiveRematch = room.rematch !== null && room.rematch.expiresAt > now;
        if (!hasActiveRematch && elapsedMs >= this.opts.finishedRoomTimeoutMs) {
          toClose.push({
            room,
            reason: 'Completed room expired after inactivity.',
          });
        }
      }
    }

    for (const entry of toClose) {
      this.closeRoom(entry.room, entry.reason);
    }
    return toClose.length;
  }

  public disposeAll(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    for (const room of this.rooms.values()) {
      this.clearAllTimers(room);
    }
    this.rooms.clear();
  }

  public getRoom(roomCode: string): InternalRoom | undefined {
    return this.rooms.get(roomCode.trim().toUpperCase());
  }

  public getPublicRooms(): PublicRoomSummary[] {
    // Reclaim any expired waiting/finished rooms so stale rooms never appear in discovery
    this.cleanupStaleRooms();

    const list: Array<{ summary: PublicRoomSummary; createdAt: number }> = [];
    for (const room of this.rooms.values()) {
      if (room.visibility !== 'public') continue;
      if (room.status !== 'waiting' && room.status !== 'playing') continue;
      list.push({
        summary: this.buildPublicRoomSummary(room),
        createdAt: room.createdAt,
      });
    }

    const rank = (s: PublicRoomSummary): number => {
      if (s.joinable) return 0; // Open waiting rooms first
      if (s.status === 'waiting') return 1; // Full waiting rooms next
      return 2; // In-progress public rooms last
    };

    return list
      .sort((a, b) => {
        const diff = rank(a.summary) - rank(b.summary);
        if (diff !== 0) return diff;
        return b.createdAt - a.createdAt;
      })
      .map((entry) => entry.summary);
  }

  public validateRoomAccess(
    roomCode: string,
    inviteToken?: string
  ): { ok: true; room: PublicRoomSummary; visibility: RoomVisibility } | { ok: false; error: string } {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      if (this.expiredRoomCodes.has(code)) {
        return { ok: false, error: 'This room code has expired or been replaced.' };
      }
      return { ok: false, error: 'Room not found. Double-check the 6-character code.' };
    }
    if (room.status === 'closed') {
      return { ok: false, error: room.closeReason ?? 'This room has been closed.' };
    }
    if (room.status !== 'waiting') {
      return { ok: false, error: 'This game has already started.' };
    }
    if (inviteToken) {
      if (room.revokedTokens.has(inviteToken)) {
        return { ok: false, error: 'This invitation link has been revoked by the host.' };
      }
      if (inviteToken !== room.inviteToken) {
        return { ok: false, error: 'This invitation link is invalid or expired.' };
      }
    }
    if (room.seats.length >= room.capacity) {
      return { ok: false, error: 'Room Full — all seats are taken.' };
    }
    return {
      ok: true,
      visibility: room.visibility,
      room: this.buildPublicRoomSummary(room),
    };
  }

  /**
   * Builds a strictly sanitized ClientRoomState for a specific viewer so opponent hands are NEVER leaked.
   */
  public buildClientView(room: InternalRoom, viewerPlayerId: string): ClientRoomState {
    let sanitizedGame: ClientGameStateView | null = null;

    if (room.gameState) {
      const isFinished = room.gameState.phase === 'finished';
      sanitizedGame = {
        ...room.gameState,
        players: room.gameState.players.map((p) => {
          const revealHand =
            p.id === viewerPlayerId ||
            (isFinished && p.id === room.gameState?.donkeyPlayerId);
          return {
            id: p.id,
            name: p.name,
            type: p.type,
            seatIndex: p.seatIndex,
            cardCount: p.hand.length,
            hand: revealHand ? [...p.hand] : [],
            finished: p.finished,
            finishOrder: p.finishOrder,
            removed: p.removed,
            connected: p.connected,
            consecutiveMissedTurns: p.consecutiveMissedTurns,
            avatarColor: p.avatarColor,
          };
        }),
      };
    }

    return {
      roomCode: room.roomCode,
      tableName: room.tableName,
      visibility: room.visibility,
      capacity: room.capacity,
      status: room.status,
      difficulty: room.difficulty,
      inviteToken: room.inviteToken,
      hostPlayerId: room.hostPlayerId,
      aiHostActive: room.aiHostActive,
      suspendedHostId: room.suspendedHostId,
      pendingHostTransfer: room.pendingHostTransfer,
      turnTimerSeconds: room.turnTimerSeconds,
      turnDeadlineAt: room.turnDeadlineAt,
      vacancyExpiresAt: room.vacancyExpiresAt,
      seats: room.seats.map((s) => ({ ...s })),
      gameState: sanitizedGame,
      rematch: room.rematch ? { ...room.rematch, votes: { ...room.rematch.votes } } : null,
      yourPlayerId: viewerPlayerId,
      removedFromOngoingGame: room.removedPlayerIds.has(viewerPlayerId),
      closeReason: room.closeReason,
    };
  }

  public createRoom(params: {
    playerName: string;
    tableName?: string;
    capacity: number;
    visibility: RoomVisibility;
    turnTimerSeconds?: unknown;
    difficulty?: DifficultyMode;
  }):
    | { ok: true; room: InternalRoom; playerId: string; sessionToken: string }
    | { ok: false; error: string } {
    if (!Number.isInteger(params.capacity) || params.capacity < 2 || params.capacity > 6) {
      return { ok: false, error: 'Room capacity must be between 2 and 6 players.' };
    }

    // Validate turnTimerSeconds authoritatively on room creation
    let turnTimerSeconds: TurnTimerSeconds = 15;
    if (params.turnTimerSeconds !== undefined) {
      if (!isValidTurnTimerSeconds(params.turnTimerSeconds)) {
        return {
          ok: false,
          error: 'Invalid turn timer option. Allowed values: Off (0s), 10s, 15s, 20s, or 30s.',
        };
      }
      turnTimerSeconds = params.turnTimerSeconds;
    }

    // Reclaim stale waiting/completed rooms before checking capacity limit
    if (this.rooms.size >= this.opts.maxActiveRooms) {
      this.cleanupStaleRooms();
      if (this.rooms.size >= this.opts.maxActiveRooms) {
        return {
          ok: false,
          error: 'Server is currently at room capacity. Please try again in a moment.',
        };
      }
    }

    const cleanName = sanitizeDisplayText(params.playerName, 20) || 'Player 1';
    const cleanTable =
      sanitizeDisplayText(params.tableName ?? '', 28) || `${cleanName}’s Room`;
    const difficulty: DifficultyMode = isDifficultyMode(params.difficulty)
      ? params.difficulty
      : 'easy';

    const roomCode = this.generateCode();
    const playerId = `u_${crypto.randomBytes(6).toString('hex')}`;
    const sessionToken = this.generateToken();
    const now = Date.now();

    const seat: RoomSeat = {
      playerId,
      name: cleanName,
      type: 'human',
      connected: true,
      avatarColor: AVATAR_COLORS[0],
      joinedAt: now,
    };

    const room: InternalRoom = {
      roomCode,
      tableName: cleanTable,
      visibility: params.visibility,
      capacity: params.capacity,
      status: 'waiting',
      difficulty,
      inviteToken: this.generateToken(),
      revokedTokens: new Set(),
      hostPlayerId: playerId,
      aiHostActive: false,
      suspendedHostId: null,
      pendingHostTransfer: null,
      turnTimerSeconds,
      turnDeadlineAt: null,
      vacancyExpiresAt: null,
      seats: [seat],
      sessionTokens: new Map([[sessionToken, playerId]]),
      removedPlayerIds: new Set(),
      gameState: null,
      rematch: null,
      closeReason: null,
      createdAt: now,
      lastActivityAt: now,
      finishedAt: null,
    };

    this.rooms.set(roomCode, room);
    this.emitNote(
      room,
      'success',
      `Room ${roomCode} created (${params.capacity}-player ${params.visibility} room).`
    );
    this.sink.onRoomUpdated(room);

    return { ok: true, room, playerId, sessionToken };
  }

  public joinRoom(params: {
    roomCode: string;
    playerName: string;
    inviteToken?: string;
  }):
    | { ok: true; room: InternalRoom; playerId: string; sessionToken: string }
    | { ok: false; error: string } {
    const check = this.validateRoomAccess(params.roomCode, params.inviteToken);
    if (!check.ok) return check;

    const room = this.rooms.get(params.roomCode.trim().toUpperCase())!;
    const existingNamesLower = new Set(room.seats.map((s) => s.name.trim().toLowerCase()));
    const requestedName = sanitizeDisplayText(params.playerName, 20);

    let cleanName: string;
    if (requestedName) {
      if (existingNamesLower.has(requestedName.toLowerCase())) {
        return {
          ok: false,
          error: 'That player name is already taken in this room. Please choose a different name.',
        };
      }
      cleanName = requestedName;
    } else {
      let num = room.seats.length + 1;
      while (existingNamesLower.has(`player ${num}`)) {
        num += 1;
      }
      cleanName = `Player ${num}`;
    }

    const playerId = `u_${crypto.randomBytes(6).toString('hex')}`;
    const sessionToken = this.generateToken();

    const seat: RoomSeat = {
      playerId,
      name: cleanName,
      type: 'human',
      connected: true,
      avatarColor: AVATAR_COLORS[room.seats.length % AVATAR_COLORS.length],
      joinedAt: Date.now(),
    };

    room.seats.push(seat);
    room.sessionTokens.set(sessionToken, playerId);
    this.touchRoom(room);

    // Clear public vacancy timeout if a replacement joined!
    if (room.vacancyTimer) {
      clearTimeout(room.vacancyTimer);
      room.vacancyTimer = undefined;
      room.vacancyExpiresAt = null;
    }

    this.emitNote(room, 'info', `${cleanName} joined the room (${room.seats.length}/${room.capacity}).`);
    this.sink.onRoomUpdated(room);

    // If AI Room Host manages this room and capacity is now met, AI Room Host starts the game!
    this.maybeTriggerAiHostAutoStart(room);

    return { ok: true, room, playerId, sessionToken };
  }

  /**
   * Read-only session token check used before accepting a reconnect (e.g., to reject duplicate
   * active-tab reconnect attempts without mutating room state or emitting notifications).
   */
  public validateSessionToken(
    roomCode: string,
    sessionToken: string
  ):
    | { ok: true; roomCode: string; playerId: string }
    | { ok: false; error: string; code: 'ROOM_NOT_FOUND' | 'SESSION_INVALID' } {
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    if (!room || room.status === 'closed') {
      return { ok: false, error: 'Room no longer exists.', code: 'ROOM_NOT_FOUND' };
    }
    const playerId = room.sessionTokens.get(sessionToken);
    if (!playerId || !room.seats.some((s) => s.playerId === playerId)) {
      return { ok: false, error: 'Session is invalid or expired.', code: 'SESSION_INVALID' };
    }
    return { ok: true, roomCode: room.roomCode, playerId };
  }

  public reconnectPlayer(
    roomCode: string,
    sessionToken: string
  ):
    | { ok: true; room: InternalRoom; playerId: string; removedFromOngoingGame: boolean }
    | { ok: false; error: string; code: 'ROOM_NOT_FOUND' | 'SESSION_INVALID' } {
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    if (!room || room.status === 'closed') {
      return { ok: false, error: 'Room no longer exists.', code: 'ROOM_NOT_FOUND' };
    }

    const playerId = room.sessionTokens.get(sessionToken);
    if (!playerId) {
      return { ok: false, error: 'Session is invalid or expired.', code: 'SESSION_INVALID' };
    }

    const seat = room.seats.find((s) => s.playerId === playerId);
    if (!seat) {
      return { ok: false, error: 'Session is invalid or expired.', code: 'SESSION_INVALID' };
    }

    this.touchRoom(room);

    // Section 13: If player was removed after 3 missed turns, they cannot rejoin the ongoing game,
    // but we STILL restore seat.connected = true so they receive state updates and are eligible for rematch!
    if (room.removedPlayerIds.has(playerId) && room.status === 'playing') {
      seat.connected = true;
      this.sink.onRoomUpdated(room);
      return { ok: true, room, playerId, removedFromOngoingGame: true };
    }

    seat.connected = true;

    if (room.gameState) {
      room.gameState = markPlayerConnection(room.gameState, playerId, true);
    }

    // AUD-002: If a Timer-Off room scheduled the 15s disconnected fallback for this player's turn,
    // cancel it cleanly upon reconnection so Timer-Off behavior is restored without a surprise timeout.
    if (
      room.status === 'playing' &&
      room.gameState?.phase === 'playing' &&
      room.gameState.currentTurnPlayerId === playerId &&
      room.turnTimerSeconds === 0 &&
      room.turnTimer
    ) {
      clearTimeout(room.turnTimer);
      room.turnTimer = undefined;
      room.turnDeadlineAt = null;
    }

    // Section 19: If original host reconnects before removal, restore host ownership!
    if (room.suspendedHostId === playerId && room.aiHostActive) {
      room.hostPlayerId = playerId;
      room.suspendedHostId = null;
      room.aiHostActive = false;
      this.cancelAiStartTimer(room);
      this.emitNote(
        room,
        'success',
        "You're back! Host ownership has been restored to you.",
        playerId
      );
      this.emitNote(
        room,
        'info',
        `${seat.name} reconnected and resumed host ownership.`
      );
    } else {
      this.emitNote(room, 'info', `${seat.name} reconnected.`);
    }

    // AUD-005: If reconnecting during an unexpired rematch window where they were marked declined
    // due to disconnect, restore them to pending so they can respond before the window expires.
    if (room.status === 'finished' && room.rematch && Date.now() <= room.rematch.expiresAt) {
      if (
        !(playerId in room.rematch.votes) ||
        room.rematch.votes[playerId] === 'declined'
      ) {
        room.rematch.votes[playerId] = 'pending';
      }
      this.syncRematchVotesWithSeats(room);
    }

    this.sink.onRoomUpdated(room);

    // AUD-012: If a guest reconnects to an already-full waiting room managed by AI Room Host
    // (e.g. after all humans had briefly disconnected), resume AI Room Host auto-start cleanly.
    if (room.status === 'waiting' && room.aiHostActive && room.seats.length === room.capacity) {
      this.maybeTriggerAiHostAutoStart(room);
    }

    return { ok: true, room, playerId, removedFromOngoingGame: false };
  }

  /**
   * Handles an unexpected socket drop (Section 13 & Section 19).
   * Never pauses the game!
   */
  public handleDisconnect(roomCode: string, playerId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.status === 'closed') return;

    const seat = room.seats.find((s) => s.playerId === playerId);
    if (!seat || !seat.connected) return;

    seat.connected = false;
    this.touchRoom(room);

    // If player was already removed from ongoing game and was only spectating/waiting for rematch
    if (room.removedPlayerIds.has(playerId) && room.status === 'playing') {
      this.sink.onRoomUpdated(room);
      return;
    }

    if (room.gameState) {
      room.gameState = markPlayerConnection(room.gameState, playerId, false);
    }

    // Cancel pending host transfer involving disconnected player
    if (
      room.pendingHostTransfer &&
      (room.pendingHostTransfer.fromPlayerId === playerId ||
        room.pendingHostTransfer.toPlayerId === playerId)
    ) {
      room.pendingHostTransfer = null;
    }

    // Section 19: Unexpected host disconnection -> AI Room Host temporarily takes over
    if (room.hostPlayerId === playerId) {
      room.suspendedHostId = playerId;
      room.hostPlayerId = null;
      room.aiHostActive = true;
      this.emitNote(
        room,
        'warning',
        `Host ${seat.name} disconnected. AI Room Host has temporarily taken over room management.`
      );
    } else if (room.status === 'waiting') {
      this.emitNote(room, 'warning', `${seat.name} disconnected from the lobby.`);
    } else if (room.status === 'playing') {
      this.emitNote(room, 'warning', `${seat.name} disconnected. Game continues without pausing.`);
    } else {
      this.emitNote(room, 'warning', `${seat.name} disconnected.`);
    }

    // AUD-012: If zero connected humans remain in a waiting room, cancel any pending AI auto-start immediately
    if (
      room.status === 'waiting' &&
      !room.seats.some((s) => s.type === 'human' && s.connected)
    ) {
      this.cancelAiStartTimer(room);
    }

    // AUD-005: Recalculate rematch eligibility when any player (including host) disconnects during rematch
    if (room.status === 'finished' && room.rematch) {
      this.syncRematchVotesWithSeats(room);
      if (room.aiHostActive && !this.hasPendingRematchVotes(room)) {
        this.finalizeRematchWindow(room);
        return;
      }
      if (Date.now() > room.rematch.expiresAt && !room.rematch.readyToStart) {
        room.rematch = null;
      }
    }

    this.sink.onRoomUpdated(room);

    // AUD-002: In Timer-Off rooms, schedule the 15s disconnected fallback immediately if the active
    // turn player disconnects mid-turn so the game can never stall indefinitely.
    if (
      room.status === 'playing' &&
      room.gameState?.phase === 'playing' &&
      room.gameState.currentTurnPlayerId === playerId &&
      room.turnTimerSeconds === 0 &&
      !room.turnTimer
    ) {
      this.scheduleDisconnectedFallbackTurnTimer(room, playerId);
    }

    // If host dropped from an already-full waiting room, let AI Room Host auto-start it!
    if (room.status === 'waiting' && room.aiHostActive && room.seats.length === room.capacity) {
      this.maybeTriggerAiHostAutoStart(room);
    }
  }

  /**
   * Voluntary departure before game starts (or after game finishes).
   * During an active game, use voluntaryExitInGame() instead!
   */
  public leaveRoom(
    roomCode: string,
    playerId: string
  ):
    | { ok: true; reason?: 'left' | 'voluntary_exit' | 'finished_exit'; message?: string }
    | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status === 'closed') {
      return { ok: false, error: 'Room not found.' };
    }

    if (room.status === 'playing') {
      return this.voluntaryExitInGame(roomCode, playerId);
    }

    const idx = room.seats.findIndex((s) => s.playerId === playerId);
    if (idx === -1) return { ok: true };

    const [leaving] = room.seats.splice(idx, 1);

    // Cancel pending transfer if leaving player was involved
    if (
      room.pendingHostTransfer &&
      (room.pendingHostTransfer.fromPlayerId === playerId ||
        room.pendingHostTransfer.toPlayerId === playerId)
    ) {
      room.pendingHostTransfer = null;
    }

    // Remove session token for leaving player
    this.revokePlayerTokens(room, playerId);
    this.touchRoom(room);

    const remainingHumans = room.seats.filter((s) => s.type === 'human');

    // If zero human players remain, close the room cleanly
    if (remainingHumans.length === 0) {
      this.closeRoom(room, 'All players left the room.');
      return { ok: true };
    }

    // Section 18 & 19: Voluntary host departure -> AI Room Host permanently manages room
    if (room.hostPlayerId === playerId || room.suspendedHostId === playerId) {
      room.hostPlayerId = null;
      room.suspendedHostId = null;
      room.aiHostActive = true;
      this.emitNote(
        room,
        'info',
        `Host ${leaving.name} left. AI Room Host is now managing the room.`
      );
    } else {
      this.emitNote(room, 'info', `${leaving.name} left the room.`);
    }

    // AUD-004 B: Remove departing player's vote from active rematch and reevaluate finalization
    if (room.status === 'finished' && room.rematch) {
      delete room.rematch.votes[playerId];
      this.syncRematchVotesWithSeats(room);
      if (room.aiHostActive && !this.hasPendingRematchVotes(room)) {
        this.finalizeRematchWindow(room);
        return { ok: true };
      }
      if (Date.now() > room.rematch.expiresAt && !room.rematch.readyToStart) {
        room.rematch = null;
      }
    }

    // AUD-012: Leaving a waiting room invalidates any pending AI auto-start countdown
    if (room.status === 'waiting') {
      this.cancelAiStartTimer(room);
    }

    // Section 18: Public room vacancy -> wait 2 minutes for replacement before closing
    if (room.status === 'waiting' && room.visibility === 'public' && room.seats.length < room.capacity) {
      this.startPublicVacancyTimer(room);
    }

    this.sink.onRoomUpdated(room);
    return { ok: true };
  }

  private startPublicVacancyTimer(room: InternalRoom): void {
    if (room.vacancyTimer) clearTimeout(room.vacancyTimer);
    room.vacancyExpiresAt = Date.now() + this.opts.publicVacancyTimeoutMs;
    this.emitNote(
      room,
      'warning',
      'Waiting up to 2 minutes for a replacement player to join this public room.'
    );
    room.vacancyTimer = setTimeout(() => {
      if (room.status === 'waiting' && room.seats.length < room.capacity) {
        this.closeRoom(
          room,
          'Public room closed automatically after 2 minutes without a replacement player.'
        );
      }
    }, this.opts.publicVacancyTimeoutMs);
  }

  public addBot(roomCode: string, requesterId: string): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'waiting') {
      return { ok: false, error: 'Bots can only be added while waiting in the lobby.' };
    }
    if (!this.isConnectedHost(room, requesterId)) {
      return { ok: false, error: 'Only the host can add bots.' };
    }
    if (room.seats.length >= room.capacity) {
      return { ok: false, error: 'Room Full — cannot add more players.' };
    }

    const usedNamesLower = new Set(room.seats.map((s) => s.name.trim().toLowerCase()));
    let botName = BOT_NAMES.find((n) => !usedNamesLower.has(n.toLowerCase()));
    if (!botName) {
      let idx = room.seats.length + 1;
      while (usedNamesLower.has(`bot ${idx}`)) idx += 1;
      botName = `Bot ${idx}`;
    }
    const botId = `bot_${crypto.randomBytes(4).toString('hex')}`;

    room.seats.push({
      playerId: botId,
      name: botName,
      type: 'bot',
      connected: true,
      avatarColor: AVATAR_COLORS[room.seats.length % AVATAR_COLORS.length],
      joinedAt: Date.now(),
    });
    this.touchRoom(room);

    if (room.vacancyTimer && room.seats.length >= room.capacity) {
      clearTimeout(room.vacancyTimer);
      room.vacancyTimer = undefined;
      room.vacancyExpiresAt = null;
    }

    this.emitNote(room, 'info', `${botName} joined the lobby.`);
    this.sink.onRoomUpdated(room);
    return { ok: true };
  }

  public removeSeat(
    roomCode: string,
    requesterId: string,
    targetPlayerId: string
  ): { ok: true; kickedPlayerId: string; wasHuman: boolean } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'waiting') {
      return { ok: false, error: 'Players can only be removed before the game starts.' };
    }
    if (!this.isConnectedHost(room, requesterId)) {
      return { ok: false, error: 'Only the host can remove players from the lobby.' };
    }
    if (targetPlayerId === requesterId) {
      return { ok: false, error: 'Use Leave Room to exit yourself.' };
    }

    const idx = room.seats.findIndex((s) => s.playerId === targetPlayerId);
    if (idx === -1) return { ok: false, error: 'Player not found in lobby.' };

    const [removed] = room.seats.splice(idx, 1);
    this.revokePlayerTokens(room, targetPlayerId);
    this.cancelAiStartTimer(room);
    this.touchRoom(room);

    if (
      room.pendingHostTransfer &&
      (room.pendingHostTransfer.fromPlayerId === targetPlayerId ||
        room.pendingHostTransfer.toPlayerId === targetPlayerId)
    ) {
      room.pendingHostTransfer = null;
    }

    if (removed.type === 'human') {
      this.sink.onPlayerKicked?.(
        room.roomCode,
        targetPlayerId,
        'You were removed from the lobby by the host.'
      );
    }

    this.emitNote(room, 'info', `${removed.name} was removed from the lobby.`);
    this.sink.onRoomUpdated(room);
    return { ok: true, kickedPlayerId: targetPlayerId, wasHuman: removed.type === 'human' };
  }

  public updateTurnTimer(
    roomCode: string,
    requesterId: string,
    turnTimerSeconds: unknown
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status === 'closed') return { ok: false, error: 'Room not found.' };
    if (room.status !== 'waiting') {
      return {
        ok: false,
        error: 'Turn timer can only be changed while waiting in the lobby.',
      };
    }
    const authorized =
      this.isConnectedHost(room, requesterId) ||
      (requesterId === 'AI_ROOM_HOST' && room.aiHostActive);
    if (!authorized) {
      return { ok: false, error: 'Only the host can change the room timer.' };
    }
    if (!isValidTurnTimerSeconds(turnTimerSeconds)) {
      return {
        ok: false,
        error: 'Invalid turn timer option. Allowed values: Off (0s), 10s, 15s, 20s, or 30s.',
      };
    }
    if (room.turnTimerSeconds === turnTimerSeconds) {
      return { ok: true };
    }
    room.turnTimerSeconds = turnTimerSeconds;
    this.touchRoom(room);
    const label = turnTimerSeconds === 0 ? 'Off' : `${turnTimerSeconds}s`;
    this.emitNote(room, 'info', `Turn timer updated to ${label}.`);
    this.sink.onRoomUpdated(room);
    return { ok: true };
  }

  /**
   * Section 17 & 21: Revoke invitation link and issue a fresh replacement token.
   */
  public revokeInviteLink(
    roomCode: string,
    requesterId: string
  ): { ok: true; newInviteToken: string } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status === 'closed') return { ok: false, error: 'Room not found.' };
    if (room.status !== 'waiting') {
      return { ok: false, error: 'Invitation links can only be changed while waiting in the lobby.' };
    }
    if (!this.isConnectedHost(room, requesterId)) {
      return { ok: false, error: 'Only the host can revoke invitation links.' };
    }

    room.revokedTokens.add(room.inviteToken);
    room.inviteToken = this.generateToken();
    this.touchRoom(room);

    this.emitNote(
      room,
      'info',
      'Previous invitation link revoked. A new invitation link is now active.',
      requesterId
    );
    this.sink.onRoomUpdated(room);
    return { ok: true, newInviteToken: room.inviteToken };
  }

  /**
   * Section 21: Regenerate unique 6-character room code.
   */
  public regenerateRoomCode(
    roomCode: string,
    requesterId: string
  ): { ok: true; newRoomCode: string } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'waiting') {
      return { ok: false, error: 'Room code can only be changed before the game starts.' };
    }
    if (!this.isConnectedHost(room, requesterId)) {
      return { ok: false, error: 'Only the host can regenerate the room code.' };
    }

    const oldCode = room.roomCode;
    const newCode = this.generateCode();
    this.rooms.delete(oldCode);
    this.recordExpiredCode(oldCode);
    room.roomCode = newCode;
    this.rooms.set(newCode, room);
    this.touchRoom(room);

    // AUD-001: Synchronize connected socket roomCode metadata BEFORE emitting notifications/room_state
    this.sink.onRoomCodeChanged?.(oldCode, newCode, room);

    this.emitNote(room, 'info', `Room code updated to ${newCode}.`);
    this.sink.onRoomUpdated(room);
    return { ok: true, newRoomCode: newCode };
  }

  /**
   * Section 19: Manual host transfer request -> requires acceptance by selected connected player.
   */
  public requestHostTransfer(
    roomCode: string,
    requesterId: string,
    targetPlayerId: string
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status === 'closed') return { ok: false, error: 'Room not found.' };
    if (!this.isConnectedHost(room, requesterId)) {
      return { ok: false, error: 'Only the current connected host can transfer ownership.' };
    }
    if (targetPlayerId === requesterId) {
      return { ok: false, error: 'You are already the host.' };
    }

    const fromSeat = room.seats.find((s) => s.playerId === requesterId);
    const toSeat = room.seats.find((s) => s.playerId === targetPlayerId);
    if (!fromSeat || !toSeat || toSeat.type !== 'human' || !toSeat.connected) {
      return { ok: false, error: 'Target must be a connected human player.' };
    }
    if (
      room.pendingHostTransfer &&
      room.pendingHostTransfer.toPlayerId === targetPlayerId &&
      room.pendingHostTransfer.fromPlayerId === requesterId
    ) {
      return { ok: false, error: `A host transfer request to ${toSeat.name} is already pending.` };
    }

    room.pendingHostTransfer = {
      fromPlayerId: fromSeat.playerId,
      fromPlayerName: fromSeat.name,
      toPlayerId: toSeat.playerId,
      toPlayerName: toSeat.name,
      requestedAt: Date.now(),
    };
    this.touchRoom(room);

    this.emitNote(
      room,
      'info',
      `${fromSeat.name} wants to transfer Host ownership to you.`,
      toSeat.playerId
    );
    this.sink.onRoomUpdated(room);
    return { ok: true };
  }

  public respondHostTransfer(
    roomCode: string,
    responderId: string,
    accept: boolean
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status === 'closed' || !room.pendingHostTransfer) {
      return { ok: false, error: 'No pending host transfer request.' };
    }
    if (room.pendingHostTransfer.toPlayerId !== responderId) {
      return { ok: false, error: 'This transfer request is not addressed to you.' };
    }
    const responderSeat = room.seats.find((s) => s.playerId === responderId);
    if (!responderSeat || responderSeat.type !== 'human' || !responderSeat.connected) {
      room.pendingHostTransfer = null;
      return { ok: false, error: 'You must be connected in this room to respond.' };
    }

    const req = room.pendingHostTransfer;
    room.pendingHostTransfer = null;
    this.touchRoom(room);

    if (accept) {
      room.hostPlayerId = responderId;
      room.aiHostActive = false;
      room.suspendedHostId = null;
      this.cancelAiStartTimer(room);
      this.emitNote(room, 'success', `Host ownership transferred to ${req.toPlayerName}.`);
    } else {
      this.emitNote(
        room,
        'info',
        `${req.toPlayerName} declined the host transfer request.`,
        req.fromPlayerId
      );
    }

    this.sink.onRoomUpdated(room);
    return { ok: true };
  }

  public cancelRoom(
    roomCode: string,
    requesterId: string
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status === 'closed') return { ok: false, error: 'Room not found.' };
    if (!this.isConnectedHost(room, requesterId)) {
      return { ok: false, error: 'Only the host can cancel this room.' };
    }
    if (room.status === 'playing') {
      return { ok: false, error: 'Cannot cancel a game already in progress.' };
    }
    this.closeRoom(room, 'The host cancelled the room.');
    return { ok: true };
  }

  private closeRoom(room: InternalRoom, reason: string): void {
    this.clearAllTimers(room);
    room.status = 'closed';
    room.closeReason = reason;
    const memberIds = room.seats.map((s) => s.playerId);
    this.rooms.delete(room.roomCode);
    this.recordExpiredCode(room.roomCode);
    this.sink.onRoomClosed(room.roomCode, reason, memberIds);
  }

  private maybeTriggerAiHostAutoStart(room: InternalRoom): void {
    if (!room.aiHostActive || room.status !== 'waiting') return;
    if (room.seats.length !== room.capacity) return;
    // Do not auto-start an empty room with zero connected human players
    if (!room.seats.some((s) => s.type === 'human' && s.connected)) return;
    // AUD-012: Guard against duplicate auto-start timers & duplicate notifications
    if (room.aiStartTimer) return;

    this.emitNote(room, 'info', 'Room is full! AI Room Host is starting the game...');
    room.aiStartTimer = setTimeout(() => {
      room.aiStartTimer = undefined;
      if (
        room.aiHostActive &&
        room.status === 'waiting' &&
        room.seats.length === room.capacity &&
        room.seats.some((s) => s.type === 'human' && s.connected)
      ) {
        this.startGameInternal(room);
      }
    }, this.opts.aiAutoStartDelayMs);
  }

  public startGame(
    roomCode: string,
    requesterId: string
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'waiting') {
      return { ok: false, error: 'Room is not ready to start.' };
    }
    if (!this.isConnectedHost(room, requesterId)) {
      return { ok: false, error: 'Only the host can start the game.' };
    }
    // Section 16: Room starts only when its required number of players is present
    if (room.seats.length !== room.capacity) {
      return {
        ok: false,
        error: `Waiting for ${room.capacity - room.seats.length} more player(s) (${room.seats.length}/${room.capacity}).`,
      };
    }

    this.startGameInternal(room);
    return { ok: true };
  }

  private startGameInternal(room: InternalRoom, activeSeats?: RoomSeat[]): void {
    this.cancelAiStartTimer(room);
    if (room.vacancyTimer) {
      clearTimeout(room.vacancyTimer);
      room.vacancyTimer = undefined;
      room.vacancyExpiresAt = null;
    }
    if (room.rematchTimer) {
      clearTimeout(room.rematchTimer);
      room.rematchTimer = undefined;
    }

    const seatsToPlay = activeSeats ?? room.seats;
    const acceptedIds = new Set(seatsToPlay.map((s) => s.playerId));
    const excludedSeats = room.seats.filter((s) => !acceptedIds.has(s.playerId));

    // AUD-003: Revoke tokens and detach players excluded from a smaller-group rematch
    for (const excluded of excludedSeats) {
      this.revokePlayerTokens(room, excluded.playerId);
      if (
        room.pendingHostTransfer &&
        (room.pendingHostTransfer.fromPlayerId === excluded.playerId ||
          room.pendingHostTransfer.toPlayerId === excluded.playerId)
      ) {
        room.pendingHostTransfer = null;
      }
      if (room.hostPlayerId === excluded.playerId || room.suspendedHostId === excluded.playerId) {
        room.hostPlayerId = null;
        room.suspendedHostId = null;
        room.aiHostActive = true;
      }
    }

    room.seats = seatsToPlay;
    room.capacity = seatsToPlay.length;
    room.removedPlayerIds.clear();
    room.rematch = null;
    room.status = 'playing';
    room.finishedAt = null;
    this.touchRoom(room);

    for (const excluded of excludedSeats) {
      if (excluded.type === 'human') {
        this.sink.onPlayerDetached?.(
          room.roomCode,
          excluded.playerId,
          'A rematch started without you.'
        );
      }
    }

    const playerConfigs: PlayerConfig[] = seatsToPlay.map((s) => ({
      id: s.playerId,
      name: s.name,
      type: s.type,
      avatarColor: s.avatarColor,
    }));

    room.gameState = createInitialGameState(playerConfigs, {
      rng: this.opts.rng,
      difficulty: room.difficulty,
    });
    // Sync connection status into fresh GameState
    for (const s of seatsToPlay) {
      if (!s.connected) {
        room.gameState = markPlayerConnection(room.gameState, s.playerId, false);
      }
    }

    this.emitNote(room, 'success', 'Cards dealt! Game started — Ace of Spades leads.');
    this.sink.onRoomUpdated(room);
    this.scheduleNextServerStep(room);
  }

  public playCardAction(
    roomCode: string,
    playerId: string,
    cardId: string
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing' || !room.gameState) {
      return { ok: false, error: 'No active game in this room.' };
    }
    if (room.removedPlayerIds.has(playerId)) {
      return { ok: false, error: 'You were removed from this game after 3 missed turns.' };
    }

    const res = playCard(room.gameState, playerId, cardId, { isAutoPlay: false });
    if (!res.ok) return res;

    this.clearTurnAndBotTimers(room);
    room.gameState = res.state;
    this.touchRoom(room);
    this.handlePostStateTransition(room);
    return { ok: true };
  }

  /**
   * Section 10: Voluntary Exit between tricks for active players,
   * OR immediate clean exit for officially finished (or already removed) players without altering game state.
   */
  public voluntaryExitInGame(
    roomCode: string,
    playerId: string
  ):
    | { ok: true; reason: 'voluntary_exit' | 'finished_exit'; message: string }
    | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing' || !room.gameState) {
      return { ok: false, error: 'No active game.' };
    }

    const gamePlayer = room.gameState.players.find((p) => p.id === playerId);
    const seatIdx = room.seats.findIndex((s) => s.playerId === playerId);
    const seat = seatIdx >= 0 ? room.seats[seatIdx] : undefined;

    // Officially finished players (or players already removed after 3 missed turns)
    // may leave at any time without affecting remaining players, cards, or game state.
    if (
      gamePlayer &&
      ((gamePlayer.finished && gamePlayer.hand.length === 0 && !gamePlayer.removed) ||
        gamePlayer.removed)
    ) {
      const wasFinished = gamePlayer.finished && !gamePlayer.removed;
      const playerName = seat?.name ?? gamePlayer.name;

      // Detach their seat and revoke session token so they don't linger in rematch/reconnect
      if (seatIdx >= 0) {
        room.seats.splice(seatIdx, 1);
      }
      this.revokePlayerTokens(room, playerId);
      this.touchRoom(room);

      if (
        room.pendingHostTransfer &&
        (room.pendingHostTransfer.fromPlayerId === playerId ||
          room.pendingHostTransfer.toPlayerId === playerId)
      ) {
        room.pendingHostTransfer = null;
      }

      // Mark connection false in gameState without altering finished/finishOrder/cards/trick/turn
      room.gameState = markPlayerConnection(room.gameState, playerId, false);

      // AUD-013: Close ghost bot-only rooms if zero human seats remain (disconnected humans still keep room alive)
      const remainingHumans = room.seats.filter((s) => s.type === 'human');
      if (remainingHumans.length === 0) {
        this.closeRoom(room, 'All human players left the game.');
        return {
          ok: true,
          reason: 'finished_exit',
          message: wasFinished
            ? 'You left the table. Your finishing position is preserved.'
            : 'You left the room.',
        };
      }

      if (room.hostPlayerId === playerId || room.suspendedHostId === playerId) {
        room.hostPlayerId = null;
        room.suspendedHostId = null;
        room.aiHostActive = true;
        this.emitNote(
          room,
          'info',
          `${playerName} left the table. AI Room Host now manages the room.`
        );
      } else {
        this.emitNote(
          room,
          'info',
          wasFinished
            ? `${playerName} finished and left the table. The game continues.`
            : `${playerName} left the room.`
        );
      }

      this.sink.onRoomUpdated(room);
      return {
        ok: true,
        reason: 'finished_exit',
        message: wasFinished
          ? 'You left the table. Your finishing position is preserved while remaining players finish.'
          : 'You left the room.',
      };
    }

    if (!canVoluntarilyExit(room.gameState)) {
      return {
        ok: false,
        error: 'Exit is disabled mid-trick. Please wait until the current trick finishes.',
      };
    }

    const res = removePlayerAndRedistribute(
      room.gameState,
      playerId,
      'voluntary_exit',
      this.opts.rng
    );
    if (!res.ok) return res;

    this.clearTurnAndBotTimers(room);
    room.gameState = res.state;
    room.removedPlayerIds.add(playerId);
    this.revokePlayerTokens(room, playerId);
    this.touchRoom(room);

    if (seatIdx >= 0) {
      room.seats.splice(seatIdx, 1);
    }

    if (
      room.pendingHostTransfer &&
      (room.pendingHostTransfer.fromPlayerId === playerId ||
        room.pendingHostTransfer.toPlayerId === playerId)
    ) {
      room.pendingHostTransfer = null;
    }

    // AUD-013: Close ghost bot-only rooms if zero human seats remain (disconnected humans still keep room alive)
    const remainingHumans = room.seats.filter((s) => s.type === 'human');
    if (remainingHumans.length === 0) {
      this.closeRoom(room, 'All human players left the game.');
      return {
        ok: true,
        reason: 'voluntary_exit',
        message: 'Exited game between tricks.',
      };
    }

    // Voluntary host departure -> AI Room Host takes over permanently
    if (room.hostPlayerId === playerId || room.suspendedHostId === playerId) {
      room.hostPlayerId = null;
      room.suspendedHostId = null;
      room.aiHostActive = true;
      this.emitNote(
        room,
        'info',
        `${seat?.name ?? 'Host'} left between tricks. AI Room Host now manages the room.`
      );
    }

    const redist = res.state.lastRedistribution;
    if (redist) {
      this.emitNote(
        room,
        'warning',
        `${redist.removedPlayerName} exited between tricks. ${redist.cardsDistributedCount} cards redistributed clockwise.`
      );
    }

    this.handlePostStateTransition(room);
    return {
      ok: true,
      reason: 'voluntary_exit',
      message: redist
        ? `Exited between tricks. ${redist.cardsDistributedCount} cards redistributed clockwise.`
        : 'Exited game between tricks.',
    };
  }

  private clearTurnAndBotTimers(room: InternalRoom): void {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.botTimer) clearTimeout(room.botTimer);
    room.turnTimer = undefined;
    room.botTimer = undefined;
    room.turnDeadlineAt = null;
  }

  private handlePostStateTransition(room: InternalRoom): void {
    if (!room.gameState) return;
    this.touchRoom(room);

    if (room.gameState.phase === 'finished') {
      this.clearTurnAndBotTimers(room);
      if (room.trickTimer) {
        clearTimeout(room.trickTimer);
        room.trickTimer = undefined;
      }
      room.status = 'finished';
      room.finishedAt = Date.now();
      const donkey = room.gameState.players.find((p) => p.id === room.gameState?.donkeyPlayerId);
      this.emitNote(
        room,
        'info',
        donkey
          ? `Game Over! ${donkey.name} is the Last Donkey.`
          : 'Game Over! All remaining players finished simultaneously.'
      );
      this.sink.onRoomUpdated(room);
      return;
    }

    this.sink.onRoomUpdated(room);
    this.scheduleNextServerStep(room);
  }

  private scheduleNextServerStep(room: InternalRoom): void {
    if (!room.gameState || room.status !== 'playing') return;

    this.clearTurnAndBotTimers(room);

    // Phase: trick_result -> auto-advance after brief notification window
    if (room.gameState.phase === 'trick_result') {
      const isFailed = room.gameState.lastOutcome?.type === 'failed';
      const delay = isFailed ? this.opts.trickFailDelayMs : this.opts.trickSuccessDelayMs;
      if (room.trickTimer) clearTimeout(room.trickTimer);
      room.trickTimer = setTimeout(() => {
        if (!room.gameState || room.gameState.phase !== 'trick_result') return;
        room.gameState = continueAfterTrick(room.gameState);
        this.handlePostStateTransition(room);
      }, delay);
      return;
    }

    // Phase: playing
    const turnId = room.gameState.currentTurnPlayerId;
    if (!turnId) return;

    const currentPlayer = room.gameState.players.find((p) => p.id === turnId);
    if (!currentPlayer) return;

    // Bot turn -> routes strictly through sanitized BotPublicObservation for room.difficulty
    if (currentPlayer.type === 'bot') {
      room.botTimer = setTimeout(() => {
        if (!room.gameState || room.gameState.phase !== 'playing') return;
        if (room.gameState.currentTurnPlayerId !== currentPlayer.id) return;
        const card = chooseBotCard(
          room.gameState,
          currentPlayer.id,
          room.difficulty,
          this.opts.rng
        );
        if (!card) return;
        const res = playCard(room.gameState, currentPlayer.id, card.id, { isAutoPlay: true });
        if (res.ok) {
          room.gameState = res.state;
          this.handlePostStateTransition(room);
        }
      }, this.opts.botDelayMs);
      return;
    }

    // Human turn -> server authoritative turn timer (Section 12 & 13)
    // If player is disconnected and timer is Off, still use 15s fallback so game NEVER stalls!
    const effectiveSeconds =
      room.turnTimerSeconds > 0
        ? room.turnTimerSeconds
        : !currentPlayer.connected
          ? this.opts.disconnectedFallbackTimerSeconds
          : 0;

    if (effectiveSeconds > 0) {
      room.turnDeadlineAt = Date.now() + effectiveSeconds * 1000;
      this.sink.onRoomUpdated(room);

      room.turnTimer = setTimeout(() => {
        this.executeMissedTurnTimeout(room, currentPlayer.id);
      }, effectiveSeconds * 1000);
    }
  }

  private scheduleDisconnectedFallbackTurnTimer(room: InternalRoom, playerId: string): void {
    // Guard against duplicate fallback timers
    if (room.turnTimer) return;
    const fallbackSeconds = this.opts.disconnectedFallbackTimerSeconds;
    if (fallbackSeconds <= 0) return;

    room.turnDeadlineAt = Date.now() + fallbackSeconds * 1000;
    this.sink.onRoomUpdated(room);

    room.turnTimer = setTimeout(() => {
      this.executeMissedTurnTimeout(room, playerId);
    }, fallbackSeconds * 1000);
  }

  public executeMissedTurnTimeout(room: InternalRoom, playerId: string): void {
    room.turnTimer = undefined;
    room.turnDeadlineAt = null;
    if (!room.gameState || room.gameState.phase !== 'playing') return;
    if (room.gameState.currentTurnPlayerId !== playerId) return;

    const player = room.gameState.players.find((p) => p.id === playerId);
    const res = handleMissedTurn(room.gameState, playerId, this.opts.rng);
    if (!res.ok) return;

    room.gameState = res.state;

    if (res.action === 'auto_played' && res.autoPlayedCard) {
      this.emitNote(
        room,
        'warning',
        `${player?.name ?? 'Player'} missed turn (${res.missedCount}/3) — auto-played ${formatCard(res.autoPlayedCard)}.`
      );
    } else if (res.action === 'removed_and_redistributed') {
      room.removedPlayerIds.add(playerId);
      const seat = room.seats.find((s) => s.playerId === playerId);
      if (seat) seat.connected = false;
      // If removed player was the suspended/current host, AI Room Host permanently manages
      if (room.hostPlayerId === playerId || room.suspendedHostId === playerId) {
        room.hostPlayerId = null;
        room.suspendedHostId = null;
        room.aiHostActive = true;
      }
      this.emitNote(
        room,
        'error',
        `${player?.name ?? 'Player'} was removed after 3 consecutive missed turns. Their ${res.redistribution?.cardsDistributedCount ?? 0} cards were redistributed clockwise.`
      );
    }

    this.handlePostStateTransition(room);
  }

  // =========================================================================
  // SECTION 20: REMATCH SYSTEM (30-SECOND RESPONSE WINDOW)
  // =========================================================================

  private getEligibleRematchSeats(room: InternalRoom): RoomSeat[] {
    return room.seats.filter((s) => s.type === 'bot' || s.connected);
  }

  private getAcceptedEligibleRematchSeats(room: InternalRoom): RoomSeat[] {
    if (!room.rematch) return [];
    return room.seats.filter(
      (s) => (s.type === 'bot' || s.connected) && room.rematch?.votes[s.playerId] === 'accepted'
    );
  }

  private syncRematchVotesWithSeats(room: InternalRoom): void {
    if (!room.rematch) return;
    const currentSeatIds = new Set(room.seats.map((s) => s.playerId));
    for (const pid of Object.keys(room.rematch.votes)) {
      if (!currentSeatIds.has(pid)) {
        delete room.rematch.votes[pid];
      }
    }
    for (const seat of room.seats) {
      if (seat.type === 'human' && !seat.connected) {
        room.rematch.votes[seat.playerId] = 'declined';
      }
    }
    room.rematch.readyToStart = this.getAcceptedEligibleRematchSeats(room).length >= 2;
  }

  private hasPendingRematchVotes(room: InternalRoom): boolean {
    if (!room.rematch) return false;
    return room.seats.some(
      (s) => s.type === 'human' && s.connected && room.rematch?.votes[s.playerId] === 'pending'
    );
  }

  public requestRematch(
    roomCode: string,
    requesterId: string
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'finished') {
      return { ok: false, error: 'Rematch is only available after a game ends.' };
    }
    const requesterSeat = room.seats.find((s) => s.playerId === requesterId);
    const isAuthorized =
      this.isConnectedHost(room, requesterId) ||
      (room.aiHostActive && Boolean(requesterSeat && requesterSeat.connected));
    if (!isAuthorized) {
      return { ok: false, error: 'Only the host can start a rematch.' };
    }

    // AUD-004 C: Prevent overlapping active rematch windows
    if (room.rematch && room.rematch.expiresAt > Date.now()) {
      return { ok: false, error: 'A rematch vote is already in progress.' };
    }

    // AUD-004 C: Require at least 2 eligible seats before initiating a rematch
    const eligibleSeats = this.getEligibleRematchSeats(room);
    if (eligibleSeats.length < 2) {
      return { ok: false, error: 'At least 2 eligible players are required to start a rematch.' };
    }

    const votes: Record<string, RematchState['votes'][string]> = {};
    for (const seat of room.seats) {
      if (seat.type === 'bot') {
        votes[seat.playerId] = 'accepted';
      } else if (seat.playerId === requesterId) {
        votes[seat.playerId] = 'accepted';
      } else if (!seat.connected) {
        votes[seat.playerId] = 'declined';
      } else {
        votes[seat.playerId] = 'pending';
      }
    }

    room.rematch = {
      initiatedBy: room.aiHostActive ? 'AI_ROOM_HOST' : requesterId,
      expiresAt: Date.now() + this.opts.rematchTimeoutMs,
      votes,
      readyToStart: false,
    };
    this.syncRematchVotesWithSeats(room);
    this.touchRoom(room);

    this.emitNote(
      room,
      'info',
      'Rematch requested! Players have 30 seconds to accept or decline.'
    );
    this.sink.onRoomUpdated(room);

    if (room.rematchTimer) clearTimeout(room.rematchTimer);
    room.rematchTimer = setTimeout(() => {
      this.finalizeRematchWindow(room);
    }, this.opts.rematchTimeoutMs);

    // If all connected human players already voted (e.g. solo host + bots under AI Host), evaluate immediately
    if (!this.hasPendingRematchVotes(room) && room.aiHostActive) {
      this.finalizeRematchWindow(room);
    }

    return { ok: true };
  }

  public respondRematch(
    roomCode: string,
    playerId: string,
    accept: boolean
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'finished' || !room.rematch) {
      return { ok: false, error: 'No active rematch invitation.' };
    }
    // AUD-004 D: Reject votes submitted after rematch window expiration
    if (Date.now() > room.rematch.expiresAt) {
      return { ok: false, error: 'The rematch response window has expired.' };
    }
    const seat = room.seats.find((s) => s.playerId === playerId);
    if (!seat || !(playerId in room.rematch.votes)) {
      return { ok: false, error: 'You are not part of this rematch.' };
    }
    if (seat.type === 'human' && !seat.connected) {
      return { ok: false, error: 'Reconnect to respond to the rematch invitation.' };
    }

    room.rematch.votes[playerId] = accept ? 'accepted' : 'declined';
    this.syncRematchVotesWithSeats(room);
    this.touchRoom(room);

    this.emitNote(
      room,
      accept ? 'success' : 'info',
      `${seat.name} ${accept ? 'accepted' : 'declined'} the rematch.`
    );
    this.sink.onRoomUpdated(room);

    if (!this.hasPendingRematchVotes(room) && room.aiHostActive) {
      this.finalizeRematchWindow(room);
    }

    return { ok: true };
  }

  public startAcceptedRematch(
    roomCode: string,
    requesterId: string
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'finished' || !room.rematch) {
      return { ok: false, error: 'No rematch in progress.' };
    }
    if (!room.aiHostActive && !this.isConnectedHost(room, requesterId)) {
      return { ok: false, error: 'Only the host can start the rematch.' };
    }
    if (
      room.aiHostActive &&
      !room.seats.some((s) => s.playerId === requesterId && s.connected)
    ) {
      return { ok: false, error: 'You must be connected in this room to start the rematch.' };
    }

    this.syncRematchVotesWithSeats(room);
    const acceptedSeats = this.getAcceptedEligibleRematchSeats(room);
    if (acceptedSeats.length < 2) {
      return { ok: false, error: 'At least 2 accepted players are required to start a rematch.' };
    }

    this.startGameInternal(room, acceptedSeats);
    return { ok: true };
  }

  private finalizeRematchWindow(room: InternalRoom): void {
    if (!room.rematch) return;
    if (room.rematchTimer) {
      clearTimeout(room.rematchTimer);
      room.rematchTimer = undefined;
    }

    // Mark all non-responders as declined and reconcile with current connected seats
    for (const [pid, vote] of Object.entries(room.rematch.votes)) {
      if (vote === 'pending') {
        room.rematch.votes[pid] = 'declined';
      }
    }
    this.syncRematchVotesWithSeats(room);

    const acceptedSeats = this.getAcceptedEligibleRematchSeats(room);

    // AUD-004 A: Reset rematch to null when fewer than 2 eligible players accepted (both human & AI host)
    if (acceptedSeats.length < 2) {
      room.rematch = null;
      this.emitNote(
        room,
        'warning',
        'Not enough players accepted the rematch. You may request another rematch when ready.'
      );
      this.sink.onRoomUpdated(room);
      return;
    }

    if (room.aiHostActive) {
      this.emitNote(
        room,
        'success',
        `AI Room Host starting rematch with ${acceptedSeats.length} players.`
      );
      this.startGameInternal(room, acceptedSeats);
    } else {
      room.rematch.readyToStart = true;
      this.emitNote(
        room,
        'info',
        `Rematch timer finished — ${acceptedSeats.length} players ready. Host may start now.`
      );
      this.sink.onRoomUpdated(room);
    }
  }
}
