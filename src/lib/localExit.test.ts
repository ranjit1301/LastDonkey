import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACE_OF_SPADES_ID,
  continueAfterTrick,
  createInitialGameState,
  makeCard,
  playCard,
  type GameState,
  type PlayerConfig,
} from '../engine';
import {
  executeLocalVoluntaryExit,
  resolvePassAndPlayPerspectivePlayer,
  shouldHidePassAndPlayHand,
  shouldShowPassAndPlayPrivacyCurtain,
} from './localExit';

function makeHumanPlayers(count: number): PlayerConfig[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `p${idx + 1}`,
    name: `Player ${idx + 1}`,
    type: 'human',
  }));
}

function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('Phase 2 Batch 2 — Pass-and-Play Voluntary Exit & Handoff', () => {
  it('rejects exit during an unresolved trick without modifying game state', () => {
    const initial = createInitialGameState(makeHumanPlayers(4), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 5), makeCard('clubs', 7)],
        [makeCard('spades', 10), makeCard('hearts', 6), makeCard('clubs', 8)],
        [makeCard('spades', 6), makeCard('hearts', 7), makeCard('clubs', 9)],
        [makeCard('spades', 2), makeCard('hearts', 8), makeCard('clubs', 10)],
      ],
    });

    // p1 plays A♠ -> trick is now unresolved (1 of 4 plays)
    const midTrick = (playCard(initial, 'p1', ACE_OF_SPADES_ID) as { ok: true; state: GameState })
      .state;
    const snapshot = JSON.stringify(midTrick);

    const res = executeLocalVoluntaryExit(midTrick, 'p2', { isPassAndPlay: true });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /middle of a trick/i);
      assert.equal(res.shouldLeaveToLobby, false);
      assert.equal(JSON.stringify(res.nextState), snapshot);
    }
  });

  it('redistributes cards one at a time clockwise between tricks and keeps match alive when multiple active players remain', () => {
    const initial = createInitialGameState(makeHumanPlayers(4), {
      customHands: [
        // Trick 1 spades + 5 extra cards for p2 (who will exit after Trick 1!)
        [makeCard('spades', 14), makeCard('hearts', 4)],
        [
          makeCard('spades', 10),
          makeCard('diamonds', 2),
          makeCard('diamonds', 5),
          makeCard('diamonds', 8),
          makeCard('clubs', 3),
          makeCard('clubs', 9),
        ],
        [makeCard('spades', 6), makeCard('hearts', 7)],
        [makeCard('spades', 2), makeCard('hearts', 9)],
      ],
    });

    // Complete Trick 1 (Spades succeed -> p1 leads Trick 2 with 0 plays)
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // p2 exits between tricks with 5 cards.
    // Clockwise active recipients starting strictly AFTER p2 (seat 1): p3 (seat 2), p4 (seat 3), p1 (seat 0).
    // 5 cards dealt one at a time clockwise -> p3 (+2), p4 (+2), p1 (+1)!
    const beforeCardIds = new Set(s.players.flatMap((p) => p.hand.map((c) => c.id)));
    const exitRes = executeLocalVoluntaryExit(s, 'p2', {
      isPassAndPlay: true,
      rng: createSeededRng(42),
    });

    assert.equal(exitRes.ok, true);
    if (!exitRes.ok) return;

    assert.equal(exitRes.shouldLeaveToLobby, false, 'Must NOT destroy match or navigate away');
    assert.equal(exitRes.shouldResetReveal, true);
    assert.equal(exitRes.cardsDistributedCount, 5);
    assert.ok(exitRes.nextState !== null);
    assert.equal(exitRes.nextState.phase, 'playing');

    const next = exitRes.nextState;
    const p1 = next.players.find((p) => p.id === 'p1')!;
    const p2 = next.players.find((p) => p.id === 'p2')!;
    const p3 = next.players.find((p) => p.id === 'p3')!;
    const p4 = next.players.find((p) => p.id === 'p4')!;

    assert.equal(p2.removed, true);
    assert.equal(p2.hand.length, 0);
    assert.equal(next.lastRedistribution?.recipientCounts['p3'], 2);
    assert.equal(next.lastRedistribution?.recipientCounts['p4'], 2);
    assert.equal(next.lastRedistribution?.recipientCounts['p1'], 1);
    assert.equal(p3.hand.length, 3); // 1 + 2
    assert.equal(p4.hand.length, 3); // 1 + 2
    assert.equal(p1.hand.length, 2); // 1 + 1

    // Exact card conservation (zero duplicates, zero lost cards)
    const afterCardIds = new Set(next.players.flatMap((p) => p.hand.map((c) => c.id)));
    assert.equal(afterCardIds.size, beforeCardIds.size);
    for (const id of beforeCardIds) {
      assert.equal(afterCardIds.has(id), true);
    }

    // Turn order & current leader remain valid and exclude p2
    assert.equal(next.currentTurnPlayerId, 'p1');
    assert.deepEqual(next.currentTrick.expectedPlayerIds, ['p1', 'p3', 'p4']);

    // Match continues cleanly into Trick 2!
    const play1 = playCard(next, 'p1', p1.hand[0].id);
    assert.equal(play1.ok, true);
  });

  it('does NOT redistribute cards to players who have already finished', () => {
    const initial = createInitialGameState(makeHumanPlayers(4), {
      customHands: [
        [makeCard('spades', 14), makeCard('diamonds', 4), makeCard('diamonds', 7), makeCard('diamonds', 9)],
        [makeCard('spades', 10)], // p2 finishes officially on Trick 1!
        [makeCard('spades', 6), makeCard('hearts', 5), makeCard('clubs', 6)],
        [makeCard('spades', 2), makeCard('hearts', 8), makeCard('clubs', 9)],
      ],
    });

    // Trick 1 resolves -> p2 finishes #1!
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    assert.equal(s.players[1].finished, true);
    assert.equal(s.players[1].hand.length, 0);

    // p1 (current leader!) voluntarily exits with 3 Diamonds -> p2 is finished and MUST be skipped!
    // Clockwise active recipients after p1 are: p3 (+2) and p4 (+1). Leader passes clockwise to p3!
    const exitRes = executeLocalVoluntaryExit(s, 'p1', {
      isPassAndPlay: true,
      rng: createSeededRng(7),
    });
    assert.equal(exitRes.ok, true);
    if (!exitRes.ok || !exitRes.nextState) return;

    const next = exitRes.nextState;
    const p2 = next.players.find((p) => p.id === 'p2')!;
    const p3 = next.players.find((p) => p.id === 'p3')!;
    const p4 = next.players.find((p) => p.id === 'p4')!;

    assert.equal(p2.finished, true);
    assert.equal(p2.hand.length, 0, 'Finished player must never receive redistributed cards');
    assert.equal(next.lastRedistribution?.recipientCounts['p2'], undefined);
    assert.equal(next.lastRedistribution?.recipientCounts['p3'], 2);
    assert.equal(next.lastRedistribution?.recipientCounts['p4'], 1);
    assert.equal(p3.hand.length, 4); // 2 + 2
    assert.equal(p4.hand.length, 3); // 2 + 1

    // Current leader updated clockwise to p3 (skipping finished p2)
    assert.equal(next.currentTurnPlayerId, 'p3');
    assert.deepEqual(next.currentTrick.expectedPlayerIds, ['p3', 'p4']);
  });

  it('handles an exiting player with zero cards without unnecessary redistribution', () => {
    const initial = createInitialGameState(makeHumanPlayers(3), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 5)],
        [makeCard('spades', 10), makeCard('hearts', 6)],
        [makeCard('spades', 6), makeCard('hearts', 7)],
      ],
    });

    // Finish Trick 1
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Construct a synthetic zero-card active player state to verify no shuffle/redistribution runs
    const zeroCardState: GameState = {
      ...s,
      players: s.players.map((p) => (p.id === 'p2' ? { ...p, hand: [] } : p)),
    };

    let rngCalled = false;
    const exitRes = executeLocalVoluntaryExit(zeroCardState, 'p2', {
      isPassAndPlay: true,
      rng: () => {
        rngCalled = true;
        return 0.5;
      },
    });

    assert.equal(exitRes.ok, true);
    if (!exitRes.ok || !exitRes.nextState) return;

    assert.equal(rngCalled, false, 'Zero-card exit must not perform unnecessary shuffling');
    assert.equal(exitRes.cardsDistributedCount, 0);
    assert.equal(exitRes.shouldLeaveToLobby, false);
    assert.equal(exitRes.nextState.players[0].hand.length, 1);
    assert.equal(exitRes.nextState.players[2].hand.length, 1);
    assert.equal(exitRes.nextState.players[1].removed, true);
    assert.deepEqual(exitRes.nextState.currentTrick.expectedPlayerIds, ['p1', 'p3']);
    assert.doesNotMatch(exitRes.toast?.message ?? '', /redistributed/i);
  });

  it('determines the Donkey correctly when only one active player remains after Pass-and-Play exit', () => {
    const initial = createInitialGameState(makeHumanPlayers(3), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 5), makeCard('clubs', 7)],
        [makeCard('spades', 10)], // p2 finishes on Trick 1
        [makeCard('spades', 6), makeCard('diamonds', 8)],
      ],
    });

    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Active players are now p1 and p3 (p2 is finished #1).
    // p1 exits -> cards go to p3 -> only 1 active player (p3) remains -> p3 is declared Donkey!
    const exitRes = executeLocalVoluntaryExit(s, 'p1', {
      isPassAndPlay: true,
      rng: createSeededRng(13),
    });

    assert.equal(exitRes.ok, true);
    if (!exitRes.ok || !exitRes.nextState) return;

    assert.equal(exitRes.shouldLeaveToLobby, false, 'Should show Results screen with Donkey, not abandon to lobby');
    assert.equal(exitRes.nextState.phase, 'finished');
    assert.equal(exitRes.nextState.donkeyPlayerId, 'p3');
    assert.equal(exitRes.nextState.currentTurnPlayerId, null);
    // p3 received p1's 2 cards (1 + 2 = 3); finished p2 still has 0
    assert.equal(exitRes.nextState.players[2].hand.length, 3);
    assert.equal(exitRes.nextState.players[1].hand.length, 0);
  });

  it('prevents duplicate exit requests from causing duplicate redistribution or errors', () => {
    const initial = createInitialGameState(makeHumanPlayers(4), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 5)],
        [makeCard('spades', 10), makeCard('diamonds', 4), makeCard('diamonds', 9)],
        [makeCard('spades', 6), makeCard('clubs', 7)],
        [makeCard('spades', 2), makeCard('clubs', 8)],
      ],
    });

    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    const first = executeLocalVoluntaryExit(s, 'p2', {
      isPassAndPlay: true,
      rng: createSeededRng(99),
    });
    assert.equal(first.ok, true);
    if (!first.ok || !first.nextState) return;

    const afterFirstSnapshot = JSON.stringify(first.nextState);
    assert.equal(first.nextState.redistributionHistory?.length, 1);

    // Duplicate exit request for p2 MUST be rejected cleanly with zero state mutation
    const duplicate = executeLocalVoluntaryExit(first.nextState, 'p2', {
      isPassAndPlay: true,
      rng: createSeededRng(99),
    });
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) {
      assert.match(duplicate.error, /already exited/i);
      assert.equal(JSON.stringify(duplicate.nextState), afterFirstSnapshot);
      assert.equal(duplicate.nextState.redistributionHistory?.length, 1);
    }
  });

  it('maintains strict Pass-and-Play privacy handoff after exit and never exposes another human’s hand', () => {
    const initial = createInitialGameState(makeHumanPlayers(3), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 5), makeCard('clubs', 4)],
        [makeCard('spades', 10), makeCard('hearts', 6), makeCard('clubs', 5)],
        [makeCard('spades', 6), makeCard('hearts', 7), makeCard('clubs', 6)],
      ],
    });

    // Trick 1 finishes -> phase === 'trick_result', p3 just played last card (revealedPlayerId === 'p3')
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    assert.equal(s.phase, 'trick_result');

    // During trick_result, perspective stays on active holding human (p3), and ALL hands are concealed!
    const trickResultPerspective = resolvePassAndPlayPerspectivePlayer({
      phase: s.phase,
      activeTurnPlayer: null,
      nextLeaderId: s.lastOutcome?.nextLeaderId ?? null,
      players: s.players,
      revealedPlayerId: 'p3',
    });
    assert.equal(trickResultPerspective.id, 'p3');
    assert.equal(
      shouldHidePassAndPlayHand({
        isPassAndPlay: true,
        openHandsTesting: false,
        phase: s.phase,
        activeTurnPlayer: null,
        perspectivePlayer: trickResultPerspective,
        revealedPlayerId: 'p3',
      }),
      true
    );

    // Advance to Trick 2 -> p1 leads. p1 reveals their hand, then exits!
    s = continueAfterTrick(s);
    const exitRes = executeLocalVoluntaryExit(s, 'p1', {
      isPassAndPlay: true,
      rng: createSeededRng(21),
    });
    assert.equal(exitRes.ok, true);
    if (!exitRes.ok || !exitRes.nextState) return;
    const afterExit = exitRes.nextState;

    // Leader is now p2. Even if revealedPlayerId still momentarily holds 'p1' before effect reset,
    // the privacy curtain MUST show for p2 AND p2's hand MUST remain hidden!
    const nextActiveTurn = afterExit.players.find((p) => p.id === afterExit.currentTurnPlayerId)!;
    assert.equal(nextActiveTurn.id, 'p2');

    const perspectiveAfterExit = resolvePassAndPlayPerspectivePlayer({
      phase: afterExit.phase,
      activeTurnPlayer: nextActiveTurn,
      nextLeaderId: null,
      players: afterExit.players,
      revealedPlayerId: 'p1',
    });
    assert.equal(perspectiveAfterExit.id, 'p2');

    assert.equal(
      shouldShowPassAndPlayPrivacyCurtain({
        isPassAndPlay: true,
        openHandsTesting: false,
        phase: afterExit.phase,
        activeTurnPlayer: nextActiveTurn,
        revealedPlayerId: 'p1',
      }),
      true,
      'Next human player MUST receive the Pass Device handoff screen after exit'
    );
    assert.equal(
      shouldHidePassAndPlayHand({
        isPassAndPlay: true,
        openHandsTesting: false,
        phase: afterExit.phase,
        activeTurnPlayer: nextActiveTurn,
        perspectivePlayer: perspectiveAfterExit,
        revealedPlayerId: 'p1',
      }),
      true,
      'Next human player’s hand MUST stay hidden until they tap Show Hand'
    );

    // Once p2 confirms handoff (revealedPlayerId === 'p2'), curtain hides and p2's hand is shown!
    assert.equal(
      shouldShowPassAndPlayPrivacyCurtain({
        isPassAndPlay: true,
        openHandsTesting: false,
        phase: afterExit.phase,
        activeTurnPlayer: nextActiveTurn,
        revealedPlayerId: 'p2',
      }),
      false
    );
    assert.equal(
      shouldHidePassAndPlayHand({
        isPassAndPlay: true,
        openHandsTesting: false,
        phase: afterExit.phase,
        activeTurnPlayer: nextActiveTurn,
        perspectivePlayer: perspectiveAfterExit,
        revealedPlayerId: 'p2',
      }),
      false
    );
  });

  it('preserves Practice vs Bots voluntary exit behavior unchanged', () => {
    const practicePlayers: PlayerConfig[] = [
      { id: 'human', name: 'You', type: 'human' },
      { id: 'b1', name: 'Bot Raju', type: 'bot' },
      { id: 'b2', name: 'Bot Pinky', type: 'bot' },
    ];
    const initial = createInitialGameState(practicePlayers, {
      difficulty: 'medium',
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 5), makeCard('clubs', 6)],
        [makeCard('spades', 10), makeCard('hearts', 7), makeCard('clubs', 8)],
        [makeCard('spades', 6), makeCard('hearts', 9), makeCard('clubs', 10)],
      ],
    });

    // Mid-trick in Practice vs Bots is still rejected
    const midTrick = (playCard(initial, 'human', 'spades-14') as { ok: true; state: GameState })
      .state;
    const midRes = executeLocalVoluntaryExit(midTrick, 'human', { isPassAndPlay: false });
    assert.equal(midRes.ok, false);
    if (!midRes.ok) {
      assert.equal(midRes.shouldLeaveToLobby, false);
    }

    // Between tricks in Practice vs Bots redistributes and returns sole human cleanly to lobby
    let between = (playCard(midTrick, 'b1', 'spades-10') as { ok: true; state: GameState }).state;
    between = (playCard(between, 'b2', 'spades-6') as { ok: true; state: GameState }).state;
    between = continueAfterTrick(between);

    const exitRes = executeLocalVoluntaryExit(between, 'human', {
      isPassAndPlay: false,
      rng: createSeededRng(5),
    });
    assert.equal(exitRes.ok, true);
    if (!exitRes.ok) return;
    assert.equal(exitRes.shouldLeaveToLobby, true);
    assert.equal(exitRes.nextState, null);
    assert.equal(exitRes.cardsDistributedCount, 2);
    assert.match(exitRes.toast?.message ?? '', /2 cards redistributed/i);
  });
});
