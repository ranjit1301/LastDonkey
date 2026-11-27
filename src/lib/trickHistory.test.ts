import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  continueAfterTrick,
  createInitialGameState,
  getLegalCards,
  makeCard,
  markPlayerConnection,
  playCard,
  type Card,
  type GameState,
  type PlayerConfig,
} from '../engine/index.ts';
import { RoomManager, type InternalRoom } from '../server/roomManager.ts';
import { buildTrickHistoryView, cloneTrickOutcome } from './trickHistory.ts';

function mustPlay(state: GameState, playerId: string, cardId: string): GameState {
  const res = playCard(state, playerId, cardId);
  assert.equal(res.ok, true, res.ok ? undefined : `Expected legal play, got: ${res.error}`);
  return res.state;
}

function makeCustomGameState(
  hands: Array<{ id: string; name: string; cards: Card[] }>,
  opts: {
    trickNumber?: number;
    leaderIndex?: number;
    isFirstTurnOfGame?: boolean;
    difficulty?: 'easy' | 'medium' | 'hard';
  } = {}
): GameState {
  const configs: PlayerConfig[] = hands.map((h) => ({
    id: h.id,
    name: h.name,
    type: 'human',
  }));
  const base = createInitialGameState(configs, { difficulty: opts.difficulty ?? 'easy' });
  const players = base.players.map((p, idx) => ({
    ...p,
    hand: [...hands[idx].cards],
    finished: false,
    finishOrder: null,
    removed: false,
  }));
  const leaderIdx = opts.leaderIndex ?? 0;
  const leaderId = players[leaderIdx].id;
  return {
    ...base,
    phase: 'playing',
    difficulty: opts.difficulty ?? 'easy',
    players,
    currentTurnPlayerId: leaderId,
    isFirstTurnOfGame: opts.isFirstTurnOfGame ?? false,
    currentTrick: {
      trickNumber: opts.trickNumber ?? 1,
      ledSuit: null,
      plays: [],
      expectedPlayerIds: players.map((p) => p.id),
    },
    lastOutcome: null,
    trickHistory: [],
    removedCards: [],
    finishGroups: [],
    finishOrder: [],
    donkeyPlayerId: null,
    endReason: null,
  };
}

function createTestRoomManager(overrides = {}) {
  return new RoomManager(
    {
      onRoomUpdated: () => {},
      onNotification: () => {},
      onRoomClosed: () => {},
    },
    {
      publicVacancyTimeoutMs: 60,
      rematchTimeoutMs: 200,
      botDelayMs: 5,
      trickSuccessDelayMs: 5,
      trickFailDelayMs: 5,
      aiAutoStartDelayMs: 5,
      cleanupIntervalMs: 0,
      ...overrides,
    }
  );
}

let activeManager: RoomManager | null = null;
afterEach(() => {
  activeManager?.disposeAll();
  activeManager = null;
});

describe('Trick History — Recording, Formatting & Chronological Accumulation', () => {
  it('records successful tricks with exact play order, player attribution, winner details, and no failure reason', () => {
    let state = makeCustomGameState(
      [
        { id: 'p1', name: 'Aarav', cards: [makeCard('hearts', 7), makeCard('clubs', 2)] },
        { id: 'p2', name: 'Meera', cards: [makeCard('hearts', 13), makeCard('clubs', 5)] },
        { id: 'p3', name: 'Kabir', cards: [makeCard('hearts', 10)] },
      ],
      { leaderIndex: 0, trickNumber: 1 }
    );

    // Play order: Aarav (7♥) -> Meera (K♥) -> Kabir (10♥, finishes safe)
    state = mustPlay(state, 'p1', 'hearts-7');
    state = mustPlay(state, 'p2', 'hearts-13');
    state = mustPlay(state, 'p3', 'hearts-10');

    assert.equal(state.trickHistory.length, 1);
    const view = buildTrickHistoryView(state.trickHistory, state.players);

    assert.deepEqual(view.summary, {
      totalTricks: 1,
      successfulTricks: 1,
      failedTricks: 0,
    });
    assert.equal(view.entries.length, 1);

    const entry = view.entries[0];
    assert.equal(entry.trickNumber, 1);
    assert.equal(entry.type, 'success');
    assert.equal(entry.ledSuit, 'hearts');
    assert.equal(entry.winnerName, 'Meera');
    assert.equal(entry.collectorName, null);
    assert.equal(entry.affectedCardCount, 3);
    assert.equal(entry.failureReason, null);
    assert.deepEqual(entry.newlyFinishedNames, ['Kabir']);
    assert.match(entry.outcomeText, /Meera played highest \(K♥\)/);
    assert.match(entry.outcomeText, /3 cards discarded/);
    assert.match(entry.outcomeText, /Meera leads next/);

    // Exact play order and player attribution preserved
    assert.deepEqual(
      entry.plays.map((p) => ({
        playerName: p.playerName,
        cardId: p.card.id,
        order: p.order,
        isLead: p.isLead,
        isHighestLed: p.isHighestLed,
        isOffSuitCut: p.isOffSuitCut,
      })),
      [
        {
          playerName: 'Aarav',
          cardId: 'hearts-7',
          order: 0,
          isLead: true,
          isHighestLed: false,
          isOffSuitCut: false,
        },
        {
          playerName: 'Meera',
          cardId: 'hearts-13',
          order: 1,
          isLead: false,
          isHighestLed: true,
          isOffSuitCut: false,
        },
        {
          playerName: 'Kabir',
          cardId: 'hearts-10',
          order: 2,
          isLead: false,
          isHighestLed: false,
          isOffSuitCut: false,
        },
      ]
    );
  });

  it('records failed off-suit cuts with exact failure reason, collector details, and play order', () => {
    let state = makeCustomGameState(
      [
        { id: 'p1', name: 'Aarav', cards: [makeCard('spades', 9), makeCard('clubs', 3)] },
        { id: 'p2', name: 'Meera', cards: [makeCard('spades', 14), makeCard('clubs', 6)] },
        { id: 'p3', name: 'Kabir', cards: [makeCard('diamonds', 12), makeCard('clubs', 9)] },
      ],
      { leaderIndex: 0, trickNumber: 1 }
    );

    // Aarav leads 9♠, Meera follows with A♠ (highest), Kabir cannot follow ♠ and cuts with Q♦
    state = mustPlay(state, 'p1', 'spades-9');
    state = mustPlay(state, 'p2', 'spades-14');
    state = mustPlay(state, 'p3', 'diamonds-12');

    assert.equal(state.trickHistory.length, 1);
    const view = buildTrickHistoryView(state.trickHistory, state.players);

    assert.deepEqual(view.summary, {
      totalTricks: 1,
      successfulTricks: 0,
      failedTricks: 1,
    });

    const entry = view.entries[0];
    assert.equal(entry.trickNumber, 1);
    assert.equal(entry.type, 'failed');
    assert.equal(entry.ledSuit, 'spades');
    assert.equal(entry.winnerName, null);
    assert.equal(entry.collectorName, 'Meera');
    assert.equal(entry.affectedCardCount, 3);
    assert.equal(
      entry.failureReason,
      'Kabir cut off-suit with Q♦ (could not follow ♠ Spades)'
    );
    assert.match(entry.outcomeText, /Meera \(highest ♠ Spades\) collected 3 cards and leads next/);

    assert.deepEqual(
      entry.plays.map((p) => ({
        playerName: p.playerName,
        cardId: p.card.id,
        order: p.order,
        isLead: p.isLead,
        isHighestLed: p.isHighestLed,
        isOffSuitCut: p.isOffSuitCut,
      })),
      [
        {
          playerName: 'Aarav',
          cardId: 'spades-9',
          order: 0,
          isLead: true,
          isHighestLed: false,
          isOffSuitCut: false,
        },
        {
          playerName: 'Meera',
          cardId: 'spades-14',
          order: 1,
          isLead: false,
          isHighestLed: true,
          isOffSuitCut: false,
        },
        {
          playerName: 'Kabir',
          cardId: 'diamonds-12',
          order: 2,
          isLead: false,
          isHighestLed: false,
          isOffSuitCut: true,
        },
      ]
    );
  });

  it('accumulates multiple mixed successful and failed tricks in strict chronological order across transitions and reconnects', () => {
    let state = makeCustomGameState(
      [
        {
          id: 'p1',
          name: 'Riya',
          cards: [makeCard('hearts', 10), makeCard('clubs', 8), makeCard('diamonds', 4)],
        },
        {
          id: 'p2',
          name: 'Dev',
          cards: [makeCard('hearts', 4), makeCard('diamonds', 13)],
        },
      ],
      { leaderIndex: 0, trickNumber: 1 }
    );

    // Trick 1 (Success): Riya leads 10♥, Dev follows 4♥ -> Riya wins & leads next
    state = mustPlay(state, 'p1', 'hearts-10');
    state = mustPlay(state, 'p2', 'hearts-4');
    assert.equal(state.phase, 'trick_result');
    state = continueAfterTrick(state);
    assert.equal(state.trickHistory.length, 1);

    // Simulate disconnect/reconnect mid-match via markPlayerConnection
    state = markPlayerConnection(state, 'p2', false);
    state = markPlayerConnection(state, 'p2', true);
    assert.equal(state.trickHistory.length, 1);

    // Trick 2 (Failed Cut): Riya leads 8♣, Dev has no clubs and cuts with K♦ (Dev finishes safe!)
    // Riya collects 8♣ + K♦ and becomes the Donkey (only active player remaining) -> Game finished!
    state = mustPlay(state, 'p1', 'clubs-8');
    state = mustPlay(state, 'p2', 'diamonds-13');
    assert.equal(state.phase, 'finished');
    assert.equal(state.donkeyPlayerId, 'p1');
    assert.equal(state.trickHistory.length, 2);

    // Verify buildTrickHistoryView preserves strict chronological order even if given reversed input
    const reversedView = buildTrickHistoryView(
      [...state.trickHistory].reverse(),
      state.players
    );

    assert.deepEqual(reversedView.summary, {
      totalTricks: 2,
      successfulTricks: 1,
      failedTricks: 1,
    });
    assert.deepEqual(
      reversedView.entries.map((e) => ({ trickNumber: e.trickNumber, type: e.type })),
      [
        { trickNumber: 1, type: 'success' },
        { trickNumber: 2, type: 'failed' },
      ]
    );
    assert.equal(reversedView.entries[0].failureReason, null);
    assert.equal(
      reversedView.entries[1].failureReason,
      'Dev cut off-suit with K♦ (could not follow ♣ Clubs)'
    );
    assert.deepEqual(reversedView.entries[1].newlyFinishedNames, ['Dev']);
    assert.match(reversedView.entries[1].outcomeText, /on the final trick/);
  });
});

describe('Trick History — Multiplayer Visibility, Security, Reconnects & Rematch Reset', () => {
  it('hides full history mid-game in Hard mode, preserves history across reconnects, shares identical history with all players on completion, and resets cleanly on rematch', () => {
    const manager = createTestRoomManager();
    activeManager = manager;

    const created = manager.createRoom({
      playerName: 'Aarav',
      capacity: 2,
      visibility: 'private',
      difficulty: 'hard',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const joined = manager.joinRoom({
      roomCode: created.room.roomCode,
      playerName: 'Meera',
    });
    assert.equal(joined.ok, true);
    if (!joined.ok) return;

    const p1Id = created.playerId;
    const p2Id = joined.playerId;
    const roomCode = created.room.roomCode;

    const started = manager.startGame(roomCode, p1Id);
    assert.equal(started.ok, true);

    const room = manager.getRoom(roomCode) as InternalRoom;
    assert.ok(room?.gameState);

    // Replace hands with a deterministic 2-trick endgame (1 successful trick + 1 failed cut finishing the match)
    room.gameState = {
      ...room.gameState,
      phase: 'playing',
      difficulty: 'hard',
      currentTurnPlayerId: p1Id,
      isFirstTurnOfGame: false,
      currentTrick: {
        trickNumber: 1,
        ledSuit: null,
        plays: [],
        expectedPlayerIds: [p1Id, p2Id],
      },
      lastOutcome: null,
      trickHistory: [],
      removedCards: [],
      finishGroups: [],
      finishOrder: [],
      donkeyPlayerId: null,
      endReason: null,
      players: room.gameState.players.map((p) => ({
        ...p,
        hand:
          p.id === p1Id
            ? [makeCard('hearts', 10), makeCard('clubs', 8), makeCard('diamonds', 4)]
            : [makeCard('hearts', 4), makeCard('diamonds', 13)],
        finished: false,
        finishOrder: null,
        removed: false,
      })),
    };

    // Trick 1 (Success): p1 plays 10♥, p2 plays 4♥
    assert.equal(manager.playCardAction(roomCode, p1Id, 'hearts-10').ok, true);
    assert.equal(manager.playCardAction(roomCode, p2Id, 'hearts-4').ok, true);

    // Authoritative server state already has Trick 1 recorded
    assert.ok(room.gameState);
    assert.equal(room.gameState.trickHistory.length, 1);

    // Mid-game Hard mode: buildClientView MUST NOT leak trickHistory or opponent hands
    const midViewP1 = manager.buildClientView(room, p1Id);
    const midViewP2 = manager.buildClientView(room, p2Id);
    assert.equal(midViewP1.gameState?.trickHistory.length, 0);
    assert.equal(midViewP2.gameState?.trickHistory.length, 0);
    assert.equal(
      midViewP1.gameState?.players.find((p) => p.id === p2Id)?.hand.length,
      0
    );

    // Advance immediately into Trick 2 (skipping wait for trickTimer)
    room.gameState = continueAfterTrick(room.gameState);

    // Disconnect and reconnect p2 mid-game; authoritative history must survive intact
    manager.handleDisconnect(roomCode, p2Id);
    const reconMid = manager.reconnectPlayer(roomCode, joined.sessionToken);
    assert.equal(reconMid.ok, true);
    assert.equal(room.gameState.trickHistory.length, 1);

    // Trick 2 (Failed cut -> match completes): p1 leads 8♣, p2 cuts with K♦ and finishes safe
    assert.equal(manager.playCardAction(roomCode, p1Id, 'clubs-8').ok, true);
    assert.equal(manager.playCardAction(roomCode, p2Id, 'diamonds-13').ok, true);

    assert.equal(room.status, 'finished');
    assert.equal(room.gameState.phase, 'finished');
    assert.equal(room.gameState.trickHistory.length, 2);

    // After match completion, ALL eligible players receive the exact same complete chronological history
    const finalViewP1 = manager.buildClientView(room, p1Id);
    const finalViewP2 = manager.buildClientView(room, p2Id);

    assert.equal(finalViewP1.gameState?.trickHistory.length, 2);
    assert.equal(finalViewP2.gameState?.trickHistory.length, 2);
    assert.deepEqual(finalViewP1.gameState?.trickHistory, finalViewP2.gameState?.trickHistory);

    // Verify chronological order and outcomes from the wire payload
    const renderedForP1 = buildTrickHistoryView(
      finalViewP1.gameState!.trickHistory,
      finalViewP1.gameState!.players,
      finalViewP1.seats
    );
    const renderedForP2 = buildTrickHistoryView(
      finalViewP2.gameState!.trickHistory,
      finalViewP2.gameState!.players,
      finalViewP2.seats
    );
    assert.deepEqual(renderedForP1, renderedForP2);
    assert.deepEqual(renderedForP1.summary, {
      totalTricks: 2,
      successfulTricks: 1,
      failedTricks: 1,
    });
    assert.equal(renderedForP1.entries[0].type, 'success');
    assert.equal(renderedForP1.entries[1].type, 'failed');
    assert.equal(
      renderedForP1.entries[1].failureReason,
      'Meera cut off-suit with K♦ (could not follow ♣ Clubs)'
    );

    // Verify defensive cloning: mutating client view trickHistory cannot mutate authoritative server state
    finalViewP1.gameState!.trickHistory[0].plays.pop();
    assert.equal(room.gameState.trickHistory[0].plays.length, 2);

    // Reconnect AFTER game completion still receives the full Trick History
    manager.handleDisconnect(roomCode, p2Id);
    const reconFinished = manager.reconnectPlayer(roomCode, joined.sessionToken);
    assert.equal(reconFinished.ok, true);
    const postReconViewP2 = manager.buildClientView(room, p2Id);
    assert.equal(postReconViewP2.gameState?.trickHistory.length, 2);

    // Rematch flow: requesting, accepting, and starting rematch MUST reset trickHistory cleanly
    const reqRematch = manager.requestRematch(roomCode, p1Id);
    assert.equal(reqRematch.ok, true);
    const respRematch = manager.respondRematch(roomCode, p2Id, true);
    assert.equal(respRematch.ok, true);
    const startRematch = manager.startAcceptedRematch(roomCode, p1Id);
    assert.equal(startRematch.ok, true);

    assert.equal(room.status, 'playing');
    assert.ok(room.gameState);
    assert.equal(room.gameState.phase, 'playing');
    assert.equal(room.gameState.trickHistory.length, 0);
    assert.equal(room.gameState.lastOutcome, null);

    // Verify legal move on rematch starts cleanly at trick #1 with empty history
    const activePlayerId = room.gameState.currentTurnPlayerId;
    assert.ok(activePlayerId);
    const legal = getLegalCards(room.gameState, activePlayerId);
    assert.ok(legal.length > 0);
    assert.equal(manager.buildClientView(room, p1Id).gameState?.trickHistory.length, 0);
    assert.equal(manager.buildClientView(room, p2Id).gameState?.trickHistory.length, 0);
  });

  it('exposes only the latest trick mid-game in Easy/Medium mode and reveals full history only on finish', () => {
    const manager = createTestRoomManager();
    activeManager = manager;

    const created = manager.createRoom({
      playerName: 'Host',
      capacity: 2,
      visibility: 'private',
      difficulty: 'medium',
      turnTimerSeconds: 0,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const joined = manager.joinRoom({
      roomCode: created.room.roomCode,
      playerName: 'Guest',
    });
    assert.equal(joined.ok, true);
    if (!joined.ok) return;

    const p1Id = created.playerId;
    const p2Id = joined.playerId;
    const roomCode = created.room.roomCode;
    assert.equal(manager.startGame(roomCode, p1Id).ok, true);

    const room = manager.getRoom(roomCode) as InternalRoom;
    assert.ok(room.gameState);
    room.gameState = {
      ...room.gameState,
      phase: 'playing',
      difficulty: 'medium',
      currentTurnPlayerId: p1Id,
      isFirstTurnOfGame: false,
      currentTrick: {
        trickNumber: 1,
        ledSuit: null,
        plays: [],
        expectedPlayerIds: [p1Id, p2Id],
      },
      lastOutcome: null,
      trickHistory: [],
      removedCards: [],
      finishGroups: [],
      finishOrder: [],
      donkeyPlayerId: null,
      endReason: null,
      players: room.gameState.players.map((p) => ({
        ...p,
        hand:
          p.id === p1Id
            ? [makeCard('hearts', 10), makeCard('spades', 10), makeCard('clubs', 8)]
            : [makeCard('hearts', 4), makeCard('spades', 4), makeCard('diamonds', 13)],
        finished: false,
        finishOrder: null,
        removed: false,
      })),
    };

    // Complete Trick 1 (Success)
    assert.equal(manager.playCardAction(roomCode, p1Id, 'hearts-10').ok, true);
    assert.equal(manager.playCardAction(roomCode, p2Id, 'hearts-4').ok, true);
    room.gameState = continueAfterTrick(room.gameState);

    // Complete Trick 2 (Success)
    assert.equal(manager.playCardAction(roomCode, p1Id, 'spades-10').ok, true);
    assert.equal(manager.playCardAction(roomCode, p2Id, 'spades-4').ok, true);

    // Server has 2 tricks, but mid-game Medium client view only gets the 1 most recent trick (no full history leakage)
    assert.equal(room.gameState.trickHistory.length, 2);
    const midView = manager.buildClientView(room, p1Id);
    assert.equal(midView.gameState?.trickHistory.length, 1);
    assert.equal(midView.gameState?.trickHistory[0].trickNumber, 2);

    // Advance & complete Trick 3 (Failed cut -> game finishes)
    room.gameState = continueAfterTrick(room.gameState);
    assert.equal(manager.playCardAction(roomCode, p1Id, 'clubs-8').ok, true);
    assert.equal(manager.playCardAction(roomCode, p2Id, 'diamonds-13').ok, true);

    const endView = manager.buildClientView(room, p1Id);
    assert.equal(endView.gameState?.phase, 'finished');
    assert.deepEqual(
      endView.gameState?.trickHistory.map((t) => t.trickNumber),
      [1, 2, 3]
    );
  });

  it('cloneTrickOutcome creates a deep-cloned copy independent of the original outcome', () => {
    const state = makeCustomGameState(
      [
        { id: 'p1', name: 'Aarav', cards: [makeCard('hearts', 7), makeCard('clubs', 2)] },
        { id: 'p2', name: 'Meera', cards: [makeCard('diamonds', 12), makeCard('clubs', 5)] },
      ],
      { leaderIndex: 0, trickNumber: 1 }
    );
    const s1 = mustPlay(state, 'p1', 'hearts-7');
    const s2 = mustPlay(s1, 'p2', 'diamonds-12');
    const original = s2.trickHistory[0];
    const cloned = cloneTrickOutcome(original);

    assert.deepEqual(cloned, original);
    assert.notEqual(cloned, original);
    assert.notEqual(cloned.plays, original.plays);
    assert.notEqual(cloned.plays[0].card, original.plays[0].card);
    cloned.plays[0].card.rank = 14;
    assert.equal(original.plays[0].card.rank, 7);
  });
});
