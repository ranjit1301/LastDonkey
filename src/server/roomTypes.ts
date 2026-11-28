import type { Card, DifficultyMode, GameState, PlayerType } from '../engine/index.ts';
import type { PlayerFacialState } from '../lib/facialExpressions.ts';
import type { TurnTimerSeconds } from '../lib/settings.ts';

export type RoomVisibility = 'private' | 'public';
export type RoomStatus = 'waiting' | 'playing' | 'finished' | 'closed';

export interface RoomSeat {
  playerId: string;
  name: string;
  type: PlayerType;
  connected: boolean;
  avatarColor: string;
  botAvatarId?: string;
  joinedAt: number;
}

export interface PendingHostTransfer {
  fromPlayerId: string;
  fromPlayerName: string;
  toPlayerId: string;
  toPlayerName: string;
  requestedAt: number;
}

export type RematchVote = 'pending' | 'accepted' | 'declined';

export interface RematchState {
  initiatedBy: string; // playerId or 'AI_ROOM_HOST'
  expiresAt: number;
  votes: Record<string, RematchVote>; // keyed by playerId
  readyToStart: boolean;
}

export interface RoomNotification {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;
  targetPlayerId?: string; // If omitted, broadcast to entire room
}

export interface PublicRoomSummary {
  roomCode: string;
  tableName: string;
  hostName: string;
  capacity: number;
  playerCount: number;
  availableSeats: number;
  isFull: boolean;
  joinable: boolean;
  status: RoomStatus;
  difficulty: DifficultyMode;
  turnTimerSeconds: TurnTimerSeconds;
  aiHostActive: boolean;
  vacancyExpiresAt: number | null;
}

/**
 * Sanitized player object sent over the wire:
 * Other players' hidden cards are NEVER sent to clients while a game is in progress.
 */
export interface ClientPlayerView {
  id: string;
  name: string;
  type: PlayerType;
  seatIndex: number;
  cardCount: number;
  hand: Card[]; // Populated ONLY for the viewer themselves, OR for Donkey after phase === 'finished'
  finished: boolean;
  finishOrder: number | null;
  removed: boolean;
  connected: boolean;
  consecutiveMissedTurns: number;
  avatarColor: string;
  botAvatarId?: string;
}

export interface ClientGameStateView extends Omit<GameState, 'players'> {
  players: ClientPlayerView[];
  /** Authoritative facial expressions derived from full server trickHistory (zero card-history leakage) */
  playerExpressions?: Record<string, PlayerFacialState>;
}

export interface ClientRoomState {
  roomCode: string;
  tableName: string;
  visibility: RoomVisibility;
  capacity: number;
  status: RoomStatus;
  difficulty: DifficultyMode;
  inviteToken: string | null; // Only sent to players in the room (for sharing)
  hostPlayerId: string | null;
  aiHostActive: boolean;
  suspendedHostId: string | null;
  pendingHostTransfer: PendingHostTransfer | null;
  turnTimerSeconds: TurnTimerSeconds;
  turnDeadlineAt: number | null;
  vacancyExpiresAt: number | null;
  seats: RoomSeat[];
  gameState: ClientGameStateView | null;
  rematch: RematchState | null;
  yourPlayerId: string;
  removedFromOngoingGame: boolean;
  closeReason: string | null;
}

// Client -> Server WebSocket Messages
export type ClientMessage =
  | {
      type: 'create_room';
      playerName: string;
      tableName?: string;
      capacity: number;
      visibility: RoomVisibility;
      turnTimerSeconds?: TurnTimerSeconds;
      difficulty?: DifficultyMode;
    }
  | {
      type: 'join_room';
      roomCode: string;
      playerName: string;
      inviteToken?: string;
    }
  | {
      type: 'reconnect';
      roomCode: string;
      sessionToken: string;
      rejectIfActive?: boolean;
    }
  | { type: 'leave_room' }
  | { type: 'add_bot' }
  | { type: 'remove_seat'; targetPlayerId: string }
  | { type: 'start_game' }
  | { type: 'cancel_room' }
  | { type: 'play_card'; cardId: string }
  | { type: 'voluntary_exit' }
  | { type: 'transfer_host_request'; targetPlayerId: string }
  | { type: 'transfer_host_respond'; accept: boolean }
  | { type: 'revoke_invite' }
  | { type: 'regenerate_code' }
  | { type: 'update_turn_timer'; turnTimerSeconds: TurnTimerSeconds }
  | { type: 'rematch_request' }
  | { type: 'rematch_respond'; accept: boolean }
  | { type: 'rematch_start' }
  | { type: 'ping' };

export type LeaveRoomReason = 'left' | 'voluntary_exit' | 'finished_exit' | 'kicked';

// Server -> Client WebSocket Messages
export type ServerMessage =
  | {
      type: 'session_established';
      playerId: string;
      sessionToken: string;
      roomCode: string;
    }
  | {
      type: 'room_state';
      room: ClientRoomState;
    }
  | {
      type: 'notification';
      notification: RoomNotification;
    }
  | {
      type: 'error';
      message: string;
      code?: string;
    }
  | {
      type: 'left_room';
      roomCode: string;
      reason: LeaveRoomReason;
      message?: string;
    }
  | {
      type: 'room_closed';
      roomCode: string;
      reason: string;
    }
  | {
      type: 'session_superseded';
      roomCode: string;
      message: string;
    }
  | {
      type: 'pong';
    };
