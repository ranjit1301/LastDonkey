import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACE_OF_SPADES_ID,
  canVoluntarilyExit,
  chooseRandomLegalCard,
  continueAfterTrick,
  createDeck,
  createInitialGameState,
  dealCards,
  getLegalCards,
  handleMissedTurn,
  makeCard,
  markPlayerConnection,
  playCard,
  removePlayerAndRedistribute,
  type GameState,
  type PlayerConfig,
} from './index';

function makePlayers(count: number): PlayerConfig[] {
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

describe('1. Deck & Exact Card Distribution (2 to 6 Players)', () => {
  it('creates a 52-card deck with no jokers or duplicates', () => {
    const deck = createDeck();
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck.map((c) => c.id)).size, 52);
  });

  it('distributes exact counts for 2, 3, 4, 5, and 6 players', () => {
    const deck = createDeck();
    const expected: Record<number, number[]> = {
      2: [26, 26],
      3: [18, 17, 17],
      4: [13, 13, 13, 13],
      5: [11, 11, 10, 10, 10],
      6: [9, 9, 9, 9, 8, 8],
    };

    for (const [countStr, expectedCounts] of Object.entries(expected)) {
      const hands = dealCards(deck, Number(countStr));
      assert.deepEqual(
        hands.map((h) => h.length),
        expectedCounts
      );
      assert.equal(new Set(hands.flat().map((c) => c.id)).size, 52);
    }
  });
});

describe('2. Starting Player, A♠ Rule & Follow-Suit Enforcement', () => {
  it('requires A♠ holder to start with A♠ and enforces following suit on every trick', () => {
    const initial = createInitialGameState(makePlayers(3), {
      customHands: [
        [makeCard('hearts', 10), makeCard('clubs', 4)],
        [makeCard('spades', 14), makeCard('diamonds', 9)],
        [makeCard('spades', 7), makeCard('hearts', 3)],
      ],
    });

    assert.equal(initial.currentTurnPlayerId, 'p2');
    assert.deepEqual(
      getLegalCards(initial, 'p2').map((c) => c.id),
      [ACE_OF_SPADES_ID]
    );
    assert.equal(playCard(initial, 'p2', 'diamonds-9').ok, false);

    const r1 = playCard(initial, 'p2', 'spades-14');
    assert.equal(r1.ok, true);
    if (!r1.ok) return;

    // p3 has 7♠ so MUST follow Spades
    assert.equal(playCard(r1.state, 'p3', 'hearts-3').ok, false);
    const r2 = playCard(r1.state, 'p3', 'spades-7');
    assert.equal(r2.ok, true);
    if (!r2.ok) return;

    // p1 is void in Spades -> may play any card (will cut immediately)
    assert.equal(getLegalCards(r2.state, 'p1').length, 2);
  });
});

describe('3. Successful Tricks & Simultaneous Finishers (Section 7)', () => {
  it('finishes players ONLY after trick resolves, records simultaneous finishers, and picks next-highest active leader', () => {
    // Exact example from Section 7:
    // A plays 5♠ (last card), B plays K♠ (last card), C plays 9♠, D plays 3♠.
    const initial = createInitialGameState(makePlayers(4), {
      customHands: [
        [makeCard('spades', 5)],
        [makeCard('spades', 13)],
        [makeCard('spades', 9), makeCard('hearts', 2)],
        [makeCard('spades', 3), makeCard('clubs', 6)],
      ],
    });

    let s = initial;
    // A plays last card -> NOT finished yet mid-trick!
    s = (playCard(s, 'p1', 'spades-5') as { ok: true; state: GameState }).state;
    assert.equal(s.players[0].finished, false);

    // B plays last card -> NOT finished yet mid-trick!
    s = (playCard(s, 'p2', 'spades-13') as { ok: true; state: GameState }).state;
    assert.equal(s.players[1].finished, false);

    s = (playCard(s, 'p3', 'spades-9') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-3') as { ok: true; state: GameState }).state;

    // Trick succeeds! All 4 cards permanently removed.
    assert.equal(s.phase, 'trick_result');
    assert.equal(s.lastOutcome?.type, 'success');
    assert.equal(s.removedCards.length, 4);

    // A and B finished simultaneously with shared rank #1!
    assert.equal(s.players[0].finished, true);
    assert.equal(s.players[1].finished, true);
    assert.equal(s.players[0].finishOrder, 1);
    assert.equal(s.players[1].finishOrder, 1);
    assert.deepEqual(s.finishGroups, [['p1', 'p2']]);

    // Highest card was B (K♠), who finished -> next-highest active player is C (9♠)!
    assert.equal(s.lastOutcome?.nextLeaderId, 'p3');

    const next = continueAfterTrick(s);
    assert.equal(next.currentTurnPlayerId, 'p3');
    assert.deepEqual(next.currentTrick.expectedPlayerIds, ['p3', 'p4']);
  });
});

describe('4. Failed Tricks, No Last-Card Protection & 2-Player Endgame (Sections 8 & 9)', () => {
  it('stops trick immediately on cut and gives all played cards to highest led-suit player', () => {
    // Section 8 Example 1: A plays 8♠, B plays 4♠, C plays 7♥ and cuts, D does not play.
    const initial = createInitialGameState(makePlayers(4), {
      customHands: [
        [makeCard('spades', 8), makeCard('clubs', 2)],
        [makeCard('spades', 4), makeCard('diamonds', 3)],
        [makeCard('hearts', 7), makeCard('clubs', 9)],
        [makeCard('spades', 13), makeCard('diamonds', 5)],
      ],
    });

    let s = initial;
    s = (playCard(s, 'p1', 'spades-8') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-4') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'hearts-7') as { ok: true; state: GameState }).state;

    assert.equal(s.phase, 'trick_result');
    assert.equal(s.lastOutcome?.type, 'failed');
    if (s.lastOutcome?.type === 'failed') {
      assert.equal(s.lastOutcome.collectorId, 'p1');
      assert.equal(s.lastOutcome.collectedCards.length, 3);
      assert.equal(s.lastOutcome.nextLeaderId, 'p1');
    }
    assert.equal(s.players[0].hand.length, 4); // 2♣ + 8♠, 4♠, 7♥
    assert.equal(s.players[3].hand.length, 2); // D never played!
  });

  it('never ends prematurely in a 2-player endgame when a failed trick reverses the last card (Section 8 & 9)', () => {
    // Only A and B remain: A has 8♠ (1 card!), B has 5♥ and 9♣.
    // A plays 8♠ (0 cards temporarily), B cuts with 5♥ -> A collects BOTH cards and game CONTINUES!
    const initial = createInitialGameState(makePlayers(2), {
      customHands: [
        [makeCard('spades', 8)],
        [makeCard('hearts', 5), makeCard('clubs', 9)],
      ],
    });

    const r1 = playCard(initial, 'p1', 'spades-8');
    assert.equal(r1.ok, true);
    if (!r1.ok) return;

    // Must NOT finish or end game yet!
    assert.equal(r1.state.phase, 'playing');
    assert.equal(r1.state.players[0].finished, false);
    assert.equal(r1.state.currentTurnPlayerId, 'p2');

    const r2 = playCard(r1.state, 'p2', 'hearts-5');
    assert.equal(r2.ok, true);
    if (!r2.ok) return;

    // Failed trick: A collects 8♠ + 5♥ -> A has 2 cards, B has 1 card -> game continues!
    assert.equal(r2.state.phase, 'trick_result');
    assert.equal(r2.state.players[0].finished, false);
    assert.equal(r2.state.players[0].hand.length, 2);
    assert.equal(r2.state.players[1].hand.length, 1);
    assert.equal(r2.state.donkeyPlayerId, null);
    assert.equal(r2.state.lastOutcome?.nextLeaderId, 'p1');
  });

  it('declares Donkey only after trick resolves and only 1 active player retains cards', () => {
    // 2 players: A has 8♠ (last card), B has 5♥ (last card).
    // A leads 8♠, B cuts with 5♥ -> A collects both (2 cards), B has 0 -> B finishes -> A is Donkey!
    const initial = createInitialGameState(makePlayers(2), {
      customHands: [[makeCard('spades', 8)], [makeCard('hearts', 5)]],
    });

    const r1 = playCard(initial, 'p1', 'spades-8');
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    assert.equal(r1.state.phase, 'playing');

    const r2 = playCard(r1.state, 'p2', 'hearts-5');
    assert.equal(r2.ok, true);
    if (!r2.ok) return;

    assert.equal(r2.state.phase, 'finished');
    assert.equal(r2.state.donkeyPlayerId, 'p1');
    assert.equal(r2.state.players[0].hand.length, 2); // Donkey retains remaining cards
    assert.deepEqual(r2.state.finishOrder, ['p2']);
  });
});

describe('5. Voluntary Exit Between Tricks (Section 10)', () => {
  it('blocks voluntary exit mid-trick and redistributes cards clockwise between tricks', () => {
    const initial = createInitialGameState(makePlayers(4), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 10), makeCard('clubs', 7)],
        [makeCard('spades', 9), makeCard('diamonds', 4)],
        [makeCard('spades', 6), makeCard('clubs', 3)],
        [makeCard('spades', 2), makeCard('hearts', 8)],
      ],
    });

    assert.equal(canVoluntarilyExit(initial), true);

    // Mid-trick: exit must be blocked!
    const mid = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    assert.equal(canVoluntarilyExit(mid), false);
    assert.equal(removePlayerAndRedistribute(mid, 'p2', 'voluntary_exit').ok, false);

    // Between tricks (start of trick 1): p1 exits -> p1's 3 cards distributed clockwise to p2, p3, p4 (1 each)
    const exited = removePlayerAndRedistribute(
      initial,
      'p1',
      'voluntary_exit',
      createSeededRng(42)
    );
    assert.equal(exited.ok, true);
    if (!exited.ok) return;

    assert.equal(exited.state.players[0].removed, true);
    assert.equal(exited.state.players[0].hand.length, 0);
    assert.equal(exited.state.players[1].hand.length, 3);
    assert.equal(exited.state.players[2].hand.length, 3);
    assert.equal(exited.state.players[3].hand.length, 3);
  });
});

describe('6. Missed Turns, Removal & Reconnection (Section 13)', () => {
  it('auto-plays on 1st and 2nd miss, resets on reconnect, and removes + redistributes on 3rd consecutive miss', () => {
    const rng = createSeededRng(99);
    const initial = createInitialGameState(makePlayers(3), {
      customHands: [
        [
          makeCard('spades', 14),
          makeCard('spades', 10),
          makeCard('hearts', 8),
          makeCard('clubs', 5),
          makeCard('diamonds', 3),
        ],
        [
          makeCard('spades', 9),
          makeCard('spades', 4),
          makeCard('hearts', 7),
          makeCard('clubs', 6),
        ],
        [
          makeCard('spades', 6),
          makeCard('spades', 2),
          makeCard('hearts', 4),
          makeCard('diamonds', 9),
        ],
      ],
    });

    // Miss #1 for p1 -> auto-plays A♠ (the only legal card)
    const m1 = handleMissedTurn(initial, 'p1', rng);
    assert.equal(m1.ok, true);
    if (!m1.ok) return;
    assert.equal(m1.action, 'auto_played');
    assert.equal(m1.missedCount, 1);
    assert.equal(m1.autoPlayedCard?.id, ACE_OF_SPADES_ID);

    // Finish trick 1 normally with p2 and p3
    let s = m1.state;
    s = (playCard(s, 'p2', 'spades-9') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);
    assert.equal(s.currentTurnPlayerId, 'p1');

    // Miss #2 for p1 -> auto-plays random legal card
    const m2 = handleMissedTurn(s, 'p1', rng);
    assert.equal(m2.ok, true);
    if (!m2.ok) return;
    assert.equal(m2.action, 'auto_played');
    assert.equal(m2.missedCount, 2);

    // Test reconnection reset check on a branched copy
    const reconnected = markPlayerConnection(m2.state, 'p1', true);
    assert.equal(reconnected.players[0].consecutiveMissedTurns, 0);

    // Continue from m2 without reconnecting -> finish trick 2 so p1 gets turn again (or force turn to p1)
    let s2 = m2.state;
    // Play remaining players of trick 2
    while (s2.phase === 'playing' && s2.currentTurnPlayerId !== 'p1') {
      const c = chooseRandomLegalCard(s2, s2.currentTurnPlayerId!, rng)!;
      s2 = (playCard(s2, s2.currentTurnPlayerId!, c.id) as { ok: true; state: GameState }).state;
    }
    if (s2.phase === 'trick_result') {
      s2 = continueAfterTrick(s2);
    }
    while (s2.phase === 'playing' && s2.currentTurnPlayerId !== 'p1') {
      const c = chooseRandomLegalCard(s2, s2.currentTurnPlayerId!, rng)!;
      s2 = (playCard(s2, s2.currentTurnPlayerId!, c.id) as { ok: true; state: GameState }).state;
    }

    assert.equal(s2.currentTurnPlayerId, 'p1');
    const p1CardsBeforeRemoval = s2.players[0].hand.length;
    const totalHandsBefore = s2.players.reduce((sum, p) => sum + p.hand.length, 0);

    // Miss #3 for p1 -> removed & cards redistributed clockwise to p2 & p3!
    const m3 = handleMissedTurn(s2, 'p1', rng);
    assert.equal(m3.ok, true);
    if (!m3.ok) return;
    assert.equal(m3.action, 'removed_and_redistributed');
    assert.equal(m3.missedCount, 3);
    assert.equal(m3.state.players[0].removed, true);
    assert.equal(m3.state.players[0].hand.length, 0);
    assert.equal(m3.redistribution?.cardsDistributedCount, p1CardsBeforeRemoval);

    // Total cards in hands (plus table if trick still open) conserved!
    const totalHandsAfter = m3.state.players.reduce((sum, p) => sum + p.hand.length, 0);
    assert.equal(totalHandsAfter, totalHandsBefore);
  });
});

describe('7. Full Automated Match Simulations (2 to 6 Players, Random Bots)', () => {
  for (const playerCount of [2, 3, 4, 5, 6]) {
    it(`completes a full valid ${playerCount}-player Rang Vapas game with 52-card conservation`, () => {
      const rng = createSeededRng(2026 + playerCount * 97);
      let state = createInitialGameState(makePlayers(playerCount), { rng });

      let steps = 0;
      const MAX_STEPS = 8000;

      while (state.phase !== 'finished' && steps < MAX_STEPS) {
        steps++;
        if (state.phase === 'trick_result') {
          state = continueAfterTrick(state);
          continue;
        }

        const turnId = state.currentTurnPlayerId;
        assert.ok(turnId, 'Active game must have a currentTurnPlayerId');

        const chosen = chooseRandomLegalCard(state, turnId, rng);
        assert.ok(chosen, 'Active player must have at least one legal card');

        const res = playCard(state, turnId, chosen.id);
        assert.equal(res.ok, true, res.ok ? '' : res.error);
        if (res.ok) state = res.state;

        const cardsInHands = state.players.reduce((sum, p) => sum + p.hand.length, 0);
        const cardsOnTable = state.phase === 'playing' ? state.currentTrick.plays.length : 0;
        assert.equal(
          cardsInHands + cardsOnTable + state.removedCards.length,
          52,
          `Card conservation violated at step ${steps}`
        );
      }

      assert.equal(state.phase, 'finished', `Game did not finish within ${MAX_STEPS} steps`);
      if (state.donkeyPlayerId) {
        const donkey = state.players.find((p) => p.id === state.donkeyPlayerId)!;
        assert.equal(donkey.finished, false);
        assert.ok(donkey.hand.length >= 1);
      }
    });
  }
});
