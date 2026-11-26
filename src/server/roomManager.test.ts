import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { ACE_OF_SPADES_ID } from '../engine';
import { RoomManager, type InternalRoom } from './roomManager';
import { createMultiplayerRuntime } from './wsHandler';
import type { RoomNotification, ServerMessage } from './roomTypes';
import { MultiplayerClient } from '../lib/multiplayerClient';

function createTestManager(overrides = {}) {
  const updates: InternalRoom[] = [];
  const notifications: RoomNotification[] = [];
  const closedRooms: Array<{ roomCode: string; reason: string }> = [];
  const kickedPlayers: Array<{ roomCode: string; playerId: string; reason: string }> = [];
  const manager = new RoomManager(
    {
      onRoomUpdated: (room: InternalRoom) => {
        updates.push(room);
      },
      onNotification: (_room, note) => notifications.push(note),
      onRoomClosed: (roomCode, reason) => closedRooms.push({ roomCode, reason }),
      onPlayerKicked: (roomCode, playerId, reason) =>
        kickedPlayers.push({ roomCode, playerId, reason }),
    },
    {
      publicVacancyTimeoutMs: 60,
      rematchTimeoutMs: 80,
      botDelayMs: 20,
      trickSuccessDelayMs: 20,
      trickFailDelayMs: 20,
      aiAutoStartDelayMs: 30,
      cleanupIntervalMs: 0,
      ...overrides,
    }
  );
  return { manager, updates, notifications, closedRooms, kickedPlayers };
}

let activeManager: RoomManager | null = null;
afterEach(() => {
  activeManager?.disposeAll();
  activeManager = null;
});

describe('RoomManager — Multiplayer Rooms, Invitations, Host Ownership & Rematch', () => {
  it('enforces fixed room capacities (2-6) and blocks 7th player or joining full room', () => {
    const { manager } = createTestManager();
    activeManager = manager;

    assert.equal(
      manager.createRoom({ playerName: 'A', capacity: 7, visibility: 'public' }).ok,
      false
    );

    const created = manager.createRoom({ playerName: 'Host', capacity: 2, visibility: 'public' });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const j2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P2' });
    assert.equal(j2.ok, true);

    const j3 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P3' });
    assert.equal(j3.ok, false);
    if (!j3.ok) assert.match(j3.error, /Room Full/i);
  });

  it('keeps private rooms out of public discovery, supports invite revocation and code regeneration', () => {
    const { manager } = createTestManager();
    activeManager = manager;

    const created = manager.createRoom({ playerName: 'Host', capacity: 3, visibility: 'private' });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.equal(manager.getPublicRooms().length, 0);

    const oldToken = created.room.inviteToken;
    const rev = manager.revokeInviteLink(created.room.roomCode, created.playerId);
    assert.equal(rev.ok, true);
    if (!rev.ok) return;

    // Old invite token must be rejected
    const badJoin = manager.joinRoom({
      roomCode: created.room.roomCode,
      playerName: 'Guest',
      inviteToken: oldToken,
    });
    assert.equal(badJoin.ok, false);
    if (!badJoin.ok) assert.match(badJoin.error, /revoked/i);

    // New invite token works
    const goodJoin = manager.joinRoom({
      roomCode: created.room.roomCode,
      playerName: 'Guest',
      inviteToken: rev.newInviteToken,
    });
    assert.equal(goodJoin.ok, true);

    // Regenerate room code
    const oldCode = created.room.roomCode;
    const regen = manager.regenerateRoomCode(oldCode, created.playerId);
    assert.equal(regen.ok, true);
    if (!regen.ok) return;

    assert.equal(manager.validateRoomAccess(oldCode).ok, false);
    assert.equal(manager.validateRoomAccess(regen.newRoomCode).ok, true);
  });

  it('handles manual host transfer with acceptance and unexpected host disconnect/restoration', () => {
    const { manager, notifications } = createTestManager();
    activeManager = manager;

    const created = manager.createRoom({ playerName: 'Host', capacity: 3, visibility: 'private' });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Ananya' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    // Host requests transfer -> not transferred until accepted
    const req = manager.requestHostTransfer(created.room.roomCode, created.playerId, p2.playerId);
    assert.equal(req.ok, true);
    assert.equal(created.room.hostPlayerId, created.playerId);

    // Target accepts -> ownership transfers
    const acc = manager.respondHostTransfer(created.room.roomCode, p2.playerId, true);
    assert.equal(acc.ok, true);
    assert.equal(created.room.hostPlayerId, p2.playerId);

    // Unexpected disconnect of new host -> AI Room Host takes over temporarily
    manager.handleDisconnect(created.room.roomCode, p2.playerId);
    assert.equal(created.room.aiHostActive, true);
    assert.equal(created.room.suspendedHostId, p2.playerId);

    // Host reconnects -> ownership restored with exact notification
    const rec = manager.reconnectPlayer(created.room.roomCode, p2.sessionToken);
    assert.equal(rec.ok, true);
    assert.equal(created.room.hostPlayerId, p2.playerId);
    assert.equal(created.room.aiHostActive, false);
    assert.ok(
      notifications.some((n) => n.message === "You're back! Host ownership has been restored to you.")
    );
  });

  it('closes public room automatically after vacancy timeout when no replacement joins', async () => {
    const { manager, closedRooms } = createTestManager({ publicVacancyTimeoutMs: 40 });
    activeManager = manager;

    const created = manager.createRoom({ playerName: 'Host', capacity: 3, visibility: 'public' });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Bob' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    // Bob leaves -> vacancy timer starts
    manager.leaveRoom(created.room.roomCode, p2.playerId);
    assert.ok(created.room.vacancyExpiresAt !== null);

    await new Promise((r) => setTimeout(r, 80));
    assert.equal(closedRooms.length, 1);
    assert.equal(closedRooms[0].roomCode, created.room.roomCode);
  });

  it('sanitizes hidden opponent cards in ClientRoomState and supports smaller-group rematch', () => {
    const { manager } = createTestManager();
    activeManager = manager;

    const created = manager.createRoom({ playerName: 'Host', capacity: 3, visibility: 'private' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P2' });
    const p3 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P3' });
    assert.equal(p2.ok && p3.ok, true);
    if (!p2.ok || !p3.ok) return;

    const started = manager.startGame(created.room.roomCode, created.playerId);
    assert.equal(started.ok, true);

    const viewForHost = manager.buildClientView(created.room, created.playerId);
    const hostPlayer = viewForHost.gameState!.players.find((p) => p.id === created.playerId)!;
    const oppPlayer = viewForHost.gameState!.players.find((p) => p.id === p2.playerId)!;

    assert.ok(hostPlayer.hand.length >= 17);
    assert.equal(oppPlayer.hand.length, 0); // Hidden cards strictly stripped!
    assert.ok(oppPlayer.cardCount >= 17);

    // Simulate finished game to test 2-of-3 smaller-group rematch
    created.room.status = 'finished';
    created.room.gameState!.phase = 'finished';

    const rm = manager.requestRematch(created.room.roomCode, created.playerId);
    assert.equal(rm.ok, true);
    assert.equal(manager.respondRematch(created.room.roomCode, p2.playerId, true).ok, true);
    assert.equal(manager.respondRematch(created.room.roomCode, p3.playerId, false).ok, true);

    const startRm = manager.startAcceptedRematch(created.room.roomCode, created.playerId);
    assert.equal(startRm.ok, true);
    assert.equal(created.room.seats.length, 2);
    assert.equal(created.room.status, 'playing');
  });

  it('stores and propagates selected difficulty mode across room summary, client state, and game state', () => {
    const { manager } = createTestManager();
    activeManager = manager;

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 3,
      visibility: 'public',
      difficulty: 'hard',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.equal(created.room.difficulty, 'hard');
    assert.equal(manager.getPublicRooms()[0]?.difficulty, 'hard');

    const addedBot1 = manager.addBot(created.room.roomCode, created.playerId);
    const addedBot2 = manager.addBot(created.room.roomCode, created.playerId);
    assert.equal(addedBot1.ok && addedBot2.ok, true);

    const started = manager.startGame(created.room.roomCode, created.playerId);
    assert.equal(started.ok, true);

    const view = manager.buildClientView(created.room, created.playerId);
    assert.equal(view.difficulty, 'hard');
    assert.equal(view.gameState?.difficulty, 'hard');
  });
});

describe('Phase 1 — RoomManager Reliability, Validation, Cleanup & Edge Cases', () => {
  it('validates turnTimerSeconds authoritatively on createRoom and updateTurnTimer', () => {
    const { manager } = createTestManager();
    activeManager = manager;

    const invalidValues: unknown[] = [0.001, -5, 5, 12, 999, Number.NaN, '15', null, Infinity];
    for (const bad of invalidValues) {
      const res = manager.createRoom({
        playerName: 'Host',
        capacity: 2,
        visibility: 'private',
        turnTimerSeconds: bad,
      });
      assert.equal(res.ok, false, `Expected createRoom to reject ${String(bad)}`);
    }

    const validValues = [0, 10, 15, 20, 30] as const;
    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 2,
      visibility: 'private',
      turnTimerSeconds: 20,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.room.turnTimerSeconds, 20);

    for (const bad of invalidValues) {
      const upd = manager.updateTurnTimer(created.room.roomCode, created.playerId, bad);
      assert.equal(upd.ok, false, `Expected updateTurnTimer to reject ${String(bad)}`);
    }
    for (const good of validValues) {
      const upd = manager.updateTurnTimer(created.room.roomCode, created.playerId, good);
      assert.equal(upd.ok, true);
      assert.equal(created.room.turnTimerSeconds, good);
    }
  });

  it('prevents duplicate player names (case-insensitive & whitespace-normalized) within the same room', () => {
    const { manager } = createTestManager();
    activeManager = manager;

    const created = manager.createRoom({
      playerName: '  Alex  ',
      capacity: 4,
      visibility: 'private',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.room.seats[0].name, 'Alex');

    const dup1 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'alex' });
    assert.equal(dup1.ok, false);
    if (!dup1.ok) assert.match(dup1.error, /already taken/i);

    const dup2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: '  ALEX ' });
    assert.equal(dup2.ok, false);

    // Distinct name succeeds
    const ok2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'bot raju' });
    assert.equal(ok2.ok, true);

    // Adding a bot skips 'Bot Raju' because a human already took it case-insensitively
    const bot = manager.addBot(created.room.roomCode, created.playerId);
    assert.equal(bot.ok, true);
    const botSeat = created.room.seats.find((s) => s.type === 'bot');
    assert.ok(botSeat);
    assert.notEqual(botSeat.name.toLowerCase(), 'bot raju');

    // Blank fallback name avoids collision cleanly
    const blank = manager.joinRoom({ roomCode: created.room.roomCode, playerName: '   ' });
    assert.equal(blank.ok, true);
  });

  it('triggers AI Room Host auto-start when host disconnects from a full waiting room, and cancels if host reconnects in time', async () => {
    const { manager } = createTestManager({ aiAutoStartDelayMs: 35 });
    activeManager = manager;

    const created = manager.createRoom({ playerName: 'Host', capacity: 2, visibility: 'private' });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Riya' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    // Host drops while room is full -> if host reconnects before delay, game does NOT auto-start
    manager.handleDisconnect(created.room.roomCode, created.playerId);
    assert.equal(created.room.aiHostActive, true);
    const restored = manager.reconnectPlayer(created.room.roomCode, created.sessionToken);
    assert.equal(restored.ok, true);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(created.room.status, 'waiting');
    assert.equal(created.room.hostPlayerId, created.playerId);

    // Now host drops again and stays disconnected -> AI Room Host auto-starts the full room!
    manager.handleDisconnect(created.room.roomCode, created.playerId);
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(created.room.status, 'playing');
    assert.ok(created.room.gameState !== null);
  });

  it('does NOT auto-start a full waiting room when zero human players remain connected', async () => {
    const { manager } = createTestManager({ aiAutoStartDelayMs: 25 });
    activeManager = manager;

    const created = manager.createRoom({ playerName: 'Host', capacity: 2, visibility: 'private' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(manager.addBot(created.room.roomCode, created.playerId).ok, true);

    // Only human disconnects -> 0 connected humans -> should NOT start ghost game
    manager.handleDisconnect(created.room.roomCode, created.playerId);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(created.room.status, 'waiting');
  });

  it('keeps removed players out of the ongoing game on reconnect, yet makes them eligible for rematch', () => {
    const { manager } = createTestManager();
    activeManager = manager;

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Kiran' });
    const p3 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Meera' });
    assert.equal(p2.ok && p3.ok, true);
    if (!p2.ok || !p3.ok) return;

    assert.equal(manager.startGame(created.room.roomCode, created.playerId).ok, true);

    // Force Kiran's turn to time out 3 times until removed
    const room = created.room;
    const gs = room.gameState!;
    const kiran = gs.players.find((p) => p.id === p2.playerId)!;
    // Set Kiran as current turn with 2 prior misses so next timeout removes Kiran cleanly
    gs.currentTurnPlayerId = kiran.id;
    gs.isFirstTurnOfGame = false;
    kiran.consecutiveMissedTurns = 2;

    manager.executeMissedTurnTimeout(room, kiran.id);
    assert.equal(room.removedPlayerIds.has(kiran.id), true);
    assert.equal(room.seats.find((s) => s.playerId === kiran.id)?.connected, false);

    // Kiran reconnects while game is still ongoing
    const rec = manager.reconnectPlayer(room.roomCode, p2.sessionToken);
    assert.equal(rec.ok, true);
    if (!rec.ok) return;
    assert.equal(rec.removedFromOngoingGame, true);
    // Still blocked from playing in ongoing game
    const tryPlay = manager.playCardAction(room.roomCode, kiran.id, 'S-2');
    assert.equal(tryPlay.ok, false);
    // Seat is now marked connected so Kiran is eligible for rematch!
    assert.equal(room.seats.find((s) => s.playerId === kiran.id)?.connected, true);

    // Game finishes -> Host initiates rematch -> Kiran must be 'pending' (NOT auto-declined!)
    room.status = 'finished';
    room.gameState!.phase = 'finished';
    const rm = manager.requestRematch(room.roomCode, created.playerId);
    assert.equal(rm.ok, true);
    assert.equal(room.rematch?.votes[kiran.id], 'pending');

    // Kiran accepts rematch and joins the next game
    assert.equal(manager.respondRematch(room.roomCode, kiran.id, true).ok, true);
    assert.equal(manager.startAcceptedRematch(room.roomCode, created.playerId).ok, true);
    assert.equal(room.status, 'playing');
    assert.ok(room.seats.some((s) => s.playerId === kiran.id));
    assert.equal(room.removedPlayerIds.has(kiran.id), false);
  });

  it('allows an officially finished player to exit mid-trick without affecting remaining players or game state', () => {
    const { manager } = createTestManager();
    activeManager = manager;

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Dev' });
    const p3 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Nia' });
    assert.equal(p2.ok && p3.ok, true);
    if (!p2.ok || !p3.ok) return;

    assert.equal(manager.startGame(created.room.roomCode, created.playerId).ok, true);
    const room = created.room;
    const gs = room.gameState!;

    // Mark Host as officially finished (0 cards, finished: true, finishOrder: 1) while Dev & Nia are mid-trick
    const hostPlayer = gs.players.find((p) => p.id === created.playerId)!;
    const devPlayer = gs.players.find((p) => p.id === p2.playerId)!;
    const niaPlayer = gs.players.find((p) => p.id === p3.playerId)!;

    hostPlayer.hand = [];
    hostPlayer.finished = true;
    hostPlayer.finishOrder = 1;
    gs.finishOrder = [hostPlayer.id];
    gs.isFirstTurnOfGame = false;
    const devLedCard = devPlayer.hand.pop()!;
    gs.currentTrick = {
      trickNumber: 5,
      ledSuit: devLedCard.suit,
      expectedPlayerIds: [devPlayer.id, niaPlayer.id],
      plays: [{ playerId: devPlayer.id, card: devLedCard, order: 0 }],
    };
    gs.currentTurnPlayerId = niaPlayer.id;

    const devCountBefore = devPlayer.hand.length;
    const niaCountBefore = niaPlayer.hand.length;

    // Active player (Nia) is still blocked mid-trick
    const activeBlocked = manager.voluntaryExitInGame(room.roomCode, niaPlayer.id);
    assert.equal(activeBlocked.ok, false);

    // Officially finished Host CAN exit immediately even mid-trick
    const finishedExit = manager.voluntaryExitInGame(room.roomCode, hostPlayer.id);
    assert.equal(finishedExit.ok, true);
    if (!finishedExit.ok) return;
    assert.equal(finishedExit.reason, 'finished_exit');

    // Remaining game state is completely preserved
    assert.equal(room.status, 'playing');
    assert.equal(room.gameState!.currentTurnPlayerId, niaPlayer.id);
    assert.equal(room.gameState!.currentTrick.plays.length, 1);
    assert.equal(
      room.gameState!.players.find((p) => p.id === devPlayer.id)!.hand.length,
      devCountBefore
    );
    assert.equal(
      room.gameState!.players.find((p) => p.id === niaPlayer.id)!.hand.length,
      niaCountBefore
    );
    // Host's finishing status is preserved and AI Room Host took over room management
    const hostAfter = room.gameState!.players.find((p) => p.id === hostPlayer.id)!;
    assert.equal(hostAfter.finished, true);
    assert.equal(hostAfter.finishOrder, 1);
    assert.equal(room.aiHostActive, true);
    // Token revoked & seat detached
    assert.equal(manager.reconnectPlayer(room.roomCode, created.sessionToken).ok, false);
  });

  it('enforces maxActiveRooms and cleans up abandoned, idle, and completed rooms without ever removing active games', () => {
    const { manager } = createTestManager({
      maxActiveRooms: 3,
      abandonedWaitingTimeoutMs: 1_000,
      idleWaitingTimeoutMs: 5_000,
      finishedRoomTimeoutMs: 2_000,
    });
    activeManager = manager;

    // Room 1: Abandoned waiting room (0 connected humans)
    const r1 = manager.createRoom({ playerName: 'A', capacity: 2, visibility: 'private' });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    manager.handleDisconnect(r1.room.roomCode, r1.playerId);

    // Room 2: Active playing game (MUST NEVER be removed by cleanup!)
    const r2 = manager.createRoom({ playerName: 'B', capacity: 2, visibility: 'private' });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(manager.addBot(r2.room.roomCode, r2.playerId).ok, true);
    assert.equal(manager.startGame(r2.room.roomCode, r2.playerId).ok, true);

    // Room 3: Finished room
    const r3 = manager.createRoom({ playerName: 'C', capacity: 2, visibility: 'private' });
    assert.equal(r3.ok, true);
    if (!r3.ok) return;
    r3.room.status = 'finished';
    r3.room.finishedAt = r3.room.lastActivityAt;

    // At capacity (3/3): creating a 4th room fails before rooms expire
    const blocked = manager.createRoom({ playerName: 'D', capacity: 2, visibility: 'private' });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /capacity/i);

    // Advance virtual time past all timeouts -> R1 (abandoned) and R3 (finished) cleaned up, R2 (playing) untouched!
    const future = Date.now() + 60_000;
    const cleaned = manager.cleanupStaleRooms(future);
    assert.equal(cleaned, 2);
    assert.equal(manager.getRoom(r1.room.roomCode), undefined);
    assert.equal(manager.getRoom(r3.room.roomCode), undefined);
    assert.ok(manager.getRoom(r2.room.roomCode), 'Active playing room must never be removed');
    assert.equal(manager.getRoomCount(), 1);
  });

  it('invokes onPlayerKicked and revokes session token when host kicks a player from lobby', () => {
    const { manager, kickedPlayers } = createTestManager();
    activeManager = manager;

    const created = manager.createRoom({ playerName: 'Host', capacity: 3, visibility: 'private' });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Guest' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    const kick = manager.removeSeat(created.room.roomCode, created.playerId, p2.playerId);
    assert.equal(kick.ok, true);
    assert.equal(kickedPlayers.length, 1);
    assert.equal(kickedPlayers[0].playerId, p2.playerId);

    // Kicked player's session token is immediately invalidated
    const reconn = manager.reconnectPlayer(created.room.roomCode, p2.sessionToken);
    assert.equal(reconn.ok, false);
  });
});

// ============================================================================
// REAL WEBSOCKET INTEGRATION TESTS (Handshake, Kick Ejection, Exit Ack, Heartbeat)
// ============================================================================

interface WsTestClient {
  ws: WebSocket;
  messages: ServerMessage[];
  send: (payload: object) => void;
  waitFor: <T extends ServerMessage['type']>(
    type: T,
    predicate?: (msg: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs?: number
  ) => Promise<Extract<ServerMessage, { type: T }>>;
  close: () => Promise<void>;
}

async function openWsClient(url: string): Promise<WsTestClient> {
  const ws = new WebSocket(url);
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    type: ServerMessage['type'];
    predicate?: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
  }> = [];

  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString('utf8')) as ServerMessage;
    messages.push(parsed);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w.type === parsed.type && (!w.predicate || w.predicate(parsed))) {
        waiters.splice(i, 1);
        w.resolve(parsed);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  return {
    ws,
    messages,
    send: (payload) => ws.send(JSON.stringify(payload)),
    waitFor: <T extends ServerMessage['type']>(
      type: T,
      predicate?: (msg: Extract<ServerMessage, { type: T }>) => boolean,
      timeoutMs = 2000
    ) => {
      const existing = messages.find(
        (m): m is Extract<ServerMessage, { type: T }> =>
          m.type === type && (!predicate || predicate(m as Extract<ServerMessage, { type: T }>))
      );
      if (existing) return Promise.resolve(existing);
      return new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for WS message type "${type}"`)),
          timeoutMs
        );
        waiters.push({
          type,
          predicate: predicate as ((msg: ServerMessage) => boolean) | undefined,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg as Extract<ServerMessage, { type: T }>);
          },
        });
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once('close', () => resolve());
        ws.close();
      }),
  };
}

describe('Phase 1 — End-to-End WebSocket Reliability (Reconnect, Kick, Exit Ack, Heartbeat)', () => {
  it('restores seat via reconnect without duplicating seats, exposes zero tokens to peers, and ejects kicked lobby players', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0 },
      heartbeatIntervalMs: 0,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const c1 = await openWsClient(wsUrl);
    const c2 = await openWsClient(wsUrl);
    let c1Refreshed: WsTestClient | null = null;

    try {
      // Host creates room
      c1.send({
        type: 'create_room',
        playerName: 'Host',
        capacity: 3,
        visibility: 'private',
        turnTimerSeconds: 15,
      });
      const sess1 = await c1.waitFor('session_established');
      await c1.waitFor('room_state');

      // Peer joins room
      c2.send({ type: 'join_room', roomCode: sess1.roomCode, playerName: 'Guest' });
      const sess2 = await c2.waitFor('session_established');
      const peerState = await c2.waitFor('room_state');

      // Security check: Host's sessionToken is NEVER leaked to peer's ClientRoomState
      assert.equal(JSON.stringify(peerState.room).includes(sess1.sessionToken), false);

      // Simulate browser refresh for Host on a brand-new WebSocket using stored roomCode + sessionToken
      c1Refreshed = await openWsClient(wsUrl);
      c1Refreshed.send({
        type: 'reconnect',
        roomCode: sess1.roomCode,
        sessionToken: sess1.sessionToken,
      });
      const restored = await c1Refreshed.waitFor('room_state');
      assert.equal(restored.room.yourPlayerId, sess1.playerId);
      assert.equal(restored.room.seats.length, 2); // No duplicate seat!
      assert.equal(restored.room.hostPlayerId, sess1.playerId);

      // Host kicks Guest from lobby -> Guest must immediately receive left_room (reason: 'kicked')
      c1Refreshed.send({ type: 'remove_seat', targetPlayerId: sess2.playerId });
      const kickedMsg = await c2.waitFor('left_room');
      assert.equal(kickedMsg.reason, 'kicked');

      // Guest is detached and receives NO further room_state updates when host adds a bot
      const countBefore = c2.messages.filter((m) => m.type === 'room_state').length;
      c1Refreshed.send({ type: 'add_bot' });
      await c1Refreshed.waitFor('room_state', (m) => m.room.seats.some((s) => s.type === 'bot'));
      await new Promise((r) => setTimeout(r, 30));
      const countAfter = c2.messages.filter((m) => m.type === 'room_state').length;
      assert.equal(countAfter, countBefore);
    } finally {
      await c1.close();
      await c2.close();
      if (c1Refreshed) await c1Refreshed.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('requires server acknowledgement for voluntary_exit: rejects mid-trick without disconnecting, acknowledges between tricks', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0, botDelayMs: 5000 },
      heartbeatIntervalMs: 0,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const c1 = await openWsClient(wsUrl);
    const c2 = await openWsClient(wsUrl);

    try {
      c1.send({
        type: 'create_room',
        playerName: 'Host',
        capacity: 2,
        visibility: 'private',
        turnTimerSeconds: 0,
      });
      const sess1 = await c1.waitFor('session_established');
      await c1.waitFor('room_state');

      c2.send({ type: 'join_room', roomCode: sess1.roomCode, playerName: 'Peer' });
      const sess2 = await c2.waitFor('session_established');
      await c2.waitFor('room_state');

      c1.send({ type: 'start_game' });
      const state1 = await c1.waitFor('room_state', (m) => m.room.status === 'playing');
      const leaderId = state1.room.gameState!.currentTurnPlayerId!;
      const leaderClient = leaderId === sess1.playerId ? c1 : c2;
      const otherClient = leaderId === sess1.playerId ? c2 : c1;

      // Leader plays A♠ so we are now mid-trick
      leaderClient.send({ type: 'play_card', cardId: ACE_OF_SPADES_ID });
      await otherClient.waitFor(
        'room_state',
        (m) => (m.room.gameState?.currentTrick.plays.length ?? 0) === 1
      );

      // Mid-trick voluntary_exit MUST be rejected with error and MUST NOT emit left_room
      otherClient.send({ type: 'voluntary_exit' });
      const errMsg = await otherClient.waitFor('error');
      assert.match(errMsg.message, /mid-trick/i);
      assert.equal(otherClient.messages.some((m) => m.type === 'left_room'), false);

      // Simulate between-tricks state and send voluntary_exit -> receives left_room ack!
      const internalRoom = runtime.roomManager.getRoom(sess1.roomCode)!;
      internalRoom.gameState!.currentTrick.plays = [];
      otherClient.send({ type: 'voluntary_exit' });
      const ack = await otherClient.waitFor('left_room');
      assert.equal(ack.reason, 'voluntary_exit');
    } finally {
      await c1.close();
      await c2.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('maintains healthy sockets with ping/pong heartbeat and terminates stale sockets only after missing 2 consecutive pongs', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0 },
      heartbeatIntervalMs: 40,
      maxMissedPongs: 2,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const healthy = await openWsClient(wsUrl);
    // Stale client that suppresses automatic pong frames to simulate dead mobile TCP connection
    const stale = new WebSocket(wsUrl, { autoPong: false });
    await new Promise<void>((resolve) => stale.once('open', () => resolve()));

    try {
      // App-level ping/pong works too
      healthy.send({ type: 'ping' });
      await healthy.waitFor('pong');

      // Track when stale socket closes: must NOT close on the very first missed ping (40ms),
      // and MUST terminate after missing 2 consecutive pongs (~120ms-200ms).
      const start = Date.now();
      let staleClosedAt = 0;
      const staleClosePromise = new Promise<void>((resolve) => {
        stale.once('close', () => {
          staleClosedAt = Date.now() - start;
          resolve();
        });
      });

      await staleClosePromise;
      assert.ok(staleClosedAt >= 75, `Stale socket closed too early (${staleClosedAt}ms)`);
      assert.equal(healthy.ws.readyState, WebSocket.OPEN);
    } finally {
      await healthy.close();
      stale.terminate();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('MultiplayerClient persists session in sessionStorage for refresh recovery and never queues stale play_card across disconnect', () => {
    const storageMap = new Map<string, string>();
    const sentFrames: string[] = [];

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = FakeWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onclose: ((ev: { code: number }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        FakeWebSocket.instances.push(this);
      }
      send(data: string) {
        sentFrames.push(data);
      }
      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.({ code: 1000 });
      }
      static instances: FakeWebSocket[] = [];
    }

    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevWS = (globalThis as Record<string, unknown>).WebSocket;
    (globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;
    (globalThis as Record<string, unknown>).window = {
      location: { protocol: 'http:', host: 'localhost:3000' },
      sessionStorage: {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => storageMap.set(k, v),
        removeItem: (k: string) => storageMap.delete(k),
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    };

    try {
      const errors: string[] = [];
      const leftReasons: string[] = [];
      const client1 = new MultiplayerClient({
        onRoomState: () => {},
        onNotification: () => {},
        onError: (m) => errors.push(m),
        onLeftRoom: (r) => leftReasons.push(r),
        onRoomClosed: () => {},
        onSessionExpired: () => {},
        onConnectionChange: () => {},
      });

      client1.connect();
      const ws1 = FakeWebSocket.instances[0];
      ws1.onopen?.();
      ws1.onmessage?.({
        data: JSON.stringify({
          type: 'session_established',
          playerId: 'u_1',
          sessionToken: 'tok_secret_123',
          roomCode: 'ABC123',
        }),
      });

      assert.equal(client1.hasStoredSession(), true);
      // Simulate page refresh unmount preserving sessionStorage
      client1.disconnect({ preserveStoredSession: true });
      assert.equal(client1.hasStoredSession(), true);

      // New client after refresh restores session automatically
      const client2 = new MultiplayerClient({
        onRoomState: () => {},
        onNotification: () => {},
        onError: (m) => errors.push(m),
        onLeftRoom: (r) => leftReasons.push(r),
        onRoomClosed: () => {},
        onSessionExpired: () => {},
        onConnectionChange: () => {},
      });
      assert.equal(client2.restoreSession(), true);
      const ws2 = FakeWebSocket.instances[1];
      ws2.readyState = FakeWebSocket.CONNECTING;

      // Attempting play_card while connecting/disconnected must NOT be queued
      client2.send({ type: 'play_card', cardId: 'S-14' });
      assert.ok(errors.some((e) => /Reconnecting/i.test(e)));

      ws2.readyState = FakeWebSocket.OPEN;
      ws2.onopen?.();
      const parsedSent = sentFrames.map((f) => JSON.parse(f) as { type: string; roomCode?: string });
      assert.equal(
        parsedSent.some((m) => m.type === 'reconnect' && m.roomCode === 'ABC123'),
        true
      );
      assert.equal(
        parsedSent.some((m) => m.type === 'play_card'),
        false
      );

      // Receiving left_room clears sessionStorage completely
      ws2.onmessage?.({
        data: JSON.stringify({ type: 'left_room', roomCode: 'ABC123', reason: 'kicked' }),
      });
      assert.equal(client2.hasStoredSession(), false);
      assert.deepEqual(leftReasons, ['kicked']);
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).WebSocket = prevWS;
    }
  });
});

// ============================================================================
// PHASE 3 BATCH 1 — CRITICAL SERVER LIFECYCLE & REMATCH FIXES
// (AUD-001, AUD-002, AUD-003, AUD-004, AUD-005, AUD-013)
// ============================================================================

describe('Phase 3 Batch 1 — AUD-001: Room Code Regeneration Broadcast & Session Recovery', () => {
  it('synchronizes socket metadata before broadcast so host & guest receive new room_state, notification, and reconnect works', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0 },
      heartbeatIntervalMs: 0,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const hostWs = await openWsClient(wsUrl);
    const guestWs = await openWsClient(wsUrl);
    let guestReconnected: WsTestClient | null = null;

    try {
      hostWs.send({
        type: 'create_room',
        playerName: 'Host',
        capacity: 3,
        visibility: 'private',
        turnTimerSeconds: 15,
      });
      const hostSess = await hostWs.waitFor('session_established');
      await hostWs.waitFor('room_state');
      const oldCode = hostSess.roomCode;

      guestWs.send({ type: 'join_room', roomCode: oldCode, playerName: 'Guest' });
      const guestSess = await guestWs.waitFor('session_established');
      await guestWs.waitFor('room_state');

      // Host regenerates room code
      hostWs.send({ type: 'regenerate_code' });

      const hostUpdated = await hostWs.waitFor(
        'room_state',
        (m) => m.room.roomCode !== oldCode
      );
      const newCode = hostUpdated.room.roomCode;
      assert.notEqual(newCode, oldCode);

      // Both host and guest MUST receive updated room_state and notification with newCode
      const guestUpdated = await guestWs.waitFor(
        'room_state',
        (m) => m.room.roomCode === newCode
      );
      assert.equal(guestUpdated.room.roomCode, newCode);

      const hostNote = await hostWs.waitFor(
        'notification',
        (m) => m.notification.message.includes(newCode)
      );
      const guestNote = await guestWs.waitFor(
        'notification',
        (m) => m.notification.message.includes(newCode)
      );
      assert.ok(hostNote.notification.message.includes(newCode));
      assert.ok(guestNote.notification.message.includes(newCode));

      // Old room code is no longer valid
      assert.equal(runtime.roomManager.validateRoomAccess(oldCode).ok, false);
      assert.equal(runtime.roomManager.validateRoomAccess(newCode).ok, true);

      // Post-regeneration actions use synchronized socket metadata seamlessly
      hostWs.send({ type: 'add_bot' });
      const guestBotUpdate = await guestWs.waitFor(
        'room_state',
        (m) => m.room.roomCode === newCode && m.room.seats.some((s) => s.type === 'bot')
      );
      assert.equal(guestBotUpdate.room.seats.length, 3);

      // Reconnecting after refresh with newCode + original sessionToken restores guest's seat
      guestReconnected = await openWsClient(wsUrl);
      guestReconnected.send({
        type: 'reconnect',
        roomCode: newCode,
        sessionToken: guestSess.sessionToken,
      });
      const restored = await guestReconnected.waitFor(
        'room_state',
        (m) => m.room.roomCode === newCode
      );
      assert.equal(restored.room.yourPlayerId, guestSess.playerId);
      assert.equal(restored.room.seats.length, 3);

      // Reconnecting with the old room code is rejected
      const staleCheck = runtime.roomManager.reconnectPlayer(oldCode, guestSess.sessionToken);
      assert.equal(staleCheck.ok, false);
    } finally {
      await hostWs.close();
      await guestWs.close();
      if (guestReconnected) await guestReconnected.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('MultiplayerClient updates sessionStorage to the regenerated room code upon receiving room_state', () => {
    const storageMap = new Map<string, string>();
    const sentFrames: string[] = [];

    class FakeWS {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = FakeWS.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onclose: ((ev: { code: number }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        FakeWS.instances.push(this);
      }
      send(data: string) {
        sentFrames.push(data);
      }
      close() {
        this.readyState = FakeWS.CLOSED;
        this.onclose?.({ code: 1000 });
      }
      static instances: FakeWS[] = [];
    }

    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevWS = (globalThis as Record<string, unknown>).WebSocket;
    (globalThis as Record<string, unknown>).WebSocket = FakeWS;
    (globalThis as Record<string, unknown>).window = {
      location: { protocol: 'http:', host: 'localhost:3000' },
      sessionStorage: {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => storageMap.set(k, v),
        removeItem: (k: string) => storageMap.delete(k),
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    };

    try {
      const client = new MultiplayerClient({
        onRoomState: () => {},
        onNotification: () => {},
        onError: () => {},
        onLeftRoom: () => {},
        onRoomClosed: () => {},
        onSessionExpired: () => {},
        onConnectionChange: () => {},
      });

      client.connect();
      const ws1 = FakeWS.instances[0];
      ws1.onopen?.();
      ws1.onmessage?.({
        data: JSON.stringify({
          type: 'session_established',
          playerId: 'u_host',
          sessionToken: 'tok_regen_1',
          roomCode: 'OLD111',
        }),
      });

      // Server broadcasts regenerated room code
      ws1.onmessage?.({
        data: JSON.stringify({
          type: 'room_state',
          room: { roomCode: 'NEW999' },
        }),
      });

      client.disconnect({ preserveStoredSession: true });

      // Refresh recovery client should reconnect using NEW999, not OLD111
      const refreshedClient = new MultiplayerClient({
        onRoomState: () => {},
        onNotification: () => {},
        onError: () => {},
        onLeftRoom: () => {},
        onRoomClosed: () => {},
        onSessionExpired: () => {},
        onConnectionChange: () => {},
      });
      assert.equal(refreshedClient.restoreSession(), true);
      const ws2 = FakeWS.instances[1];
      ws2.onopen?.();

      const parsed = sentFrames.map((f) => JSON.parse(f) as { type: string; roomCode?: string });
      assert.equal(
        parsed.some((m) => m.type === 'reconnect' && m.roomCode === 'NEW999'),
        true
      );
      assert.equal(
        parsed.some((m) => m.type === 'reconnect' && m.roomCode === 'OLD111'),
        false
      );
      refreshedClient.disconnect();
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).WebSocket = prevWS;
    }
  });
});

describe('Phase 3 Batch 1 — AUD-002: Timer-Off Mid-Turn Disconnect Deadlock Fix', () => {
  it('schedules fallback timer on mid-turn disconnect in Timer-Off room, cancels cleanly on reconnect, and auto-plays if still disconnected', async () => {
    const { manager, updates } = createTestManager({
      disconnectedFallbackTimerSeconds: 0.06, // 60ms for deterministic test
      botDelayMs: 5000,
    });

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 2,
      visibility: 'private',
      turnTimerSeconds: 0, // Timer Off
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Guest' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    assert.equal(manager.startGame(created.room.roomCode, created.playerId).ok, true);
    const room = manager.getRoom(created.room.roomCode)!;
    const activeTurnId = room.gameState!.currentTurnPlayerId!;
    const activeToken =
      activeTurnId === created.playerId ? created.sessionToken : p2.sessionToken;

    // While connected in Timer-Off mode, no turn timer or deadline is active
    assert.equal(room.turnDeadlineAt, null);
    assert.equal(room.turnTimer, undefined);

    // Active player disconnects mid-turn -> fallback timer scheduled & deadline broadcast
    const updatesBefore = updates.length;
    manager.handleDisconnect(room.roomCode, activeTurnId);
    assert.notEqual(room.turnDeadlineAt, null);
    assert.notEqual(room.turnTimer, undefined);
    assert.ok(updates.length > updatesBefore);

    // Duplicate disconnect call must not overwrite or duplicate the active fallback timer
    const existingTimer = room.turnTimer;
    manager.handleDisconnect(room.roomCode, activeTurnId);
    assert.equal(room.turnTimer, existingTimer);

    // Reconnect BEFORE fallback expires -> fallback timer cancelled & no missed turn fires
    const reconn = manager.reconnectPlayer(room.roomCode, activeToken);
    assert.equal(reconn.ok, true);
    assert.equal(room.turnDeadlineAt, null);
    assert.equal(room.turnTimer, undefined);

    await new Promise((r) => setTimeout(r, 100));
    const playerAfterReconn = room.gameState!.players.find((p) => p.id === activeTurnId)!;
    assert.equal(playerAfterReconn.consecutiveMissedTurns, 0);
    assert.equal(room.gameState!.currentTurnPlayerId, activeTurnId);

    // Disconnect again and stay disconnected -> fallback fires, auto-plays a legal card, advances turn
    manager.handleDisconnect(room.roomCode, activeTurnId);
    assert.notEqual(room.turnTimer, undefined);

    await new Promise((r) => setTimeout(r, 110));
    const playerAfterTimeout = room.gameState!.players.find((p) => p.id === activeTurnId)!;
    assert.equal(playerAfterTimeout.consecutiveMissedTurns, 1);
    assert.notEqual(room.gameState!.currentTurnPlayerId, activeTurnId);
    assert.equal(room.gameState!.currentTrick.plays.length, 1);

    manager.disposeAll();
  });

  it('does NOT cancel a configured turn timer (>0s) when the active player disconnects and reconnects', () => {
    const { manager } = createTestManager();
    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 2,
      visibility: 'private',
      turnTimerSeconds: 20,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Guest' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    assert.equal(manager.startGame(created.room.roomCode, created.playerId).ok, true);
    const room = manager.getRoom(created.room.roomCode)!;
    const activeTurnId = room.gameState!.currentTurnPlayerId!;
    const activeToken =
      activeTurnId === created.playerId ? created.sessionToken : p2.sessionToken;

    const initialTimer = room.turnTimer;
    const initialDeadline = room.turnDeadlineAt;
    assert.notEqual(initialTimer, undefined);
    assert.notEqual(initialDeadline, null);

    manager.handleDisconnect(room.roomCode, activeTurnId);
    assert.equal(room.turnTimer, initialTimer);

    const reconn = manager.reconnectPlayer(room.roomCode, activeToken);
    assert.equal(reconn.ok, true);
    // Configured timer stays intact!
    assert.equal(room.turnTimer, initialTimer);
    assert.equal(room.turnDeadlineAt, initialDeadline);

    manager.disposeAll();
  });
});

describe('Phase 3 Batch 1 — AUD-003: Smaller-Group Rematch Player Detachment', () => {
  it('detaches excluded players over WS with left_room, revokes tokens, prevents leaked updates, and lets them create/join another room', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0, botDelayMs: 5000 },
      heartbeatIntervalMs: 0,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const c1 = await openWsClient(wsUrl);
    const c2 = await openWsClient(wsUrl);
    const c3 = await openWsClient(wsUrl);
    let c3ReconnectAttempt: WsTestClient | null = null;

    try {
      c1.send({
        type: 'create_room',
        playerName: 'Host',
        capacity: 3,
        visibility: 'private',
        turnTimerSeconds: 0,
      });
      const sess1 = await c1.waitFor('session_established');
      await c1.waitFor('room_state');

      c2.send({ type: 'join_room', roomCode: sess1.roomCode, playerName: 'Player2' });
      const sess2 = await c2.waitFor('session_established');
      await c2.waitFor('room_state');

      c3.send({ type: 'join_room', roomCode: sess1.roomCode, playerName: 'Player3' });
      const sess3 = await c3.waitFor('session_established');
      await c3.waitFor('room_state');

      // Start game and transition to finished
      c1.send({ type: 'start_game' });
      await c1.waitFor('room_state', (m) => m.room.status === 'playing');
      const internalRoom = runtime.roomManager.getRoom(sess1.roomCode)!;
      internalRoom.status = 'finished';
      internalRoom.gameState!.phase = 'finished';

      // Host initiates rematch -> P2 accepts, P3 declines -> Host starts 2-player rematch
      c1.send({ type: 'rematch_request' });
      await c2.waitFor('room_state', (m) => Boolean(m.room.rematch));
      c2.send({ type: 'rematch_respond', accept: true });
      c3.send({ type: 'rematch_respond', accept: false });
      await c1.waitFor(
        'room_state',
        (m) =>
          m.room.rematch?.votes[sess2.playerId] === 'accepted' &&
          m.room.rematch?.votes[sess3.playerId] === 'declined'
      );

      c1.send({ type: 'rematch_start' });

      // P3 immediately receives left_room with "A rematch started without you."
      const detachedMsg = await c3.waitFor('left_room');
      assert.equal(detachedMsg.reason, 'left');
      assert.match(detachedMsg.message ?? '', /rematch started without you/i);
      const c3RoomStatesAfterDetach = c3.messages.filter((m) => m.type === 'room_state').length;

      // Accepted players Host & P2 both receive new playing state with 2 seats
      const hostNewGame = await c1.waitFor(
        'room_state',
        (m) => m.room.status === 'playing' && m.room.seats.length === 2
      );
      const p2NewGame = await c2.waitFor(
        'room_state',
        (m) => m.room.status === 'playing' && m.room.seats.length === 2
      );
      assert.equal(hostNewGame.room.seats.some((s) => s.playerId === sess3.playerId), false);
      assert.equal(p2NewGame.room.seats.length, 2);

      // P3 never received the new 2-player rematch room_state and receives zero further updates
      // when Host/P2 play a card in the new game
      const leaderId = hostNewGame.room.gameState!.currentTurnPlayerId!;
      const leaderWs = leaderId === sess1.playerId ? c1 : c2;
      leaderWs.send({ type: 'play_card', cardId: ACE_OF_SPADES_ID });
      await c1.waitFor(
        'room_state',
        (m) =>
          m.room.seats.length === 2 && (m.room.gameState?.currentTrick.plays.length ?? 0) === 1
      );
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(
        c3.messages.some(
          (m) => m.type === 'room_state' && m.room.status === 'playing' && m.room.seats.length === 2
        ),
        false
      );
      assert.equal(
        c3.messages.filter((m) => m.type === 'room_state').length,
        c3RoomStatesAfterDetach
      );

      // P3's old sessionToken is revoked and rejected on reconnect
      c3ReconnectAttempt = await openWsClient(wsUrl);
      c3ReconnectAttempt.send({
        type: 'reconnect',
        roomCode: sess1.roomCode,
        sessionToken: sess3.sessionToken,
      });
      const reconnErr = await c3ReconnectAttempt.waitFor('error');
      assert.equal(reconnErr.code, 'SESSION_INVALID');

      // P3's original socket is cleanly detached and can immediately create a new room!
      c3.send({
        type: 'create_room',
        playerName: 'Player3',
        capacity: 2,
        visibility: 'private',
        turnTimerSeconds: 15,
      });
      const newSess = await c3.waitFor(
        'session_established',
        (m) => m.roomCode !== sess1.roomCode
      );
      assert.notEqual(newSess.roomCode, sess1.roomCode);
    } finally {
      await c1.close();
      await c2.close();
      await c3.close();
      if (c3ReconnectAttempt) await c3ReconnectAttempt.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('Phase 3 Batch 1 — AUD-004: Rematch State, Vote Lifecycle & Retry Guards', () => {
  it('resets room.rematch to null on <2 accepted timeout for human host and allows immediate retry', async () => {
    const { manager } = createTestManager({ rematchTimeoutMs: 50 });
    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 2,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Guest' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    const room = manager.getRoom(created.room.roomCode)!;
    room.status = 'finished';

    // First rematch request -> Guest does not respond -> timeout with <2 accepted
    assert.equal(manager.requestRematch(room.roomCode, created.playerId).ok, true);
    assert.notEqual(room.rematch, null);

    // Duplicate/overlapping rematch request during active window MUST be rejected
    const dup = manager.requestRematch(room.roomCode, created.playerId);
    assert.equal(dup.ok, false);

    await new Promise((r) => setTimeout(r, 90));
    assert.equal(room.rematch, null);

    // Host can immediately initiate a second rematch cleanly!
    const retry = manager.requestRematch(room.roomCode, created.playerId);
    assert.equal(retry.ok, true);
    assert.notEqual(room.rematch, null);

    manager.disposeAll();
  });

  it('rejects rematch with <2 eligible seats, rejects late votes after expiresAt, and cleans votes on leaveRoom', () => {
    const { manager } = createTestManager({ rematchTimeoutMs: 5000 });
    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P2' });
    const p3 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P3' });
    assert.equal(p2.ok && p3.ok, true);
    if (!p2.ok || !p3.ok) return;

    const room = manager.getRoom(created.room.roomCode)!;
    room.status = 'finished';

    // Request rematch, P2 accepts, P3 leaves room -> P3's vote must be removed cleanly
    assert.equal(manager.requestRematch(room.roomCode, created.playerId).ok, true);
    assert.equal(manager.respondRematch(room.roomCode, p2.playerId, true).ok, true);
    assert.equal(room.rematch!.readyToStart, true);

    assert.equal(manager.leaveRoom(room.roomCode, p3.playerId).ok, true);
    assert.equal(p3.playerId in room.rematch!.votes, false);
    assert.equal(room.rematch!.readyToStart, true);

    // Late vote after expiresAt MUST be rejected
    room.rematch!.expiresAt = Date.now() - 10;
    const lateVote = manager.respondRematch(room.roomCode, p2.playerId, false);
    assert.equal(lateVote.ok, false);
    assert.match(lateVote.error, /expired/i);

    // Now P2 also leaves -> only 1 eligible seat remains -> rematch cleared & new request rejected
    assert.equal(manager.leaveRoom(room.roomCode, p2.playerId).ok, true);
    assert.equal(room.rematch, null);
    const soloRematch = manager.requestRematch(room.roomCode, created.playerId);
    assert.equal(soloRematch.ok, false);
    assert.match(soloRematch.error, /at least 2/i);

    manager.disposeAll();
  });

  it('triggers immediate AI Room Host finalization when departing player leaves zero pending votes', () => {
    const { manager } = createTestManager({ rematchTimeoutMs: 10_000 });
    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P2' });
    const p3 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P3' });
    assert.equal(p2.ok && p3.ok, true);
    if (!p2.ok || !p3.ok) return;

    const room = manager.getRoom(created.room.roomCode)!;
    room.status = 'finished';

    // Host requests rematch -> P2 accepts -> Host leaves (AI Host takes over) -> P3 is only pending
    assert.equal(manager.requestRematch(room.roomCode, created.playerId).ok, true);
    assert.equal(manager.respondRematch(room.roomCode, p2.playerId, true).ok, true);
    assert.equal(manager.leaveRoom(room.roomCode, created.playerId).ok, true);
    assert.equal(room.aiHostActive, true);
    assert.equal(created.playerId in room.rematch!.votes, false);

    // P3 leaves -> zero pending votes remain and only P2 accepted (<2) -> AI Host finalizes immediately & resets rematch to null
    assert.equal(manager.leaveRoom(room.roomCode, p3.playerId).ok, true);
    assert.equal(room.rematch, null);

    manager.disposeAll();
  });
});

describe('Phase 3 Batch 1 — AUD-005: Host & Player Disconnect During Active Rematch', () => {
  it('excludes disconnected host from rematch, marks vote declined, and starts 2-player rematch under AI Host once remaining players respond', () => {
    const detached: Array<{ roomCode: string; playerId: string; reason: string }> = [];
    const manager = new RoomManager(
      {
        onRoomUpdated: () => {},
        onNotification: () => {},
        onRoomClosed: () => {},
        onPlayerDetached: (roomCode, playerId, reason) =>
          detached.push({ roomCode, playerId, reason }),
      },
      { rematchTimeoutMs: 10_000, cleanupIntervalMs: 0, botDelayMs: 5000 }
    );

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P2' });
    const p3 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P3' });
    assert.equal(p2.ok && p3.ok, true);
    if (!p2.ok || !p3.ok) return;

    const room = manager.getRoom(created.room.roomCode)!;
    room.status = 'finished';

    // Host requests rematch, P2 accepts, P3 still pending -> Host disconnects
    assert.equal(manager.requestRematch(room.roomCode, created.playerId).ok, true);
    assert.equal(manager.respondRematch(room.roomCode, p2.playerId, true).ok, true);

    manager.handleDisconnect(room.roomCode, created.playerId);
    assert.equal(room.aiHostActive, true);
    assert.equal(room.rematch!.votes[created.playerId], 'declined');
    assert.equal(room.rematch!.readyToStart, false); // Only P2 accepted now

    // P3 accepts -> AI Host finalizes immediately & starts 2-player game with ONLY P2 & P3!
    assert.equal(manager.respondRematch(room.roomCode, p3.playerId, true).ok, true);
    assert.equal(room.status, 'playing');
    assert.equal(room.seats.length, 2);
    assert.equal(room.seats.some((s) => s.playerId === created.playerId), false);
    assert.equal(detached.some((d) => d.playerId === created.playerId), true);

    manager.disposeAll();
  });

  it('resets rematch to null if host disconnects leaving fewer than 2 eligible accepted players', () => {
    const { manager } = createTestManager({ rematchTimeoutMs: 10_000 });
    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 2,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P2' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    const room = manager.getRoom(created.room.roomCode)!;
    room.status = 'finished';

    assert.equal(manager.requestRematch(room.roomCode, created.playerId).ok, true);
    assert.equal(manager.respondRematch(room.roomCode, p2.playerId, true).ok, true);

    // Both accepted, then Host disconnects -> zero pending votes, only 1 connected accepted -> resets to null!
    manager.handleDisconnect(room.roomCode, created.playerId);
    assert.equal(room.status, 'finished');
    assert.equal(room.rematch, null);

    manager.disposeAll();
  });

  it('restores reconnected host vote to pending before rematch expires so host can accept cleanly', () => {
    const { manager } = createTestManager({ rematchTimeoutMs: 10_000 });
    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P2' });
    const p3 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P3' });
    assert.equal(p2.ok && p3.ok, true);
    if (!p2.ok || !p3.ok) return;

    const room = manager.getRoom(created.room.roomCode)!;
    room.status = 'finished';

    assert.equal(manager.requestRematch(room.roomCode, created.playerId).ok, true);
    manager.handleDisconnect(room.roomCode, created.playerId);
    assert.equal(room.rematch!.votes[created.playerId], 'declined');

    // Host reconnects before expiration -> ownership restored & vote set to pending
    const reconn = manager.reconnectPlayer(room.roomCode, created.sessionToken);
    assert.equal(reconn.ok, true);
    assert.equal(room.hostPlayerId, created.playerId);
    assert.equal(room.aiHostActive, false);
    assert.equal(room.rematch!.votes[created.playerId], 'pending');

    // Host can now accept cleanly
    assert.equal(manager.respondRematch(room.roomCode, created.playerId, true).ok, true);
    assert.equal(room.rematch!.votes[created.playerId], 'accepted');

    manager.disposeAll();
  });
});

describe('Phase 3 Batch 1 — AUD-013: Ghost Bot-Only Online Game Cleanup', () => {
  it('closes room and clears all timers immediately when the last human voluntarily exits an active game with bots', () => {
    const { manager, closedRooms } = createTestManager({ botDelayMs: 5000 });
    const created = manager.createRoom({
      playerName: 'SoloHuman',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 15,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.equal(manager.addBot(created.room.roomCode, created.playerId).ok, true);
    assert.equal(manager.addBot(created.room.roomCode, created.playerId).ok, true);
    assert.equal(manager.startGame(created.room.roomCode, created.playerId).ok, true);

    const room = manager.getRoom(created.room.roomCode)!;
    // Between tricks: currentTrick.plays is empty at start of first trick
    const exitRes = manager.voluntaryExitInGame(room.roomCode, created.playerId);
    assert.equal(exitRes.ok, true);

    // Room must be closed, removed from active map, and have zero lingering timers
    assert.equal(room.status, 'closed');
    assert.equal(manager.getRoom(room.roomCode), undefined);
    assert.equal(room.turnTimer, undefined);
    assert.equal(room.botTimer, undefined);
    assert.equal(room.trickTimer, undefined);
    assert.equal(closedRooms.some((c) => c.roomCode === room.roomCode), true);

    manager.disposeAll();
  });

  it('closes room immediately when the last human finishes officially and exits a game with bots', () => {
    const { manager, closedRooms } = createTestManager({ botDelayMs: 5000 });
    const created = manager.createRoom({
      playerName: 'FastFinisher',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    assert.equal(manager.addBot(created.room.roomCode, created.playerId).ok, true);
    assert.equal(manager.addBot(created.room.roomCode, created.playerId).ok, true);
    assert.equal(manager.startGame(created.room.roomCode, created.playerId).ok, true);

    const room = manager.getRoom(created.room.roomCode)!;
    const gp = room.gameState!.players.find((p) => p.id === created.playerId)!;
    gp.finished = true;
    gp.hand = [];
    gp.finishOrder = 1;

    const exitRes = manager.voluntaryExitInGame(room.roomCode, created.playerId);
    assert.equal(exitRes.ok, true);
    if (exitRes.ok) {
      assert.equal(exitRes.reason, 'finished_exit');
    }

    assert.equal(room.status, 'closed');
    assert.equal(manager.getRoom(room.roomCode), undefined);
    assert.equal(room.botTimer, undefined);
    assert.equal(closedRooms.some((c) => c.roomCode === room.roomCode), true);

    manager.disposeAll();
  });

  it('keeps room alive when one human exits while another human is temporarily disconnected and eligible to reconnect', () => {
    const { manager, closedRooms } = createTestManager({ botDelayMs: 5000 });
    const created = manager.createRoom({
      playerName: 'Human1',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Human2' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;
    assert.equal(manager.addBot(created.room.roomCode, created.playerId).ok, true);
    assert.equal(manager.startGame(created.room.roomCode, created.playerId).ok, true);

    const room = manager.getRoom(created.room.roomCode)!;
    // Human2 temporarily disconnects (still in room.seats and eligible to reconnect)
    manager.handleDisconnect(room.roomCode, p2.playerId);

    // Human1 exits voluntarily between tricks -> room MUST stay open for Human2!
    const exitRes = manager.voluntaryExitInGame(room.roomCode, created.playerId);
    assert.equal(exitRes.ok, true);

    assert.equal(room.status, 'playing');
    assert.notEqual(manager.getRoom(room.roomCode), undefined);
    assert.equal(closedRooms.length, 0);
    assert.equal(room.seats.some((s) => s.playerId === p2.playerId && s.type === 'human'), true);

    // Human2 can still reconnect cleanly
    const reconn = manager.reconnectPlayer(room.roomCode, p2.sessionToken);
    assert.equal(reconn.ok, true);

    manager.disposeAll();
  });
});

// ============================================================================
// PHASE 3 BATCH 2 — WAITING LOBBY (AUD-012), ONLINE TIMER CONFIG & PUBLIC BROWSER
// ============================================================================

describe('Phase 3 Batch 2 — AUD-012: Waiting Lobby Lifecycle & Reliability', () => {
  it('cancels aiStartTimer when all humans disconnect and resumes auto-start when a guest reconnects to a full AI-host waiting room', async () => {
    const { manager, notifications } = createTestManager({ aiAutoStartDelayMs: 40 });
    activeManager = manager;

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 2,
      visibility: 'private',
      turnTimerSeconds: 15,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Guest' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    const room = created.room;

    // Host disconnects from full waiting room -> AI Host takes over and schedules aiStartTimer
    manager.handleDisconnect(room.roomCode, created.playerId);
    assert.equal(room.aiHostActive, true);
    assert.notEqual(room.aiStartTimer, undefined);

    // Guest ALSO disconnects before auto-start -> 0 connected humans -> aiStartTimer immediately cancelled
    manager.handleDisconnect(room.roomCode, p2.playerId);
    assert.equal(room.aiStartTimer, undefined);
    assert.ok(
      notifications.some((n) => /Guest disconnected from the lobby/i.test(n.message)),
      'Waiting-lobby guest disconnect should emit lobby-specific message'
    );

    // Wait past auto-start delay -> room MUST NOT start with 0 connected humans
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(room.status, 'waiting');

    // Guest reconnects -> AI Room Host MUST resume auto-start instead of deadlocking forever!
    const reconn = manager.reconnectPlayer(room.roomCode, p2.sessionToken);
    assert.equal(reconn.ok, true);
    assert.notEqual(room.aiStartTimer, undefined);

    await new Promise((r) => setTimeout(r, 75));
    assert.equal(room.status, 'playing');
    assert.ok(room.gameState !== null);
  });

  it('cancels pending aiStartTimer when a seat leaves a full waiting room and prevents duplicate auto-start timers', async () => {
    const { manager, notifications } = createTestManager({ aiAutoStartDelayMs: 50 });
    activeManager = manager;

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 3,
      visibility: 'private',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P2' });
    const p3 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P3' });
    assert.equal(p2.ok && p3.ok, true);
    if (!p2.ok || !p3.ok) return;

    const room = created.room;
    manager.handleDisconnect(room.roomCode, created.playerId);
    assert.notEqual(room.aiStartTimer, undefined);

    // Calling handleDisconnect again (duplicate event) must not duplicate timer or notification
    const startNotesBefore = notifications.filter((n) =>
      /AI Room Host is starting the game/i.test(n.message)
    ).length;
    manager.handleDisconnect(room.roomCode, created.playerId);
    const startNotesAfter = notifications.filter((n) =>
      /AI Room Host is starting the game/i.test(n.message)
    ).length;
    assert.equal(startNotesAfter, startNotesBefore);

    // P3 leaves before auto-start fires -> aiStartTimer immediately cancelled & room stays waiting
    assert.equal(manager.leaveRoom(room.roomCode, p3.playerId).ok, true);
    assert.equal(room.aiStartTimer, undefined);

    await new Promise((r) => setTimeout(r, 80));
    assert.equal(room.status, 'waiting');
  });

  it('rejects stale lobby mutations from a disconnected host and restores authority upon reconnect', () => {
    const { manager } = createTestManager();
    activeManager = manager;

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 15,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'P2' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    const code = created.room.roomCode;
    manager.handleDisconnect(code, created.playerId);

    // Disconnected host cannot perform any host-only waiting-lobby mutations
    assert.equal(manager.addBot(code, created.playerId).ok, false);
    assert.equal(manager.removeSeat(code, created.playerId, p2.playerId).ok, false);
    assert.equal(manager.updateTurnTimer(code, created.playerId, 30).ok, false);
    assert.equal(manager.regenerateRoomCode(code, created.playerId).ok, false);
    assert.equal(manager.revokeInviteLink(code, created.playerId).ok, false);
    assert.equal(manager.cancelRoom(code, created.playerId).ok, false);

    // Host reconnects -> authority restored cleanly
    assert.equal(manager.reconnectPlayer(code, created.sessionToken).ok, true);
    assert.equal(manager.updateTurnTimer(code, created.playerId, 30).ok, true);
    assert.equal(created.room.turnTimerSeconds, 30);
    assert.equal(manager.addBot(code, created.playerId).ok, true);
    assert.equal(created.room.seats.length, 3);
  });

  it('MultiplayerClient never buffers stale lobby mutations across disconnect and deduplicates rapid join_room clicks', () => {
    const storageMap = new Map<string, string>();
    const sentFrames: string[] = [];

    class FakeWS {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = FakeWS.CONNECTING;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onclose: ((ev: { code: number }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        FakeWS.instances.push(this);
      }
      send(data: string) {
        sentFrames.push(data);
      }
      close() {
        this.readyState = FakeWS.CLOSED;
        this.onclose?.({ code: 1000 });
      }
      static instances: FakeWS[] = [];
    }

    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevWS = (globalThis as Record<string, unknown>).WebSocket;
    (globalThis as Record<string, unknown>).WebSocket = FakeWS;
    (globalThis as Record<string, unknown>).window = {
      location: { protocol: 'http:', host: 'localhost:3000' },
      sessionStorage: {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => storageMap.set(k, v),
        removeItem: (k: string) => storageMap.delete(k),
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    };

    let client: MultiplayerClient | null = null;
    try {
      const errors: string[] = [];
      client = new MultiplayerClient({
        onRoomState: () => {},
        onNotification: () => {},
        onError: (m) => errors.push(m),
        onLeftRoom: () => {},
        onRoomClosed: () => {},
        onSessionExpired: () => {},
        onConnectionChange: () => {},
      });

      // Rapid double join_room while connecting -> deduplicated to a single join_room frame
      client.send({ type: 'join_room', roomCode: 'AAA111', playerName: 'Guest' });
      client.send({ type: 'join_room', roomCode: 'BBB222', playerName: 'Guest' });

      // Stale in-room lobby mutations while disconnected MUST be rejected, never queued
      client.send({ type: 'add_bot' });
      client.send({ type: 'update_turn_timer', turnTimerSeconds: 20 });
      client.send({ type: 'start_game' });
      assert.equal(errors.length, 3);

      const ws = FakeWS.instances[0];
      ws.readyState = FakeWS.OPEN;
      ws.onopen?.();

      const parsed = sentFrames.map((f) => JSON.parse(f) as { type: string; roomCode?: string });
      const joins = parsed.filter((m) => m.type === 'join_room');
      assert.equal(joins.length, 1);
      assert.equal(joins[0].roomCode, 'BBB222');
      assert.equal(parsed.some((m) => m.type === 'add_bot'), false);
      assert.equal(parsed.some((m) => m.type === 'update_turn_timer'), false);
      assert.equal(parsed.some((m) => m.type === 'start_game'), false);
    } finally {
      client?.disconnect();
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).WebSocket = prevWS;
    }
  });
});

describe('Phase 3 Batch 2 — Online Lobby Turn Timer Configuration', () => {
  it('synchronizes waiting-lobby timer changes over WS, enforces host-only & waiting-only rules, and carries setting into game start', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0, botDelayMs: 5000 },
      heartbeatIntervalMs: 0,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const hostWs = await openWsClient(wsUrl);
    const guestWs = await openWsClient(wsUrl);

    try {
      hostWs.send({
        type: 'create_room',
        playerName: 'Host',
        capacity: 2,
        visibility: 'public',
        turnTimerSeconds: 15,
      });
      const hostSess = await hostWs.waitFor('session_established');
      await hostWs.waitFor('room_state');

      guestWs.send({ type: 'join_room', roomCode: hostSess.roomCode, playerName: 'Guest' });
      const guestSess = await guestWs.waitFor('session_established');
      const guestInit = await guestWs.waitFor('room_state');
      assert.equal(guestInit.room.turnTimerSeconds, 15);

      // Guest attempting to change timer MUST be rejected
      guestWs.send({ type: 'update_turn_timer', turnTimerSeconds: 30 });
      const guestErr = await guestWs.waitFor('error');
      assert.match(guestErr.message, /only the host/i);

      // Host attempting invalid timer value MUST be rejected
      hostWs.send({ type: 'update_turn_timer', turnTimerSeconds: 25 as unknown as 20 });
      const invalidErr = await hostWs.waitFor('error');
      assert.match(invalidErr.message, /invalid turn timer/i);

      // Host updates timer to 20s -> BOTH host & guest receive synced room_state & notification
      hostWs.send({ type: 'update_turn_timer', turnTimerSeconds: 20 });
      const guestSynced = await guestWs.waitFor(
        'room_state',
        (m) => m.room.turnTimerSeconds === 20
      );
      assert.equal(guestSynced.room.turnTimerSeconds, 20);
      const timerNote = await guestWs.waitFor(
        'notification',
        (m) => /Turn timer updated to 20s/i.test(m.notification.message)
      );
      assert.ok(timerNote);

      // Transfer host to Guest -> former Host is rejected, new Host (Guest) can update to 10s
      hostWs.send({ type: 'transfer_host_request', targetPlayerId: guestSess.playerId });
      await guestWs.waitFor(
        'room_state',
        (m) => m.room.pendingHostTransfer?.toPlayerId === guestSess.playerId
      );
      guestWs.send({ type: 'transfer_host_respond', accept: true });
      await hostWs.waitFor('room_state', (m) => m.room.hostPlayerId === guestSess.playerId);

      // Former host can no longer update timer
      hostWs.send({ type: 'update_turn_timer', turnTimerSeconds: 30 });
      const formerHostErr = await hostWs.waitFor(
        'error',
        (m) => /only the host/i.test(m.message)
      );
      assert.ok(formerHostErr);

      // New host updates timer to 10s -> synced to former host
      guestWs.send({ type: 'update_turn_timer', turnTimerSeconds: 10 });
      const hostSynced = await hostWs.waitFor(
        'room_state',
        (m) => m.room.turnTimerSeconds === 10
      );
      assert.equal(hostSynced.room.turnTimerSeconds, 10);

      // Start game -> 10s timer is carried into the active game (turnDeadlineAt ~10s ahead)
      guestWs.send({ type: 'start_game' });
      const playingState = await guestWs.waitFor(
        'room_state',
        (m) => m.room.status === 'playing' && m.room.turnDeadlineAt !== null
      );
      const remainingMs = playingState.room.turnDeadlineAt! - Date.now();
      assert.ok(remainingMs > 5000 && remainingMs <= 10_500, `Expected ~10s deadline, got ${remainingMs}ms`);

      // Once game has started, lobby timer changes MUST be rejected and must NOT alter active game!
      guestWs.send({ type: 'update_turn_timer', turnTimerSeconds: 30 });
      const inGameErr = await guestWs.waitFor(
        'error',
        (m) => /waiting in the lobby/i.test(m.message)
      );
      assert.ok(inGameErr);
      assert.equal(runtime.roomManager.getRoom(hostSess.roomCode)!.turnTimerSeconds, 10);
    } finally {
      await hostWs.close();
      await guestWs.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('carries Timer Off (0s) configured in waiting lobby into game start while preserving disconnected-player fallback', async () => {
    const { manager } = createTestManager({
      disconnectedFallbackTimerSeconds: 0.06,
      botDelayMs: 5000,
    });
    activeManager = manager;

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 2,
      visibility: 'private',
      turnTimerSeconds: 15,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Guest' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    // Host switches lobby timer from 15s to Off (0s) before starting
    assert.equal(manager.updateTurnTimer(created.room.roomCode, created.playerId, 0).ok, true);
    assert.equal(manager.startGame(created.room.roomCode, created.playerId).ok, true);

    const room = created.room;
    assert.equal(room.turnTimerSeconds, 0);
    assert.equal(room.turnDeadlineAt, null);

    // Active turn player disconnects mid-turn -> fallback timer activates & auto-plays cleanly
    const activeTurnId = room.gameState!.currentTurnPlayerId!;
    manager.handleDisconnect(room.roomCode, activeTurnId);
    assert.notEqual(room.turnDeadlineAt, null);

    await new Promise((r) => setTimeout(r, 100));
    assert.notEqual(room.gameState!.currentTurnPlayerId, activeTurnId);
  });

  it('allows AI_ROOM_HOST internal timer change when aiHostActive while blocking human guests', () => {
    const { manager } = createTestManager();
    activeManager = manager;

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 3,
      visibility: 'private',
      turnTimerSeconds: 15,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const p2 = manager.joinRoom({ roomCode: created.room.roomCode, playerName: 'Guest' });
    assert.equal(p2.ok, true);
    if (!p2.ok) return;

    manager.handleDisconnect(created.room.roomCode, created.playerId);
    assert.equal(created.room.aiHostActive, true);

    assert.equal(manager.updateTurnTimer(created.room.roomCode, p2.playerId, 20).ok, false);
    assert.equal(manager.updateTurnTimer(created.room.roomCode, 'AI_ROOM_HOST', 20).ok, true);
    assert.equal(created.room.turnTimerSeconds, 20);
  });
});

describe('Phase 3 Batch 2 — Public Room Browser Discovery & Join Guards', () => {
  it('exposes accurate public metadata, separates open/full/in-progress rooms, and never leaks private or closed rooms', () => {
    const { manager } = createTestManager({ botDelayMs: 5000 });
    activeManager = manager;

    // Private room must NEVER appear
    const priv = manager.createRoom({
      playerName: 'SecretHost',
      tableName: 'Private Club',
      capacity: 4,
      visibility: 'private',
      turnTimerSeconds: 30,
      difficulty: 'hard',
    });
    assert.equal(priv.ok, true);

    // Public room 1: In-progress (playing)
    const pubPlaying = manager.createRoom({
      playerName: 'Alice',
      tableName: 'Active Match',
      capacity: 2,
      visibility: 'public',
      turnTimerSeconds: 10,
      difficulty: 'medium',
    });
    assert.equal(pubPlaying.ok, true);
    if (!pubPlaying.ok) return;
    assert.equal(manager.addBot(pubPlaying.room.roomCode, pubPlaying.playerId).ok, true);
    assert.equal(manager.startGame(pubPlaying.room.roomCode, pubPlaying.playerId).ok, true);

    // Public room 2: Full waiting room
    const pubFull = manager.createRoom({
      playerName: 'Bob',
      tableName: 'Full Waiting',
      capacity: 2,
      visibility: 'public',
      turnTimerSeconds: 0,
      difficulty: 'hard',
    });
    assert.equal(pubFull.ok, true);
    if (!pubFull.ok) return;
    assert.equal(manager.addBot(pubFull.room.roomCode, pubFull.playerId).ok, true);

    // Public room 3: Open waiting room (joinable)
    const pubOpen = manager.createRoom({
      playerName: 'Cara',
      tableName: 'Open Evening Table',
      capacity: 4,
      visibility: 'public',
      turnTimerSeconds: 20,
      difficulty: 'easy',
    });
    assert.equal(pubOpen.ok, true);
    if (!pubOpen.ok) return;

    const list = manager.getPublicRooms();
    assert.equal(list.length, 3);
    assert.equal(list.some((r) => r.tableName === 'Private Club'), false);
    // Ensure no secret tokens exist anywhere in public room summaries
    assert.equal(JSON.stringify(list).includes(pubOpen.sessionToken), false);
    assert.equal(JSON.stringify(list).includes(pubOpen.room.inviteToken), false);

    // Ordering: Open waiting -> Full waiting -> In-progress
    assert.equal(list[0].roomCode, pubOpen.room.roomCode);
    assert.equal(list[0].hostName, 'Cara');
    assert.equal(list[0].playerCount, 1);
    assert.equal(list[0].availableSeats, 3);
    assert.equal(list[0].joinable, true);
    assert.equal(list[0].isFull, false);
    assert.equal(list[0].status, 'waiting');
    assert.equal(list[0].turnTimerSeconds, 20);
    assert.equal(list[0].difficulty, 'easy');

    assert.equal(list[1].roomCode, pubFull.room.roomCode);
    assert.equal(list[1].hostName, 'Bob');
    assert.equal(list[1].availableSeats, 0);
    assert.equal(list[1].isFull, true);
    assert.equal(list[1].joinable, false);
    assert.equal(list[1].turnTimerSeconds, 0);

    assert.equal(list[2].roomCode, pubPlaying.room.roomCode);
    assert.equal(list[2].status, 'playing');
    assert.equal(list[2].joinable, false);
    assert.equal(list[2].turnTimerSeconds, 10);

    // Live timer update & AI Host takeover reflect immediately in getPublicRooms()
    assert.equal(manager.updateTurnTimer(pubOpen.room.roomCode, pubOpen.playerId, 30).ok, true);
    manager.handleDisconnect(pubOpen.room.roomCode, pubOpen.playerId);
    const refreshed = manager.getPublicRooms();
    const updatedOpen = refreshed.find((r) => r.roomCode === pubOpen.room.roomCode)!;
    assert.equal(updatedOpen.turnTimerSeconds, 30);
    assert.equal(updatedOpen.hostName, 'AI Room Host');
    assert.equal(updatedOpen.aiHostActive, true);
  });

  it('rejects joining full, in-progress, cancelled, or stale disappeared public rooms and sweeps stale rooms on refresh', () => {
    const { manager } = createTestManager({
      abandonedWaitingTimeoutMs: 50,
      botDelayMs: 5000,
    });
    activeManager = manager;

    // 1. Room that becomes full between listing and join
    const fullRoom = manager.createRoom({
      playerName: 'Host1',
      capacity: 2,
      visibility: 'public',
    });
    assert.equal(fullRoom.ok, true);
    if (!fullRoom.ok) return;
    assert.equal(manager.addBot(fullRoom.room.roomCode, fullRoom.playerId).ok, true);
    const joinFull = manager.joinRoom({ roomCode: fullRoom.room.roomCode, playerName: 'Late' });
    assert.equal(joinFull.ok, false);
    if (!joinFull.ok) assert.match(joinFull.error, /full/i);

    // 2. Room that starts between listing and join
    assert.equal(manager.startGame(fullRoom.room.roomCode, fullRoom.playerId).ok, true);
    const validateStarted = manager.validateRoomAccess(fullRoom.room.roomCode);
    assert.equal(validateStarted.ok, false);
    if (!validateStarted.ok) assert.match(validateStarted.error, /already started/i);

    // 3. Room that is cancelled/disappears between listing and join
    const vanished = manager.createRoom({
      playerName: 'Host2',
      capacity: 3,
      visibility: 'public',
    });
    assert.equal(vanished.ok, true);
    if (!vanished.ok) return;
    const vanishedCode = vanished.room.roomCode;
    assert.equal(manager.cancelRoom(vanishedCode, vanished.playerId).ok, true);
    assert.equal(manager.getPublicRooms().some((r) => r.roomCode === vanishedCode), false);
    const joinVanished = manager.joinRoom({ roomCode: vanishedCode, playerName: 'Guest' });
    assert.equal(joinVanished.ok, false);
    if (!joinVanished.ok) assert.match(joinVanished.error, /expired|not found/i);

    // 4. Stale abandoned public waiting room is swept automatically on getPublicRooms() refresh
    const stale = manager.createRoom({
      playerName: 'GhostHost',
      capacity: 4,
      visibility: 'public',
    });
    assert.equal(stale.ok, true);
    if (!stale.ok) return;
    manager.handleDisconnect(stale.room.roomCode, stale.playerId);
    stale.room.lastActivityAt = Date.now() - 200; // Past 50ms abandoned timeout
    const afterSweep = manager.getPublicRooms();
    assert.equal(afterSweep.some((r) => r.roomCode === stale.room.roomCode), false);
    assert.equal(manager.validateRoomAccess(stale.room.roomCode).ok, false);
  });
});

// ============================================================================
// PHASE 3 BATCH 3 — MULTI-TAB SERVER COORDINATION & SESSION RECOVERY OVER WS
// ============================================================================

describe('Phase 3 Batch 3 — Multi-Tab Session Safety & Recovery Over WebSocket', () => {
  it('rejects duplicate-tab reconnect with rejectIfActive: true without disconnecting or disturbing the active tab', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0, botDelayMs: 5000 },
      heartbeatIntervalMs: 0,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const tabA = await openWsClient(wsUrl);
    const tabB = await openWsClient(wsUrl);

    try {
      tabA.send({
        type: 'create_room',
        playerName: 'Host',
        capacity: 2,
        visibility: 'private',
      });
      const hostSess = await tabA.waitFor('session_established');
      await tabA.waitFor('room_state');

      // Duplicate tab probes with rejectIfActive: true while Tab A is live
      tabB.send({
        type: 'reconnect',
        roomCode: hostSess.roomCode,
        sessionToken: hostSess.sessionToken,
        rejectIfActive: true,
      });
      const dupErr = await tabB.waitFor('error');
      assert.equal(dupErr.code, 'SESSION_ACTIVE_ELSEWHERE');

      // Tab A MUST remain open and completely functional (able to add a bot)
      assert.equal(tabA.ws.readyState, WebSocket.OPEN);
      tabA.send({ type: 'add_bot' });
      const updated = await tabA.waitFor('room_state', (m) => m.room.seats.length === 2);
      assert.equal(updated.room.seats.length, 2);
    } finally {
      await tabA.close();
      await tabB.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('notifies displaced tab with session_superseded + close 4001 on deliberate takeover while preserving game state', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0, botDelayMs: 5000 },
      heartbeatIntervalMs: 0,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const tabA = await openWsClient(wsUrl);
    const tabB = await openWsClient(wsUrl);

    try {
      tabA.send({
        type: 'create_room',
        playerName: 'Host',
        capacity: 2,
        visibility: 'private',
      });
      const hostSess = await tabA.waitFor('session_established');
      await tabA.waitFor('room_state');
      tabA.send({ type: 'add_bot' });
      await tabA.waitFor('room_state', (m) => m.room.seats.length === 2);
      tabA.send({ type: 'start_game' });
      const playingA = await tabA.waitFor('room_state', (m) => m.room.status === 'playing');

      const tabAClosePromise = new Promise<number>((resolve) => {
        tabA.ws.once('close', (code) => resolve(code));
      });

      // Tab B intentionally takes over (rejectIfActive omitted/false)
      tabB.send({
        type: 'reconnect',
        roomCode: hostSess.roomCode,
        sessionToken: hostSess.sessionToken,
      });

      const supersededMsg = await tabA.waitFor('session_superseded');
      assert.equal(supersededMsg.roomCode, hostSess.roomCode);
      const closeCode = await tabAClosePromise;
      assert.equal(closeCode, 4001);

      // Tab B receives exact preserved seat & game state
      const playingB = await tabB.waitFor('room_state', (m) => m.room.status === 'playing');
      assert.equal(playingB.room.yourPlayerId, hostSess.playerId);
      assert.equal(playingB.room.seats.length, 2);
      assert.equal(
        playingB.room.gameState?.players.find((p) => p.id === hostSess.playerId)?.cardCount,
        playingA.room.gameState?.players.find((p) => p.id === hostSess.playerId)?.cardCount
      );
    } finally {
      await tabA.close();
      await tabB.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('allows deliberate page refresh with rejectIfActive: true after old socket closes and keeps unrelated rooms isolated', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0, botDelayMs: 5000 },
      heartbeatIntervalMs: 0,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws' });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const room1Tab = await openWsClient(wsUrl);
    const room2Tab = await openWsClient(wsUrl);
    let room1Refreshed: Awaited<ReturnType<typeof openWsClient>> | null = null;

    try {
      // Tab 1 creates Room 1, Tab 2 creates Room 2 concurrently
      room1Tab.send({
        type: 'create_room',
        playerName: 'Alice',
        capacity: 2,
        visibility: 'private',
      });
      const sess1 = await room1Tab.waitFor('session_established');
      await room1Tab.waitFor('room_state');

      room2Tab.send({
        type: 'create_room',
        playerName: 'Bob',
        capacity: 2,
        visibility: 'private',
      });
      const sess2 = await room2Tab.waitFor('session_established');
      await room2Tab.waitFor('room_state');
      assert.notEqual(sess1.roomCode, sess2.roomCode);

      // Simulate page refresh on Room 1: old socket closes cleanly, new socket reconnects with rejectIfActive: true
      await room1Tab.close();
      await new Promise((r) => setTimeout(r, 30));

      room1Refreshed = await openWsClient(wsUrl);
      room1Refreshed.send({
        type: 'reconnect',
        roomCode: sess1.roomCode,
        sessionToken: sess1.sessionToken,
        rejectIfActive: true,
      });
      const restored1 = await room1Refreshed.waitFor('room_state');
      assert.equal(restored1.room.roomCode, sess1.roomCode);
      assert.equal(restored1.room.yourPlayerId, sess1.playerId);
      assert.equal(restored1.room.seats.length, 1);

      // Room 2 remains completely unaffected and active
      room2Tab.send({ type: 'add_bot' });
      const room2Updated = await room2Tab.waitFor('room_state', (m) => m.room.seats.length === 2);
      assert.equal(room2Updated.room.roomCode, sess2.roomCode);
    } finally {
      await room1Tab.close();
      await room1Refreshed?.close();
      await room2Tab.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('Final Release Readiness Audit — Security, Socket Lifecycle & Full Match Verification', () => {
  it('blocks cross-player socket rebinding on reconnect and cleans up closed socket references', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0, botDelayMs: 5000 },
      heartbeatIntervalMs: 0,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const hostWs = await openWsClient(wsUrl);
    const guestWs = await openWsClient(wsUrl);
    let guestReconnectedWs: Awaited<ReturnType<typeof openWsClient>> | null = null;

    try {
      hostWs.send({
        type: 'create_room',
        playerName: 'Host',
        capacity: 2,
        visibility: 'private',
      });
      const hostSess = await hostWs.waitFor('session_established');
      await hostWs.waitFor('room_state');

      guestWs.send({
        type: 'join_room',
        roomCode: hostSess.roomCode,
        playerName: 'Guest',
      });
      const guestSess = await guestWs.waitFor('session_established');
      await guestWs.waitFor('room_state');
      await hostWs.waitFor('room_state', (m) => m.room.seats.length === 2);

      // Guest attempts to hijack/rebind their already-bound socket onto Host's session
      guestWs.send({
        type: 'reconnect',
        roomCode: hostSess.roomCode,
        sessionToken: hostSess.sessionToken,
      });
      const rebindErr = await guestWs.waitFor('error');
      assert.match(rebindErr.message, /leave your current room/i);

      // Host's socket must remain OPEN and Host must still own the seat
      assert.equal(hostWs.ws.readyState, WebSocket.OPEN);

      // Guest disconnects -> server marks disconnected cleanly and releases socket entry
      await guestWs.close();
      const afterDisc = await hostWs.waitFor(
        'room_state',
        (m) => m.room.seats.find((s) => s.playerId === guestSess.playerId)?.connected === false
      );
      assert.equal(
        afterDisc.room.seats.find((s) => s.playerId === guestSess.playerId)?.connected,
        false
      );

      // Guest reconnects cleanly on a fresh socket with rejectIfActive: true
      guestReconnectedWs = await openWsClient(wsUrl);
      guestReconnectedWs.send({
        type: 'reconnect',
        roomCode: hostSess.roomCode,
        sessionToken: guestSess.sessionToken,
        rejectIfActive: true,
      });
      const guestRestored = await guestReconnectedWs.waitFor('room_state');
      assert.equal(guestRestored.room.yourPlayerId, guestSess.playerId);
      assert.equal(
        guestRestored.room.seats.find((s) => s.playerId === guestSess.playerId)?.connected,
        true
      );
    } finally {
      await hostWs.close();
      await guestWs.close();
      await guestReconnectedWs?.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('enforces WebSocket auth rate limiting, message flood protection, and rejects unsupported message types', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: { cleanupIntervalMs: 0 },
      heartbeatIntervalMs: 0,
      maxAuthAttemptsPerMinute: 3,
      maxMessagesPer10Seconds: 5,
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const clientA = await openWsClient(wsUrl);
    const clientB = await openWsClient(wsUrl);

    try {
      // 1. Unsupported message type returns explicit error
      clientA.messages.length = 0;
      clientA.ws.send(JSON.stringify({ type: 'unsupported_op' }));
      const unsupportedErr = await clientA.waitFor('error');
      assert.match(unsupportedErr.message, /unsupported message type/i);

      // 2. Auth brute-force attempts exceed maxAuthAttemptsPerMinute (3)
      for (let i = 0; i < 3; i++) {
        clientA.messages.length = 0;
        clientA.send({ type: 'join_room', roomCode: `FAKE0${i}`, playerName: 'Tester' });
        const err = await clientA.waitFor('error');
        assert.notEqual(err.code, 'RATE_LIMITED');
      }
      clientA.messages.length = 0;
      clientA.send({ type: 'join_room', roomCode: 'FAKE99', playerName: 'Tester' });
      const authLimitErr = await clientA.waitFor('error');
      assert.equal(authLimitErr.code, 'RATE_LIMITED');

      // 3. Per-socket message flood limit triggers on 6th non-ping message while ping stays exempt
      for (let i = 0; i < 5; i++) {
        clientB.messages.length = 0;
        clientB.send({ type: 'start_game' });
        const err = await clientB.waitFor('error');
        assert.notEqual(err.code, 'RATE_LIMITED');
      }
      // Ping is still answered even right at the limit
      clientB.messages.length = 0;
      clientB.send({ type: 'ping' });
      await clientB.waitFor('pong');

      clientB.messages.length = 0;
      clientB.send({ type: 'start_game' });
      const floodErr = await clientB.waitFor('error');
      assert.equal(floodErr.code, 'RATE_LIMITED');
    } finally {
      await clientA.close();
      await clientB.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('prevents disconnected host from initiating/starting rematch and never reuses expired room codes', () => {
    // Deterministic RNG that first generates AAAAAA, then BBBBBB
    let step = 0;
    const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
    const { manager } = createTestManager({
      rng: () => (seq[step++] ?? 2) / 32,
    });

    const first = manager.createRoom({
      playerName: 'Host',
      capacity: 2,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const firstCode = first.room.roomCode;

    // Close the room so its code enters expiredRoomCodes
    assert.equal(manager.cancelRoom(firstCode, first.playerId).ok, true);

    // Next room tries to generate the same code first (seq 6..11), must skip it and pick BBBBBB!
    const second = manager.createRoom({
      playerName: 'Host2',
      capacity: 2,
      visibility: 'private',
      turnTimerSeconds: 0,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.notEqual(second.room.roomCode, firstCode);

    const guest = manager.joinRoom({ roomCode: second.room.roomCode, playerName: 'Guest2' });
    assert.equal(guest.ok, true);
    if (!guest.ok) return;

    const room = manager.getRoom(second.room.roomCode)!;
    room.status = 'finished';

    // Simulate a disconnected host without AI takeover -> requestRematch MUST be rejected
    const hostSeat = room.seats.find((s) => s.playerId === second.playerId)!;
    hostSeat.connected = false;
    const reqErr = manager.requestRematch(room.roomCode, second.playerId);
    assert.equal(reqErr.ok, false);

    // Reconnect host, start rematch, guest accepts, then disconnect host -> startAcceptedRematch rejected
    hostSeat.connected = true;
    assert.equal(manager.requestRematch(room.roomCode, second.playerId).ok, true);
    assert.equal(manager.respondRematch(room.roomCode, guest.playerId, true).ok, true);
    hostSeat.connected = false;
    const startErr = manager.startAcceptedRematch(room.roomCode, second.playerId);
    assert.equal(startErr.ok, false);

    manager.disposeAll();
  });

  it('completes a full 2-player online match + rematch over WebSockets with strict hand redaction and 52-card conservation', async () => {
    const runtime = createMultiplayerRuntime({
      roomManagerOptions: {
        cleanupIntervalMs: 0,
        trickSuccessDelayMs: 5,
        trickFailDelayMs: 5,
        rematchTimeoutMs: 5000,
      },
      heartbeatIntervalMs: 0,
      maxMessagesPer10Seconds: 500, // Full 52-card game runs rapidly in tests
    });
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
    runtime.attach(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const hostWs = await openWsClient(wsUrl);
    const guestWs = await openWsClient(wsUrl);

    try {
      hostWs.send({
        type: 'create_room',
        playerName: 'Alice',
        capacity: 2,
        visibility: 'public',
        turnTimerSeconds: 0,
      });
      const hostSess = await hostWs.waitFor('session_established');
      await hostWs.waitFor('room_state');

      // Verify public room discovery lists the waiting room
      const pubRooms = runtime.roomManager.getPublicRooms();
      assert.equal(pubRooms.length, 1);
      assert.equal(pubRooms[0].roomCode, hostSess.roomCode);

      guestWs.send({
        type: 'join_room',
        roomCode: hostSess.roomCode,
        playerName: 'Bob',
      });
      const guestSess = await guestWs.waitFor('session_established');
      await guestWs.waitFor('room_state');
      await hostWs.waitFor('room_state', (m) => m.room.seats.length === 2);

      hostWs.messages.length = 0;
      guestWs.messages.length = 0;
      hostWs.send({ type: 'start_game' });
      let hostRoom = (await hostWs.waitFor('room_state', (m) => m.room.status === 'playing')).room;
      let guestRoom = (await guestWs.waitFor('room_state', (m) => m.room.status === 'playing')).room;

      const assertViewInvariants = (
        view: typeof hostRoom,
        ownId: string,
        otherId: string
      ) => {
        const gs = view.gameState;
        assert.ok(gs);
        const self = gs!.players.find((p) => p.id === ownId)!;
        const other = gs!.players.find((p) => p.id === otherId)!;
        assert.equal(self.hand.length, self.cardCount);
        if (gs!.phase !== 'finished') {
          // Strict security invariant: opponent's cards MUST NEVER be leaked mid-game
          assert.equal(other.hand.length, 0);
        }
        const inFlightPlays = gs!.phase === 'playing' ? gs!.currentTrick.plays.length : 0;
        const totalCards =
          gs!.players.reduce((sum, p) => sum + p.cardCount, 0) +
          inFlightPlays +
          gs!.removedCards.length;
        assert.equal(totalCards, 52);
      };

      assertViewInvariants(hostRoom, hostSess.playerId, guestSess.playerId);
      assertViewInvariants(guestRoom, guestSess.playerId, hostSess.playerId);

      // Drive the entire game to completion via legal WebSocket play_card messages
      let safetySteps = 0;
      while (hostRoom.status === 'playing' && safetySteps < 200) {
        safetySteps++;
        const gs = hostRoom.gameState!;
        if (gs.phase === 'trick_result') {
          const trickNo = gs.currentTrick.trickNumber;
          hostRoom = (
            await hostWs.waitFor(
              'room_state',
              (m) =>
                m.room.status === 'finished' ||
                (m.room.gameState?.phase === 'playing' &&
                  m.room.gameState.currentTrick.trickNumber > trickNo)
            )
          ).room;
          guestRoom = (
            await guestWs.waitFor(
              'room_state',
              (m) =>
                m.room.status === 'finished' ||
                (m.room.gameState?.phase === 'playing' &&
                  m.room.gameState.currentTrick.trickNumber > trickNo)
            )
          ).room;
          assertViewInvariants(hostRoom, hostSess.playerId, guestSess.playerId);
          assertViewInvariants(guestRoom, guestSess.playerId, hostSess.playerId);
          continue;
        }

        const turnId = gs.currentTurnPlayerId!;
        const isHostTurn = turnId === hostSess.playerId;
        const activeView = isHostTurn ? hostRoom : guestRoom;
        const activeWs = isHostTurn ? hostWs : guestWs;
        const activePlayer = activeView.gameState!.players.find((p) => p.id === turnId)!;

        // Pick a strictly legal card
        let card = activePlayer.hand[0];
        if (activeView.gameState!.isFirstTurnOfGame) {
          card = activePlayer.hand.find((c) => c.id === 'spades-14') ?? card;
        } else if (activeView.gameState!.currentTrick.ledSuit) {
          const sameSuit = activePlayer.hand.find(
            (c) => c.suit === activeView.gameState!.currentTrick.ledSuit
          );
          if (sameSuit) card = sameSuit;
        }

        hostWs.messages.length = 0;
        guestWs.messages.length = 0;
        activeWs.send({ type: 'play_card', cardId: card.id });

        hostRoom = (await hostWs.waitFor('room_state')).room;
        guestRoom = (await guestWs.waitFor('room_state')).room;
        assertViewInvariants(hostRoom, hostSess.playerId, guestSess.playerId);
        assertViewInvariants(guestRoom, guestSess.playerId, hostSess.playerId);
      }

      assert.equal(hostRoom.status, 'finished');
      assert.equal(guestRoom.status, 'finished');
      assert.equal(hostRoom.gameState?.phase, 'finished');

      // Run a full online rematch flow
      hostWs.messages.length = 0;
      guestWs.messages.length = 0;
      hostWs.send({ type: 'rematch_request' });
      await guestWs.waitFor('room_state', (m) => m.room.rematch !== null);

      hostWs.messages.length = 0;
      guestWs.messages.length = 0;
      guestWs.send({ type: 'rematch_respond', accept: true });
      await hostWs.waitFor('room_state', (m) => m.room.rematch?.readyToStart === true);

      hostWs.messages.length = 0;
      guestWs.messages.length = 0;
      hostWs.send({ type: 'rematch_start' });
      const rematchHost = (await hostWs.waitFor('room_state', (m) => m.room.status === 'playing'))
        .room;
      const rematchGuest = (await guestWs.waitFor('room_state', (m) => m.room.status === 'playing'))
        .room;
      assertViewInvariants(rematchHost, hostSess.playerId, guestSess.playerId);
      assertViewInvariants(rematchGuest, guestSess.playerId, hostSess.playerId);
    } finally {
      await hostWs.close();
      await guestWs.close();
      runtime.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

