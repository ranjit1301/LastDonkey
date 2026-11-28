import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACE_OF_SPADES_ID,
  buildBotObservation,
  buildPublicMemory,
  canFinishPracticeSessionEarly,
  canVoluntarilyExit,
  chooseBotCard,
  chooseRandomLegalCard,
  continueAfterTrick,
  createDeck,
  createInitialGameState,
  dealCards,
  getDiscardedCardsBySuit,
  getLegalCards,
  getMediumStrategicHint,
  getPublicRemainingSuitCounts,
  handleMissedTurn,
  makeCard,
  markPlayerConnection,
  playCard,
  removePlayerAndRedistribute,
  shuffleDeck,
  type DifficultyMode,
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

describe('8. Easy Discarded-Card Tracker & Medium Remaining Suit Counts', () => {
  it('tracks successful-trick discards grouped by suit and excludes failed-trick returned cards', () => {
    const initial = createInitialGameState(makePlayers(3), {
      difficulty: 'easy',
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 10), makeCard('clubs', 5)],
        [makeCard('spades', 9), makeCard('diamonds', 12), makeCard('clubs', 4)],
        [makeCard('spades', 4), makeCard('hearts', 8), makeCard('clubs', 2)],
      ],
    });

    // Trick 1 (successful Spades trick): A♠, 9♠, 4♠ -> permanently discarded
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-9') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-4') as { ok: true; state: GameState }).state;

    const discardedAfterSuccess = getDiscardedCardsBySuit(s.removedCards);
    assert.deepEqual(
      discardedAfterSuccess.spades.map((c) => c.id),
      ['spades-14', 'spades-9', 'spades-4']
    );
    assert.equal(discardedAfterSuccess.hearts.length, 0);
    assert.equal(discardedAfterSuccess.clubs.length, 0);
    assert.equal(discardedAfterSuccess.diamonds.length, 0);

    const remainingAfterSuccess = getPublicRemainingSuitCounts(s.removedCards);
    assert.deepEqual(remainingAfterSuccess, {
      spades: 10,
      hearts: 13,
      clubs: 13,
      diamonds: 13,
    });

    // Trick 2 (failed Hearts trick): p1 leads 10♥, p2 cuts with Q♦ -> cards return to p1, NOT discarded!
    s = continueAfterTrick(s);
    s = (playCard(s, 'p1', 'hearts-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'diamonds-12') as { ok: true; state: GameState }).state;

    assert.equal(s.lastOutcome?.type, 'failed');
    const discardedAfterFail = getDiscardedCardsBySuit(s.removedCards);
    assert.equal(discardedAfterFail.spades.length, 3);
    assert.equal(discardedAfterFail.hearts.length, 0);
    assert.equal(discardedAfterFail.diamonds.length, 0);

    // Remaining counts MUST stay exact (returned 10♥ and Q♦ remain counted in play)
    const remainingAfterFail = getPublicRemainingSuitCounts(s.removedCards);
    assert.deepEqual(remainingAfterFail, {
      spades: 10,
      hearts: 13,
      clubs: 13,
      diamonds: 13,
    });
  });
});

describe('9. Medium Mode Strategic Hints & Strict Mode Gating', () => {
  it('never produces hints in Easy or Hard mode and never names specific cards in Medium mode', () => {
    const baseHands = [
      [makeCard('spades', 14), makeCard('hearts', 12), makeCard('clubs', 6)],
      [makeCard('spades', 8), makeCard('diamonds', 13), makeCard('clubs', 3)],
      [makeCard('spades', 5), makeCard('hearts', 4), makeCard('clubs', 2)],
    ];

    for (const mode of ['easy', 'medium', 'hard'] as const) {
      let s = createInitialGameState(makePlayers(3), {
        difficulty: mode,
        customHands: baseHands.map((h) => [...h]),
      });

      // Resolve Trick 1 so we are past the forced A♠ turn
      s = (playCard(s, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
      s = (playCard(s, 'p2', 'spades-8') as { ok: true; state: GameState }).state;
      s = (playCard(s, 'p3', 'spades-5') as { ok: true; state: GameState }).state;
      s = continueAfterTrick(s);

      // p1 leads 12♥, now it is p2's turn and p2 has NO Hearts (off-suit cut moment)
      s = (playCard(s, 'p1', 'hearts-12') as { ok: true; state: GameState }).state;
      const hint = getMediumStrategicHint(s, 'p2');

      if (mode === 'medium') {
        assert.ok(hint, 'Medium mode should provide an informative hint on off-suit cut opportunity');
        // Ensure hint never recommends or names any specific card rank/suit symbol
        assert.doesNotMatch(hint, /[♠♥♦♣]|\b(A|K|Q|J|10|[2-9])\b/);
      } else {
        assert.equal(hint, null, `${mode} mode must never show Medium hints`);
      }
    }
  });
});

describe('10. Strict Bot Fairness — Zero Opponent Hand Inspection', () => {
  it('never reads any element or iterates any opponent hand across Easy, Medium, and Hard modes', () => {
    const baseState = createInitialGameState(makePlayers(4), {
      difficulty: 'hard',
      rng: createSeededRng(777),
    });

    // Advance past A♠ opening so leading, following, and cutting can all be tested
    const leadId = baseState.currentTurnPlayerId!;
    const afterAce = (playCard(baseState, leadId, ACE_OF_SPADES_ID) as { ok: true; state: GameState })
      .state;

    const testBotId = afterAce.currentTurnPlayerId!;

    // Wrap every opponent's hand array in a Proxy that ONLY permits `.length` (public card count)
    // and throws immediately on ANY card index access or iteration/method call!
    const guardedState: GameState = {
      ...afterAce,
      players: afterAce.players.map((p) => {
        if (p.id === testBotId) return p;
        const guardedHand = new Proxy(p.hand, {
          get(target, prop, receiver) {
            if (prop === 'length') return target.length;
            throw new Error(
              `Bot fairness violation: attempted to access opponent ${p.id} hand property "${String(prop)}"`
            );
          },
        });
        return { ...p, hand: guardedHand };
      }),
    };

    const obs = buildBotObservation(guardedState, testBotId);
    assert.equal(obs.botId, testBotId);
    assert.equal(obs.players.length, 4);

    for (const mode of ['easy', 'medium', 'hard'] as const) {
      const chosen = chooseBotCard(guardedState, testBotId, mode, createSeededRng(1234));
      assert.ok(chosen, `${mode} bot must return a legal card without peeking`);
      const legalIds = new Set(getLegalCards(afterAce, testBotId).map((c) => c.id));
      assert.ok(legalIds.has(chosen.id), `${mode} bot chose an illegal card`);
    }
  });
});

describe('11. Strategic Bot Behavior & Full Simulations Across Easy, Medium, and Hard', () => {
  it('Medium and Hard bots dump high off-suit cards when cutting instead of tiny low cards', () => {
    const initial = createInitialGameState(makePlayers(3), {
      difficulty: 'hard',
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 10), makeCard('clubs', 5)],
        [makeCard('spades', 7), makeCard('diamonds', 13), makeCard('clubs', 2), makeCard('clubs', 3)],
        [makeCard('spades', 4), makeCard('hearts', 6), makeCard('diamonds', 8)],
      ],
    });

    // Trick 1 resolves Spades
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-7') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-4') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Trick 2: p1 leads 10♥; p2 is void in Hearts and holds K♦ (singleton high) vs 2♣, 3♣
    s = (playCard(s, 'p1', 'hearts-10') as { ok: true; state: GameState }).state;

    // Deterministic RNG (0.5 avoids Medium's 10% random variance)
    const midRng = () => 0.5;
    const medChoice = chooseBotCard(s, 'p2', 'medium', midRng);
    const hardChoice = chooseBotCard(s, 'p2', 'hard', midRng);

    assert.equal(medChoice?.id, 'diamonds-13');
    assert.equal(hardChoice?.id, 'diamonds-13');
  });

  it('Hard bot avoids leading a suit an opponent is publicly known void in when a safe suit exists', () => {
    const initial = createInitialGameState(makePlayers(3), {
      difficulty: 'hard',
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 10), makeCard('clubs', 5), makeCard('diamonds', 4)],
        [makeCard('spades', 7), makeCard('diamonds', 13), makeCard('clubs', 8), makeCard('clubs', 3)],
        [makeCard('spades', 4), makeCard('hearts', 6), makeCard('clubs', 9), makeCard('diamonds', 6)],
      ],
    });

    // Trick 1: Spades succeed
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-7') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-4') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Trick 2: p1 leads 10♥, p2 publicly proves void in Hearts by cutting with K♦ -> p1 collects 10♥ & K♦ and leads next!
    s = (playCard(s, 'p1', 'hearts-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'diamonds-13') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // p1 now holds 10♥ (known void by p2!), K♦, 4♦, 5♣. Hard bot must NOT lead Hearts!
    const hardLead = chooseBotCard(s, 'p1', 'hard', () => 0.5);
    assert.ok(hardLead);
    assert.notEqual(hardLead.suit, 'hearts');
  });

  const difficulties: DifficultyMode[] = ['easy', 'medium', 'hard'];
  for (const mode of difficulties) {
    for (const playerCount of [2, 3, 4, 5, 6]) {
      it(`completes a valid ${playerCount}-player game in ${mode.toUpperCase()} mode with exact 52-card conservation`, () => {
        const rng = createSeededRng(5000 + playerCount * 131 + mode.length * 17);
        let state = createInitialGameState(makePlayers(playerCount), {
          difficulty: mode,
          rng,
        });

        let steps = 0;
        const MAX_STEPS = 8000;

        while (state.phase !== 'finished' && steps < MAX_STEPS) {
          steps++;
          if (state.phase === 'trick_result') {
            state = continueAfterTrick(state);
            continue;
          }

          const turnId = state.currentTurnPlayerId;
          assert.ok(turnId);

          const chosen = chooseBotCard(state, turnId, mode, rng);
          assert.ok(chosen);

          const res = playCard(state, turnId, chosen.id);
          assert.equal(res.ok, true, res.ok ? '' : res.error);
          if (res.ok) state = res.state;

          const cardsInHands = state.players.reduce((sum, p) => sum + p.hand.length, 0);
          const cardsOnTable = state.phase === 'playing' ? state.currentTrick.plays.length : 0;
          assert.equal(
            cardsInHands + cardsOnTable + state.removedCards.length,
            52,
            `Card conservation violated in ${mode} mode (${playerCount}P) at step ${steps}`
          );

          // Medium remaining suit counts must always equal total undiscarded cards across all hands + table
          const counts = getPublicRemainingSuitCounts(state.removedCards);
          const sumRemaining = counts.spades + counts.hearts + counts.clubs + counts.diamonds;
          assert.equal(sumRemaining, 52 - state.removedCards.length);
        }

        assert.equal(
          state.phase,
          'finished',
          `${mode} mode ${playerCount}P game did not finish within ${MAX_STEPS} steps`
        );
        if (state.donkeyPlayerId) {
          const donkey = state.players.find((p) => p.id === state.donkeyPlayerId)!;
          assert.equal(donkey.finished, false);
          assert.ok(donkey.hand.length >= 1);
        }
      });
    }
  }
});

describe('12. Hard Bot Suit Awareness & Strategic Decision-Making (Mandatory Tests A–E)', () => {
  it('Test A: Bot has no Diamonds — must NEVER lead a Diamond', () => {
    const initial = createInitialGameState(makePlayers(4), {
      difficulty: 'hard',
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 9), makeCard('clubs', 6)],
        [makeCard('spades', 10), makeCard('diamonds', 8), makeCard('hearts', 5)],
        [makeCard('spades', 6), makeCard('diamonds', 4), makeCard('clubs', 7)],
        [makeCard('spades', 2), makeCard('diamonds', 12), makeCard('hearts', 3)],
      ],
    });

    // Resolve Trick 1 so p1 (who holds 0 Diamonds) leads Trick 2
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    assert.equal(s.currentTurnPlayerId, 'p1');
    assert.equal(
      s.players[0].hand.some((c) => c.suit === 'diamonds'),
      false
    );

    const rng = createSeededRng(101);
    for (let i = 0; i < 20; i++) {
      const lead = chooseBotCard(s, 'p1', 'hard', rng);
      assert.ok(lead);
      assert.notEqual(lead.suit, 'diamonds');
      assert.ok(s.players[0].hand.some((c) => c.id === lead.id));
    }
  });

  it('Test B: Diamond trick cut with a Spade fails immediately, A collects all 3 cards, D does not play', () => {
    const initial = createInitialGameState(makePlayers(4), {
      difficulty: 'hard',
      customHands: [
        [makeCard('spades', 14), makeCard('diamonds', 8), makeCard('clubs', 4)],
        [makeCard('spades', 10), makeCard('diamonds', 5), makeCard('hearts', 6)],
        [makeCard('spades', 6), makeCard('spades', 13), makeCard('clubs', 9)],
        [makeCard('spades', 2), makeCard('diamonds', 12), makeCard('hearts', 7)],
      ],
    });

    // Trick 1: Spades succeed, A (p1) leads Trick 2
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Trick 2: A leads 8♦, B plays 5♦, C cuts with K♠ (no Diamonds)
    s = (playCard(s, 'p1', 'diamonds-8') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'diamonds-5') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-13') as { ok: true; state: GameState }).state;

    assert.equal(s.phase, 'trick_result');
    assert.equal(s.lastOutcome?.type, 'failed');
    if (s.lastOutcome?.type === 'failed') {
      assert.equal(s.lastOutcome.collectorId, 'p1');
      assert.deepEqual(
        s.lastOutcome.collectedCards.map((c) => c.id),
        ['diamonds-8', 'diamonds-5', 'spades-13']
      );
      assert.equal(s.lastOutcome.nextLeaderId, 'p1');
    }
    // D (p4) did NOT play — still holds all 2 remaining cards (12♦, 7♥)
    assert.equal(s.players[3].hand.length, 2);
    // Playing as D must be rejected since the trick already failed
    assert.equal(playCard(s, 'p4', 'diamonds-12').ok, false);
  });

  it('Test C: Bot collects a failed trick, updates hand & available suits, and switches off cut suit', () => {
    const initial = createInitialGameState(makePlayers(4), {
      difficulty: 'hard',
      customHands: [
        // p1 holds ONLY Diamonds (after A♠) before Trick 2 — ZERO Spades!
        [makeCard('spades', 14), makeCard('diamonds', 8), makeCard('diamonds', 2)],
        [makeCard('spades', 10), makeCard('diamonds', 5), makeCard('hearts', 6)],
        [makeCard('spades', 6), makeCard('spades', 13), makeCard('clubs', 9)],
        [makeCard('spades', 2), makeCard('diamonds', 12), makeCard('hearts', 7)],
      ],
    });

    // Trick 1: Spades succeed
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Before Trick 2, p1 has ONLY Diamonds (8♦, 2♦)
    assert.deepEqual(
      Array.from(new Set(s.players[0].hand.map((c) => c.suit))),
      ['diamonds']
    );

    // Trick 2: p1 leads 8♦, p2 plays 5♦, p3 cuts with K♠ -> p1 collects 8♦, 5♦, K♠!
    s = (playCard(s, 'p1', 'diamonds-8') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'diamonds-5') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-13') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Returned cards MUST appear in p1's hand and include Spades now!
    const p1Ids = s.players[0].hand.map((c) => c.id);
    assert.ok(p1Ids.includes('diamonds-8'));
    assert.ok(p1Ids.includes('diamonds-5'));
    assert.ok(p1Ids.includes('spades-13'));
    assert.ok(p1Ids.includes('diamonds-2'));

    const obs = buildBotObservation(s, 'p1');
    const availableSuits = new Set(obs.ownHand.map((c) => c.suit));
    assert.equal(availableSuits.has('diamonds'), true);
    assert.equal(availableSuits.has('spades'), true);

    // Hard bot MUST recalculate available suits and switch to K♠ instead of repeating Diamonds into p3's known void!
    const nextLead = chooseBotCard(s, 'p1', 'hard', () => 0.5);
    assert.equal(nextLead?.id, 'spades-13');
  });

  it('Test D: Bot with low Diamonds and high Spades after a Diamond cut evaluates both suits and does NOT blindly repeat Diamonds', () => {
    // Exact scenario that previously triggered the rank-penalty bug:
    // Several Spades already discarded (so Spades has moderate unseen count),
    // Human (p2 or p3) just cut Diamonds with a Spade, Bot (p1) holds low 2♦, 5♦, 8♦ and high Q♠!
    const initial = createInitialGameState(makePlayers(4), {
      difficulty: 'hard',
      customHands: [
        [makeCard('spades', 14), makeCard('spades', 11), makeCard('diamonds', 8), makeCard('diamonds', 2)],
        [makeCard('spades', 10), makeCard('spades', 9), makeCard('spades', 12), makeCard('hearts', 5)],
        [makeCard('spades', 6), makeCard('spades', 5), makeCard('diamonds', 4), makeCard('clubs', 7)],
        [makeCard('spades', 3), makeCard('spades', 2), makeCard('diamonds', 9), makeCard('clubs', 4)],
      ],
    });

    // Trick 1 & Trick 2: 8 Spades permanently discarded!
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-3') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    s = (playCard(s, 'p1', 'spades-11') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-9') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-5') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Trick 3: p1 leads 8♦ -> p2 (human, void in Diamonds!) immediately cuts with Q♠ -> p1 collects 8♦ & Q♠!
    s = (playCard(s, 'p1', 'diamonds-8') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-12') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // p1 now holds 2♦, 8♦, Q♠. Even though 2♦ is tiny and 8 Spades are gone, p2 is KNOWN VOID in Diamonds!
    // Hard bot MUST NOT blindly repeat 2♦ or 8♦ — it must lead Q♠!
    const rng = createSeededRng(404);
    for (let i = 0; i < 15; i++) {
      const lead = chooseBotCard(s, 'p1', 'hard', rng);
      assert.equal(lead?.suit, 'spades', 'Hard bot must switch to Spades instead of repeating cut Diamonds');
    }
  });

  it('Test E: Repeated failed tricks — bot updates hand & suit counts after EVERY collection and adapts across suits', () => {
    const initial = createInitialGameState(makePlayers(4), {
      difficulty: 'hard',
      customHands: [
        // p1 starts with A♠ + Diamonds only
        [makeCard('spades', 14), makeCard('diamonds', 9), makeCard('diamonds', 3)],
        // p2 has NO Diamonds, has K♠
        [makeCard('spades', 10), makeCard('spades', 13), makeCard('hearts', 4)],
        // p3 has NO Spades after Trick 1, has Q♥
        [makeCard('spades', 6), makeCard('hearts', 12), makeCard('clubs', 7)],
        // p4 has Hearts, Diamonds, Clubs
        [makeCard('spades', 2), makeCard('hearts', 8), makeCard('diamonds', 6)],
      ],
    });

    // Trick 1: Spades succeed -> p1 leads Trick 2
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Failed Trick #1 (Trick 2): p1 leads 9♦, p2 cuts with K♠ -> p1 collects 9♦ & K♠
    s = (playCard(s, 'p1', 'diamonds-9') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-13') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    assert.equal(s.players[0].hand.length, 3); // 3♦, 9♦, K♠
    const leadAfterFail1 = chooseBotCard(s, 'p1', 'hard', () => 0.5);
    assert.equal(leadAfterFail1?.id, 'spades-13', 'After Diamond cut, bot must switch to Spades');

    // Failed Trick #2 (Trick 3): p1 leads K♠, p2 cuts with 4♥! -> p1 collects K♠ & 4♥!
    s = (playCard(s, 'p1', 'spades-13') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'hearts-4') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Hand now contains 3♦, 9♦, K♠, 4♥ (4 cards across 3 suits!)
    assert.equal(s.players[0].hand.length, 4);
    assert.ok(s.players[0].hand.some((c) => c.id === 'hearts-4'));

    // Both Diamonds AND Spades are now known-void for p2 — bot MUST detect its newly collected Hearts suit and lead 4♥!
    const leadAfterFail2 = chooseBotCard(s, 'p1', 'hard', () => 0.5);
    assert.equal(
      leadAfterFail2?.id,
      'hearts-4',
      'After collecting 4♥ from second failed trick, bot must adapt and lead Hearts'
    );
  });
});

describe('13. Practice vs Bots — Early Finish Game Option Gating', () => {
  const practicePlayers: PlayerConfig[] = [
    { id: 'human', name: 'You', type: 'human' },
    { id: 'b1', name: 'Bot Raju', type: 'bot' },
    { id: 'b2', name: 'Bot Pinky', type: 'bot' },
  ];

  it('does NOT allow Finish Game mid-trick on last card or after a failed trick returns cards, and ONLY allows it after official finish confirmation in Practice vs Bots', () => {
    // Case 1: Human plays last card (8♠), Bot 1 plays 5♠, Bot 2 cuts with 7♥ -> cards return to Human!
    const failCase = createInitialGameState(practicePlayers, {
      difficulty: 'medium',
      customHands: [
        [makeCard('spades', 8)],
        [makeCard('spades', 5), makeCard('clubs', 9)],
        [makeCard('hearts', 7), makeCard('diamonds', 4)],
      ],
    });

    // Human plays last card -> hand is 0 mid-trick, NOT officially finished yet!
    const midFail = (playCard(failCase, 'human', 'spades-8') as { ok: true; state: GameState }).state;
    assert.equal(midFail.players[0].hand.length, 0);
    assert.equal(midFail.players[0].finished, false);
    assert.equal(canFinishPracticeSessionEarly(midFail, 'human', true), false);

    // Bot 1 plays 5♠, Bot 2 cuts with 7♥ -> trick fails and cards return to Human!
    let afterFail = (playCard(midFail, 'b1', 'spades-5') as { ok: true; state: GameState }).state;
    afterFail = (playCard(afterFail, 'b2', 'hearts-7') as { ok: true; state: GameState }).state;
    assert.equal(afterFail.players[0].hand.length, 3);
    assert.equal(afterFail.players[0].finished, false);
    assert.equal(canFinishPracticeSessionEarly(afterFail, 'human', true), false);

    // Case 2: Successful trick resolves and confirms Human finished #1 while 2 bots remain active!
    const successCase = createInitialGameState(practicePlayers, {
      difficulty: 'medium',
      customHands: [
        [makeCard('spades', 8)],
        [makeCard('spades', 5), makeCard('clubs', 9)],
        [makeCard('spades', 3), makeCard('diamonds', 4)],
      ],
    });

    // Human plays last card mid-trick -> still FALSE before trick resolves!
    const midSuccess = (playCard(successCase, 'human', 'spades-8') as { ok: true; state: GameState })
      .state;
    assert.equal(canFinishPracticeSessionEarly(midSuccess, 'human', true), false);

    let resolved = (playCard(midSuccess, 'b1', 'spades-5') as { ok: true; state: GameState }).state;
    assert.equal(canFinishPracticeSessionEarly(resolved, 'human', true), false);

    resolved = (playCard(resolved, 'b2', 'spades-3') as { ok: true; state: GameState }).state;
    // Now trick resolved successfully: Human is officially #1, 2 bots still playing, NO Donkey yet!
    assert.equal(resolved.phase, 'trick_result');
    assert.equal(resolved.players[0].finished, true);
    assert.equal(resolved.players[0].finishOrder, 1);
    assert.equal(resolved.donkeyPlayerId, null);

    // Allowed ONLY in Practice vs Bots (true), NEVER in multiplayer (false)!
    assert.equal(canFinishPracticeSessionEarly(resolved, 'human', true), true);
    assert.equal(canFinishPracticeSessionEarly(resolved, 'human', false), false);

    // Still allowed while continuing to watch bots play subsequent tricks
    const watching = continueAfterTrick(resolved);
    assert.equal(watching.phase, 'playing');
    assert.equal(canFinishPracticeSessionEarly(watching, 'human', true), true);
    assert.equal(watching.donkeyPlayerId, null);
  });
});

describe('14. Bot Memory Persistence & Selective Invalidation After Player Removal', () => {
  it('Medium and Hard bots preserve void-suit and returned-card memory across multiple tricks', () => {
    const initial = createInitialGameState(makePlayers(4), {
      difficulty: 'hard',
      customHands: [
        // p1 leads Spades (T1), then Diamonds (T2 cut by p2), then Hearts (T3 succeeds), then chooses T4 lead
        [makeCard('spades', 14), makeCard('diamonds', 8), makeCard('diamonds', 3), makeCard('hearts', 10), makeCard('clubs', 5)],
        [makeCard('spades', 10), makeCard('clubs', 12), makeCard('hearts', 6), makeCard('clubs', 7), makeCard('spades', 4)],
        [makeCard('spades', 6), makeCard('diamonds', 5), makeCard('hearts', 4), makeCard('clubs', 9), makeCard('hearts', 2)],
        [makeCard('spades', 2), makeCard('diamonds', 11), makeCard('hearts', 3), makeCard('clubs', 4), makeCard('diamonds', 7)],
      ],
    });

    // Trick 1: Spades succeed -> p1 leads Trick 2
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Trick 2: p1 leads 8♦, p2 (void in Diamonds!) cuts with Q♣ -> p1 collects 8♦ & Q♣
    s = (playCard(s, 'p1', 'diamonds-8') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'clubs-12') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Trick 3: Hearts succeed -> p1 leads Trick 4
    s = (playCard(s, 'p1', 'hearts-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'hearts-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'hearts-4') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'hearts-3') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Verify public memory persisted across Trick 3
    const memForP1 = buildPublicMemory(buildBotObservation(s, 'p1'));
    assert.equal(memForP1.knownVoidSuits.get('p2')?.has('diamonds'), true);
    assert.equal(memForP1.knownReturnedCardIds.get('p1')?.has('diamonds-8'), true);
    assert.equal(memForP1.knownReturnedCardIds.get('p1')?.has('clubs-12'), true);

    // Both Medium and Hard bots must remember p2 is void in Diamonds and lead Clubs instead
    const medLead = chooseBotCard(s, 'p1', 'medium', () => 0.5);
    const hardLead = chooseBotCard(s, 'p1', 'hard', () => 0.5);
    assert.equal(medLead?.suit, 'clubs', 'Medium bot must remember p2 is void in Diamonds across tricks');
    assert.equal(hardLead?.suit, 'clubs', 'Hard bot must remember p2 is void in Diamonds across tricks');
  });

  it('selectively invalidates ONLY unreliable memory on player removal while preserving unaffected voids and returned cards', () => {
    // 5-player game:
    // - Trick 1 (Spades): succeeds -> p1 leads
    // - Trick 2 (Clubs): p1 leads 10♣, p2 cuts with 9♥ (p2 void in clubs), p1 collects [10♣, 9♥]
    // - Trick 3 (Clubs): p1 leads 10♣, p2 plays 8♥? Wait: p2 is void in clubs so let p1 lead Diamonds instead!
    // Let's craft a crystal-clear 5-player sequence:
    //   T1 (Spades): all follow -> p1 leads T2
    //   T2 (Clubs): p1 leads 6♣, p2 plays 4♣, p3 plays 3♣, p4 plays 12♣, p5 cuts with 11♥ -> p4 collects [6♣, 4♣, 3♣, 12♣, 11♥], p5 known void in Clubs!
    //   T3 (Clubs): p4 leads 12♣, p5 plays? Wait: let p4 lead Hearts next? Better: p4 leads 11♥ -> p5 plays 7♥, p1 plays 8♥, p2 plays 9♥, p3 cuts with 2♦ -> p4 collects [11♥, 7♥, 8♥, 9♥, 2♦], p3 known void in Hearts!
    //   T4 (Diamonds): p4 leads 2♦, p5 plays 5♦, p1 plays 6♦, p2 cuts with 4♥ -> p1 collects [2♦, 5♦, 6♦, 4♥], p2 known void in Diamonds!
    //   T5 (Clubs): p1 leads 7♣, p2 cuts with 10♥ -> p1 collects [7♣, 10♥], p2 NOW ALSO known void in Clubs!
    // Now p5 has ONLY 2 cards left ([3♠, 8♦]). When p5 is removed clockwise after p5:
    //   Active players clockwise after p5 (seat 4) are: p1 (seat 0, +1), p2 (seat 1, +1), p3 (seat 2, +0), p4 (seat 3, +0).
    // Expected after p5 is removed:
    //   1. p5's own voids & returned entries are removed.
    //   2. p2 received +1 card from p5:
    //      - p2's void in Diamonds MUST be invalidated (p5 was NOT known void in Diamonds, so p5 could have given p2 a Diamond!).
    //      - p2's void in Clubs MUST be PRESERVED (p5 was ALSO publicly known void in Clubs, so p5 had 0 Clubs to give!).
    //   3. p3 received 0 cards from p5:
    //      - p3's void in Hearts MUST be PRESERVED!
    //   4. p4's previously collected returned cards (6♣, 4♣, 3♣, 12♣, 7♥, 8♥, 9♥) MUST be PRESERVED!
    const initial = createInitialGameState(makePlayers(5), {
      difficulty: 'hard',
      customHands: [
        [makeCard('spades', 14), makeCard('clubs', 6), makeCard('hearts', 8), makeCard('diamonds', 6), makeCard('clubs', 7)],
        [makeCard('spades', 10), makeCard('clubs', 4), makeCard('hearts', 9), makeCard('hearts', 4), makeCard('hearts', 10), makeCard('hearts', 2)],
        [makeCard('spades', 8), makeCard('clubs', 3), makeCard('diamonds', 2), makeCard('diamonds', 9), makeCard('clubs', 9)],
        [makeCard('spades', 5), makeCard('clubs', 12), makeCard('diamonds', 11), makeCard('hearts', 5), makeCard('clubs', 5)],
        [makeCard('spades', 2), makeCard('hearts', 11), makeCard('hearts', 7), makeCard('diamonds', 5), makeCard('spades', 3), makeCard('diamonds', 8)],
      ],
    });

    // T1: Spades succeed -> p1 leads
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-8') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-5') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p5', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // T2: Clubs -> p5 cuts with J♥ -> p4 collects [6♣, 4♣, 3♣, Q♣, J♥], p5 void in Clubs
    s = (playCard(s, 'p1', 'clubs-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'clubs-4') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'clubs-3') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'clubs-12') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p5', 'hearts-11') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // T3: p4 leads J♥ -> p5 plays 7♥, p1 plays 8♥, p2 plays 9♥, p3 cuts with 2♦ -> p4 collects, p3 void in Hearts
    s = (playCard(s, 'p4', 'hearts-11') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p5', 'hearts-7') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p1', 'hearts-8') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'hearts-9') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'diamonds-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // T4: p4 leads 2♦ -> p5 plays 5♦, p1 plays 6♦, p2 cuts with 4♥ -> p1 collects, p2 void in Diamonds
    s = (playCard(s, 'p4', 'diamonds-2') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p5', 'diamonds-5') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p1', 'diamonds-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'hearts-4') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // T5: p1 leads 7♣ -> p2 cuts with 10♥ -> p1 collects, p2 void in Clubs (in addition to Diamonds!)
    s = (playCard(s, 'p1', 'clubs-7') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'hearts-10') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Sanity check pre-removal memory
    const memBefore = buildPublicMemory(buildBotObservation(s, 'p1'));
    assert.equal(memBefore.knownVoidSuits.get('p5')?.has('clubs'), true);
    assert.equal(memBefore.knownVoidSuits.get('p2')?.has('diamonds'), true);
    assert.equal(memBefore.knownVoidSuits.get('p2')?.has('clubs'), true);
    assert.equal(memBefore.knownVoidSuits.get('p3')?.has('hearts'), true);
    assert.equal(memBefore.knownReturnedCardIds.get('p4')?.has('clubs-12'), true);

    // Remove p5 (holds 2 cards: 3♠ and 8♦ -> distributed clockwise to p1 (+1) and p2 (+1); p3 & p4 get 0)
    const removedRes = removePlayerAndRedistribute(s, 'p5', 'voluntary_exit', createSeededRng(77));
    assert.equal(removedRes.ok, true);
    if (!removedRes.ok) return;
    s = removedRes.state;

    assert.equal(s.lastRedistribution?.cardsDistributedCount, 2);
    assert.equal(s.lastRedistribution?.recipientCounts['p1'], 1);
    assert.equal(s.lastRedistribution?.recipientCounts['p2'], 1);
    assert.equal(s.lastRedistribution?.recipientCounts['p3'] ?? 0, 0);
    assert.equal(s.lastRedistribution?.recipientCounts['p4'] ?? 0, 0);
    assert.equal(s.lastRedistribution?.afterTrickCount, 5);

    const memAfter = buildPublicMemory(buildBotObservation(s, 'p1'));
    // Removed player's entries cleared
    assert.equal(memAfter.knownVoidSuits.has('p5'), false);
    assert.equal(memAfter.knownReturnedCardIds.has('p5'), false);

    // p2 received 1 card from p5:
    // - Diamonds void MUST be invalidated (p5 could have held Diamonds!)
    assert.equal(memAfter.knownVoidSuits.get('p2')?.has('diamonds') ?? false, false);
    // - Clubs void MUST be PRESERVED (p5 was also publicly known void in Clubs!)
    assert.equal(memAfter.knownVoidSuits.get('p2')?.has('clubs'), true);

    // p3 received 0 cards -> prior Hearts void MUST be PRESERVED!
    assert.equal(memAfter.knownVoidSuits.get('p3')?.has('hearts'), true);

    // p4's previously collected returned cards MUST be PRESERVED!
    assert.equal(memAfter.knownReturnedCardIds.get('p4')?.has('clubs-12'), true);
    assert.equal(memAfter.knownReturnedCardIds.get('p4')?.has('clubs-6'), true);
    assert.equal(memAfter.knownReturnedCardIds.get('p4')?.has('hearts-9'), true);
  });

  it('Medium and Hard bots learn and retain NEW void-suit and returned-card knowledge observed AFTER a player removal', () => {
    const initial = createInitialGameState(makePlayers(4), {
      difficulty: 'hard',
      customHands: [
        [makeCard('spades', 14), makeCard('diamonds', 8), makeCard('diamonds', 3), makeCard('clubs', 6)],
        [makeCard('spades', 10), makeCard('hearts', 12), makeCard('clubs', 9), makeCard('hearts', 5)],
        [makeCard('spades', 6), makeCard('diamonds', 4), makeCard('clubs', 8), makeCard('hearts', 7)],
        [makeCard('spades', 2), makeCard('hearts', 3)],
      ],
    });

    // Trick 1: Spades succeed -> p1 leads
    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Remove p4 (1 card: 3♥ -> goes to p1 clockwise)
    const removed = removePlayerAndRedistribute(s, 'p4', 'voluntary_exit', createSeededRng(11));
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    s = removed.state;

    // Trick 2 (AFTER removal): p1 leads 8♦, p2 (void in Diamonds!) cuts with Q♥ -> p1 collects [8♦, Q♥]
    s = (playCard(s, 'p1', 'diamonds-8') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'hearts-12') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    // Memory MUST retain p2's new Diamond void AND p1's newly collected cards (NOT wiped because p4 was removed earlier!)
    const mem = buildPublicMemory(buildBotObservation(s, 'p1'));
    assert.equal(mem.anyPlayerRemoved, true);
    assert.equal(mem.knownVoidSuits.get('p2')?.has('diamonds'), true);
    assert.equal(mem.knownReturnedCardIds.get('p1')?.has('diamonds-8'), true);
    assert.equal(mem.knownReturnedCardIds.get('p1')?.has('hearts-12'), true);

    // Both Medium and Hard bots MUST avoid leading Diamonds into p2's post-removal void!
    const medCard = chooseBotCard(s, 'p1', 'medium', () => 0.5);
    const hardCard = chooseBotCard(s, 'p1', 'hard', () => 0.5);
    assert.notEqual(medCard?.suit, 'diamonds', 'Medium bot must not repeat cut suit after player removal');
    assert.notEqual(hardCard?.suit, 'diamonds', 'Hard bot must not repeat cut suit after player removal');

    // Structural fairness check: zero hidden opponent hand access even with redistributionHistory present!
    let leaked = false;
    const guardedState: GameState = {
      ...s,
      players: s.players.map((p) => {
        if (p.id === 'p1') return p;
        const guardedHand = new Proxy(p.hand, {
          get(target, prop, receiver) {
            if (prop !== 'length') leaked = true;
            return Reflect.get(target, prop, receiver);
          },
        });
        return { ...p, hand: guardedHand };
      }),
    };
    for (const diff of ['easy', 'medium', 'hard'] as DifficultyMode[]) {
      const picked = chooseBotCard(guardedState, 'p1', diff, () => 0.5);
      assert.ok(picked !== null);
    }
    assert.equal(leaked, false, 'Bots must never inspect hidden opponent hands after redistribution');
  });

  it('Easy bot remains random and rule-compliant after player removal', () => {
    const initial = createInitialGameState(makePlayers(4), {
      difficulty: 'easy',
      customHands: [
        [makeCard('spades', 14), makeCard('diamonds', 8), makeCard('diamonds', 3), makeCard('clubs', 6)],
        [makeCard('spades', 10), makeCard('hearts', 12), makeCard('clubs', 9), makeCard('hearts', 5)],
        [makeCard('spades', 6), makeCard('diamonds', 4), makeCard('clubs', 8), makeCard('hearts', 7)],
        [makeCard('spades', 2), makeCard('hearts', 3)],
      ],
    });

    let s = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p3', 'spades-6') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p4', 'spades-2') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    const removed = removePlayerAndRedistribute(s, 'p4', 'voluntary_exit', createSeededRng(11));
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    s = removed.state;

    // p2 cuts Diamonds with Q♥ -> p1 now holds 3♦, 8♦, 6♣, 3♥, Q♥ (5 legal cards)
    s = (playCard(s, 'p1', 'diamonds-8') as { ok: true; state: GameState }).state;
    s = (playCard(s, 'p2', 'hearts-12') as { ok: true; state: GameState }).state;
    s = continueAfterTrick(s);

    const legalIds = new Set(getLegalCards(s, 'p1').map((c) => c.id));
    const seenIds = new Set<string>();
    const rng = createSeededRng(999);
    for (let i = 0; i < 60; i++) {
      const picked = chooseBotCard(s, 'p1', 'easy', rng);
      assert.ok(picked !== null && legalIds.has(picked.id));
      seenIds.add(picked.id);
    }
    // Easy bot still chooses across ALL legal cards (including Diamonds) randomly without strategic bias
    assert.equal(seenIds.size, legalIds.size);
  });
});

describe('2-Player Shuffle Fairness & 2-Player Exit / Removal Rules', () => {
  it('verifies Fisher–Yates 2-player shuffle fairness across 10,000 simulated deals', () => {
    const TRIALS = 10_000;
    const rng = createSeededRng(20261128);
    const cardToP0 = new Map<string, number>();
    let totalSuitCards = 0;
    let totalSuitSlots = 0;
    let rawAdjSameSuitPairs = 0;
    let totalRawAdjSlots = 0;

    for (let t = 0; t < TRIALS; t++) {
      const deck = shuffleDeck(createDeck(), rng);
      const hands = dealCards(deck, 2);
      assert.equal(hands[0].length, 26);
      assert.equal(hands[1].length, 26);

      const seen = new Set<string>();
      for (const c of hands[0]) {
        seen.add(c.id);
        cardToP0.set(c.id, (cardToP0.get(c.id) ?? 0) + 1);
      }
      for (const c of hands[1]) {
        seen.add(c.id);
      }
      assert.equal(seen.size, 52, 'Every 2-player deal must contain all 52 unique cards');

      for (const hand of hands) {
        const sc: Record<string, number> = { spades: 0, hearts: 0, clubs: 0, diamonds: 0 };
        for (const c of hand) sc[c.suit]++;
        for (const count of Object.values(sc)) {
          totalSuitCards += count;
          totalSuitSlots++;
        }
        for (let i = 0; i < hand.length - 1; i++) {
          totalRawAdjSlots++;
          if (hand[i].suit === hand[i + 1].suit) {
            rawAdjSameSuitPairs++;
          }
        }
      }
    }

    assert.equal(cardToP0.size, 52);
    const expectedP0 = TRIALS / 2;
    const stdDev = Math.sqrt(TRIALS * 0.25);
    for (const [cardId, count] of cardToP0.entries()) {
      const z = Math.abs(count - expectedP0) / stdDev;
      assert.ok(
        z < 4.5,
        `Card ${cardId} deal rate deviated unexpectedly (${count}/${TRIALS}, z=${z.toFixed(2)})`
      );
    }

    const meanCardsPerSuit = totalSuitCards / totalSuitSlots;
    assert.ok(
      meanCardsPerSuit > 6.45 && meanCardsPerSuit < 6.55,
      `Expected ~6.50 cards/suit, got ${meanCardsPerSuit.toFixed(4)}`
    );

    // Raw dealt order adjacent same-suit probability should match exact theory: 12/51 ≈ 0.2353
    const adjSameSuitRate = rawAdjSameSuitPairs / totalRawAdjSlots;
    assert.ok(
      adjSameSuitRate > 0.225 && adjSameSuitRate < 0.245,
      `Expected raw adjacent same-suit rate ~0.2353, got ${adjSameSuitRate.toFixed(4)}`
    );
  });

  it('in a 2-player game, voluntary exit between tricks makes the exiting player lose and the remaining player win with zero card redistribution', () => {
    const initial = createInitialGameState(makePlayers(2), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 9), makeCard('clubs', 7)],
        [makeCard('spades', 10), makeCard('diamonds', 8), makeCard('hearts', 4)],
      ],
    });

    // Mid-trick voluntary exit remains strictly blocked in 2-player games
    const mid = (playCard(initial, 'p1', 'spades-14') as { ok: true; state: GameState }).state;
    const midExit = removePlayerAndRedistribute(mid, 'p1', 'voluntary_exit');
    assert.equal(midExit.ok, false);

    // Complete trick 1 -> between tricks
    let between = (playCard(mid, 'p2', 'spades-10') as { ok: true; state: GameState }).state;
    between = continueAfterTrick(between);

    const exited = removePlayerAndRedistribute(between, 'p1', 'voluntary_exit');
    assert.equal(exited.ok, true);
    if (!exited.ok) return;

    assert.equal(exited.state.phase, 'finished');
    assert.equal(exited.state.currentTurnPlayerId, null);
    assert.equal(exited.state.donkeyPlayerId, 'p1', 'Exiting player must be marked as the loser');
    assert.deepEqual(exited.state.finishOrder, ['p2']);
    assert.deepEqual(exited.state.finishGroups, [['p2']]);

    const p1 = exited.state.players.find((p) => p.id === 'p1')!;
    const p2 = exited.state.players.find((p) => p.id === 'p2')!;
    assert.equal(p1.removed, true);
    assert.equal(p1.finished, false);
    assert.equal(p1.hand.length, 0);
    assert.equal(p2.finished, true);
    assert.equal(p2.finishOrder, 1);
    assert.equal(p2.removed, false);
    assert.equal(p2.hand.length, 2, 'Remaining player must NOT receive redistributed cards');
    assert.equal(exited.state.lastRedistribution?.cardsDistributedCount, 0);
    assert.match(exited.state.endReason ?? '', /Player 1 exited the game and loses\. Player 2 wins!/i);
  });

  it('in a 2-player game, removal after 3 missed turns makes the removed player lose and the remaining player win without redistributing cards', () => {
    const initial = createInitialGameState(makePlayers(2), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 9), makeCard('clubs', 7)],
        [makeCard('spades', 10), makeCard('diamonds', 8), makeCard('hearts', 4)],
      ],
    });

    const removed = removePlayerAndRedistribute(initial, 'p1', 'missed_turns');
    assert.equal(removed.ok, true);
    if (!removed.ok) return;

    assert.equal(removed.state.phase, 'finished');
    assert.equal(removed.state.donkeyPlayerId, 'p1');
    assert.deepEqual(removed.state.finishOrder, ['p2']);
    assert.equal(removed.state.lastRedistribution?.cardsDistributedCount, 0);
    assert.equal(removed.state.players[1].finished, true);
    assert.equal(removed.state.players[1].hand.length, 3);
    assert.match(removed.state.endReason ?? '', /3 consecutive missed turns and loses\. Player 2 wins!/i);
  });
});


