import { WebSocket, type WebSocketServer } from 'ws';
import { RoomManager, type InternalRoom, type RoomManagerOptions } from './roomManager.ts';
import type { ClientMessage, LeaveRoomReason, ServerMessage } from './roomTypes.ts';

export interface SocketMeta {
  ws: WebSocket;
  roomCode: string | null;
  playerId: string | null;
  missedPongs: number;
  createdRoomTimestamps: number[];
  authAttemptTimestamps: number[];
  messageTimestamps: number[];
}

export interface MultiplayerRuntimeOptions {
  roomManagerOptions?: RoomManagerOptions;
  heartbeatIntervalMs?: number; // Default: 25_000ms
  maxMissedPongs?: number; // Default: 2 (~50s tolerance so temporary latency never disconnects players)
  maxRoomCreatesPerMinute?: number; // Default: 6 per socket
  maxAuthAttemptsPerMinute?: number; // Default: 20 join/reconnect attempts per minute per socket
  maxMessagesPer10Seconds?: number; // Default: 80 non-ping messages per 10 seconds per socket
}

export interface MultiplayerRuntime {
  roomManager: RoomManager;
  attach: (wss: WebSocketServer) => void;
  dispose: () => void;
}

function sendMsg(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function createMultiplayerRuntime(
  options: MultiplayerRuntimeOptions = {}
): MultiplayerRuntime {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 25_000;
  const maxMissedPongs = options.maxMissedPongs ?? 2;
  const maxRoomCreatesPerMinute = options.maxRoomCreatesPerMinute ?? 6;
  const maxAuthAttemptsPerMinute = options.maxAuthAttemptsPerMinute ?? 20;
  const maxMessagesPer10Seconds = options.maxMessagesPer10Seconds ?? 80;

  const socketsByPlayer = new Map<string, SocketMeta>();
  const metaBySocket = new WeakMap<WebSocket, SocketMeta>();
  const heartbeatTimers = new Set<ReturnType<typeof setInterval>>();

  const roomManager = new RoomManager(
    {
      onRoomUpdated(room: InternalRoom) {
        // Only broadcast room_state to current seats in the room (removed-after-3-missed-turns
        // players remain in room.seats so they can watch and join rematch; kicked/exited players are detached).
        for (const seat of room.seats) {
          const meta = socketsByPlayer.get(seat.playerId);
          if (meta && meta.roomCode === room.roomCode) {
            sendMsg(meta.ws, {
              type: 'room_state',
              room: roomManager.buildClientView(room, seat.playerId),
            });
          }
        }
      },
      onNotification(room, notification) {
        if (notification.targetPlayerId) {
          const target = socketsByPlayer.get(notification.targetPlayerId);
          if (target && target.roomCode === room.roomCode) {
            sendMsg(target.ws, { type: 'notification', notification });
          }
          return;
        }
        for (const seat of room.seats) {
          const meta = socketsByPlayer.get(seat.playerId);
          if (meta && meta.roomCode === room.roomCode) {
            sendMsg(meta.ws, { type: 'notification', notification });
          }
        }
      },
      onPlayerKicked(roomCode, playerId, reason) {
        const meta = socketsByPlayer.get(playerId);
        if (meta && meta.roomCode === roomCode) {
          socketsByPlayer.delete(playerId);
          meta.roomCode = null;
          meta.playerId = null;
          sendMsg(meta.ws, {
            type: 'left_room',
            roomCode,
            reason: 'kicked',
            message: reason,
          });
        }
      },
      onRoomCodeChanged(oldCode, newCode) {
        for (const sock of socketsByPlayer.values()) {
          if (sock.roomCode === oldCode) {
            sock.roomCode = newCode;
          }
        }
      },
      onPlayerDetached(roomCode, playerId, reason) {
        const meta = socketsByPlayer.get(playerId);
        if (meta && meta.roomCode === roomCode) {
          socketsByPlayer.delete(playerId);
          meta.roomCode = null;
          meta.playerId = null;
          sendMsg(meta.ws, {
            type: 'left_room',
            roomCode,
            reason: 'left',
            message: reason,
          });
        }
      },
      onRoomClosed(roomCode, reason, memberPlayerIds) {
        for (const pid of memberPlayerIds) {
          const meta = socketsByPlayer.get(pid);
          if (meta && meta.roomCode === roomCode) {
            socketsByPlayer.delete(pid);
            meta.roomCode = null;
            meta.playerId = null;
            sendMsg(meta.ws, { type: 'room_closed', roomCode, reason });
          }
        }
      },
    },
    options.roomManagerOptions
  );

  function attach(wss: WebSocketServer): void {
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    if (heartbeatIntervalMs > 0) {
      heartbeatTimer = setInterval(() => {
        for (const clientWs of wss.clients) {
          const clientMeta = metaBySocket.get(clientWs);
          if (!clientMeta || clientWs.readyState !== WebSocket.OPEN) continue;

          if (clientMeta.missedPongs >= maxMissedPongs) {
            clientWs.terminate();
            continue;
          }

          clientMeta.missedPongs += 1;
          try {
            clientWs.ping();
          } catch {
            clientWs.terminate();
          }
        }
      }, heartbeatIntervalMs);

      if (typeof heartbeatTimer.unref === 'function') {
        heartbeatTimer.unref();
      }
      heartbeatTimers.add(heartbeatTimer);
    }

    wss.on('close', () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimers.delete(heartbeatTimer);
        heartbeatTimer = null;
      }
    });

    wss.on('connection', (ws) => {
      const meta: SocketMeta = {
        ws,
        roomCode: null,
        playerId: null,
        missedPongs: 0,
        createdRoomTimestamps: [],
        authAttemptTimestamps: [],
        messageTimestamps: [],
      };
      metaBySocket.set(ws, meta);

      ws.on('pong', () => {
        meta.missedPongs = 0;
      });

      ws.on('message', (raw) => {
        // Any inbound message proves the connection is alive
        meta.missedPongs = 0;

        let msg: ClientMessage;
        try {
          const text = typeof raw === 'string' ? raw : raw.toString('utf8');
          if (text.length > 8192) {
            sendMsg(ws, { type: 'error', message: 'Message too large.' });
            return;
          }
          msg = JSON.parse(text) as ClientMessage;
        } catch {
          sendMsg(ws, { type: 'error', message: 'Invalid message format.' });
          return;
        }

        if (!msg || typeof msg.type !== 'string') {
          sendMsg(ws, { type: 'error', message: 'Missing message type.' });
          return;
        }

        const fail = (error: string, code?: string) =>
          sendMsg(ws, { type: 'error', message: error, code });

        // Per-socket sliding-window message flood protection (exclude lightweight heartbeat pings)
        if (msg.type !== 'ping' && maxMessagesPer10Seconds > 0) {
          const now = Date.now();
          meta.messageTimestamps = meta.messageTimestamps.filter((ts) => now - ts < 10_000);
          if (meta.messageTimestamps.length >= maxMessagesPer10Seconds) {
            return fail('Too many requests in a short time. Please slow down.', 'RATE_LIMITED');
          }
          meta.messageTimestamps.push(now);
        }

        const consumeAuthAttempt = (): boolean => {
          if (maxAuthAttemptsPerMinute <= 0) return true;
          const now = Date.now();
          meta.authAttemptTimestamps = meta.authAttemptTimestamps.filter((ts) => now - ts < 60_000);
          if (meta.authAttemptTimestamps.length >= maxAuthAttemptsPerMinute) {
            fail('Too many join or reconnect attempts. Please wait a moment.', 'RATE_LIMITED');
            return false;
          }
          meta.authAttemptTimestamps.push(now);
          return true;
        };

        switch (msg.type) {
          case 'ping': {
            sendMsg(ws, { type: 'pong' });
            break;
          }

          case 'create_room': {
            if (meta.roomCode && meta.playerId) {
              return fail('Please leave your current room before creating a new one.');
            }
            const now = Date.now();
            meta.createdRoomTimestamps = meta.createdRoomTimestamps.filter(
              (ts) => now - ts < 60_000
            );
            if (meta.createdRoomTimestamps.length >= maxRoomCreatesPerMinute) {
              return fail('Too many rooms created recently. Please wait a moment.');
            }

            const res = roomManager.createRoom({
              playerName: String(msg.playerName ?? ''),
              tableName: msg.tableName ? String(msg.tableName) : undefined,
              capacity: Number(msg.capacity),
              visibility: msg.visibility === 'public' ? 'public' : 'private',
              turnTimerSeconds: msg.turnTimerSeconds,
              difficulty: msg.difficulty,
              avatarId: msg.avatarId ? String(msg.avatarId) : undefined,
              savedAvatarId: msg.savedAvatarId ? String(msg.savedAvatarId) : undefined,
            });
            if (!res.ok) return fail(res.error);

            meta.createdRoomTimestamps.push(now);
            meta.roomCode = res.room.roomCode;
            meta.playerId = res.playerId;
            socketsByPlayer.set(res.playerId, meta);

            sendMsg(ws, {
              type: 'session_established',
              playerId: res.playerId,
              sessionToken: res.sessionToken,
              roomCode: res.room.roomCode,
            });
            sendMsg(ws, {
              type: 'room_state',
              room: roomManager.buildClientView(res.room, res.playerId),
            });
            break;
          }

          case 'join_room': {
            if (meta.roomCode && meta.playerId) {
              return fail('Please leave your current room before joining another.');
            }
            if (!consumeAuthAttempt()) return;
            const res = roomManager.joinRoom({
              roomCode: String(msg.roomCode ?? ''),
              playerName: String(msg.playerName ?? ''),
              inviteToken: msg.inviteToken ? String(msg.inviteToken) : undefined,
              avatarId: msg.avatarId ? String(msg.avatarId) : undefined,
              savedAvatarId: msg.savedAvatarId ? String(msg.savedAvatarId) : undefined,
            });
            if (!res.ok) return fail(res.error);

            meta.roomCode = res.room.roomCode;
            meta.playerId = res.playerId;
            socketsByPlayer.set(res.playerId, meta);

            sendMsg(ws, {
              type: 'session_established',
              playerId: res.playerId,
              sessionToken: res.sessionToken,
              roomCode: res.room.roomCode,
            });
            sendMsg(ws, {
              type: 'room_state',
              room: roomManager.buildClientView(res.room, res.playerId),
            });
            break;
          }

          case 'reconnect': {
            if (!consumeAuthAttempt()) return;
            const roomCodeStr = String(msg.roomCode ?? '');
            const tokenStr = String(msg.sessionToken ?? '');

            const preCheck = roomManager.validateSessionToken(roomCodeStr, tokenStr);
            if (!preCheck.ok) return fail(preCheck.error, preCheck.code);

            // Prevent an already-bound socket from silently rebinding onto another player's seat
            if (meta.roomCode && meta.playerId && meta.playerId !== preCheck.playerId) {
              return fail('Please leave your current room before switching to another session.');
            }

            if (msg.rejectIfActive) {
              const activeExisting = socketsByPlayer.get(preCheck.playerId);
              if (
                activeExisting &&
                activeExisting.ws !== ws &&
                activeExisting.ws.readyState === WebSocket.OPEN
              ) {
                return fail(
                  'This seat is already active in another tab or window.',
                  'SESSION_ACTIVE_ELSEWHERE'
                );
              }
            }

            const res = roomManager.reconnectPlayer(roomCodeStr, tokenStr);
            if (!res.ok) return fail(res.error, res.code);

            // Replace any previous socket for the same playerId cleanly and notify it before closing
            const existing = socketsByPlayer.get(res.playerId);
            if (existing && existing.ws !== ws) {
              existing.roomCode = null;
              existing.playerId = null;
              try {
                sendMsg(existing.ws, {
                  type: 'session_superseded',
                  roomCode: res.room.roomCode,
                  message: 'This game session was opened in another tab or window.',
                });
                existing.ws.close(4001, 'Session resumed on a newer connection');
              } catch {
                // ignore already-closing socket
              }
            }

            meta.roomCode = res.room.roomCode;
            meta.playerId = res.playerId;
            socketsByPlayer.set(res.playerId, meta);

            sendMsg(ws, {
              type: 'room_state',
              room: roomManager.buildClientView(res.room, res.playerId),
            });
            if (res.removedFromOngoingGame) {
              sendMsg(ws, {
                type: 'notification',
                notification: {
                  id: `rem-${Date.now()}`,
                  kind: 'warning',
                  message:
                    'You were removed after 3 missed turns and cannot rejoin this ongoing game. You may join the next game.',
                  timestamp: Date.now(),
                },
              });
            }
            break;
          }

          case 'leave_room': {
            if (!meta.roomCode || !meta.playerId) {
              sendMsg(ws, { type: 'left_room', roomCode: '', reason: 'left' });
              return;
            }
            const leavingCode = meta.roomCode;
            const leavingPlayerId = meta.playerId;
            const res = roomManager.leaveRoom(leavingCode, leavingPlayerId);
            if (!res.ok) return fail(res.error);

            const reason: LeaveRoomReason = res.reason ?? 'left';
            const message = res.message;

            socketsByPlayer.delete(leavingPlayerId);
            meta.roomCode = null;
            meta.playerId = null;
            sendMsg(ws, {
              type: 'left_room',
              roomCode: leavingCode,
              reason,
              message,
            });
            break;
          }

          case 'add_bot': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.addBot(meta.roomCode, meta.playerId);
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'remove_seat': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.removeSeat(
              meta.roomCode,
              meta.playerId,
              String(msg.targetPlayerId ?? '')
            );
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'update_avatar': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.updateSeatAvatar(
              meta.roomCode,
              meta.playerId,
              String(msg.avatarId ?? '')
            );
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'start_game': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.startGame(meta.roomCode, meta.playerId);
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'cancel_room': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.cancelRoom(meta.roomCode, meta.playerId);
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'play_card': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.playCardAction(
              meta.roomCode,
              meta.playerId,
              String(msg.cardId ?? '')
            );
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'voluntary_exit': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const exitingCode = meta.roomCode;
            const exitingPlayerId = meta.playerId;
            const res = roomManager.voluntaryExitInGame(exitingCode, exitingPlayerId);
            if (!res.ok) return fail(res.error);

            socketsByPlayer.delete(exitingPlayerId);
            meta.roomCode = null;
            meta.playerId = null;
            sendMsg(ws, {
              type: 'left_room',
              roomCode: exitingCode,
              reason: res.reason,
              message: res.message,
            });
            break;
          }

          case 'transfer_host_request': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.requestHostTransfer(
              meta.roomCode,
              meta.playerId,
              String(msg.targetPlayerId ?? '')
            );
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'transfer_host_respond': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.respondHostTransfer(
              meta.roomCode,
              meta.playerId,
              Boolean(msg.accept)
            );
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'revoke_invite': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.revokeInviteLink(meta.roomCode, meta.playerId);
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'regenerate_code': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.regenerateRoomCode(meta.roomCode, meta.playerId);
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'update_turn_timer': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.updateTurnTimer(
              meta.roomCode,
              meta.playerId,
              msg.turnTimerSeconds
            );
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'rematch_request': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.requestRematch(meta.roomCode, meta.playerId);
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'rematch_respond': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.respondRematch(
              meta.roomCode,
              meta.playerId,
              Boolean(msg.accept)
            );
            if (!res.ok) return fail(res.error);
            break;
          }

          case 'rematch_start': {
            if (!meta.roomCode || !meta.playerId) return fail('Not in a room.');
            const res = roomManager.startAcceptedRematch(meta.roomCode, meta.playerId);
            if (!res.ok) return fail(res.error);
            break;
          }

          default: {
            fail('Unsupported message type.');
            break;
          }
        }
      });

      ws.on('close', () => {
        if (meta.playerId && meta.roomCode) {
          const current = socketsByPlayer.get(meta.playerId);
          if (current?.ws === ws) {
            const closingRoomCode = meta.roomCode;
            const closingPlayerId = meta.playerId;
            socketsByPlayer.delete(closingPlayerId);
            meta.roomCode = null;
            meta.playerId = null;
            roomManager.handleDisconnect(closingRoomCode, closingPlayerId);
          }
        }
      });
    });
  }

  function dispose(): void {
    for (const timer of heartbeatTimers) {
      clearInterval(timer);
    }
    heartbeatTimers.clear();
    socketsByPlayer.clear();
    roomManager.disposeAll();
  }

  return { roomManager, attach, dispose };
}
