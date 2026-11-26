export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

/**
 * Standard card ranks in Last Donkey (Rang Vapas):
 * 2 is lowest, Ace (14) is highest.
 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  id: string; // e.g., "spades-14" for Ace of Spades
  suit: Suit;
  rank: Rank;
}

export type PlayerType = 'human' | 'bot';
export type DifficultyMode = 'easy' | 'medium' | 'hard';
export type BotDifficulty = DifficultyMode;

export interface BotPublicPlayerInfo {
  id: string;
  seatIndex: number;
  cardCount: number;
  finished: boolean;
  removed: boolean;
}

export interface BotPublicObservation {
  botId: string;
  ownHand: readonly Card[];
  legalCards: readonly Card[];
  isFirstTurnOfGame: boolean;
  currentTrick: {
    trickNumber: number;
    ledSuit: Suit | null;
    plays: readonly TrickPlay[];
    expectedPlayerIds: readonly string[];
  };
  removedCards: readonly Card[];
  trickHistory: readonly TrickOutcome[];
  redistributionHistory: readonly RedistributionEvent[];
  players: readonly BotPublicPlayerInfo[];
}

export interface PlayerConfig {
  id: string;
  name: string;
  type: PlayerType;
  avatarColor?: string;
}

export interface Player {
  id: string;
  name: string;
  type: PlayerType;
  seatIndex: number;
  hand: Card[];
  finished: boolean;
  finishOrder: number | null; // Competition rank (simultaneous finishers share the same rank, e.g. both #1)
  removed: boolean; // True if player exited voluntarily or was removed after 3 consecutive missed turns
  connected: boolean;
  consecutiveMissedTurns: number;
  avatarColor: string;
}

export interface TrickPlay {
  playerId: string;
  card: Card;
  order: number;
}

export interface CurrentTrick {
  trickNumber: number;
  ledSuit: Suit | null;
  plays: TrickPlay[];
  expectedPlayerIds: string[];
}

export interface SuccessfulTrickOutcome {
  type: 'success';
  trickNumber: number;
  ledSuit: Suit;
  plays: TrickPlay[];
  highestPlay: TrickPlay;
  nextLeaderId: string | null;
  newlyFinishedIds: string[]; // Simultaneous finishers on this trick
  removedCards: Card[];
}

export interface FailedTrickOutcome {
  type: 'failed';
  trickNumber: number;
  ledSuit: Suit;
  plays: TrickPlay[];
  offSuitPlay: TrickPlay;
  collectorId: string; // Always the highest led-suit card player (no last-card protection)
  collectedCards: Card[];
  nextLeaderId: string | null;
  newlyFinishedIds: string[];
}

export type TrickOutcome = SuccessfulTrickOutcome | FailedTrickOutcome;

export type GamePhase = 'playing' | 'trick_result' | 'finished';

export interface RedistributionEvent {
  removedPlayerId: string;
  removedPlayerName: string;
  reason: 'voluntary_exit' | 'missed_turns';
  cardsDistributedCount: number;
  recipientCounts: Record<string, number>;
  /** Number of completed tricks in trickHistory when this redistribution occurred (public timeline marker) */
  afterTrickCount?: number;
}

export interface GameState {
  phase: GamePhase;
  difficulty: DifficultyMode;
  players: Player[];
  currentTrick: CurrentTrick;
  currentTurnPlayerId: string | null;
  isFirstTurnOfGame: boolean;
  removedCards: Card[];
  lastOutcome: TrickOutcome | null;
  trickHistory: TrickOutcome[];
  /** Groups of simultaneous finishers in chronological order, e.g. [['p1','p2'], ['p3']] */
  finishGroups: string[][];
  /** Flattened finisher IDs for convenience */
  finishOrder: string[];
  donkeyPlayerId: string | null;
  endReason: string | null;
  lastRedistribution: RedistributionEvent | null;
  /** Chronological log of public redistribution events (zero hidden card data) */
  redistributionHistory?: RedistributionEvent[];
}

export interface PlayResult {
  ok: true;
  state: GameState;
}

export interface PlayError {
  ok: false;
  error: string;
}

export type PlayResponse = PlayResult | PlayError;

export interface MissedTurnResult {
  ok: true;
  action: 'auto_played' | 'removed_and_redistributed';
  state: GameState;
  autoPlayedCard?: Card;
  missedCount: number;
  redistribution?: RedistributionEvent;
}

export type MissedTurnResponse = MissedTurnResult | PlayError;
