import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager, type InternalRoom } from './src/server/roomManager';
import type { ClientMessage, ServerMessage } from './src/server/roomTypes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface SocketMeta {
  ws: WebSocket;
  roomCode: string | null;
  playerId: string | null;
}

const socketsByPlayer = new Map<string, SocketMeta>();

function sendMsg(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const roomManager = new RoomManager({
  onRoomUpdated(room: InternalRoom) {
    for (const seat of room.seats) {
      const meta = socketsByPlayer.get(seat.playerId);
      if (meta && meta.roomCode === room.roomCode) {
        sendMsg(meta.ws, {
          type: 'room_state',
          room: roomManager.buildClientView(room, seat.playerId),
        });
      }
    }
    // Also update any disconnected/removed viewers still attached to this room
    for (const meta of socketsByPlayer.values()) {
      if (
        meta.roomCode === room.roomCode &&
        meta.playerId &&
        !room.seats.some((s) => s.playerId === meta.playerId)
      ) {
        sendMsg(meta.ws, {
          type: 'room_state',
          room: roomManager.buildClientView(room, meta.playerId),
        });
      }
    }
  },
  onNotification(room, notification) {
    if (notification.targetPlayerId) {
      const target = socketsByPlayer.get(notification.targetPlayerId);
      if (target) sendMsg(target.ws, { type: 'notification', notification });
      return;
    }
    for (const seat of room.seats) {
      const meta = socketsByPlayer.get(seat.playerId);
      if (meta && meta.roomCode === room.roomCode) {
        sendMsg(meta.ws, { type: 'notification', notification });
      }
    }
  },
  onRoomClosed(roomCode, reason, memberPlayerIds) {
    for (const pid of memberPlayerIds) {
      const meta = socketsByPlayer.get(pid);
      if (meta && meta.roomCode === roomCode) {
        meta.roomCode = null;
        sendMsg(meta.ws, { type: 'room_closed', roomCode, reason });
      }
    }
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Public Rooms discovery API (never leaks private rooms)
  app.get('/api/rooms/public', (_req, res) => {
    res.json({ rooms: roomManager.getPublicRooms() });
  });

  // Validate room code or invitation link before joining (works even when user isn't logged in)
  app.get('/api/rooms/validate', (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const invite = typeof req.query.invite === 'string' ? req.query.invite : undefined;
    if (!code) {
      res.status(400).json({ ok: false, error: 'Room code is required.' });
      return;
    }
    const result = roomManager.validateRoomAccess(code, invite);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  // Mount Vite middleware in dev, or serve static dist in production
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const meta: SocketMeta = { ws, roomCode: null, playerId: null };

    ws.on('message', (raw) => {
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

      const fail = (error: string) => sendMsg(ws, { type: 'error', message: error });

      switch (msg.type) {
        case 'create_room': {
          const res = roomManager.createRoom({
            playerName: String(msg.playerName ?? ''),
            tableName: msg.tableName ? String(msg.tableName) : undefined,
            capacity: Number(msg.capacity),
            visibility: msg.visibility === 'public' ? 'public' : 'private',
            turnTimerSeconds: msg.turnTimerSeconds,
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

        case 'join_room': {
          const res = roomManager.joinRoom({
            roomCode: String(msg.roomCode ?? ''),
            playerName: String(msg.playerName ?? ''),
            inviteToken: msg.inviteToken ? String(msg.inviteToken) : undefined,
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
          const res = roomManager.reconnectPlayer(
            String(msg.roomCode ?? ''),
            String(msg.sessionToken ?? '')
          );
          if (!res.ok) return fail(res.error);

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
          if (!meta.roomCode || !meta.playerId) return;
          const res = roomManager.leaveRoom(meta.roomCode, meta.playerId);
          if (!res.ok) return fail(res.error);
          socketsByPlayer.delete(meta.playerId);
          meta.roomCode = null;
          meta.playerId = null;
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
          const res = roomManager.voluntaryExitInGame(meta.roomCode, meta.playerId);
          if (!res.ok) return fail(res.error);
          socketsByPlayer.delete(meta.playerId);
          meta.roomCode = null;
          meta.playerId = null;
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
          const oldCode = meta.roomCode;
          const res = roomManager.regenerateRoomCode(oldCode, meta.playerId);
          if (!res.ok) return fail(res.error);
          // Update roomCode reference for all sockets in that room
          for (const sock of socketsByPlayer.values()) {
            if (sock.roomCode === oldCode) {
              sock.roomCode = res.newRoomCode;
            }
          }
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
      }
    });

    ws.on('close', () => {
      if (meta.playerId && meta.roomCode) {
        const current = socketsByPlayer.get(meta.playerId);
        if (current?.ws === ws) {
          roomManager.handleDisconnect(meta.roomCode, meta.playerId);
        }
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Last Donkey (Rang Vapas) server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Last Donkey server:', err);
  process.exit(1);
});
