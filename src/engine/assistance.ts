import type { Card, DifficultyMode, GameState, Suit } from './types.ts';

export interface DifficultyMetadata {
  id: DifficultyMode;
  label: string;
  subtitle: string;
  shortTag: string;
  botSummary: string;
  assistSummary: string;
}

export const DIFFICULTY_META: Record<DifficultyMode, DifficultyMetadata> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    subtitle: 'Beginner',
    shortTag: 'Easy · Beginner',
    botSummary: 'Random legal bot play',
    assistSummary: 'Permanent discarded-card tracker visible',
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    subtitle: 'Strategic Learning',
    shortTag: 'Medium · Strategic',
    botSummary: 'Smart bots tracking public suits',
    assistSummary: 'Exact remaining suit counts + occasional hints',
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    subtitle: 'Expert',
    shortTag: 'Hard · Expert',
    botSummary: 'Probability-based expert bots',
    assistSummary: 'No tracker, no suit counts, no hints',
  },
};

export const TRACKER_SUIT_ORDER: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];

export type DiscardedBySuit = Record<Suit, Card[]>;
export type RemainingSuitCounts = Record<Suit, number>;

export function isDifficultyMode(value: unknown): value is DifficultyMode {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

/**
 * Easy Mode helper:
 * Groups ONLY permanently discarded cards (from successful tricks) by suit,
 * sorted from Ace down to 2. Failed-trick cards are NEVER in removedCards.
 */
export function getDiscardedCardsBySuit(removedCards: readonly Card[]): DiscardedBySuit {
  const grouped: DiscardedBySuit = {
    spades: [],
    hearts: [],
    clubs: [],
    diamonds: [],
  };

  for (const card of removedCards) {
    grouped[card.suit].push(card);
  }

  for (const suit of TRACKER_SUIT_ORDER) {
    grouped[suit].sort((a, b) => b.rank - a.rank);
  }

  return grouped;
}

/**
 * Medium Mode helper:
 * Calculates exact remaining cards still in play for each suit using strictly
 * public information (13 cards per suit minus permanently discarded successful-trick cards).
 * Cards returned to a player's hand after a failed trick are NOT in removedCards,
 * so they remain accurately counted as still in play without revealing any card ranks.
 */
export function getPublicRemainingSuitCounts(removedCards: readonly Card[]): RemainingSuitCounts {
  const counts: RemainingSuitCounts = {
    spades: 13,
    hearts: 13,
    clubs: 13,
    diamonds: 13,
  };

  for (const card of removedCards) {
    counts[card.suit] = Math.max(0, counts[card.suit] - 1);
  }

  return counts;
}

interface PublicHintStateView {
  phase: GameState['phase'];
  difficulty?: DifficultyMode;
  isFirstTurnOfGame: boolean;
  currentTurnPlayerId: string | null;
  currentTrick: GameState['currentTrick'];
  removedCards: readonly Card[];
  trickHistory: GameState['trickHistory'];
  players: readonly {
    id: string;
    finished: boolean;
    removed: boolean;
    hand: readonly Card[];
  }[];
}

/**
 * Medium Mode strategic hint generator:
 * - Only produces hints in Medium mode on the human player's active turn.
 * - Uses ONLY publicly available game info + the current player's own hand.
 * - Occasional, short, informative, never prescriptive, never names/recommends/highlights a card.
 */
export function getMediumStrategicHint(
  state: PublicHintStateView,
  playerId: string
): string | null {
  if (state.difficulty !== 'medium') return null;
  if (state.phase !== 'playing') return null;
  if (state.currentTurnPlayerId !== playerId) return null;
  if (state.isFirstTurnOfGame) return null;

  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.finished || player.removed || player.hand.length <= 1) return null;

  const trickNum = state.currentTrick.trickNumber;
  const ledSuit = state.currentTrick.ledSuit;
  const plays = state.currentTrick.plays;
  const expected = state.currentTrick.expectedPlayerIds;
  const activeCount = state.players.filter((p) => !p.finished && !p.removed).length;
  const remainingCounts = getPublicRemainingSuitCounts(state.removedCards);
  const lastOutcome =
    state.trickHistory.length > 0 ? state.trickHistory[state.trickHistory.length - 1] : null;

  // Situation 1: Player cannot follow the led suit (off-suit cut moment)
  if (ledSuit !== null) {
    const matchingSuit = player.hand.filter((c) => c.suit === ledSuit);
    if (matchingSuit.length === 0) {
      return 'An off-suit play will end this trick.';
    }

    // Situation 2: Following suit with players still to act behind you, holding both high & low options
    const playersBehind = Math.max(0, expected.length - plays.length - 1);
    const hasHigh = matchingSuit.some((c) => c.rank >= 11);
    const hasLow = matchingSuit.some((c) => c.rank <= 8);
    if (playersBehind > 0 && hasHigh && hasLow && trickNum % 2 === 0) {
      return 'You may want to save your higher card.';
    }

    // Occasional endgame reminder when few active players remain
    if (activeCount <= 3 && trickNum % 3 === 1) {
      return 'Consider which cards may still be in play.';
    }

    return null;
  }

  // Situation 3: Leading a trick immediately after a failed trick (cards were returned to a hand)
  if (lastOutcome?.type === 'failed' && plays.length === 0 && trickNum % 2 === 1) {
    return 'Returned cards from a failed trick are still in play.';
  }

  // Situation 4: Leading a trick when at least one held suit has few remaining cards outside your hand
  if (plays.length === 0) {
    const heldSuits = Array.from(new Set(player.hand.map((c) => c.suit)));
    const hasTightSuit = heldSuits.some((suit) => {
      const mySuitCount = player.hand.filter((c) => c.suit === suit).length;
      const othersSuitCount = Math.max(0, remainingCounts[suit] - mySuitCount);
      return othersSuitCount > 0 && othersSuitCount < activeCount;
    });

    if (hasTightSuit && trickNum % 2 === 0) {
      return 'Think carefully before leading this suit.';
    }

    if (activeCount <= 3 && trickNum % 3 === 0) {
      return 'Consider which cards may still be in play.';
    }
  }

  return null;
}

interface PracticeFinishCheckState {
  phase: GameState['phase'];
  players: readonly {
    id: string;
    type: 'human' | 'bot';
    finished: boolean;
    finishOrder: number | null;
    removed: boolean;
    hand: readonly Card[];
    cardCount?: number;
  }[];
}

/**
 * Returns true ONLY when the human player in Practice vs Bots has officially finished
 * all their cards after trick resolution under confirmed Rang Vapas rules, while at
 * least 2 remaining bots are still actively playing (so no Donkey has been determined yet).
 */
export function canFinishPracticeSessionEarly(
  state: PracticeFinishCheckState,
  playerId: string,
  isPracticeVsBots: boolean
): boolean {
  if (!isPracticeVsBots) return false;
  if (state.phase === 'finished') return false;

  // Strictly Practice vs Bots (1 human + bots)
  const humanCount = state.players.filter((p) => p.type === 'human').length;
  if (humanCount !== 1) return false;

  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.type !== 'human') return false;
  if (player.removed) return false;

  const cardsLeft = typeof player.cardCount === 'number' ? player.cardCount : player.hand.length;
  return player.finished === true && player.finishOrder !== null && cardsLeft === 0;
}
