import {
  formatCard,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  type Card,
  type Suit,
  type TrickOutcome,
  type TrickPlay,
} from '../engine/index.ts';

export interface TrickHistoryPlayerLookup {
  id: string;
  name: string;
}

export interface TrickHistoryPlayEntry {
  playerId: string;
  playerName: string;
  card: Card;
  order: number;
  isLead: boolean;
  isHighestLed: boolean;
  isOffSuitCut: boolean;
}

export interface TrickHistoryEntry {
  trickNumber: number;
  type: 'success' | 'failed';
  ledSuit: Suit;
  ledSuitLabel: string;
  ledSuitSymbol: string;
  plays: TrickHistoryPlayEntry[];
  /** Primary outcome sentence (winner/cleared cards or collector/returned cards). */
  outcomeText: string;
  /** Exact failure reason for failed tricks, or null for successful tricks. */
  failureReason: string | null;
  /** Names of players who officially cleared their hand on this trick. */
  newlyFinishedNames: string[];
  /** Highest led-suit player for successful tricks, or null for failed tricks. */
  winnerName: string | null;
  /** Card collector name for failed tricks, or null for successful tricks. */
  collectorName: string | null;
  /** Number of cards cleared (success) or collected (failed). */
  affectedCardCount: number;
}

export interface TrickHistorySummary {
  totalTricks: number;
  successfulTricks: number;
  failedTricks: number;
}

export interface TrickHistoryView {
  summary: TrickHistorySummary;
  entries: TrickHistoryEntry[];
}

/**
 * Pure defensive clone for TrickOutcome objects sent over the wire so client
 * representations never share mutable references with authoritative server state.
 */
export function cloneTrickOutcome(outcome: TrickOutcome): TrickOutcome {
  const clonedPlays: TrickPlay[] = outcome.plays.map((p) => ({
    playerId: p.playerId,
    card: { ...p.card },
    order: p.order,
  }));

  if (outcome.type === 'success') {
    return {
      type: 'success',
      trickNumber: outcome.trickNumber,
      ledSuit: outcome.ledSuit,
      plays: clonedPlays,
      highestPlay: {
        playerId: outcome.highestPlay.playerId,
        card: { ...outcome.highestPlay.card },
        order: outcome.highestPlay.order,
      },
      nextLeaderId: outcome.nextLeaderId,
      newlyFinishedIds: [...outcome.newlyFinishedIds],
      removedCards: outcome.removedCards.map((c) => ({ ...c })),
    };
  }

  return {
    type: 'failed',
    trickNumber: outcome.trickNumber,
    ledSuit: outcome.ledSuit,
    plays: clonedPlays,
    offSuitPlay: {
      playerId: outcome.offSuitPlay.playerId,
      card: { ...outcome.offSuitPlay.card },
      order: outcome.offSuitPlay.order,
    },
    collectorId: outcome.collectorId,
    collectedCards: outcome.collectedCards.map((c) => ({ ...c })),
    nextLeaderId: outcome.nextLeaderId,
    newlyFinishedIds: [...outcome.newlyFinishedIds],
  };
}

/**
 * Builds the chronological Trick History presentation model from authoritative
 * gameState.trickHistory and player metadata.
 */
export function buildTrickHistoryView(
  trickHistory: readonly TrickOutcome[],
  players: readonly TrickHistoryPlayerLookup[],
  fallbackSeats: readonly { playerId: string; name: string }[] = []
): TrickHistoryView {
  const nameById = new Map<string, string>();
  for (const s of fallbackSeats) {
    nameById.set(s.playerId, s.name);
  }
  for (const p of players) {
    nameById.set(p.id, p.name);
  }

  const getPlayerName = (playerId: string | null): string => {
    if (!playerId) return 'Unknown';
    return nameById.get(playerId) ?? 'Player';
  };

  // Preserve strict chronological order by trickNumber
  const orderedHistory = [...trickHistory].sort((a, b) => a.trickNumber - b.trickNumber);

  let successfulTricks = 0;
  let failedTricks = 0;

  const entries: TrickHistoryEntry[] = orderedHistory.map((outcome) => {
    if (outcome.type === 'success') {
      successfulTricks += 1;
    } else {
      failedTricks += 1;
    }

    const sortedPlays = [...outcome.plays].sort((a, b) => a.order - b.order);
    const highestLedCardId =
      outcome.type === 'success'
        ? outcome.highestPlay.card.id
        : sortedPlays
            .filter((tp) => tp.card.suit === outcome.ledSuit)
            .sort((a, b) => b.card.rank - a.card.rank)[0]?.card.id ?? null;

    const plays: TrickHistoryPlayEntry[] = sortedPlays.map((tp, idx) => ({
      playerId: tp.playerId,
      playerName: getPlayerName(tp.playerId),
      card: tp.card,
      order: tp.order,
      isLead: idx === 0,
      isHighestLed: highestLedCardId !== null && tp.card.id === highestLedCardId,
      isOffSuitCut:
        outcome.type === 'failed' &&
        tp.card.id === outcome.offSuitPlay.card.id &&
        tp.playerId === outcome.offSuitPlay.playerId,
    }));

    const newlyFinishedNames = outcome.newlyFinishedIds.map((id) => getPlayerName(id));
    const ledSuitLabel = SUIT_NAMES[outcome.ledSuit];
    const ledSuitSymbol = SUIT_SYMBOLS[outcome.ledSuit];

    if (outcome.type === 'success') {
      const winnerName = getPlayerName(outcome.highestPlay.playerId);
      const winnerCard = formatCard(outcome.highestPlay.card);
      const count = outcome.removedCards.length;
      const cardWord = count === 1 ? 'card' : 'cards';
      const nextLeadSuffix = outcome.nextLeaderId
        ? ` · ${getPlayerName(outcome.nextLeaderId)} leads next`
        : ' · Final trick';

      return {
        trickNumber: outcome.trickNumber,
        type: 'success',
        ledSuit: outcome.ledSuit,
        ledSuitLabel,
        ledSuitSymbol,
        plays,
        outcomeText: `${winnerName} played highest (${winnerCard}) · ${count} ${cardWord} discarded${nextLeadSuffix}`,
        failureReason: null,
        newlyFinishedNames,
        winnerName,
        collectorName: null,
        affectedCardCount: count,
      };
    }

    const cutterName = getPlayerName(outcome.offSuitPlay.playerId);
    const cutCard = formatCard(outcome.offSuitPlay.card);
    const collectorName = getPlayerName(outcome.collectorId);
    const count = outcome.collectedCards.length;
    const cardWord = count === 1 ? 'card' : 'cards';
    const nextLeadSuffix = outcome.nextLeaderId ? ' and leads next' : ' on the final trick';

    return {
      trickNumber: outcome.trickNumber,
      type: 'failed',
      ledSuit: outcome.ledSuit,
      ledSuitLabel,
      ledSuitSymbol,
      plays,
      outcomeText: `${collectorName} (highest ${ledSuitSymbol} ${ledSuitLabel}) collected ${count} ${cardWord}${nextLeadSuffix}`,
      failureReason: `${cutterName} cut off-suit with ${cutCard} (could not follow ${ledSuitSymbol} ${ledSuitLabel})`,
      newlyFinishedNames,
      winnerName: null,
      collectorName,
      affectedCardCount: count,
    };
  });

  return {
    summary: {
      totalTricks: entries.length,
      successfulTricks,
      failedTricks,
    },
    entries,
  };
}
