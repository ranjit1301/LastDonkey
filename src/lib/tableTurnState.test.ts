import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACE_OF_SPADES_ID,
  canPlayCard,
  continueAfterTrick,
  createInitialGameState,
  getLegalCards,
  playCard,
  type Card,
  type DifficultyMode,
  type GameState,
} from '../engine/index.ts';
import { deriveTableTurnState } from './tableTurnState.ts';

function c(suit: Card['suit'], rank: Card['rank']): Card {
  return { id: `${suit}-${rank}`, suit, rank };
}

function makeTwoPlayerState(
  p1Hand: Card[],
  p2Hand: Card[],
  difficulty: DifficultyMode = 'easy'
): GameState {
  return createInitialGameState(
    [
      { id: 'p1', name: 'Aarav', type: 'human' },
      { id: 'p2', name: 'Meera', type: 'human' },
    ],
    {
      customHands: [p1Hand, p2Hand],
      difficulty,
    }
  );
}

describe('Issue 1 — Card Selection Rules & Play Button Consistency', () => {
  it('restricts selection strictly to active trick suit across Easy, Medium, and Hard when holding that suit', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      // p1 leads A♠ (Turn 1), then it is p2's turn with active ledSuit = 'spades'
      const initial = makeTwoPlayerState(
        [c('spades', 14), c('hearts', 10)],
        [c('spades', 7), c('spades', 12), c('hearts', 4), c('diamonds', 9)],
        difficulty
      );
      const afterLead = playCard(initial, 'p1', ACE_OF_SPADES_ID);
      assert.equal(afterLead.ok, true);
      if (!afterLead.ok) return;

      const p2 = afterLead.state.players[1];
      const engineLegalIds = new Set(getLegalCards(afterLead.state, 'p2').map((card) => card.id));
      assert.deepEqual([...engineLegalIds].sort(), ['spades-12', 'spades-7']);

      const turnState = deriveTableTurnState({
        gameState: afterLead.state,
        perspectivePlayer: p2,
        activeTurnPlayer: p2,
        selectedCardId: null,
        isOnline: false,
      });

      assert.equal(turnState.canActNow, true);
      assert.deepEqual(
        turnState.legalCards.map((card) => card.id).sort(),
        [...engineLegalIds].sort(),
        `Client legalCards must match engine getLegalCards in ${difficulty} mode`
      );

      // Matching suit cards are selectable and NOT visually disabled
      for (const id of ['spades-7', 'spades-12']) {
        const s = turnState.getCardSelectionState(id);
        assert.equal(s.isSelectable, true, `${id} should be selectable in ${difficulty}`);
        assert.equal(s.isVisuallyDisabled, false, `${id} should not be disabled in ${difficulty}`);
        assert.equal(canPlayCard(afterLead.state, 'p2', id), true);
      }

      // Off-suit cards MUST NOT be selectable and MUST be visually disabled even in Hard mode
      for (const id of ['hearts-4', 'diamonds-9']) {
        const s = turnState.getCardSelectionState(id);
        assert.equal(s.isSelectable, false, `${id} must NOT be selectable in ${difficulty}`);
        assert.equal(s.isVisuallyDisabled, true, `${id} must be visually disabled in ${difficulty}`);
        assert.equal(canPlayCard(afterLead.state, 'p2', id), false);
      }

      // Selecting an invalid off-suit card ID must never enable Play button
      const invalidSelection = deriveTableTurnState({
        gameState: afterLead.state,
        perspectivePlayer: p2,
        activeTurnPlayer: p2,
        selectedCardId: 'hearts-4',
        isOnline: false,
      });
      assert.equal(invalidSelection.validSelectedCard, null);
      assert.equal(invalidSelection.canPlaySelectedCard, false);

      // Selecting a valid trick-suit card enables Play button
      const validSelection = deriveTableTurnState({
        gameState: afterLead.state,
        perspectivePlayer: p2,
        activeTurnPlayer: p2,
        selectedCardId: 'spades-7',
        isOnline: false,
      });
      assert.equal(validSelection.validSelectedCard?.id, 'spades-7');
      assert.equal(validSelection.canPlaySelectedCard, true);

      // Authoritative engine still rejects off-suit play if forced
      const serverReject = playCard(afterLead.state, 'p2', 'hearts-4');
      assert.equal(serverReject.ok, false);
    }
  });

  it('allows selecting ANY card when the player has zero cards of the active trick suit', () => {
    const initial = makeTwoPlayerState(
      [c('spades', 14), c('clubs', 5)],
      [c('hearts', 6), c('diamonds', 11), c('clubs', 9)],
      'hard'
    );
    const afterLead = playCard(initial, 'p1', ACE_OF_SPADES_ID);
    assert.equal(afterLead.ok, true);
    if (!afterLead.ok) return;

    const p2 = afterLead.state.players[1];
    const turnState = deriveTableTurnState({
      gameState: afterLead.state,
      perspectivePlayer: p2,
      activeTurnPlayer: p2,
      selectedCardId: 'diamonds-11',
      isOnline: false,
    });

    assert.equal(turnState.canActNow, true);
    assert.equal(turnState.legalCards.length, 3);
    for (const card of p2.hand) {
      const s = turnState.getCardSelectionState(card.id);
      assert.equal(s.isSelectable, true);
      assert.equal(s.isVisuallyDisabled, false);
    }
    assert.equal(turnState.validSelectedCard?.id, 'diamonds-11');
    assert.equal(turnState.canPlaySelectedCard, true);

    // Authoritative engine accepts the off-suit cut
    const cutRes = playCard(afterLead.state, 'p2', 'diamonds-11');
    assert.equal(cutRes.ok, true);
  });

  it('enforces Ace of Spades only on Turn 1 and allows any card on subsequent fresh leads with no active trick suit', () => {
    const initial = makeTwoPlayerState(
      [c('spades', 14), c('hearts', 10), c('clubs', 3)],
      [c('spades', 8), c('diamonds', 5), c('hearts', 2)],
      'hard'
    );

    // Turn 1: no ledSuit yet, but isFirstTurnOfGame requires A♠
    const p1 = initial.players[0];
    const turn1 = deriveTableTurnState({
      gameState: initial,
      perspectivePlayer: p1,
      activeTurnPlayer: p1,
      selectedCardId: 'hearts-10',
      isOnline: false,
    });
    assert.equal(turn1.getCardSelectionState(ACE_OF_SPADES_ID).isSelectable, true);
    assert.equal(turn1.getCardSelectionState('hearts-10').isSelectable, false);
    assert.equal(turn1.getCardSelectionState('hearts-10').isVisuallyDisabled, true);
    assert.equal(turn1.canPlaySelectedCard, false);

    // Finish Trick 1 (p1 plays A♠, p2 follows 8♠) -> Trick 2 has no active ledSuit
    const t1a = playCard(initial, 'p1', ACE_OF_SPADES_ID);
    assert.equal(t1a.ok, true);
    if (!t1a.ok) return;
    const t1b = playCard(t1a.state, 'p2', 'spades-8');
    assert.equal(t1b.ok, true);
    if (!t1b.ok) return;
    const trick2 = continueAfterTrick(t1b.state);
    assert.equal(trick2.currentTrick.ledSuit, null);
    assert.equal(trick2.currentTurnPlayerId, 'p1');

    const p1Trick2 = trick2.players[0];
    const leadTurn = deriveTableTurnState({
      gameState: trick2,
      perspectivePlayer: p1Trick2,
      activeTurnPlayer: p1Trick2,
      selectedCardId: 'clubs-3',
      isOnline: false,
    });
    assert.equal(leadTurn.legalCards.length, 2);
    assert.equal(leadTurn.getCardSelectionState('hearts-10').isSelectable, true);
    assert.equal(leadTurn.getCardSelectionState('clubs-3').isSelectable, true);
    assert.equal(leadTurn.canPlaySelectedCard, true);
  });
});

describe('Issue 2 — Turn Visibility Across Turn Changes, Reconnects, States & Rematch', () => {
  it('shows YOUR TURN! only when player can act and immediately switches to opponent turn after playing a card', () => {
    const initial = makeTwoPlayerState(
      [c('spades', 14), c('hearts', 10)],
      [c('spades', 7), c('diamonds', 9)]
    );

    // Before playing: p1 sees YOUR TURN!
    const beforePlay = deriveTableTurnState({
      gameState: initial,
      perspectivePlayer: initial.players[0],
      activeTurnPlayer: initial.players[0],
      selectedCardId: ACE_OF_SPADES_ID,
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'connected',
    });
    assert.equal(beforePlay.canActNow, true);
    assert.equal(beforePlay.turnBanner.showYourTurnHighlight, true);
    assert.equal(beforePlay.turnBanner.headline, 'YOUR TURN!');
    assert.equal(beforePlay.canPlaySelectedCard, true);

    // After p1 plays A♠: p1 immediately stops seeing YOUR TURN! and sees Meera's Turn
    const afterPlay = playCard(initial, 'p1', ACE_OF_SPADES_ID);
    assert.equal(afterPlay.ok, true);
    if (!afterPlay.ok) return;

    const p1Waiting = deriveTableTurnState({
      gameState: afterPlay.state,
      perspectivePlayer: afterPlay.state.players[0],
      activeTurnPlayer: afterPlay.state.players[1],
      selectedCardId: ACE_OF_SPADES_ID,
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'connected',
    });
    assert.equal(p1Waiting.canActNow, false);
    assert.equal(p1Waiting.turnBanner.showYourTurnHighlight, false);
    assert.equal(p1Waiting.turnBanner.mode, 'other_turn');
    assert.equal(p1Waiting.turnBanner.headline, 'Meera’s Turn');
    assert.equal(p1Waiting.canPlaySelectedCard, false);
    assert.equal(p1Waiting.getCardSelectionState('hearts-10').isSelectable, false);
    assert.equal(p1Waiting.getCardSelectionState('hearts-10').isWaitingMuted, true);

    // After p2 follows suit -> phase === 'trick_result' -> neither player sees YOUR TURN!
    const trickDone = playCard(afterPlay.state, 'p2', 'spades-7');
    assert.equal(trickDone.ok, true);
    if (!trickDone.ok) return;
    assert.equal(trickDone.state.phase, 'trick_result');

    const resolvingState = deriveTableTurnState({
      gameState: trickDone.state,
      perspectivePlayer: trickDone.state.players[0],
      activeTurnPlayer: null,
      selectedCardId: 'hearts-10',
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'connected',
    });
    assert.equal(resolvingState.canActNow, false);
    assert.equal(resolvingState.turnBanner.showYourTurnHighlight, false);
    assert.equal(resolvingState.turnBanner.mode, 'trick_resolving');
  });

  it('never shows YOUR TURN! while disconnected or reconnecting, and restores immediately on reconnect', () => {
    const initial = makeTwoPlayerState(
      [c('spades', 14), c('hearts', 10)],
      [c('spades', 7), c('diamonds', 9)]
    );

    // Socket reconnecting during p1's turn
    const reconnecting = deriveTableTurnState({
      gameState: initial,
      perspectivePlayer: initial.players[0],
      activeTurnPlayer: initial.players[0],
      selectedCardId: ACE_OF_SPADES_ID,
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'reconnecting',
    });
    assert.equal(reconnecting.canActNow, false);
    assert.equal(reconnecting.isDisconnectedOnOwnTurn, true);
    assert.equal(reconnecting.turnBanner.showYourTurnHighlight, false);
    assert.equal(reconnecting.turnBanner.mode, 'reconnecting_your_turn');
    assert.equal(reconnecting.canPlaySelectedCard, false);
    assert.equal(reconnecting.getCardSelectionState(ACE_OF_SPADES_ID).isSelectable, false);

    // Player marked disconnected in authoritative server snapshot
    const seatOffline = deriveTableTurnState({
      gameState: initial,
      perspectivePlayer: { ...initial.players[0], connected: false },
      activeTurnPlayer: { ...initial.players[0], connected: false },
      selectedCardId: ACE_OF_SPADES_ID,
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'connected',
    });
    assert.equal(seatOffline.canActNow, false);
    assert.equal(seatOffline.turnBanner.showYourTurnHighlight, false);

    // Reconnect completes -> YOUR TURN! and valid selection restore immediately
    const reconnected = deriveTableTurnState({
      gameState: initial,
      perspectivePlayer: initial.players[0],
      activeTurnPlayer: initial.players[0],
      selectedCardId: ACE_OF_SPADES_ID,
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'connected',
    });
    assert.equal(reconnected.canActNow, true);
    assert.equal(reconnected.turnBanner.showYourTurnHighlight, true);
    assert.equal(reconnected.turnBanner.headline, 'YOUR TURN!');
    assert.equal(reconnected.canPlaySelectedCard, true);
  });

  it('never shows YOUR TURN! when eliminated, finished/spectating, waiting, behind privacy curtain, or spectating another seat', () => {
    const initial = makeTwoPlayerState(
      [c('spades', 14), c('hearts', 10)],
      [c('spades', 7), c('diamonds', 9)]
    );

    // Eliminated / removed player
    const removed = deriveTableTurnState({
      gameState: initial,
      perspectivePlayer: { ...initial.players[0], removed: true },
      activeTurnPlayer: initial.players[1],
      selectedCardId: null,
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'connected',
    });
    assert.equal(removed.canActNow, false);
    assert.equal(removed.turnBanner.showYourTurnHighlight, false);

    // Finished safe / spectating
    const finished = deriveTableTurnState({
      gameState: initial,
      perspectivePlayer: { ...initial.players[0], finished: true, hand: [] },
      activeTurnPlayer: initial.players[1],
      selectedCardId: null,
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'connected',
    });
    assert.equal(finished.canActNow, false);
    assert.equal(finished.turnBanner.showYourTurnHighlight, false);

    // Waiting lobby status online
    const waitingRoom = deriveTableTurnState({
      gameState: initial,
      perspectivePlayer: initial.players[0],
      activeTurnPlayer: initial.players[0],
      selectedCardId: null,
      isOnline: true,
      onlineRoom: { status: 'waiting', yourPlayerId: 'p1' },
      connectionStatus: 'connected',
    });
    assert.equal(waitingRoom.canActNow, false);
    assert.equal(waitingRoom.turnBanner.showYourTurnHighlight, false);

    // Online seat mismatch (spectating another player's seat)
    const spectatingOther = deriveTableTurnState({
      gameState: initial,
      perspectivePlayer: initial.players[0],
      activeTurnPlayer: initial.players[0],
      selectedCardId: null,
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p2' },
      connectionStatus: 'connected',
    });
    assert.equal(spectatingOther.canActNow, false);
    assert.equal(spectatingOther.turnBanner.showYourTurnHighlight, false);

    // Pass-and-Play privacy curtain active
    const behindCurtain = deriveTableTurnState({
      gameState: initial,
      perspectivePlayer: initial.players[0],
      activeTurnPlayer: initial.players[0],
      selectedCardId: ACE_OF_SPADES_ID,
      isOnline: false,
      needsPrivacyCurtain: true,
    });
    assert.equal(behindCurtain.canActNow, false);
    assert.equal(behindCurtain.turnBanner.showYourTurnHighlight, false);
    assert.equal(behindCurtain.canPlaySelectedCard, false);
  });

  it('updates turn highlight and resets invalid stale selections cleanly across a rematch', () => {
    // Match 1 ended; Rematch deals A♠ to p2 instead of p1
    const rematchGame = makeTwoPlayerState(
      [c('hearts', 10), c('clubs', 5)],
      [c('spades', 14), c('diamonds', 9)]
    );
    assert.equal(rematchGame.currentTurnPlayerId, 'p2');

    // p1 had a stale card selected from prior match -> rejected & sees Meera's Turn
    const p1Rematch = deriveTableTurnState({
      gameState: rematchGame,
      perspectivePlayer: rematchGame.players[0],
      activeTurnPlayer: rematchGame.players[1],
      selectedCardId: 'hearts-10',
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'connected',
    });
    assert.equal(p1Rematch.canActNow, false);
    assert.equal(p1Rematch.turnBanner.showYourTurnHighlight, false);
    assert.equal(p1Rematch.turnBanner.headline, 'Meera’s Turn');
    assert.equal(p1Rematch.canPlaySelectedCard, false);

    // p2 immediately gets YOUR TURN! with only A♠ selectable
    const p2Rematch = deriveTableTurnState({
      gameState: rematchGame,
      perspectivePlayer: rematchGame.players[1],
      activeTurnPlayer: rematchGame.players[1],
      selectedCardId: 'diamonds-9', // stale/invalid card for Turn 1
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p2' },
      connectionStatus: 'connected',
    });
    assert.equal(p2Rematch.canActNow, true);
    assert.equal(p2Rematch.turnBanner.showYourTurnHighlight, true);
    assert.equal(p2Rematch.turnBanner.headline, 'YOUR TURN!');
    assert.equal(p2Rematch.getCardSelectionState(ACE_OF_SPADES_ID).isSelectable, true);
    assert.equal(p2Rematch.getCardSelectionState('diamonds-9').isSelectable, false);
    assert.equal(p2Rematch.canPlaySelectedCard, false);
  });
});
