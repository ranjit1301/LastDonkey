import type { Card, Rank, Suit } from './types';

export const SUITS: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const ACE_OF_SPADES_ID = 'spades-14';

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

export const SUIT_NAMES: Record<Suit, string> = {
  spades: 'Spades',
  hearts: 'Hearts',
  diamonds: 'Diamonds',
  clubs: 'Clubs',
};

export function formatRank(rank: Rank): string {
  switch (rank) {
    case 14:
      return 'A';
    case 13:
      return 'K';
    case 12:
      return 'Q';
    case 11:
      return 'J';
    default:
      return String(rank);
  }
}

export function formatCard(card: Card): string {
  return `${formatRank(card.rank)}${SUIT_SYMBOLS[card.suit]}`;
}

export function isRedSuit(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

export function makeCard(suit: Suit, rank: Rank): Card {
  return {
    id: `${suit}-${rank}`,
    suit,
    rank,
  };
}

/**
 * Creates a standard 52-card deck with no jokers.
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(makeCard(suit, rank));
    }
  }
  return deck;
}

/**
 * Returns a new shuffled copy of the deck using Fisher-Yates.
 * Accepts an optional rng function returning [0, 1) for deterministic testing.
 */
export function shuffleDeck(deck: readonly Card[], rng: () => number = Math.random): Card[] {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

/**
 * Deals all 52 cards as evenly as possible among 2 to 6 players.
 * Extra cards go to the first players in dealing order:
 * - 2 players: 26, 26
 * - 3 players: 18, 17, 17
 * - 4 players: 13, 13, 13, 13
 * - 5 players: 11, 11, 10, 10, 10
 * - 6 players: 9, 9, 9, 9, 8, 8
 */
export function dealCards(deck: readonly Card[], playerCount: number): Card[][] {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    throw new Error(`Last Donkey requires between 2 and 6 players (received ${playerCount}).`);
  }

  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < deck.length; i++) {
    hands[i % playerCount].push(deck[i]);
  }
  return hands;
}

const SUIT_SORT_ORDER: Record<Suit, number> = {
  spades: 0,
  hearts: 1,
  clubs: 2,
  diamonds: 3,
};

/**
 * Sorts a hand cleanly by suit (alternating black/red) and rank.
 */
export function sortHand(cards: readonly Card[], order: 'desc' | 'asc' = 'desc'): Card[] {
  return [...cards].sort((a, b) => {
    const suitDiff = SUIT_SORT_ORDER[a.suit] - SUIT_SORT_ORDER[b.suit];
    if (suitDiff !== 0) return suitDiff;
    return order === 'desc' ? b.rank - a.rank : a.rank - b.rank;
  });
}

/**
 * Returns the exact expected card count per player for a given player count.
 */
export function getDealingCounts(playerCount: number): number[] {
  if (playerCount < 2 || playerCount > 6) return [];
  const base = Math.floor(52 / playerCount);
  const remainder = 52 % playerCount;
  return Array.from({ length: playerCount }, (_, idx) => (idx < remainder ? base + 1 : base));
}
