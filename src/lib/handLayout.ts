import { SUITS, type Card, type Suit } from '../engine/index.ts';

export type HandCardSize = 'lg' | 'compact' | 'sm';

export type HandDensityTier = 'comfort' | 'medium' | 'compact' | 'dense';

export interface HandLayoutSpec {
  tier: HandDensityTier;
  cardSize: HandCardSize;
  /** Tailwind negative horizontal spacing class applied to the card flex strip */
  overlapClass: string;
  /** Nominal card width in px on mobile (<640px) and desktop (>=640px) */
  cardWidthPx: { mobile: number; desktop: number };
  /** Horizontal overlap in px on mobile and desktop */
  overlapPx: { mobile: number; desktop: number };
  /** Exposed clickable/readable left strip per overlapped card in px */
  exposedWidthPx: { mobile: number; desktop: number };
  /** Show suit quick-jump controls above the hand */
  showSuitJumpBar: boolean;
}

export interface SuitJumpGroup {
  suit: Suit;
  count: number;
  firstIndex: number;
  firstCardId: string;
  isLedSuit: boolean;
}

/**
 * Progressive hand layout tiers tuned for 1–51 cards across mobile and desktop.
 * - Keeps 1–18 cards full 'lg' size (never universally shrinks normal hands).
 * - Steps down smoothly for 2-player 26-card opening hands ('compact') and
 *   extreme 29–51 card hands ('sm'), always preserving >= 38px exposed card width
 *   so rank/suit indices and tap/click targets remain accurate.
 */
export function getHandLayoutSpec(handSize: number): HandLayoutSpec {
  if (handSize <= 10) {
    return {
      tier: 'comfort',
      cardSize: 'lg',
      overlapClass: '-space-x-4 sm:-space-x-3',
      cardWidthPx: { mobile: 70, desktop: 82 },
      overlapPx: { mobile: 16, desktop: 12 },
      exposedWidthPx: { mobile: 54, desktop: 70 },
      showSuitJumpBar: false,
    };
  }

  if (handSize <= 18) {
    return {
      tier: 'medium',
      cardSize: 'lg',
      overlapClass: '-space-x-6 sm:-space-x-5',
      cardWidthPx: { mobile: 70, desktop: 82 },
      overlapPx: { mobile: 24, desktop: 20 },
      exposedWidthPx: { mobile: 46, desktop: 62 },
      showSuitJumpBar: handSize >= 13,
    };
  }

  if (handSize <= 28) {
    return {
      tier: 'compact',
      cardSize: 'compact',
      overlapClass: '-space-x-[22px] sm:-space-x-[28px]',
      cardWidthPx: { mobile: 62, desktop: 72 },
      overlapPx: { mobile: 22, desktop: 28 },
      exposedWidthPx: { mobile: 40, desktop: 44 },
      showSuitJumpBar: true,
    };
  }

  return {
    tier: 'dense',
    cardSize: 'sm',
    overlapClass: '-space-x-[18px] sm:-space-x-[26px]',
    cardWidthPx: { mobile: 56, desktop: 64 },
    overlapPx: { mobile: 18, desktop: 26 },
    exposedWidthPx: { mobile: 38, desktop: 38 },
    showSuitJumpBar: true,
  };
}

/**
 * Computes exact rendered strip width in px for a given card count and viewport class.
 */
export function estimateHandStripWidthPx(handSize: number, viewport: 'mobile' | 'desktop'): number {
  if (handSize <= 0) return 0;
  const spec = getHandLayoutSpec(handSize);
  const cardW = spec.cardWidthPx[viewport];
  const step = spec.exposedWidthPx[viewport];
  return cardW + (handSize - 1) * step;
}

/**
 * Builds ordered suit quick-jump metadata from the already-sorted hand.
 */
export function buildSuitJumpGroups(
  sortedHand: readonly Card[],
  ledSuit: Suit | null
): SuitJumpGroup[] {
  const groups: SuitJumpGroup[] = [];

  for (const suit of SUITS) {
    const firstIndex = sortedHand.findIndex((c) => c.suit === suit);
    if (firstIndex === -1) continue;
    let count = 0;
    for (const c of sortedHand) {
      if (c.suit === suit) count++;
    }
    groups.push({
      suit,
      count,
      firstIndex,
      firstCardId: sortedHand[firstIndex].id,
      isLedSuit: ledSuit === suit,
    });
  }

  return groups;
}

/**
 * Determines whether the current turn/suit context should trigger a one-shot
 * auto-scroll to bring playable cards into view, returning the first playable
 * card's ID (or null when no forced jump is warranted).
 */
export function getAutoScrollPlayableTarget(params: {
  canActNow: boolean;
  isFirstTurnOfGame: boolean;
  ledSuit: Suit | null;
  sortedHand: readonly Card[];
  legalCardIds: ReadonlySet<string>;
}): { targetCardId: string; firstIndex: number; lastIndex: number } | null {
  const { canActNow, isFirstTurnOfGame, ledSuit, sortedHand, legalCardIds } = params;
  if (!canActNow || legalCardIds.size === 0 || sortedHand.length === 0) return null;

  // Only auto-scroll when the legal set is constrained (Turn 1 A♠ or following ledSuit).
  // When leading freely or void-cutting (all cards legal), don't yank the player's scroll.
  const isConstrained =
    isFirstTurnOfGame || (ledSuit !== null && legalCardIds.size < sortedHand.length);
  if (!isConstrained) return null;

  let firstIndex = -1;
  let lastIndex = -1;
  for (let i = 0; i < sortedHand.length; i++) {
    if (legalCardIds.has(sortedHand[i].id)) {
      if (firstIndex === -1) firstIndex = i;
      lastIndex = i;
    }
  }

  if (firstIndex === -1) return null;

  return {
    targetCardId: sortedHand[firstIndex].id,
    firstIndex,
    lastIndex,
  };
}

/**
 * Computes whether a target range [rangeStartPx, rangeEndPx] inside a scroll
 * container is already visible, and if not, returns the target scrollLeft value
 * to bring the start of the playable group comfortably into view.
 */
export function computeScrollTargetForRange(params: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
  rangeStartPx: number;
  rangeEndPx: number;
  insetMarginPx?: number;
}): number | null {
  const {
    scrollLeft,
    clientWidth,
    scrollWidth,
    rangeStartPx,
    rangeEndPx,
    insetMarginPx = 24,
  } = params;

  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
  if (maxScrollLeft <= 1) return null;

  const visibleStart = scrollLeft + 8;
  const visibleEnd = scrollLeft + clientWidth - 8;

  // If the first playable card (or any part of the group with full card visibility)
  // is already comfortably visible inside the viewport, do NOT jump!
  const overlapsComfortably =
    rangeStartPx >= visibleStart && rangeStartPx + 36 <= visibleEnd;
  const endsComfortablyInside =
    rangeEndPx <= visibleEnd && rangeEndPx - 36 >= visibleStart;

  if (overlapsComfortably || endsComfortablyInside) {
    return null;
  }

  const desired = Math.max(0, Math.min(maxScrollLeft, rangeStartPx - insetMarginPx));
  if (Math.abs(desired - scrollLeft) < 4) return null;
  return desired;
}

/**
 * Threshold above which the Donkey's remaining hand on GameResultsScreen
 * switches to the compact layout so Rematch and Home stay quickly reachable.
 */
export const COMPACT_RESULTS_HAND_THRESHOLD = 18;

export function shouldUseCompactResultsHand(cardCount: number): boolean {
  return cardCount > COMPACT_RESULTS_HAND_THRESHOLD;
}
