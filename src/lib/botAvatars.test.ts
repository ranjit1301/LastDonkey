import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOT_AVATAR_PROFILES,
  getBotAvatarById,
  getBotAvatarByName,
  pickUniqueBotAvatar,
  pickUniqueBotAvatars,
  pickUniqueCharacterAvatar,
  resolveBotAvatar,
  resolveCharacterAvatar,
} from './botAvatars.ts';
import {
  buildFailedTrickEventKey,
  buildSuccessTrickEventKey,
  FAILED_TRICK_TIMING_MS,
  getFailedTrickStageForElapsed,
  shouldPlayGameAnimations,
} from './gameAnimations.ts';
import {
  addLocalLobbySeat,
  buildDefaultPlayers,
  DEFAULT_SETTINGS,
  loadSettings,
  resolvePreferredAvatarId,
  sanitizeLocalLobbyConfig,
  saveSettings,
  updateLocalLobbyPlayer,
  type LocalLobbyConfig,
} from './settings.ts';
import { RoomManager } from '../server/roomManager.ts';
import { playCard, continueAfterTrick } from '../engine/index.ts';
import { getBotReliefMotionStyle } from './facialExpressions.ts';

const EXPECTED_12_BOTS: ReadonlyArray<{ name: string; personality: string }> = [
  { name: 'Chotu Chaiwala', personality: 'Stylish and witty' },
  { name: 'Surili', personality: 'Dramatic singer' },
  { name: 'Babloo Uncle', personality: 'Overreacts to everything' },
  { name: 'Rocky Raja', personality: 'Overconfident superstar' },
  { name: 'Gappu', personality: 'Food-loving character' },
  { name: 'Pappu Viral', personality: 'Funny and unpredictable' },
  { name: 'Selfie Sona', personality: 'Loves attention' },
  { name: 'WiFi Baba', personality: 'Wise but quirky' },
  { name: 'Kallu Kaka', personality: 'Friendly and cheerful' },
  { name: 'Mishra Ji', personality: 'Knows everything' },
  { name: 'Dhamaka Don', personality: 'Overconfident entertainer' },
  { name: 'Hasmukh Didi', personality: 'Laughs at everything' },
];

function createSeededRng(seed = 42): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('Fictional Indian Bot Avatar Collection (12 Characters)', () => {
  it('defines all 12 exact fictional Indian bot names, personalities, and unique sprite quadrants', () => {
    assert.equal(BOT_AVATAR_PROFILES.length, 12);
    const ids = new Set<string>();
    const slots = new Set<string>();

    EXPECTED_12_BOTS.forEach((expected, idx) => {
      const profile = BOT_AVATAR_PROFILES[idx];
      assert.equal(profile.name, expected.name);
      assert.equal(profile.personality, expected.personality);
      ids.add(profile.id);
      slots.add(`${profile.sheet}:${profile.col}:${profile.row}`);

      assert.equal(getBotAvatarById(profile.id)?.name, expected.name);
      assert.equal(getBotAvatarByName(expected.name)?.id, profile.id);
    });

    assert.equal(ids.size, 12);
    assert.equal(slots.size, 12);
  });

  it('resolves character avatars for both bots and humans with explicit avatarId while never falsely matching humans by display name alone', () => {
    for (const profile of BOT_AVATAR_PROFILES) {
      const byId = resolveBotAvatar({ type: 'bot', botAvatarId: profile.id, name: profile.name });
      assert.equal(byId?.id, profile.id);
      assert.equal(byId?.name, profile.name);

      const byName = resolveBotAvatar({ type: 'bot', name: profile.name });
      assert.equal(byName?.id, profile.id);

      const humanByAvatarId = resolveCharacterAvatar({
        type: 'human',
        avatarId: profile.id,
        name: 'Aarav',
      });
      assert.equal(humanByAvatarId?.id, profile.id);
      // Every character also maps cleanly to a personalised relief motion style for humans and bots
      assert.ok(getBotReliefMotionStyle(profile.id));
    }

    // A human who simply types a bot's display name without an explicit avatarId must not falsely match
    assert.equal(resolveCharacterAvatar({ type: 'human', name: 'Chotu Chaiwala' }), null);
    assert.equal(resolveBotAvatar({ type: 'human', name: 'Chotu Chaiwala' }), null);
    // Explicit botAvatarId/avatarId on a human resolves cleanly
    assert.equal(
      resolveCharacterAvatar({ type: 'human', botAvatarId: 'chotu-chaiwala', name: 'Aarav' })?.id,
      'chotu-chaiwala'
    );
  });

  it('picks 12 distinct characters without duplicates, avoids collisions, and respects savedAvatarId > preferredAvatarId precedence', () => {
    const rng = createSeededRng(101);
    const allTwelve = pickUniqueBotAvatars(12, { rng });
    assert.equal(new Set(allTwelve.map((p) => p.id)).size, 12);

    const avoided = pickUniqueBotAvatar({
      usedNames: ['chotu chaiwala'],
      rng: () => 0,
    });
    assert.notEqual(avoided.name.toLowerCase(), 'chotu chaiwala');

    // Future registered-account savedAvatarId takes precedence over guest preferredAvatarId
    const registeredWins = pickUniqueCharacterAvatar({
      savedAvatarId: 'surili',
      preferredAvatarId: 'babloo-uncle',
      usedAvatarIds: ['gappu'],
      rng,
    });
    assert.equal(registeredWins.profile.id, 'surili');
    assert.equal(registeredWins.wasReassigned, false);

    // When preferred character is already taken in a room, auto-assigns an unused character
    const collision = pickUniqueCharacterAvatar({
      preferredAvatarId: 'babloo-uncle',
      usedAvatarIds: ['babloo-uncle', 'surili'],
      rng,
    });
    assert.equal(collision.wasReassigned, true);
    assert.notEqual(collision.profile.id, 'babloo-uncle');
    assert.notEqual(collision.profile.id, 'surili');

    assert.equal(
      resolvePreferredAvatarId({ savedAvatarId: 'wifi-baba', selectedAvatarId: 'gappu' }),
      'wifi-baba'
    );
    assert.equal(
      resolvePreferredAvatarId({ savedAvatarId: null, selectedAvatarId: 'gappu' }),
      'gappu'
    );
    assert.equal(resolvePreferredAvatarId({ savedAvatarId: null, selectedAvatarId: '' }), undefined);
  });

  it('assigns unique character avatars across all human and bot seats in local modes and persists selectedAvatarId in localStorage', () => {
    const players = buildDefaultPlayers(6, 'Ranjit', 'bots', createSeededRng(7), 'rocky-raja');
    assert.equal(players[0].type, 'human');
    assert.equal(players[0].avatarId, 'rocky-raja');
    assert.equal(players[0].botAvatarId, 'rocky-raja');

    const bots = players.filter((p) => p.type === 'bot');
    assert.equal(bots.length, 5);
    assert.equal(new Set(players.map((p) => p.avatarId)).size, 6, 'All 6 seats (human + bots) must have unique characters');
    for (const b of bots) {
      const profile = getBotAvatarById(b.botAvatarId);
      assert.ok(profile);
      assert.equal(b.name, profile.name);
      assert.notEqual(b.avatarId, 'rocky-raja');
    }

    let lobby: LocalLobbyConfig = sanitizeLocalLobbyConfig({
      roomCode: 'LOC123',
      tableName: 'Practice',
      mode: 'bots',
      visibility: 'private',
      capacity: 3,
      difficulty: 'easy',
      players: buildDefaultPlayers(3, 'Ranjit', 'bots', createSeededRng(9)),
    });
    lobby = addLocalLobbySeat(lobby);
    assert.equal(new Set(lobby.players.map((p) => p.avatarId)).size, 4);

    // Toggle bot seat to human -> keeps a valid unique character avatar (does not strip it)
    lobby = updateLocalLobbyPlayer(lobby, 1, { type: 'human' });
    assert.equal(lobby.players[1].type, 'human');
    assert.ok(getBotAvatarById(lobby.players[1].avatarId));
    assert.equal(new Set(lobby.players.map((p) => p.avatarId)).size, 4);

    // Choosing another seat's character avatar swaps cleanly without duplicates
    const seat2Avatar = lobby.players[2].avatarId!;
    const seat0AvatarBefore = lobby.players[0].avatarId!;
    lobby = updateLocalLobbyPlayer(lobby, 0, { avatarId: seat2Avatar });
    assert.equal(lobby.players[0].avatarId, seat2Avatar);
    assert.equal(lobby.players[2].avatarId, seat0AvatarBefore);
    assert.equal(new Set(lobby.players.map((p) => p.avatarId)).size, 4);

    // Toggle back to bot -> still unique across all seats
    lobby = updateLocalLobbyPlayer(lobby, 1, { type: 'bot' });
    assert.equal(lobby.players[1].type, 'bot');
    assert.ok(getBotAvatarById(lobby.players[1].botAvatarId));
    assert.equal(new Set(lobby.players.map((p) => p.avatarId)).size, 4);

    // Verify localStorage persistence for selectedAvatarId
    const backing = new Map<string, string>();
    const prevStorage = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        backing.set(k, v);
      },
      removeItem: (k: string) => {
        backing.delete(k);
      },
      clear: () => backing.clear(),
      key: (i: number) => Array.from(backing.keys())[i] ?? null,
      get length() {
        return backing.size;
      },
    } as Storage;
    try {
      saveSettings({ ...DEFAULT_SETTINGS, playerName: 'Ranjit', selectedAvatarId: 'wifi-baba' });
      const reloaded = loadSettings();
      assert.equal(reloaded.selectedAvatarId, 'wifi-baba');
      assert.equal(reloaded.playerName, 'Ranjit');
    } finally {
      (globalThis as { localStorage?: Storage }).localStorage = prevStorage;
    }
  });

  it('assigns authoritative unique bot avatars across 2/3/4/6-player multiplayer rooms, syncs across clients, and preserves across reconnect & rematch', () => {
    const manager = new RoomManager(
      {
        onRoomUpdated: () => {},
        onNotification: () => {},
        onRoomClosed: () => {},
      },
      { cleanupIntervalMs: 0, rng: createSeededRng(2026) }
    );

    try {
      for (const capacity of [2, 3, 4, 6]) {
        const created = manager.createRoom({
          playerName: 'HostA',
          capacity,
          visibility: 'private',
        });
        assert.equal(created.ok, true);
        if (!created.ok) continue;

        const guest = manager.joinRoom({
          roomCode: created.room.roomCode,
          playerName: 'GuestB',
        });
        assert.equal(guest.ok, true);
        if (!guest.ok) continue;

        for (let i = 2; i < capacity; i++) {
          const added = manager.addBot(created.room.roomCode, created.playerId);
          assert.equal(added.ok, true);
        }

        const botSeats = created.room.seats.filter((s) => s.type === 'bot');
        assert.equal(botSeats.length, capacity - 2);
        assert.equal(new Set(botSeats.map((s) => s.botAvatarId)).size, botSeats.length);
        for (const s of botSeats) {
          const prof = getBotAvatarById(s.botAvatarId);
          assert.ok(prof);
          assert.equal(s.name, prof.name);
        }

        const started = manager.startGame(created.room.roomCode, created.playerId);
        assert.equal(started.ok, true);

        // Multi-client consistency check
        const viewA = manager.buildClientView(created.room, created.playerId);
        const viewB = manager.buildClientView(created.room, guest.playerId);
        assert.deepEqual(
          viewA.seats.map((s) => ({ id: s.playerId, name: s.name, avatar: s.botAvatarId })),
          viewB.seats.map((s) => ({ id: s.playerId, name: s.name, avatar: s.botAvatarId }))
        );
        assert.deepEqual(
          viewA.gameState?.players.map((p) => ({ id: p.id, name: p.name, avatar: p.botAvatarId })),
          viewB.gameState?.players.map((p) => ({ id: p.id, name: p.name, avatar: p.botAvatarId }))
        );

        // Reconnect preserves bot avatars identically
        manager.handleDisconnect(created.room.roomCode, guest.playerId);
        const recon = manager.reconnectPlayer(created.room.roomCode, guest.sessionToken);
        assert.equal(recon.ok, true);
        const viewAfterReconnect = manager.buildClientView(created.room, guest.playerId);
        assert.deepEqual(
          viewAfterReconnect.gameState?.players.map((p) => ({
            id: p.id,
            name: p.name,
            avatar: p.botAvatarId,
          })),
          viewA.gameState?.players.map((p) => ({ id: p.id, name: p.name, avatar: p.botAvatarId }))
        );

        // Finish game cleanly and verify rematch keeps exact same bot avatars & names
        if (capacity === 4 && created.room.gameState) {
          const originalBots = botSeats.map((s) => ({
            id: s.playerId,
            name: s.name,
            botAvatarId: s.botAvatarId,
          }));
          // Fast-forward match to completion via valid engine plays
          let guard = 0;
          while (created.room.gameState && created.room.gameState.phase !== 'finished' && guard < 400) {
            guard++;
            if (created.room.gameState.phase === 'trick_result') {
              created.room.gameState = continueAfterTrick(created.room.gameState);
              continue;
            }
            const turnId = created.room.gameState.currentTurnPlayerId!;
            const turnPlayer = created.room.gameState.players.find((p) => p.id === turnId)!;
            const ledSuit = created.room.gameState.currentTrick.ledSuit;
            const card = created.room.gameState.isFirstTurnOfGame
              ? turnPlayer.hand.find((c) => c.id === 'spades-14') ?? turnPlayer.hand[0]
              : ledSuit
                ? turnPlayer.hand.find((c) => c.suit === ledSuit) ?? turnPlayer.hand[0]
                : turnPlayer.hand[0];
            const res = playCard(created.room.gameState, turnId, card.id);
            assert.equal(res.ok, true);
            if (res.ok) created.room.gameState = res.state;
          }
          assert.equal(created.room.gameState?.phase, 'finished');
          created.room.status = 'finished';

          const req = manager.requestRematch(created.room.roomCode, created.playerId);
          assert.equal(req.ok, true);
          const resp = manager.respondRematch(created.room.roomCode, guest.playerId, true);
          assert.equal(resp.ok, true);
          const rematchStart = manager.startAcceptedRematch(
            created.room.roomCode,
            created.playerId
          );
          assert.equal(rematchStart.ok, true);

          const rematchBots = created.room.seats
            .filter((s) => s.type === 'bot')
            .map((s) => ({ id: s.playerId, name: s.name, botAvatarId: s.botAvatarId }));
          assert.deepEqual(rematchBots, originalBots);
        }
      }
    } finally {
      manager.disposeAll();
    }
  });
});

describe('Game Animation Gating, Deduplication & 4-Stage Failed Trick Sequence', () => {
  it('defaults animationsEnabled to true and respects both settings toggle and prefers-reduced-motion', () => {
    assert.equal(DEFAULT_SETTINGS.animationsEnabled, true);
    assert.equal(shouldPlayGameAnimations(true, false), true);
    assert.equal(shouldPlayGameAnimations(false, false), false);
    assert.equal(shouldPlayGameAnimations(true, true), false);
    assert.equal(shouldPlayGameAnimations(false, true), false);
  });

  it('produces deduplication keys strictly for failed tricks and never for successful tricks', () => {
    const failedKey = buildFailedTrickEventKey({
      type: 'failed',
      trickNumber: 3,
      ledSuit: 'spades',
      plays: [],
      offSuitPlay: { playerId: 'p2', card: { id: 'hearts-5', suit: 'hearts', rank: 5 }, order: 1 },
      collectorId: 'p1',
      collectedCards: [
        { id: 'spades-14', suit: 'spades', rank: 14 },
        { id: 'hearts-5', suit: 'hearts', rank: 5 },
      ],
      nextLeaderId: 'p1',
      newlyFinishedIds: [],
    });
    assert.equal(failedKey, 'failed:3:p1:2');

    const successOutcome = {
      type: 'success' as const,
      trickNumber: 4,
      ledSuit: 'clubs' as const,
      plays: [],
      highestPlay: { playerId: 'p1', card: { id: 'clubs-13', suit: 'clubs' as const, rank: 13 as const }, order: 0 },
      nextLeaderId: 'p1',
      newlyFinishedIds: [],
      removedCards: [{ id: 'clubs-13', suit: 'clubs' as const, rank: 13 as const }],
    };
    assert.equal(buildFailedTrickEventKey(successOutcome), null);
    assert.equal(buildSuccessTrickEventKey(successOutcome), 'success:4:1');
  });

  it('advances cleanly through all 4 failed-trick stages within ~1.45 seconds', () => {
    assert.ok(FAILED_TRICK_TIMING_MS.totalDurationMs >= 1000);
    assert.ok(FAILED_TRICK_TIMING_MS.totalDurationMs <= 1600);
    assert.equal(getFailedTrickStageForElapsed(0), 'banner');
    assert.equal(getFailedTrickStageForElapsed(300), 'reaction');
    assert.equal(getFailedTrickStageForElapsed(600), 'flying');
    assert.equal(getFailedTrickStageForElapsed(1100), 'finishing');
    assert.equal(getFailedTrickStageForElapsed(1500), 'idle');
  });
});
