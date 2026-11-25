import crypto from 'node:crypto';
import {
  canVoluntarilyExit,
  chooseRandomLegalCard,
  continueAfterTrick,
  createInitialGameState,
  formatCard,
  handleMissedTurn,
  markPlayerConnection,
  playCard,
  removePlayerAndRedistribute,
  type GameState,
  type PlayerConfig,
} from '../engine';
import type { TurnTimerSeconds } from '../lib/settings';
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
} from './roomTypes';

const BOT_NAMES = ['Bot Raju', 'Bot Pinky', 'Bot Golu', 'Bot Meera', 'Bot Kabir', 'Bot Priya'];
const AVATAR_COLORS = ['#E59A00', '#2E6340', '#D95732', '#3A6B8A', '#8B5E83', '#B57435'];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface InternalRoom {
  roomCode: string;
  tableName: string;
  visibility: RoomVisibility;
  capacity: number;
  status: RoomStatus;
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
}

export interface RoomManagerOptions {
  publicVacancyTimeoutMs?: number; // Default: 120_000 (2 minutes per Section 18)
  rematchTimeoutMs?: number; // Default: 30_000 (30 seconds per Section 20)
  botDelayMs?: number; // Default: 750ms
  trickSuccessDelayMs?: number; // Default: 1500ms
  trickFailDelayMs?: number; // Default: 2100ms
  aiAutoStartDelayMs?: number; // Default: 1200ms
  rng?: () => number;
}

export class RoomManager {
  private rooms = new Map<string, InternalRoom>();
  private expiredRoomCodes = new Set<string>();
  private sink: RoomEventSink;
  private opts: Required<RoomManagerOptions>;

  constructor(sink: RoomEventSink, options: RoomManagerOptions = {}) {
    this.sink = sink;
    this.opts = {
      publicVacancyTimeoutMs: options.publicVacancyTimeoutMs ?? 120_000,
      rematchTimeoutMs: options.rematchTimeoutMs ?? 30_000,
      botDelayMs: options.botDelayMs ?? 750,
      trickSuccessDelayMs: options.trickSuccessDelayMs ?? 1500,
      trickFailDelayMs: options.trickFailDelayMs ?? 2100,
      aiAutoStartDelayMs: options.aiAutoStartDelayMs ?? 1200,
      rng: options.rng ?? Math.random,
    };
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += CODE_CHARS[Math.floor(this.opts.rng() * CODE_CHARS.length)];
      }
      if (!this.rooms.has(code)) return code;
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

  public disposeAll(): void {
    for (const room of this.rooms.values()) {
      this.clearAllTimers(room);
    }
    this.rooms.clear();
  }

  public getRoom(roomCode: string): InternalRoom | undefined {
    return this.rooms.get(roomCode.trim().toUpperCase());
  }

  public getPublicRooms(): PublicRoomSummary[] {
    const list: PublicRoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (room.visibility !== 'public') continue;
      if (room.status !== 'waiting') continue;
      list.push({
        roomCode: room.roomCode,
        tableName: room.tableName,
        capacity: room.capacity,
        playerCount: room.seats.length,
        isFull: room.seats.length >= room.capacity,
        status: room.status,
        aiHostActive: room.aiHostActive,
        vacancyExpiresAt: room.vacancyExpiresAt,
      });
    }
    return list.sort((a, b) => Number(a.isFull) - Number(b.isFull));
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
      room: {
        roomCode: room.roomCode,
        tableName: room.tableName,
        capacity: room.capacity,
        playerCount: room.seats.length,
        isFull: room.seats.length >= room.capacity,
        status: room.status,
        aiHostActive: room.aiHostActive,
        vacancyExpiresAt: room.vacancyExpiresAt,
      },
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
    turnTimerSeconds?: TurnTimerSeconds;
  }):
    | { ok: true; room: InternalRoom; playerId: string; sessionToken: string }
    | { ok: false; error: string } {
    if (!Number.isInteger(params.capacity) || params.capacity < 2 || params.capacity > 6) {
      return { ok: false, error: 'Room capacity must be between 2 and 6 players.' };
    }
    const cleanName = params.playerName.trim().slice(0, 20) || 'Player 1';
    const cleanTable = (params.tableName ?? '').trim().slice(0, 28) || `${cleanName}’s Room`;

    const roomCode = this.generateCode();
    const playerId = `u_${crypto.randomBytes(6).toString('hex')}`;
    const sessionToken = this.generateToken();

    const seat: RoomSeat = {
      playerId,
      name: cleanName,
      type: 'human',
      connected: true,
      avatarColor: AVATAR_COLORS[0],
      joinedAt: Date.now(),
    };

    const room: InternalRoom = {
      roomCode,
      tableName: cleanTable,
      visibility: params.visibility,
      capacity: params.capacity,
      status: 'waiting',
      inviteToken: this.generateToken(),
      revokedTokens: new Set(),
      hostPlayerId: playerId,
      aiHostActive: false,
      suspendedHostId: null,
      pendingHostTransfer: null,
      turnTimerSeconds: params.turnTimerSeconds ?? 15,
      turnDeadlineAt: null,
      vacancyExpiresAt: null,
      seats: [seat],
      sessionTokens: new Map([[sessionToken, playerId]]),
      removedPlayerIds: new Set(),
      gameState: null,
      rematch: null,
      closeReason: null,
      createdAt: Date.now(),
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
    const cleanName =
      params.playerName.trim().slice(0, 20) || `Player ${room.seats.length + 1}`;
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

  public reconnectPlayer(
    roomCode: string,
    sessionToken: string
  ):
    | { ok: true; room: InternalRoom; playerId: string; removedFromOngoingGame: boolean }
    | { ok: false; error: string } {
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    if (!room || room.status === 'closed') {
      return { ok: false, error: 'Room no longer exists.' };
    }

    const playerId = room.sessionTokens.get(sessionToken);
    if (!playerId) {
      return { ok: false, error: 'Session is invalid or expired.' };
    }

    // Section 13: If player was removed after 3 missed turns, they cannot rejoin the ongoing game
    if (room.removedPlayerIds.has(playerId) && room.status === 'playing') {
      return { ok: true, room, playerId, removedFromOngoingGame: true };
    }

    const seat = room.seats.find((s) => s.playerId === playerId);
    if (seat) {
      seat.connected = true;
    }

    if (room.gameState) {
      room.gameState = markPlayerConnection(room.gameState, playerId, true);
    }

    // Section 19: If original host reconnects before removal, restore host ownership!
    if (room.suspendedHostId === playerId && room.aiHostActive) {
      room.hostPlayerId = playerId;
      room.suspendedHostId = null;
      room.aiHostActive = false;
      this.emitNote(
        room,
        'success',
        "You're back! Host ownership has been restored to you.",
        playerId
      );
      this.emitNote(
        room,
        'info',
        `${seat?.name ?? 'Host'} reconnected and resumed host ownership.`
      );
    } else if (seat) {
      this.emitNote(room, 'info', `${seat.name} reconnected.`);
    }

    this.sink.onRoomUpdated(room);
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
    } else {
      this.emitNote(room, 'warning', `${seat.name} disconnected. Game continues without pausing.`);
    }

    this.sink.onRoomUpdated(room);
  }

  /**
   * Voluntary departure before game starts (or after game finishes).
   * During an active game, use voluntaryExitInGame() instead!
   */
  public leaveRoom(roomCode: string, playerId: string): { ok: true } | { ok: false; error: string } {
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
    for (const [tok, pid] of room.sessionTokens.entries()) {
      if (pid === playerId) room.sessionTokens.delete(tok);
    }

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
    if (room.hostPlayerId !== requesterId) {
      return { ok: false, error: 'Only the host can add bots.' };
    }
    if (room.seats.length >= room.capacity) {
      return { ok: false, error: 'Room Full — cannot add more players.' };
    }

    const usedNames = new Set(room.seats.map((s) => s.name));
    const botName =
      BOT_NAMES.find((n) => !usedNames.has(n)) ?? `Bot ${room.seats.length + 1}`;
    const botId = `bot_${crypto.randomBytes(4).toString('hex')}`;

    room.seats.push({
      playerId: botId,
      name: botName,
      type: 'bot',
      connected: true,
      avatarColor: AVATAR_COLORS[room.seats.length % AVATAR_COLORS.length],
      joinedAt: Date.now(),
    });

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
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'waiting') {
      return { ok: false, error: 'Players can only be removed before the game starts.' };
    }
    if (room.hostPlayerId !== requesterId) {
      return { ok: false, error: 'Only the host can remove players from the lobby.' };
    }
    if (targetPlayerId === requesterId) {
      return { ok: false, error: 'Use Leave Room to exit yourself.' };
    }

    const idx = room.seats.findIndex((s) => s.playerId === targetPlayerId);
    if (idx === -1) return { ok: false, error: 'Player not found in lobby.' };

    const [removed] = room.seats.splice(idx, 1);
    for (const [tok, pid] of room.sessionTokens.entries()) {
      if (pid === targetPlayerId) room.sessionTokens.delete(tok);
    }

    this.emitNote(room, 'info', `${removed.name} was removed from the lobby.`);
    this.sink.onRoomUpdated(room);
    return { ok: true };
  }

  public updateTurnTimer(
    roomCode: string,
    requesterId: string,
    turnTimerSeconds: TurnTimerSeconds
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.hostPlayerId !== requesterId) {
      return { ok: false, error: 'Only the host can change the room timer.' };
    }
    if (![0, 10, 15, 20, 30].includes(turnTimerSeconds)) {
      return { ok: false, error: 'Invalid turn timer option.' };
    }
    room.turnTimerSeconds = turnTimerSeconds;
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
    if (room.hostPlayerId !== requesterId) {
      return { ok: false, error: 'Only the host can revoke invitation links.' };
    }

    room.revokedTokens.add(room.inviteToken);
    room.inviteToken = this.generateToken();

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
    if (room.hostPlayerId !== requesterId) {
      return { ok: false, error: 'Only the host can regenerate the room code.' };
    }

    const oldCode = room.roomCode;
    const newCode = this.generateCode();
    this.rooms.delete(oldCode);
    this.expiredRoomCodes.add(oldCode);
    room.roomCode = newCode;
    this.rooms.set(newCode, room);

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
    if (room.hostPlayerId !== requesterId) {
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

    room.pendingHostTransfer = {
      fromPlayerId: fromSeat.playerId,
      fromPlayerName: fromSeat.name,
      toPlayerId: toSeat.playerId,
      toPlayerName: toSeat.name,
      requestedAt: Date.now(),
    };

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
    if (!room || !room.pendingHostTransfer) {
      return { ok: false, error: 'No pending host transfer request.' };
    }
    if (room.pendingHostTransfer.toPlayerId !== responderId) {
      return { ok: false, error: 'This transfer request is not addressed to you.' };
    }

    const req = room.pendingHostTransfer;
    room.pendingHostTransfer = null;

    if (accept) {
      room.hostPlayerId = responderId;
      room.aiHostActive = false;
      room.suspendedHostId = null;
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
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.hostPlayerId !== requesterId) {
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
    this.expiredRoomCodes.add(room.roomCode);
    this.sink.onRoomClosed(room.roomCode, reason, memberIds);
  }

  private maybeTriggerAiHostAutoStart(room: InternalRoom): void {
    if (!room.aiHostActive || room.status !== 'waiting') return;
    if (room.seats.length !== room.capacity) return;

    if (room.aiStartTimer) clearTimeout(room.aiStartTimer);
    this.emitNote(room, 'info', 'Room is full! AI Room Host is starting the game...');
    room.aiStartTimer = setTimeout(() => {
      if (room.status === 'waiting' && room.seats.length === room.capacity) {
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
    if (room.hostPlayerId !== requesterId) {
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
    room.seats = seatsToPlay;
    room.capacity = seatsToPlay.length;
    room.removedPlayerIds.clear();
    room.rematch = null;
    room.status = 'playing';

    const playerConfigs: PlayerConfig[] = seatsToPlay.map((s) => ({
      id: s.playerId,
      name: s.name,
      type: s.type,
      avatarColor: s.avatarColor,
    }));

    room.gameState = createInitialGameState(playerConfigs, { rng: this.opts.rng });
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
    this.handlePostStateTransition(room);
    return { ok: true };
  }

  /**
   * Section 10: Voluntary Exit between tricks only.
   */
  public voluntaryExitInGame(
    roomCode: string,
    playerId: string
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing' || !room.gameState) {
      return { ok: false, error: 'No active game.' };
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

    const seat = room.seats.find((s) => s.playerId === playerId);
    if (seat) seat.connected = false;

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
    return { ok: true };
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

    if (room.gameState.phase === 'finished') {
      this.clearTurnAndBotTimers(room);
      if (room.trickTimer) {
        clearTimeout(room.trickTimer);
        room.trickTimer = undefined;
      }
      room.status = 'finished';
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

    // Bot turn -> random legal play
    if (currentPlayer.type === 'bot') {
      room.botTimer = setTimeout(() => {
        if (!room.gameState || room.gameState.phase !== 'playing') return;
        if (room.gameState.currentTurnPlayerId !== currentPlayer.id) return;
        const card = chooseRandomLegalCard(room.gameState, currentPlayer.id, this.opts.rng);
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
          ? 15
          : 0;

    if (effectiveSeconds > 0) {
      room.turnDeadlineAt = Date.now() + effectiveSeconds * 1000;
      this.sink.onRoomUpdated(room);

      room.turnTimer = setTimeout(() => {
        this.executeMissedTurnTimeout(room, currentPlayer.id);
      }, effectiveSeconds * 1000);
    }
  }

  public executeMissedTurnTimeout(room: InternalRoom, playerId: string): void {
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

  public requestRematch(
    roomCode: string,
    requesterId: string
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'finished') {
      return { ok: false, error: 'Rematch is only available after a game ends.' };
    }
    const isAuthorized =
      room.hostPlayerId === requesterId ||
      (room.aiHostActive && room.seats.some((s) => s.playerId === requesterId));
    if (!isAuthorized) {
      return { ok: false, error: 'Only the host can start a rematch.' };
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
      readyToStart: this.countAcceptedRematch(votes) >= 2,
    };

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

    // If all human players already voted (e.g. solo host + bots), evaluate immediately
    const anyPending = Object.values(votes).some((v) => v === 'pending');
    if (!anyPending && room.aiHostActive) {
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
    if (!room || !room.rematch) {
      return { ok: false, error: 'No active rematch invitation.' };
    }
    if (!(playerId in room.rematch.votes)) {
      return { ok: false, error: 'You are not part of this rematch.' };
    }

    const seat = room.seats.find((s) => s.playerId === playerId);
    room.rematch.votes[playerId] = accept ? 'accepted' : 'declined';
    room.rematch.readyToStart = this.countAcceptedRematch(room.rematch.votes) >= 2;

    this.emitNote(
      room,
      accept ? 'success' : 'info',
      `${seat?.name ?? 'Player'} ${accept ? 'accepted' : 'declined'} the rematch.`
    );
    this.sink.onRoomUpdated(room);

    const anyPending = Object.values(room.rematch.votes).some((v) => v === 'pending');
    if (!anyPending && room.aiHostActive) {
      this.finalizeRematchWindow(room);
    }

    return { ok: true };
  }

  public startAcceptedRematch(
    roomCode: string,
    requesterId: string
  ): { ok: true } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode);
    if (!room || !room.rematch) {
      return { ok: false, error: 'No rematch in progress.' };
    }
    if (!room.aiHostActive && room.hostPlayerId !== requesterId) {
      return { ok: false, error: 'Only the host can start the rematch.' };
    }

    const acceptedSeats = room.seats.filter((s) => room.rematch?.votes[s.playerId] === 'accepted');
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

    // Mark all non-responders as declined
    for (const [pid, vote] of Object.entries(room.rematch.votes)) {
      if (vote === 'pending') {
        room.rematch.votes[pid] = 'declined';
      }
    }

    const acceptedSeats = room.seats.filter((s) => room.rematch?.votes[s.playerId] === 'accepted');
    room.rematch.readyToStart = acceptedSeats.length >= 2;

    if (room.aiHostActive) {
      if (acceptedSeats.length >= 2) {
        this.emitNote(
          room,
          'success',
          `AI Room Host starting rematch with ${acceptedSeats.length} players.`
        );
        this.startGameInternal(room, acceptedSeats);
      } else {
        room.rematch = null;
        this.emitNote(room, 'warning', 'Not enough players accepted the rematch.');
        this.sink.onRoomUpdated(room);
      }
    } else {
      this.emitNote(
        room,
        'info',
        acceptedSeats.length >= 2
          ? `Rematch timer finished — ${acceptedSeats.length} players ready. Host may start now.`
          : 'Rematch timer finished with fewer than 2 accepted players.'
      );
      this.sink.onRoomUpdated(room);
    }
  }

  private countAcceptedRematch(votes: Record<string, RematchState['votes'][string]>): number {
    return Object.values(votes).filter((v) => v === 'accepted').length;
  }
}
