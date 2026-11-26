import { RANKS, SUITS } from './deck.ts';
import { getLegalCards } from './rules.ts';
import type {
  BotPublicObservation,
  BotPublicPlayerInfo,
  Card,
  DifficultyMode,
  GameState,
  Rank,
  RedistributionEvent,
  Suit,
} from './types.ts';

/**
 * Builds a strictly sanitized public observation for a bot.
 * Structural Fairness Guarantee (Section 4):
 * - Includes ONLY the bot's own hand, legal moves, and publicly visible game state/history.
 * - NEVER includes or accesses any other player's private hand.
 */
export function buildBotObservation(state: GameState, botId: string): BotPublicObservation {
  const botPlayer = state.players.find((p) => p.id === botId);
  const ownHand: readonly Card[] = botPlayer ? [...botPlayer.hand] : [];
  const ownHandIds = new Set(ownHand.map((c) => c.id));
  // Strictly intersect legalCards with ownHand so a bot can NEVER consider a card it does not hold
  const legalCards: readonly Card[] = getLegalCards(state, botId).filter((c) =>
    ownHandIds.has(c.id)
  );

  const players: BotPublicPlayerInfo[] = state.players.map((p) => ({
    id: p.id,
    seatIndex: p.seatIndex,
    // Read ONLY length/public status — never copy or inspect other players' card objects!
    cardCount: p.id === botId ? ownHand.length : p.hand.length,
    finished: p.finished,
    removed: p.removed,
  }));

  const redistributionHistory: RedistributionEvent[] = (
    state.redistributionHistory && state.redistributionHistory.length > 0
      ? state.redistributionHistory
      : state.lastRedistribution
        ? [state.lastRedistribution]
        : []
  ).map((ev) => ({
    removedPlayerId: ev.removedPlayerId,
    removedPlayerName: ev.removedPlayerName,
    reason: ev.reason,
    cardsDistributedCount: ev.cardsDistributedCount,
    recipientCounts: { ...ev.recipientCounts },
    afterTrickCount: ev.afterTrickCount,
  }));

  return {
    botId,
    ownHand,
    legalCards,
    isFirstTurnOfGame: state.isFirstTurnOfGame,
    currentTrick: {
      trickNumber: state.currentTrick.trickNumber,
      ledSuit: state.currentTrick.ledSuit,
      plays: [...state.currentTrick.plays],
      expectedPlayerIds: [...state.currentTrick.expectedPlayerIds],
    },
    removedCards: [...state.removedCards],
    trickHistory: [...state.trickHistory],
    redistributionHistory,
    players,
  };
}

/**
 * Random legal card selection used by Easy bots and timeout auto-play.
 */
export function chooseRandomLegalCard(
  state: GameState,
  playerId: string,
  rng: () => number = Math.random
): Card | null {
  const legal = getLegalCards(state, playerId);
  return pickRandom(legal, rng);
}

function pickRandom<T>(items: readonly T[], rng: () => number): T | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  const idx = Math.floor(rng() * items.length);
  return items[Math.min(idx, items.length - 1)];
}

// ============================================================================
// PUBLIC MEMORY & PROBABILITY ANALYSIS (Strictly from BotPublicObservation)
// ============================================================================

export interface PublicMemory {
  unseenRanksBySuit: Record<Suit, Rank[]>;
  unseenCountBySuit: Record<Suit, number>;
  totalUnseenCards: number;
  /** Suits a player is publicly known to have been void in (selectively invalidated only when they receive uncertain redistributed cards or collect/play that suit) */
  knownVoidSuits: Map<string, Set<Suit>>;
  /** Exact publicly returned cards a collector picked up from failed tricks and has not yet played */
  knownReturnedCardIds: Map<string, Map<string, Card>>;
  /** Counts of publicly returned cards per player per suit still unplayed */
  knownReturnedSuits: Map<string, Record<Suit, number>>;
  anyPlayerRemoved: boolean;
}

export function buildPublicMemory(obs: BotPublicObservation): PublicMemory {
  const accountedIds = new Set<string>();

  // 1. Permanently discarded cards (ONLY from successful tricks!)
  for (const c of obs.removedCards) accountedIds.add(c.id);
  // 2. Bot's own hand
  for (const c of obs.ownHand) accountedIds.add(c.id);
  // 3. Cards currently face-up on the table in this unresolved trick
  for (const tp of obs.currentTrick.plays) accountedIds.add(tp.card.id);

  const unseenRanksBySuit: Record<Suit, Rank[]> = {
    spades: [],
    hearts: [],
    clubs: [],
    diamonds: [],
  };
  const unseenCountBySuit: Record<Suit, number> = {
    spades: 0,
    hearts: 0,
    clubs: 0,
    diamonds: 0,
  };

  let totalUnseenCards = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const id = `${suit}-${rank}`;
      if (!accountedIds.has(id)) {
        unseenRanksBySuit[suit].push(rank);
        unseenCountBySuit[suit]++;
        totalUnseenCards++;
      }
    }
  }

  const anyPlayerRemoved = obs.players.some((p) => p.removed);
  const knownVoidSuits = new Map<string, Set<Suit>>();
  const knownReturnedCardIds = new Map<string, Map<string, Card>>();

  const ensureReturnedMap = (pid: string): Map<string, Card> => {
    let map = knownReturnedCardIds.get(pid);
    if (!map) {
      map = new Map<string, Card>();
      knownReturnedCardIds.set(pid, map);
    }
    return map;
  };

  // Index public redistribution events by exact chronological trick boundary
  const redistributionsByTrickCount = new Map<number, RedistributionEvent[]>();
  for (const ev of obs.redistributionHistory ?? []) {
    const atTrick =
      typeof ev.afterTrickCount === 'number'
        ? Math.max(0, Math.min(ev.afterTrickCount, obs.trickHistory.length))
        : obs.trickHistory.length;
    let list = redistributionsByTrickCount.get(atTrick);
    if (!list) {
      list = [];
      redistributionsByTrickCount.set(atTrick, list);
    }
    list.push(ev);
  }

  const applyRedistribution = (ev: RedistributionEvent): void => {
    // Capture suits the removed player was ALREADY publicly known to be void in
    const removedPlayerVoids = knownVoidSuits.get(ev.removedPlayerId);

    // 1. Removed player's previously held returned cards were shuffled into the unknown pool
    //    (except any the bot itself received, which are already in obs.ownHand).
    knownReturnedCardIds.delete(ev.removedPlayerId);
    knownVoidSuits.delete(ev.removedPlayerId);

    // 2. For remaining players:
    //    - Their OWN previously collected returned cards remain in their hands (PRESERVED!).
    //    - Any player who received 0 redistributed cards keeps ALL prior void inferences (PRESERVED!).
    //    - Any recipient who received >= 1 unknown card has prior void inferences invalidated ONLY
    //      for suits the removed player could have held (i.e., suits NOT in removedPlayerVoids).
    if (ev.cardsDistributedCount > 0) {
      for (const [recipientId, receivedCount] of Object.entries(ev.recipientCounts)) {
        if (receivedCount <= 0) continue;
        const recipientVoids = knownVoidSuits.get(recipientId);
        if (!recipientVoids) continue;
        for (const suit of Array.from(recipientVoids)) {
          if (!removedPlayerVoids?.has(suit)) {
            recipientVoids.delete(suit);
          }
        }
        if (recipientVoids.size === 0) {
          knownVoidSuits.delete(recipientId);
        }
      }
    }
  };

  // Reconstruct exact public void & returned-card knowledge in true chronological order
  for (let i = 0; i <= obs.trickHistory.length; i++) {
    const eventsHere = redistributionsByTrickCount.get(i);
    if (eventsHere) {
      for (const ev of eventsHere) {
        applyRedistribution(ev);
      }
    }

    if (i >= obs.trickHistory.length) break;
    const outcome = obs.trickHistory[i];

    for (const tp of outcome.plays) {
      ensureReturnedMap(tp.playerId).delete(tp.card.id);
      // If a player visibly played a suit, they clearly held that suit at that moment
      knownVoidSuits.get(tp.playerId)?.delete(tp.card.suit);
    }

    if (outcome.type === 'failed') {
      // Cutter proved they held zero cards of outcome.ledSuit at this moment
      const cutterId = outcome.offSuitPlay.playerId;
      if (!knownVoidSuits.has(cutterId)) {
        knownVoidSuits.set(cutterId, new Set());
      }
      knownVoidSuits.get(cutterId)!.add(outcome.ledSuit);

      // Collector publicly received every card in collectedCards -> track exact IDs & clear void assumptions for those suits
      const collectorId = outcome.collectorId;
      const collectorVoids = knownVoidSuits.get(collectorId);
      const collectorMap = ensureReturnedMap(collectorId);
      for (const card of outcome.collectedCards) {
        collectorMap.set(card.id, card);
        if (collectorVoids) {
          collectorVoids.delete(card.suit);
        }
      }
    }
  }

  // Account for cards already played face-up in the current unresolved trick
  for (const tp of obs.currentTrick.plays) {
    ensureReturnedMap(tp.playerId).delete(tp.card.id);
    knownVoidSuits.get(tp.playerId)?.delete(tp.card.suit);
  }

  // Clean up any players already removed or finished so their stale entries don't linger
  for (const p of obs.players) {
    if (p.removed || p.finished) {
      knownVoidSuits.delete(p.id);
      knownReturnedCardIds.delete(p.id);
    }
  }

  // Summarize returned-card counts per player per suit
  const knownReturnedSuits = new Map<string, Record<Suit, number>>();
  for (const [pid, cardMap] of knownReturnedCardIds.entries()) {
    const counts: Record<Suit, number> = { spades: 0, hearts: 0, clubs: 0, diamonds: 0 };
    for (const card of cardMap.values()) {
      counts[card.suit]++;
    }
    knownReturnedSuits.set(pid, counts);
  }

  return {
    unseenRanksBySuit,
    unseenCountBySuit,
    totalUnseenCards,
    knownVoidSuits,
    knownReturnedCardIds,
    knownReturnedSuits,
    anyPlayerRemoved,
  };
}

/**
 * Hypergeometric probability that an opponent with `handSize` unknown slots holds ZERO cards of a suit
 * when `suitUnseen` unassigned cards of that suit exist inside a pool of `totalUnseen` unassigned slots.
 */
function hypergeometricZeroProb(totalUnseen: number, suitUnseen: number, handSize: number): number {
  if (handSize <= 0) return 1;
  if (suitUnseen <= 0) return 1;
  if (totalUnseen <= 0) return 1;
  if (handSize > totalUnseen - suitUnseen) return 0;

  let prob = 1;
  for (let i = 0; i < handSize; i++) {
    prob *= (totalUnseen - suitUnseen - i) / (totalUnseen - i);
  }
  return Math.max(0, Math.min(1, prob));
}

interface SuitCutAnalysis {
  /** Combined probability [0..1] that at least one opponent in opponentIds cuts this suit */
  cutProb: number;
  /** True if any opponent in opponentIds is publicly known void OR zero unseen cards of this suit remain */
  anyKnownVoid: boolean;
  /** Index within opponentIds of the earliest clockwise opponent known to be void (-1 if none) */
  firstKnownVoidIdx: number;
  /** True if the very next clockwise opponent is guaranteed to cut (known void or 0 unseen cards in suit) */
  immediateNextGuaranteedCut: boolean;
  /** True if every opponent in opponentIds is publicly known to hold at least one returned card of this suit */
  allOpponentsConfirmedHolding: boolean;
}

/**
 * Evaluates cut danger in clockwise turn order for a given suit and list of opponents.
 * Strictly uses public memory only (zero inspection of hidden opponent hands).
 */
function analyzeSuitCutRisk(
  suit: Suit,
  opponentIds: readonly string[],
  obs: BotPublicObservation,
  mem: PublicMemory
): SuitCutAnalysis {
  const activeOrderedOpps = opponentIds
    .map((id) => obs.players.find((p) => p.id === id))
    .filter(
      (p): p is BotPublicPlayerInfo =>
        p !== undefined && !p.finished && !p.removed && p.cardCount > 0
    );

  if (activeOrderedOpps.length === 0) {
    return {
      cutProb: 0,
      anyKnownVoid: false,
      firstKnownVoidIdx: -1,
      immediateNextGuaranteedCut: false,
      allOpponentsConfirmedHolding: true,
    };
  }

  // If zero unseen cards of this suit exist outside our hand, EVERY opponent has 0 cards of this suit!
  if (mem.unseenCountBySuit[suit] === 0) {
    return {
      cutProb: 1,
      anyKnownVoid: true,
      firstKnownVoidIdx: 0,
      immediateNextGuaranteedCut: true,
      allOpponentsConfirmedHolding: false,
    };
  }

  // Compute unassigned pool across all active opponents (excluding bot)
  const allActiveOpps = obs.players.filter(
    (p) => p.id !== obs.botId && !p.finished && !p.removed && p.cardCount > 0
  );

  let totalKnownReturnedInSuit = 0;
  let totalUnknownSlotsNonVoid = 0;
  for (const opp of allActiveOpps) {
    const retTotal = mem.knownReturnedCardIds.get(opp.id)?.size ?? 0;
    const retSuit = mem.knownReturnedSuits.get(opp.id)?.[suit] ?? 0;
    totalKnownReturnedInSuit += retSuit;
    if (!mem.knownVoidSuits.get(opp.id)?.has(suit)) {
      totalUnknownSlotsNonVoid += Math.max(0, opp.cardCount - retTotal);
    }
  }

  const unassignedSuitCards = Math.max(0, mem.unseenCountBySuit[suit] - totalKnownReturnedInSuit);

  let firstKnownVoidIdx = -1;
  let probNoneCut = 1;
  let confirmedCount = 0;

  for (let idx = 0; idx < activeOrderedOpps.length; idx++) {
    const opp = activeOrderedOpps[idx];
    const isKnownVoid = mem.knownVoidSuits.get(opp.id)?.has(suit) ?? false;
    if (isKnownVoid) {
      if (firstKnownVoidIdx === -1) firstKnownVoidIdx = idx;
      probNoneCut = 0;
      continue;
    }

    const oppRetSuit = mem.knownReturnedSuits.get(opp.id)?.[suit] ?? 0;
    if (oppRetSuit > 0) {
      // Opponent publicly picked up card(s) of this suit and has not played them yet -> guaranteed to hold suit!
      confirmedCount++;
      continue;
    }

    const oppRetTotal = mem.knownReturnedCardIds.get(opp.id)?.size ?? 0;
    const oppUnknownSlots = Math.max(0, opp.cardCount - oppRetTotal);

    // If zero unassigned cards of this suit remain (all accounted for in other opponents' returned cards),
    // then this opponent MUST be void too!
    if (unassignedSuitCards === 0 || oppUnknownSlots === 0) {
      if (firstKnownVoidIdx === -1) firstKnownVoidIdx = idx;
      probNoneCut = 0;
      continue;
    }

    const poolSlots = Math.max(oppUnknownSlots, unassignedSuitCards, totalUnknownSlotsNonVoid);
    const pVoid = hypergeometricZeroProb(poolSlots, unassignedSuitCards, oppUnknownSlots);
    probNoneCut *= 1 - pVoid;
  }

  return {
    cutProb: Math.max(0, Math.min(1, 1 - probNoneCut)),
    anyKnownVoid: firstKnownVoidIdx !== -1,
    firstKnownVoidIdx,
    immediateNextGuaranteedCut: firstKnownVoidIdx === 0,
    allOpponentsConfirmedHolding: confirmedCount === activeOrderedOpps.length,
  };
}

function estimateCutProbability(
  suit: Suit,
  opponentIds: readonly string[],
  obs: BotPublicObservation,
  mem: PublicMemory
): number {
  return analyzeSuitCutRisk(suit, opponentIds, obs, mem).cutProb;
}

function getPlayersRemainingBehind(obs: BotPublicObservation): string[] {
  const { expectedPlayerIds, plays } = obs.currentTrick;
  if (plays.length === 0) {
    return expectedPlayerIds.filter((id) => id !== obs.botId);
  }
  const myIndex = expectedPlayerIds.indexOf(obs.botId);
  if (myIndex === -1) return [];
  return expectedPlayerIds.slice(myIndex + 1);
}

function getCurrentHighestLedRank(obs: BotPublicObservation): number {
  const { ledSuit, plays } = obs.currentTrick;
  if (!ledSuit) return 0;
  let maxRank = 0;
  for (const tp of plays) {
    if (tp.card.suit === ledSuit && tp.card.rank > maxRank) {
      maxRank = tp.card.rank;
    }
  }
  return maxRank;
}

// ============================================================================
// EASY MODE BOT — Random Legal Play
// ============================================================================

export function chooseEasyBotCard(
  obs: BotPublicObservation,
  rng: () => number = Math.random
): Card | null {
  return pickRandom(obs.legalCards, rng);
}

// ============================================================================
// MEDIUM MODE BOT — Basic Strategic Play (Public Info Only)
// ============================================================================

export function chooseMediumBotCard(
  obs: BotPublicObservation,
  rng: () => number = Math.random
): Card | null {
  const legal = obs.legalCards;
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];

  const mem = buildPublicMemory(obs);
  const ledSuit = obs.currentTrick.ledSuit;
  const behindIds = getPlayersRemainingBehind(obs);
  const activeOpponents = obs.players.filter(
    (p) => p.id !== obs.botId && !p.finished && !p.removed
  );

  // Small natural variance (10%) so Medium feels like a learning human player, not a rigid script
  if (rng() < 0.1) {
    return pickRandom(legal, rng);
  }

  // CASE 1: Leading a trick
  if (ledSuit === null) {
    const activeOppIds = activeOpponents.map((o) => o.id);
    // Score each legal card by suit safety (remaining unseen cards & public void/returned memory)
    const scored = legal.map((card) => {
      const suitUnseen = mem.unseenCountBySuit[card.suit];
      const ownSuitCount = obs.ownHand.filter((c) => c.suit === card.suit).length;
      const risk = analyzeSuitCutRisk(card.suit, activeOppIds, obs, mem);

      let score = 0;
      // Prefer suits with plenty of unseen cards in play so opponents can follow suit
      score += Math.min(suitUnseen, activeOpponents.length * 3) * 2.2;
      if (risk.allOpponentsConfirmedHolding) {
        score += 5;
      } else if (suitUnseen < activeOpponents.length) {
        score -= 9;
      }
      if (risk.anyKnownVoid) score -= 14;

      // Prefer leading low/mid cards to avoid wasting high cards unnecessarily
      score -= (card.rank - 2) * 0.85;

      // Slight bonus for clearing from a longer suit
      score += ownSuitCount * 0.6;

      // Subtle tiebreak noise
      score += (rng() - 0.5) * 1.4;
      return { card, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].card;
  }

  const canFollow = legal[0].suit === ledSuit;

  // CASE 2: Following led suit
  if (canFollow) {
    const sortedAsc = [...legal].sort((a, b) => a.rank - b.rank);
    const currentHigh = getCurrentHighestLedRank(obs);
    const duckCards = sortedAsc.filter((c) => c.rank < currentHigh);

    // Last to play in trick -> trick is guaranteed to succeed!
    if (behindIds.length === 0) {
      // If we can duck with a reasonably high card under currentHigh, shed it safely without taking lead
      if (duckCards.length > 0) {
        return duckCards[duckCards.length - 1];
      }
      // Otherwise shed a high card safely if it's high, or lowest card to conserve if low
      return sortedAsc[sortedAsc.length - 1];
    }

    // Opponents still to play behind -> consider cut risk using unified public memory!
    const suitUnseen = mem.unseenCountBySuit[ledSuit];
    const riskBehind = analyzeSuitCutRisk(ledSuit, behindIds, obs, mem);
    const cutRisky =
      !riskBehind.allOpponentsConfirmedHolding &&
      (suitUnseen < behindIds.length + 1 || riskBehind.anyKnownVoid);

    if (duckCards.length > 0) {
      // Duck safely beneath currentHigh with highest safe loser (avoids collecting & sheds dead weight)
      return duckCards[duckCards.length - 1];
    }

    // All our cards beat currentHigh: avoid wasting Ace/King unnecessarily when cut risk exists
    if (cutRisky) {
      return sortedAsc[0];
    }
    return sortedAsc[0];
  }

  // CASE 3: Off-suit cut — trick ends immediately and collector picks up our card!
  // Dump a higher-ranked card (especially from shorter suits) instead of giving away safe low cards.
  const cutScored = legal.map((card) => {
    const ownSuitCount = obs.ownHand.filter((c) => c.suit === card.suit).length;
    let score = card.rank * 1.5;
    if (ownSuitCount === 1) score += 3.0; // Bonus for creating a void in a singleton suit
    score += (rng() - 0.5) * 1.6;
    return { card, score };
  });

  cutScored.sort((a, b) => b.score - a.score);
  return cutScored[0].card;
}

// ============================================================================
// HARD MODE BOT — Advanced Probability-Based Expert Strategy (Public Info Only)
// ============================================================================

export function chooseHardBotCard(
  obs: BotPublicObservation,
  rng: () => number = Math.random
): Card | null {
  const legal = obs.legalCards;
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];

  const mem = buildPublicMemory(obs);
  const ledSuit = obs.currentTrick.ledSuit;
  const behindIds = getPlayersRemainingBehind(obs);
  const activeOpponents = obs.players.filter(
    (p) => p.id !== obs.botId && !p.finished && !p.removed
  );
  // Preserve exact clockwise turn order after this bot when evaluating cuts!
  const orderedOppIds =
    obs.currentTrick.expectedPlayerIds.length > 0
      ? obs.currentTrick.expectedPlayerIds.filter((id) => id !== obs.botId)
      : activeOpponents.map((o) => o.id);
  const isEndgame = activeOpponents.length <= 2 || obs.ownHand.length <= 4;
  const isTwoPlayerEndgame = activeOpponents.length === 1;
  const lastOutcome =
    obs.trickHistory.length > 0 ? obs.trickHistory[obs.trickHistory.length - 1] : null;

  // Evaluate how safe our remaining hand would be to lead next trick if we win lead
  const bestLeadSafetyAfter = (excludeCardId: string): number => {
    const remaining = obs.ownHand.filter((c) => c.id !== excludeCardId);
    if (remaining.length === 0) return 1.0; // Emptying hand!
    const suits = Array.from(new Set(remaining.map((c) => c.suit)));
    let minCutProb = 1;
    for (const s of suits) {
      const pCut = estimateCutProbability(s, orderedOppIds, obs, mem);
      if (pCut < minCutProb) minCutProb = pCut;
    }
    return 1 - minCutProb;
  };

  // CASE 1: Leading a trick — inspect ONLY suits currently held in obs.ownHand (recalculated fresh every turn)
  if (ledSuit === null) {
    const cardsBySuit = new Map<Suit, Card[]>();
    for (const card of legal) {
      let bucket = cardsBySuit.get(card.suit);
      if (!bucket) {
        bucket = [];
        cardsBySuit.set(card.suit, bucket);
      }
      bucket.push(card);
    }

    const candidates: Array<{ card: Card; score: number }> = [];

    for (const [suit, ownSuitCards] of cardsBySuit.entries()) {
      const risk = analyzeSuitCutRisk(suit, orderedOppIds, obs, mem);
      const unseenRanks = mem.unseenRanksBySuit[suit];
      const justFailedSuit = lastOutcome?.type === 'failed' && lastOutcome.ledSuit === suit;
      const justCollectedThisSuit = justFailedSuit && lastOutcome.collectorId === obs.botId;

      // Stage 1: Suit-level strategic score (strictly separates non-void suits from known-void suits)
      let suitScore = 0;
      if (risk.immediateNextGuaranteedCut) {
        // Immediate next player clockwise is guaranteed to cut -> 100% guaranteed we collect!
        suitScore = -120;
      } else if (risk.anyKnownVoid) {
        // Some opponent further clockwise is publicly known void -> trick will fail if it reaches them!
        suitScore = -55 + Math.min(risk.firstKnownVoidIdx, 3) * 4;
      } else {
        // No opponent is publicly known void in this suit -> genuinely playable lead suit!
        suitScore = (1 - risk.cutProb) * (isTwoPlayerEndgame ? 52 : 44);
        if (risk.allOpponentsConfirmedHolding) {
          suitScore += 10;
        } else if (isTwoPlayerEndgame) {
          const oppId = orderedOppIds[0];
          const oppReturnedInSuit = mem.knownReturnedSuits.get(oppId)?.[suit] ?? 0;
          if (oppReturnedInSuit > 0) suitScore += 10;
        }
      }

      // Strongly avoid mindlessly repeating a suit that JUST failed (especially when this bot collected it!)
      if (justCollectedThisSuit) {
        suitScore -= 20;
      } else if (justFailedSuit) {
        suitScore -= 12;
      }

      // Hand-structure bonus: clearing a safe singleton creates a cutting void for future tricks
      if (ownSuitCards.length === 1 && !risk.anyKnownVoid && risk.cutProb < 0.25) {
        suitScore += 4.0;
      } else if (ownSuitCards.length >= 2 && !risk.anyKnownVoid && risk.cutProb < 0.35) {
        suitScore += Math.min(ownSuitCards.length, 4) * 0.7;
      }

      // Stage 2: Card-level score within this suit (high vs low choice, bounded so rank never overrides a known void)
      for (const card of ownSuitCards) {
        const higherUnseen = unseenRanks.filter((r) => r > card.rank).length;
        const lowerUnseen = unseenRanks.filter((r) => r < card.rank).length;
        const isBossCard = higherUnseen === 0;
        const leadSafetyNext = bestLeadSafetyAfter(card.id);

        let cardScore = 0;

        if (risk.immediateNextGuaranteedCut) {
          // Forced lead into immediate cut: minimize rank
          cardScore -= (card.rank - 2) * 0.5;
        } else if (risk.anyKnownVoid) {
          // Forced lead into a later-seat known void: play LOW so an intermediate player overtakes & absorbs the cut
          cardScore -= (card.rank - 2) * 0.85;
          if (higherUnseen >= 1 && risk.firstKnownVoidIdx >= 1) {
            cardScore += 3.0;
          }
        } else if (isTwoPlayerEndgame) {
          if (risk.cutProb < 0.25 && isBossCard) {
            // Safe opportunity to clear a high boss card before opponent runs out of the suit
            cardScore += 6.5 + leadSafetyNext * 3.5;
          } else if (risk.cutProb >= 0.4) {
            cardScore -= (card.rank - 2) * 0.75;
          } else {
            cardScore -= (card.rank - 2) * 0.35;
          }
        } else if (risk.cutProb < 0.16 && isBossCard && card.rank >= 12) {
          // Very safe suit: cleanly flush a dangerous Ace/King/Queen permanently while everyone can follow
          cardScore += 5.5 + leadSafetyNext * 3.5;
        } else if (risk.cutProb > 0.32) {
          // Moderate/elevated speculative cut risk: lead low so another player overtakes if a surprise cut happens
          cardScore -= (card.rank - 2) * 0.75;
          if (higherUnseen >= 2) cardScore += 2.0;
        } else {
          // Comfortable safe suit: lead low-to-medium card to preserve flexibility & pass lead cleanly
          cardScore -= (card.rank - 2) * 0.45;
          if (higherUnseen >= 1 && lowerUnseen >= 1) cardScore += 1.5;
        }

        // Endgame 2-card hand: strongly favor keeping the safer final exit card
        if (obs.ownHand.length === 2) {
          cardScore += leadSafetyNext * 7.0;
        }

        // Subtle tiebreak noise only — never large enough to distort strategic suit choice
        const totalScore = suitScore + cardScore + (rng() - 0.5) * 0.5;
        candidates.push({ card, score: totalScore });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].card;
  }

  const canFollow = legal[0].suit === ledSuit;

  // CASE 2: Following led suit — re-evaluated live after every preceding play in this trick
  if (canFollow) {
    const currentHigh = getCurrentHighestLedRank(obs);
    const riskBehind = analyzeSuitCutRisk(ledSuit, behindIds, obs, mem);
    const cutProbBehind = riskBehind.cutProb;
    const unseenRanks = mem.unseenRanksBySuit[ledSuit];
    const trickSizeIfCut = obs.currentTrick.plays.length + 2; // At least current plays + us + cutter
    const playersBeforeFirstVoid =
      riskBehind.firstKnownVoidIdx === -1 ? behindIds.length : riskBehind.firstKnownVoidIdx;

    const scored = legal.map((card) => {
      const beatsCurrent = card.rank > currentHigh;
      const higherUnseen = unseenRanks.filter((r) => r > card.rank).length;
      const leadSafetyNext = bestLeadSafetyAfter(card.id);
      let score = 0;

      if (behindIds.length === 0) {
        // LAST TO ACT — Trick is 100% GUARANTEED TO SUCCEED!
        if (!beatsCurrent) {
          // Ducking under currentHigh: sheds card safely AND lets someone else take next lead!
          score += 12 + card.rank * 1.15;
          score += (1 - leadSafetyNext) * 5;
        } else {
          // Winning a guaranteed-safe trick: destroy a dangerous boss card if we have a safe next lead
          score += 8 + card.rank * 1.1 + leadSafetyNext * 7.5;
          if (higherUnseen === 0 && card.rank >= 12) score += 4.5;
        }
      } else {
        // PLAYERS STILL TO ACT BEHIND — Cut is possible!
        if (!beatsCurrent) {
          // Safe underneath currentHigh! We CANNOT be the collector if someone behind cuts!
          score += 14 + card.rank * 0.95 + cutProbBehind * 10;
        } else {
          // Playing above currentHigh exposes us to collecting if someone behind cuts AND nobody before them overtakes us.
          const pOvertakenBeforeCut =
            higherUnseen > 0 && playersBeforeFirstVoid > 0
              ? Math.min(
                  0.85,
                  (higherUnseen / Math.max(1, unseenRanks.length)) *
                    Math.min(1, playersBeforeFirstVoid * 0.55)
                )
              : 0;
          const exposureRisk = cutProbBehind * (1 - pOvertakenBeforeCut) * trickSizeIfCut;
          score -= exposureRisk * 5.2;

          if (cutProbBehind < 0.14 && card.rank >= 12 && higherUnseen === 0) {
            score += 9 + leadSafetyNext * 5;
          } else {
            // Prefer lowest overtaking card to preserve higher cards & let intermediate players overtake
            score += 7 - (card.rank - currentHigh) * 0.85 + leadSafetyNext * 2.5;
          }
        }
      }

      if (isEndgame && obs.ownHand.length === 2) {
        score += leadSafetyNext * 6;
      }

      score += (rng() - 0.5) * 0.6;
      return { card, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].card;
  }

  // CASE 3: Cutting off-suit (we do not hold ledSuit)
  // Trick stops immediately and the collector picks up all played cards + our cut card.
  const scoredCuts = legal.map((card) => {
    const suit = card.suit;
    const ownSuitCards = obs.ownHand.filter((c) => c.suit === suit);
    const riskIfLeadLater = analyzeSuitCutRisk(suit, orderedOppIds, obs, mem);
    const higherUnseen = mem.unseenRanksBySuit[suit].filter((r) => r > card.rank).length;
    const leadSafetyAfter = bestLeadSafetyAfter(card.id);

    let score = 0;

    // 1. Strongly dump high cards (especially Aces/Kings/Queens that trap us later!)
    score += card.rank * 1.9;

    // 2. Extra bonus for shedding cards from suits that are dangerous or known-void to lead later
    if (riskIfLeadLater.anyKnownVoid) {
      score += card.rank >= 10 ? 11 : 6;
    } else if (card.rank >= 10) {
      score += riskIfLeadLater.cutProb * 10;
    }

    // 3. Boss cards (highest unseen card in a suit) are liabilities in Rang Vapas — dump them onto the collector!
    if (higherUnseen === 0 && card.rank >= 11) {
      score += 5.5;
    }

    // 4. Void creation: dumping a singleton creates a fresh void so we can cut that suit in future tricks!
    if (ownSuitCards.length === 1) {
      score += isEndgame ? 4.5 : 6.0;
    }

    // 5. Avoid dumping our lowest, safest exit card in endgame
    if (obs.ownHand.length <= 3) {
      score += leadSafetyAfter * 7;
    }

    score += (rng() - 0.5) * 0.6;
    return { card, score };
  });

  scoredCuts.sort((a, b) => b.score - a.score);
  return scoredCuts[0].card;
}

/**
 * Unified bot decision router.
 * Always builds a strictly sanitized BotPublicObservation first so NO bot difficulty
 * can ever inspect opponents' private hands.
 */
export function chooseBotCard(
  state: GameState,
  botId: string,
  difficulty?: DifficultyMode,
  rng: () => number = Math.random
): Card | null {
  const mode: DifficultyMode = difficulty ?? state.difficulty ?? 'easy';
  const obs = buildBotObservation(state, botId);

  switch (mode) {
    case 'hard':
      return chooseHardBotCard(obs, rng);
    case 'medium':
      return chooseMediumBotCard(obs, rng);
    case 'easy':
    default:
      return chooseEasyBotCard(obs, rng);
  }
}
