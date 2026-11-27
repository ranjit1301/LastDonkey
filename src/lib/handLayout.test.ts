import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createDeck,
  createInitialGameState,
  makeCard,
  sortHand,
  type Card,
  type GameState,
  type Suit,
} from '../engine/index.ts';
import {
  buildSuitJumpGroups,
  COMPACT_RESULTS_HAND_THRESHOLD,
  computeScrollTargetForRange,
  estimateHandStripWidthPx,
  getAutoScrollPlayableTarget,
  getHandLayoutSpec,
  shouldUseCompactResultsHand,
} from './handLayout.ts';
import { deriveTableTurnState } from './tableTurnState.ts';

function makeHandOfSize(size: number): Card[] {
  const deck = createDeck();
  return sortHand(deck.slice(0, size), 'desc');
}

function makeLargeHandGameState(params: {
  p1Cards: Card[];
  p2Cards: Card[];
  ledSuit?: Suit | null;
  currentTurnPlayerId?: string;
  isFirstTurnOfGame?: boolean;
  p1Connected?: boolean;
  p1Finished?: boolean;
  p1Removed?: boolean;
}): GameState {
  const base = createInitialGameState(
    [
      { id: 'p1', name: 'Aarav', type: 'human' },
      { id: 'p2', name: 'Meera', type: 'human' },
    ],
    { difficulty: 'hard' }
  );

  const ledSuit = params.ledSuit ?? null;
  const plays =
    ledSuit !== null
      ? [{ playerId: 'p2', card: makeCard(ledSuit, 2), order: 0 }]
      : [];

  return {
    ...base,
    phase: 'playing',
    currentTurnPlayerId: params.currentTurnPlayerId ?? 'p1',
    isFirstTurnOfGame: params.isFirstTurnOfGame ?? false,
    currentTrick: {
      trickNumber: 4,
      ledSuit,
      plays,
      expectedPlayerIds: ['p2', 'p1'],
    },
    players: base.players.map((p) => {
      if (p.id === 'p1') {
        return {
          ...p,
          hand: [...params.p1Cards],
          connected: params.p1Connected ?? true,
          finished: params.p1Finished ?? false,
          removed: params.p1Removed ?? false,
        };
      }
      return {
        ...p,
        hand: [...params.p2Cards],
      };
    }),
  };
}

describe('Large-Hand Progressive Layout & Responsive Geometry (13, 26, 30, 40, 51 cards)', () => {
  it('preserves full lg card size for normal hands (<= 18) and steps down progressively for 26, 30, 40, 51 cards', () => {
    const s8 = getHandLayoutSpec(8);
    assert.equal(s8.tier, 'comfort');
    assert.equal(s8.cardSize, 'lg');
    assert.equal(s8.showSuitJumpBar, false);

    const s13 = getHandLayoutSpec(13);
    assert.equal(s13.tier, 'medium');
    assert.equal(s13.cardSize, 'lg');
    assert.equal(s13.showSuitJumpBar, true);

    const s26 = getHandLayoutSpec(26);
    assert.equal(s26.tier, 'compact');
    assert.equal(s26.cardSize, 'compact');
    assert.equal(s26.showSuitJumpBar, true);

    for (const count of [30, 40, 51]) {
      const spec = getHandLayoutSpec(count);
      assert.equal(spec.tier, 'dense');
      assert.equal(spec.cardSize, 'sm');
      assert.equal(spec.showSuitJumpBar, true);
    }
  });

  it('maintains readable, accurately tappable exposed widths (>= 38px) across all hand sizes up to 51 cards', () => {
    for (const count of [1, 10, 13, 20, 26, 30, 40, 51]) {
      const spec = getHandLayoutSpec(count);
      assert.ok(
        spec.exposedWidthPx.mobile >= 38,
        `Mobile exposed width for ${count} cards should be >= 38px (got ${spec.exposedWidthPx.mobile})`
      );
      assert.ok(
        spec.exposedWidthPx.desktop >= 38,
        `Desktop exposed width for ${count} cards should be >= 38px (got ${spec.exposedWidthPx.desktop})`
      );
    }
  });

  it('fits 13 cards completely on 1280px desktop without scrolling and cuts 26–51 card strip widths dramatically across 375px, 430px, tablet, 1024px Easy, and 1280px viewports', () => {
    // Track widths:
    // - Mobile 375px: ~317px
    // - Mobile 430px: ~372px
    // - Tablet 768px (minus padding & flanking arrows): ~612px
    // - Desktop 1024px Easy sidebar (288px sidebar + padding + flanking arrows): ~554px
    // - Desktop 1280px (max-w-4xl 896px minus padding, no flanking arrows when no overflow): ~846px
    const desktop1280NoOverflow = 846;
    const width13Desktop = estimateHandStripWidthPx(13, 'desktop');
    assert.ok(
      width13Desktop <= desktop1280NoOverflow,
      `13 cards should fit on 1280px desktop without scrolling (${width13Desktop}px <= ${desktop1280NoOverflow}px)`
    );

    // 26-card opening hand reduced well below the legacy 1732px desktop / 1220px mobile
    assert.ok(estimateHandStripWidthPx(26, 'desktop') < 1200);
    assert.ok(estimateHandStripWidthPx(26, 'mobile') < 1100);

    // 51-card maximum active hand reduced well below the legacy 3382px desktop / 2370px mobile
    assert.ok(estimateHandStripWidthPx(51, 'desktop') < 2000);
    assert.ok(estimateHandStripWidthPx(51, 'mobile') < 2000);
  });

  it('builds accurate suit-jump groups preserving sorted order and highlighting the active led suit', () => {
    const hand51 = makeHandOfSize(51);
    const groups = buildSuitJumpGroups(hand51, 'diamonds');

    assert.deepEqual(
      groups.map((g) => g.suit),
      ['spades', 'hearts', 'clubs', 'diamonds']
    );
    assert.equal(
      groups.reduce((sum, g) => sum + g.count, 0),
      51
    );
    assert.equal(groups.find((g) => g.suit === 'diamonds')?.isLedSuit, true);
    assert.equal(groups.find((g) => g.suit === 'spades')?.isLedSuit, false);
    // First index of each suit points to an actual card of that suit in sortedHand
    for (const g of groups) {
      assert.equal(hand51[g.firstIndex].suit, g.suit);
      assert.equal(hand51[g.firstIndex].id, g.firstCardId);
    }
  });
});

describe('Playable-Card Auto-Scroll Target & Non-Intrusive Visibility', () => {
  it('targets the first playable card when led suit constrains a large hand (e.g. Diamonds at far right of 51-card hand)', () => {
    const hand51 = makeHandOfSize(51);
    const diamonds = hand51.filter((c) => c.suit === 'diamonds');
    const legalIds = new Set(diamonds.map((c) => c.id));

    const target = getAutoScrollPlayableTarget({
      canActNow: true,
      isFirstTurnOfGame: false,
      ledSuit: 'diamonds',
      sortedHand: hand51,
      legalCardIds: legalIds,
    });

    assert.ok(target);
    assert.equal(target.targetCardId, diamonds[0].id);
    assert.equal(hand51[target.firstIndex].suit, 'diamonds');
    assert.equal(hand51[target.lastIndex].suit, 'diamonds');
  });

  it('does NOT force auto-scroll when leading freely or when void-cutting (all cards legal)', () => {
    const hand30 = makeHandOfSize(30);
    const allIds = new Set(hand30.map((c) => c.id));

    assert.equal(
      getAutoScrollPlayableTarget({
        canActNow: true,
        isFirstTurnOfGame: false,
        ledSuit: null,
        sortedHand: hand30,
        legalCardIds: allIds,
      }),
      null
    );

    assert.equal(
      getAutoScrollPlayableTarget({
        canActNow: true,
        isFirstTurnOfGame: false,
        ledSuit: 'diamonds',
        sortedHand: hand30,
        legalCardIds: allIds, // Void in diamonds -> all cards legal
      }),
      null
    );
  });

  it('returns null when playable cards are already comfortably inside the visible viewport, and scrolls when off-screen', () => {
    // Playable group starts at 1400px in a 1960px strip; viewport is at 0..760px -> MUST scroll!
    const offscreenTarget = computeScrollTargetForRange({
      scrollLeft: 0,
      clientWidth: 760,
      scrollWidth: 1960,
      rangeStartPx: 1400,
      rangeEndPx: 1850,
    });
    assert.equal(offscreenTarget, 1200); // clamped to maxScroll (1960 - 760 = 1200)

    // Playable group starts at 120px in a 1960px strip; viewport is 0..760px -> already visible, NO jump!
    const alreadyVisibleTarget = computeScrollTargetForRange({
      scrollLeft: 0,
      clientWidth: 760,
      scrollWidth: 1960,
      rangeStartPx: 120,
      rangeEndPx: 450,
    });
    assert.equal(alreadyVisibleTarget, null);
  });
});

describe('Large-Hand Card Selection Rules & YOUR TURN Visibility', () => {
  it('allows ONLY led-suit cards to be selectable on a 40-card hand and disables Play button for non-matching cards', () => {
    const fullDeck = createDeck();
    const p1Cards = sortHand(
      fullDeck.filter((c) => c.id !== 'diamonds-2').slice(0, 40),
      'desc'
    );
    const p2Cards = [makeCard('diamonds', 3)];
    const state = makeLargeHandGameState({
      p1Cards,
      p2Cards,
      ledSuit: 'diamonds',
      currentTurnPlayerId: 'p1',
    });

    const diamondCard = p1Cards.find((c) => c.suit === 'diamonds')!;
    const spadeCard = p1Cards.find((c) => c.suit === 'spades')!;

    // Trying to select an off-suit Spade while holding Diamonds must NOT enable Play
    const invalidAttempt = deriveTableTurnState({
      gameState: state,
      perspectivePlayer: state.players[0],
      activeTurnPlayer: state.players[0],
      selectedCardId: spadeCard.id,
      isOnline: false,
    });

    assert.equal(invalidAttempt.canActNow, true);
    assert.equal(invalidAttempt.turnBanner.showYourTurnHighlight, true);
    assert.equal(invalidAttempt.turnBanner.headline, 'YOUR TURN!');
    assert.equal(invalidAttempt.getCardSelectionState(spadeCard.id).isSelectable, false);
    assert.equal(invalidAttempt.getCardSelectionState(spadeCard.id).isVisuallyDisabled, true);
    assert.equal(invalidAttempt.getCardSelectionState(diamondCard.id).isSelectable, true);
    assert.equal(invalidAttempt.validSelectedCard, null);
    assert.equal(invalidAttempt.canPlaySelectedCard, false);

    // Selecting a matching Diamond enables Play
    const validAttempt = deriveTableTurnState({
      gameState: state,
      perspectivePlayer: state.players[0],
      activeTurnPlayer: state.players[0],
      selectedCardId: diamondCard.id,
      isOnline: false,
    });
    assert.equal(validAttempt.validSelectedCard?.id, diamondCard.id);
    assert.equal(validAttempt.canPlaySelectedCard, true);
  });

  it('allows any card on a 30-card hand when void in the led suit, and suppresses YOUR TURN for disconnected/finished/removed players', () => {
    // P1 holds 30 cards with NO diamonds
    const noDiamonds = createDeck()
      .filter((c) => c.suit !== 'diamonds')
      .slice(0, 30);
    const state = makeLargeHandGameState({
      p1Cards: noDiamonds,
      p2Cards: [makeCard('diamonds', 5)],
      ledSuit: 'diamonds',
      currentTurnPlayerId: 'p1',
    });

    const voidTurn = deriveTableTurnState({
      gameState: state,
      perspectivePlayer: state.players[0],
      activeTurnPlayer: state.players[0],
      selectedCardId: noDiamonds[0].id,
      isOnline: false,
    });
    assert.equal(voidTurn.legalCards.length, 30);
    assert.equal(voidTurn.canPlaySelectedCard, true);
    assert.equal(voidTurn.turnBanner.showYourTurnHighlight, true);

    // Disconnected online player must NOT see YOUR TURN highlight or be able to act
    const disconnectedTurn = deriveTableTurnState({
      gameState: state,
      perspectivePlayer: { ...state.players[0], connected: false },
      activeTurnPlayer: state.players[0],
      selectedCardId: noDiamonds[0].id,
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'reconnecting',
    });
    assert.equal(disconnectedTurn.canActNow, false);
    assert.equal(disconnectedTurn.turnBanner.showYourTurnHighlight, false);
    assert.equal(disconnectedTurn.turnBanner.mode, 'reconnecting_your_turn');

    // Finished/spectating player must NOT see YOUR TURN highlight
    const finishedTurn = deriveTableTurnState({
      gameState: state,
      perspectivePlayer: { ...state.players[0], finished: true, hand: [] },
      activeTurnPlayer: state.players[1],
      selectedCardId: null,
      isOnline: true,
      onlineRoom: { status: 'playing', yourPlayerId: 'p1' },
      connectionStatus: 'connected',
    });
    assert.equal(finishedTurn.canActNow, false);
    assert.equal(finishedTurn.turnBanner.showYourTurnHighlight, false);
  });
});

describe('Game Results Screen — Compact Donkey Hand Threshold', () => {
  it('keeps standard layout up to 18 cards and switches to compact layout for 19–52 cards', () => {
    assert.equal(COMPACT_RESULTS_HAND_THRESHOLD, 18);
    assert.equal(shouldUseCompactResultsHand(1), false);
    assert.equal(shouldUseCompactResultsHand(18), false);
    assert.equal(shouldUseCompactResultsHand(19), true);
    assert.equal(shouldUseCompactResultsHand(40), true);
    assert.equal(shouldUseCompactResultsHand(52), true);
  });
});
