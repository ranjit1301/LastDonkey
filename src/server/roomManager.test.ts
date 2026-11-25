import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { RoomManager, type InternalRoom } from './roomManager';
import type { RoomNotification } from './roomTypes';

function createTestManager(overrides = {}) {
  const notifications: RoomNotification[] = [];
  const closedRooms: Array<{ roomCode: string; reason: string }> = [];
  const manager = new RoomManager(
    {
      onRoomUpdated: (_room: InternalRoom) => {},
      onNotification: (_room, note) => notifications.push(note),
      onRoomClosed: (roomCode, reason) => closedRooms.push({ roomCode, reason }),
    },
    {
      publicVacancyTimeoutMs: 60,
      rematchTimeoutMs: 80,
      botDelayMs: 20,
      trickSuccessDelayMs: 20,
      trickFailDelayMs: 20,
      aiAutoStartDelayMs: 30,
      ...overrides,
    }
  );
  return { manager, notifications, closedRooms };
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
});
