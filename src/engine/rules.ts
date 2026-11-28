import { ACE_OF_SPADES_ID, createDeck, dealCards, shuffleDeck } from './deck.ts';
import { chooseRandomLegalCard } from './bot.ts';
import type {
  Card,
  DifficultyMode,
  FailedTrickOutcome,
  GameState,
  MissedTurnResponse,
  Player,
  PlayerConfig,
  PlayResponse,
  RedistributionEvent,
  SuccessfulTrickOutcome,
  TrickPlay,
} from './types.ts';

const DEFAULT_AVATAR_COLORS = [
  '#E59A00', // Marigold Gold
  '#2E6340', // Forest Green
  '#D95732', // Terracotta Orange
  '#3A6B8A', // Slate Blue
  '#8B5E83', // Plum
  '#B57435', // Amber Bronze
];

export interface CreateGameOptions {
  rng?: () => number;
  customHands?: Card[][];
  difficulty?: DifficultyMode;
}

export interface PlayCardOptions {
  isAutoPlay?: boolean;
}

export function isPlayerActive(player: Player): boolean {
  return !player.finished && !player.removed;
}

export function getActivePlayers(players: readonly Player[]): Player[] {
  return players.filter(isPlayerActive);
}

/**
 * Returns active (non-finished, non-removed) players in clockwise order starting from startPlayerId.
 */
export function getClockwiseActivePlayerIds(
  players: readonly Player[],
  startPlayerId: string
): string[] {
  const startIndex = players.findIndex((p) => p.id === startPlayerId);
  if (startIndex === -1) return [];

  const result: string[] = [];
  for (let offset = 0; offset < players.length; offset++) {
    const p = players[(startIndex + offset) % players.length];
    if (isPlayerActive(p)) {
      result.push(p.id);
    }
  }
  return result;
}

/**
 * Finds the next active player clockwise strictly AFTER fromPlayerId.
 */
export function getNextClockwiseActivePlayerId(
  players: readonly Player[],
  fromPlayerId: string
): string | null {
  const startIndex = players.findIndex((p) => p.id === fromPlayerId);
  if (startIndex === -1) return null;

  for (let offset = 1; offset <= players.length; offset++) {
    const candidate = players[(startIndex + offset) % players.length];
    if (isPlayerActive(candidate)) {
      return candidate.id;
    }
  }
  return null;
}

/**
 * Creates a new Last Donkey (Rang Vapas) game state for 2 to 6 players.
 */
export function createInitialGameState(
  playerConfigs: readonly PlayerConfig[],
  options: CreateGameOptions = {}
): GameState {
  if (playerConfigs.length < 2 || playerConfigs.length > 6) {
    throw new Error(
      `Last Donkey requires between 2 and 6 players (received ${playerConfigs.length}).`
    );
  }

  let hands: Card[][];
  if (options.customHands) {
    if (options.customHands.length !== playerConfigs.length) {
      throw new Error('customHands length must match playerConfigs length.');
    }
    hands = options.customHands.map((h) => [...h]);
  } else {
    const deck = shuffleDeck(createDeck(), options.rng);
    hands = dealCards(deck, playerConfigs.length);
  }

  const players: Player[] = playerConfigs.map((cfg, index) => {
    const resolvedAvatarId = cfg.avatarId ?? cfg.botAvatarId;
    return {
      id: cfg.id,
      name: cfg.name.trim() || `Player ${index + 1}`,
      type: cfg.type,
      seatIndex: index,
      hand: hands[index],
      finished: hands[index].length === 0,
      finishOrder: null,
      removed: false,
      connected: true,
      consecutiveMissedTurns: 0,
      avatarColor: cfg.avatarColor ?? DEFAULT_AVATAR_COLORS[index % DEFAULT_AVATAR_COLORS.length],
      ...(resolvedAvatarId
        ? { avatarId: resolvedAvatarId, botAvatarId: resolvedAvatarId }
        : {}),
    };
  });

  // Section 5: The player holding A♠ starts the game and must play A♠ first.
  const starter = players.find((p) => p.hand.some((c) => c.id === ACE_OF_SPADES_ID));
  const startingPlayer = starter ?? players.find(isPlayerActive) ?? players[0];
  const hasAceOfSpades = startingPlayer.hand.some((c) => c.id === ACE_OF_SPADES_ID);

  const expectedPlayerIds = getClockwiseActivePlayerIds(players, startingPlayer.id);

  return {
    phase: 'playing',
    difficulty: options.difficulty ?? 'easy',
    players,
    currentTrick: {
      trickNumber: 1,
      ledSuit: null,
      plays: [],
      expectedPlayerIds,
    },
    currentTurnPlayerId: startingPlayer.id,
    isFirstTurnOfGame: hasAceOfSpades,
    removedCards: [],
    lastOutcome: null,
    trickHistory: [],
    finishGroups: [],
    finishOrder: [],
    donkeyPlayerId: null,
    endReason: null,
    lastRedistribution: null,
    redistributionHistory: [],
  };
}

export interface LegalCardsPlayerView {
  id: string;
  finished: boolean;
  removed: boolean;
  hand: readonly Card[];
}

export interface LegalCardsStateView {
  phase: GameState['phase'];
  currentTurnPlayerId: string | null;
  isFirstTurnOfGame: boolean;
  currentTrick: Pick<GameState['currentTrick'], 'ledSuit'>;
  players: readonly LegalCardsPlayerView[];
}

/**
 * Returns the exact list of legal cards a player may play on their turn.
 * Shared by both server-side playCard validation and client-side selection UI.
 */
export function getLegalCards(state: LegalCardsStateView, playerId: string): Card[] {
  if (state.phase !== 'playing') return [];
  if (state.currentTurnPlayerId !== playerId) return [];

  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.finished || player.removed || player.hand.length === 0) return [];

  // Section 5: First turn of the game must be Ace of Spades.
  if (state.isFirstTurnOfGame) {
    const aceOfSpades = player.hand.find((c) => c.id === ACE_OF_SPADES_ID);
    if (aceOfSpades) {
      return [aceOfSpades];
    }
  }

  const { ledSuit } = state.currentTrick;
  if (ledSuit === null) {
    return [...player.hand];
  }

  // Section 6: Must follow led suit if holding at least one card of that suit.
  const matchingSuitCards = player.hand.filter((c) => c.suit === ledSuit);
  if (matchingSuitCards.length > 0) {
    return matchingSuitCards;
  }

  return [...player.hand];
}

export function canPlayCard(state: GameState, playerId: string, cardId: string): boolean {
  return getLegalCards(state, playerId).some((c) => c.id === cardId);
}

/**
 * Section 10: Voluntary exit is ONLY allowed between tricks, never in the middle of an unresolved trick.
 */
export function canVoluntarilyExit(state: GameState): boolean {
  if (state.phase === 'finished') return true;
  if (state.phase === 'trick_result') return true;
  return state.currentTrick.plays.length === 0;
}

/**
 * Marks all active players who currently hold 0 cards as simultaneous finishers (Sections 7, 8, 9).
 */
function finalizeZeroCardPlayers(
  players: Player[],
  existingFinishGroups: string[][],
  existingFinishOrder: string[]
): {
  players: Player[];
  finishGroups: string[][];
  finishOrder: string[];
  newlyFinishedIds: string[];
} {
  const newlyFinishedIds = players
    .filter((p) => isPlayerActive(p) && p.hand.length === 0)
    .map((p) => p.id);

  if (newlyFinishedIds.length === 0) {
    return {
      players,
      finishGroups: existingFinishGroups,
      finishOrder: existingFinishOrder,
      newlyFinishedIds: [],
    };
  }

  // Competition ranking: simultaneous finishers share the exact same finishOrder rank.
  const sharedRank = existingFinishOrder.length + 1;
  const updatedPlayers = players.map((p) =>
    newlyFinishedIds.includes(p.id)
      ? { ...p, finished: true, finishOrder: sharedRank }
      : p
  );

  return {
    players: updatedPlayers,
    finishGroups: [...existingFinishGroups, newlyFinishedIds],
    finishOrder: [...existingFinishOrder, ...newlyFinishedIds],
    newlyFinishedIds,
  };
}

/**
 * Helper to resolve a completed successful trick (all remaining expected players followed led suit).
 */
function resolveSuccessfulTrick(
  state: GameState,
  updatedPlayers: Player[],
  ledSuit: NonNullable<GameState['currentTrick']['ledSuit']>,
  updatedPlays: TrickPlay[]
): GameState {
  const removedTrickCards = updatedPlays.map((tp) => tp.card);
  const nextRemovedCards = [...state.removedCards, ...removedTrickCards];

  // Section 7: Finishing is determined ONLY AFTER the successful trick resolves.
  const finalized = finalizeZeroCardPlayers(
    updatedPlayers,
    state.finishGroups,
    state.finishOrder
  );

  const sortedByRankDesc = [...updatedPlays].sort((a, b) => b.card.rank - a.card.rank);
  const highestPlay = sortedByRankDesc[0];

  const activeNow = getActivePlayers(finalized.players);

  // Section 9: Only after trick resolution & finishing updates, check if the game has ended.
  if (activeNow.length <= 1) {
    const donkey = activeNow[0] ?? null;
    const outcome: SuccessfulTrickOutcome = {
      type: 'success',
      trickNumber: state.currentTrick.trickNumber,
      ledSuit,
      plays: updatedPlays,
      highestPlay,
      nextLeaderId: null,
      newlyFinishedIds: finalized.newlyFinishedIds,
      removedCards: removedTrickCards,
    };

    return {
      ...state,
      phase: 'finished',
      players: finalized.players,
      currentTrick: {
        ...state.currentTrick,
        ledSuit,
        plays: updatedPlays,
      },
      currentTurnPlayerId: null,
      isFirstTurnOfGame: false,
      removedCards: nextRemovedCards,
      lastOutcome: outcome,
      trickHistory: [...state.trickHistory, outcome],
      finishGroups: finalized.finishGroups,
      finishOrder: finalized.finishOrder,
      donkeyPlayerId: donkey ? donkey.id : null,
      endReason: donkey
        ? `${donkey.name} is the last player remaining with cards.`
        : 'All remaining players finished simultaneously!',
      lastRedistribution: null,
    };
  }

  // Section 7: Highest card of led suit leads next if still active; otherwise next-highest active led-suit player.
  const nextLeaderPlay = sortedByRankDesc.find((tp) => {
    const owner = finalized.players.find((p) => p.id === tp.playerId);
    return owner !== undefined && isPlayerActive(owner);
  });

  const nextLeaderId = nextLeaderPlay ? nextLeaderPlay.playerId : activeNow[0].id;

  const outcome: SuccessfulTrickOutcome = {
    type: 'success',
    trickNumber: state.currentTrick.trickNumber,
    ledSuit,
    plays: updatedPlays,
    highestPlay,
    nextLeaderId,
    newlyFinishedIds: finalized.newlyFinishedIds,
    removedCards: removedTrickCards,
  };

  return {
    ...state,
    phase: 'trick_result',
    players: finalized.players,
    currentTrick: {
      ...state.currentTrick,
      ledSuit,
      plays: updatedPlays,
    },
    currentTurnPlayerId: null,
    isFirstTurnOfGame: false,
    removedCards: nextRemovedCards,
    lastOutcome: outcome,
    trickHistory: [...state.trickHistory, outcome],
    finishGroups: finalized.finishGroups,
    finishOrder: finalized.finishOrder,
    donkeyPlayerId: null,
    endReason: null,
    lastRedistribution: null,
  };
}

/**
 * Pure immutable state transition for playing a card (Sections 5, 6, 7, 8, 9).
 */
export function playCard(
  state: GameState,
  playerId: string,
  cardId: string,
  options: PlayCardOptions = {}
): PlayResponse {
  if (state.phase !== 'playing') {
    return { ok: false, error: 'Cannot play a card right now.' };
  }

  if (state.currentTurnPlayerId !== playerId) {
    return { ok: false, error: 'It is not this player’s turn.' };
  }

  const player = state.players.find((p) => p.id === playerId);
  if (!player || !isPlayerActive(player)) {
    return { ok: false, error: 'Player is not active in this game.' };
  }

  const legalCards = getLegalCards(state, playerId);
  const chosenCard = legalCards.find((c) => c.id === cardId);
  if (!chosenCard) {
    if (state.isFirstTurnOfGame) {
      return { ok: false, error: 'You must start the game by playing the Ace of Spades (A♠).' };
    }
    if (state.currentTrick.ledSuit) {
      return {
        ok: false,
        error: `You must follow the led suit (${state.currentTrick.ledSuit}).`,
      };
    }
    return { ok: false, error: 'Selected card is not in hand.' };
  }

  // Remove played card from player's hand. Do NOT mark player finished yet!
  const updatedPlayers: Player[] = state.players.map((p) => {
    if (p.id !== playerId) {
      return { ...p, hand: [...p.hand] };
    }
    return {
      ...p,
      hand: p.hand.filter((c) => c.id !== cardId),
      consecutiveMissedTurns: options.isAutoPlay ? p.consecutiveMissedTurns : 0,
    };
  });

  const ledSuit = state.currentTrick.ledSuit ?? chosenCard.suit;
  const playEntry: TrickPlay = {
    playerId,
    card: chosenCard,
    order: state.currentTrick.plays.length,
  };
  const updatedPlays: TrickPlay[] = [...state.currentTrick.plays, playEntry];
  const isOffSuit =
    state.currentTrick.ledSuit !== null && chosenCard.suit !== state.currentTrick.ledSuit;

  // =========================================================================
  // SECTION 8: FAILED TRICK — OFF-SUIT CUTTING
  // =========================================================================
  if (isOffSuit) {
    const trickCards = updatedPlays.map((tp) => tp.card);

    // Highest card of the ORIGINAL led suit among ALL cards played up to the cut.
    // Section 8: No last-card protection! Even if that player played their last card, they collect all cards.
    const ledSuitPlays = updatedPlays
      .filter((tp) => tp.card.suit === ledSuit)
      .sort((a, b) => b.card.rank - a.card.rank);

    const collectorPlay = ledSuitPlays[0];
    const collectorId = collectorPlay.playerId;

    const afterCollectionPlayers = updatedPlayers.map((p) =>
      p.id === collectorId ? { ...p, hand: [...p.hand, ...trickCards] } : p
    );

    // Now complete finishing updates for anyone whose hand is 0 after collection
    // (e.g., the off-suit cutter or another non-collector who played their final card).
    const finalized = finalizeZeroCardPlayers(
      afterCollectionPlayers,
      state.finishGroups,
      state.finishOrder
    );

    const activeAfterFail = getActivePlayers(finalized.players);

    // Section 9: Only after card collection and finishing updates, check if only 1 player remains.
    if (activeAfterFail.length <= 1) {
      const donkey = activeAfterFail[0] ?? null;
      const outcome: FailedTrickOutcome = {
        type: 'failed',
        trickNumber: state.currentTrick.trickNumber,
        ledSuit,
        plays: updatedPlays,
        offSuitPlay: playEntry,
        collectorId,
        collectedCards: trickCards,
        nextLeaderId: null,
        newlyFinishedIds: finalized.newlyFinishedIds,
      };
      return {
        ok: true,
        state: {
          ...state,
          phase: 'finished',
          players: finalized.players,
          currentTrick: {
            ...state.currentTrick,
            ledSuit,
            plays: updatedPlays,
          },
          currentTurnPlayerId: null,
          isFirstTurnOfGame: false,
          lastOutcome: outcome,
          trickHistory: [...state.trickHistory, outcome],
          finishGroups: finalized.finishGroups,
          finishOrder: finalized.finishOrder,
          donkeyPlayerId: donkey ? donkey.id : null,
          endReason: donkey
            ? `${donkey.name} is the last player remaining with cards.`
            : 'Game complete.',
          lastRedistribution: null,
        },
      };
    }

    const outcome: FailedTrickOutcome = {
      type: 'failed',
      trickNumber: state.currentTrick.trickNumber,
      ledSuit,
      plays: updatedPlays,
      offSuitPlay: playEntry,
      collectorId,
      collectedCards: trickCards,
      nextLeaderId: collectorId,
      newlyFinishedIds: finalized.newlyFinishedIds,
    };

    return {
      ok: true,
      state: {
        ...state,
        phase: 'trick_result',
        players: finalized.players,
        currentTrick: {
          ...state.currentTrick,
          ledSuit,
          plays: updatedPlays,
        },
        currentTurnPlayerId: null,
        isFirstTurnOfGame: false,
        lastOutcome: outcome,
        trickHistory: [...state.trickHistory, outcome],
        finishGroups: finalized.finishGroups,
        finishOrder: finalized.finishOrder,
        donkeyPlayerId: null,
        endReason: null,
        lastRedistribution: null,
      },
    };
  }

  // =========================================================================
  // SECTION 7: ON-SUIT PLAY (OR LEADING A TRICK)
  // Never end the game or finish players prematurely mid-trick!
  // =========================================================================
  const allExpectedPlayed = updatedPlays.length >= state.currentTrick.expectedPlayerIds.length;

  if (allExpectedPlayed) {
    return {
      ok: true,
      state: resolveSuccessfulTrick(state, updatedPlayers, ledSuit, updatedPlays),
    };
  }

  // Advance clockwise to the next expected player in this trick.
  const nextTurnPlayerId = state.currentTrick.expectedPlayerIds[updatedPlays.length];

  return {
    ok: true,
    state: {
      ...state,
      phase: 'playing',
      players: updatedPlayers,
      currentTrick: {
        ...state.currentTrick,
        ledSuit,
        plays: updatedPlays,
      },
      currentTurnPlayerId: nextTurnPlayerId,
      isFirstTurnOfGame: false,
      lastRedistribution: null,
    },
  };
}

/**
 * Transitions from 'trick_result' notification to the next trick.
 */
export function continueAfterTrick(state: GameState): GameState {
  if (state.phase !== 'trick_result' || !state.lastOutcome) {
    return state;
  }

  const activePlayers = getActivePlayers(state.players);
  if (activePlayers.length <= 1) {
    const donkey = activePlayers[0] ?? null;
    return {
      ...state,
      phase: 'finished',
      currentTurnPlayerId: null,
      donkeyPlayerId: donkey ? donkey.id : null,
      endReason: donkey ? `${donkey.name} is the last player remaining with cards.` : null,
    };
  }

  const preferredLeader = state.lastOutcome.nextLeaderId;
  const preferredActive =
    preferredLeader &&
    activePlayers.some((p) => p.id === preferredLeader);

  const nextLeaderId = preferredActive ? preferredLeader : activePlayers[0].id;
  const expectedPlayerIds = getClockwiseActivePlayerIds(state.players, nextLeaderId);

  return {
    ...state,
    phase: 'playing',
    currentTrick: {
      trickNumber: state.currentTrick.trickNumber + 1,
      ledSuit: null,
      plays: [],
      expectedPlayerIds,
    },
    currentTurnPlayerId: nextLeaderId,
    isFirstTurnOfGame: false,
    lastRedistribution: null,
  };
}

/**
 * Shuffles a removed/exiting player's remaining cards and distributes them one at a time
 * clockwise starting from the next active seat after that player (Sections 10 & 13).
 */
export function removePlayerAndRedistribute(
  state: GameState,
  playerId: string,
  reason: 'voluntary_exit' | 'missed_turns',
  rng: () => number = Math.random
): PlayResponse {
  if (state.phase === 'finished') {
    return { ok: false, error: 'Game has already ended.' };
  }

  if (reason === 'voluntary_exit' && !canVoluntarilyExit(state)) {
    return {
      ok: false,
      error: 'You cannot exit in the middle of a trick. Please wait until the trick finishes.',
    };
  }

  const target = state.players.find((p) => p.id === playerId);
  if (!target || !isPlayerActive(target)) {
    return { ok: false, error: 'Player is not active in this game.' };
  }

  // 2-player match rule: when one player exits or is removed, no cards are redistributed;
  // the exiting/removed player loses and the remaining active player immediately wins.
  // 3+ player games continue using the existing redistribution & Last Donkey rules below.
  if (state.players.length === 2) {
    const winner = state.players.find((p) => p.id !== playerId && isPlayerActive(p)) ?? null;
    const leftoverOnTable =
      state.phase === 'playing' ? state.currentTrick.plays.map((tp) => tp.card) : [];

    const updatedTwoPlayerList: Player[] = state.players.map((p) => {
      if (p.id === playerId) {
        return {
          ...p,
          hand: [],
          removed: true,
          connected: false,
          finished: false,
          finishOrder: null,
        };
      }
      if (winner && p.id === winner.id) {
        return {
          ...p,
          hand: [...p.hand],
          finished: true,
          finishOrder: 1,
        };
      }
      return { ...p, hand: [...p.hand] };
    });

    const redistribution: RedistributionEvent = {
      removedPlayerId: playerId,
      removedPlayerName: target.name,
      reason,
      cardsDistributedCount: 0,
      recipientCounts: {},
      afterTrickCount: state.trickHistory.length,
    };
    const nextRedistributionHistory: RedistributionEvent[] = [
      ...(state.redistributionHistory ?? []),
      redistribution,
    ];

    const endReason = winner
      ? reason === 'missed_turns'
        ? `${target.name} was removed after 3 consecutive missed turns and loses. ${winner.name} wins!`
        : `${target.name} exited the game and loses. ${winner.name} wins!`
      : 'No active players remain.';

    return {
      ok: true,
      state: {
        ...state,
        phase: 'finished',
        players: updatedTwoPlayerList,
        currentTurnPlayerId: null,
        finishOrder: winner ? [winner.id] : state.finishOrder,
        finishGroups: winner ? [[winner.id]] : state.finishGroups,
        removedCards: [...state.removedCards, ...leftoverOnTable],
        donkeyPlayerId: target.id,
        endReason,
        lastRedistribution: redistribution,
        redistributionHistory: nextRedistributionHistory,
      },
    };
  }

  // Identify remaining active recipients in clockwise order starting strictly AFTER target
  const targetIndex = state.players.findIndex((p) => p.id === playerId);
  const recipientIds: string[] = [];
  for (let offset = 1; offset < state.players.length; offset++) {
    const candidate = state.players[(targetIndex + offset) % state.players.length];
    if (isPlayerActive(candidate) && candidate.id !== playerId) {
      recipientIds.push(candidate.id);
    }
  }

  const cardsToDistribute = target.hand.length > 0 ? shuffleDeck(target.hand, rng) : [];
  const additions = new Map<string, Card[]>();
  const recipientCounts: Record<string, number> = {};
  for (const rid of recipientIds) {
    additions.set(rid, []);
    recipientCounts[rid] = 0;
  }

  if (recipientIds.length > 0) {
    for (let i = 0; i < cardsToDistribute.length; i++) {
      const rid = recipientIds[i % recipientIds.length];
      additions.get(rid)!.push(cardsToDistribute[i]);
      recipientCounts[rid] = (recipientCounts[rid] ?? 0) + 1;
    }
  }

  const updatedPlayers: Player[] = state.players.map((p) => {
    if (p.id === playerId) {
      return {
        ...p,
        hand: [],
        removed: true,
        connected: false,
      };
    }
    const extra = additions.get(p.id);
    if (extra && extra.length > 0) {
      return {
        ...p,
        hand: [...p.hand, ...extra],
      };
    }
    return { ...p, hand: [...p.hand] };
  });

  const redistribution: RedistributionEvent = {
    removedPlayerId: playerId,
    removedPlayerName: target.name,
    reason,
    cardsDistributedCount: cardsToDistribute.length,
    recipientCounts,
    afterTrickCount: state.trickHistory.length,
  };
  const nextRedistributionHistory: RedistributionEvent[] = [
    ...(state.redistributionHistory ?? []),
    redistribution,
  ];

  const remainingActive = getActivePlayers(updatedPlayers);

  // If only 1 active player remains after removal & redistribution, declare the Donkey immediately!
  if (remainingActive.length <= 1) {
    const donkey = remainingActive[0] ?? null;
    const leftoverOnTable =
      state.phase === 'playing' ? state.currentTrick.plays.map((tp) => tp.card) : [];

    return {
      ok: true,
      state: {
        ...state,
        phase: 'finished',
        players: updatedPlayers,
        currentTurnPlayerId: null,
        removedCards: [...state.removedCards, ...leftoverOnTable],
        donkeyPlayerId: donkey ? donkey.id : null,
        endReason: donkey
          ? `${target.name} left the game. ${donkey.name} is the last player remaining with cards.`
          : 'No active players remain.',
        lastRedistribution: redistribution,
        redistributionHistory: nextRedistributionHistory,
      },
    };
  }

  // Case 1: Between tricks while showing trick_result
  if (state.phase === 'trick_result' && state.lastOutcome) {
    const nextLeaderId =
      state.lastOutcome.nextLeaderId === playerId
        ? recipientIds[0] ?? remainingActive[0].id
        : state.lastOutcome.nextLeaderId;

    return {
      ok: true,
      state: {
        ...state,
        players: updatedPlayers,
        lastOutcome: {
          ...state.lastOutcome,
          nextLeaderId,
        },
        lastRedistribution: redistribution,
        redistributionHistory: nextRedistributionHistory,
      },
    };
  }

  // Case 2: Fresh trick with 0 plays so far
  if (state.currentTrick.plays.length === 0) {
    // If this was Turn 1 (A♠ holder was removed & A♠ got redistributed), find the new A♠ holder!
    let nextLeaderId: string;
    let isFirstTurnOfGame = state.isFirstTurnOfGame;
    if (state.isFirstTurnOfGame) {
      const newAceHolder = updatedPlayers.find(
        (p) => isPlayerActive(p) && p.hand.some((c) => c.id === ACE_OF_SPADES_ID)
      );
      nextLeaderId = newAceHolder ? newAceHolder.id : recipientIds[0];
      isFirstTurnOfGame = Boolean(newAceHolder);
    } else if (state.currentTurnPlayerId === playerId) {
      nextLeaderId = recipientIds[0];
    } else {
      nextLeaderId = state.currentTurnPlayerId ?? recipientIds[0];
    }

    const expectedPlayerIds = getClockwiseActivePlayerIds(updatedPlayers, nextLeaderId);

    return {
      ok: true,
      state: {
        ...state,
        players: updatedPlayers,
        currentTrick: {
          ...state.currentTrick,
          expectedPlayerIds,
        },
        currentTurnPlayerId: nextLeaderId,
        isFirstTurnOfGame,
        lastRedistribution: redistribution,
        redistributionHistory: nextRedistributionHistory,
      },
    };
  }

  // Case 3: Mid-trick removal (happens on 3rd consecutive missed turn per Section 13)
  const updatedExpected = state.currentTrick.expectedPlayerIds.filter((id) => id !== playerId);
  const alreadyPlayedCount = state.currentTrick.plays.length;

  // If every remaining expected player has already played in this trick, resolve it now!
  if (alreadyPlayedCount >= updatedExpected.length && state.currentTrick.ledSuit) {
    const resolved = resolveSuccessfulTrick(
      state,
      updatedPlayers,
      state.currentTrick.ledSuit,
      state.currentTrick.plays
    );
    return {
      ok: true,
      state: {
        ...resolved,
        currentTrick: {
          ...resolved.currentTrick,
          expectedPlayerIds: updatedExpected,
        },
        lastRedistribution: redistribution,
        redistributionHistory: nextRedistributionHistory,
      },
    };
  }

  // Otherwise continue the current trick with the next expected player!
  const nextTurnPlayerId = updatedExpected[alreadyPlayedCount] ?? recipientIds[0];

  return {
    ok: true,
    state: {
      ...state,
      players: updatedPlayers,
      currentTrick: {
        ...state.currentTrick,
        expectedPlayerIds: updatedExpected,
      },
      currentTurnPlayerId: nextTurnPlayerId,
      lastRedistribution: redistribution,
      redistributionHistory: nextRedistributionHistory,
    },
  };
}

/**
 * Handles a player's turn timer expiring (Section 13):
 * - 1st missed turn: auto-play a random legal card, consecutiveMissedTurns = 1.
 * - 2nd missed turn: auto-play a random legal card, consecutiveMissedTurns = 2.
 * - 3rd consecutive missed turn: remove player, shuffle & redistribute their cards clockwise,
 *   and continue the current trick with the remaining present players!
 */
export function handleMissedTurn(
  state: GameState,
  playerId: string,
  rng: () => number = Math.random
): MissedTurnResponse {
  if (state.phase !== 'playing') {
    return { ok: false, error: 'Game is not awaiting a card play.' };
  }
  if (state.currentTurnPlayerId !== playerId) {
    return { ok: false, error: 'It is not this player’s turn.' };
  }

  const player = state.players.find((p) => p.id === playerId);
  if (!player || !isPlayerActive(player)) {
    return { ok: false, error: 'Player is not active.' };
  }

  const nextMissedCount = player.consecutiveMissedTurns + 1;

  // 3rd consecutive missed turn -> remove & redistribute clockwise!
  if (nextMissedCount >= 3) {
    const withCount: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === playerId ? { ...p, consecutiveMissedTurns: nextMissedCount } : p
      ),
    };
    const removedRes = removePlayerAndRedistribute(withCount, playerId, 'missed_turns', rng);
    if (!removedRes.ok) return removedRes;
    return {
      ok: true,
      action: 'removed_and_redistributed',
      state: removedRes.state,
      missedCount: nextMissedCount,
      redistribution: removedRes.state.lastRedistribution ?? undefined,
    };
  }

  // 1st or 2nd missed turn -> random legal card auto-play
  const autoCard = chooseRandomLegalCard(state, playerId, rng);
  if (!autoCard) {
    return { ok: false, error: 'No legal cards available to auto-play.' };
  }

  const stateWithMiss: GameState = {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, consecutiveMissedTurns: nextMissedCount } : p
    ),
  };

  const playRes = playCard(stateWithMiss, playerId, autoCard.id, { isAutoPlay: true });
  if (!playRes.ok) return playRes;

  return {
    ok: true,
    action: 'auto_played',
    state: playRes.state,
    autoPlayedCard: autoCard,
    missedCount: nextMissedCount,
  };
}

/**
 * Resets a player's consecutive missed turns when they reconnect and resume playing (Section 13).
 */
export function markPlayerConnection(
  state: GameState,
  playerId: string,
  connected: boolean
): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId
        ? {
            ...p,
            connected,
            consecutiveMissedTurns: connected ? 0 : p.consecutiveMissedTurns,
          }
        : p
    ),
  };
}

/**
 * Returns the currently leading (highest led-suit) play in the ongoing trick.
 */
export function getCurrentHighestLedPlay(state: GameState): TrickPlay | null {
  const { ledSuit, plays } = state.currentTrick;
  if (!ledSuit || plays.length === 0) return null;

  const ledPlays = plays
    .filter((tp) => tp.card.suit === ledSuit)
    .sort((a, b) => b.card.rank - a.card.rank);

  return ledPlays[0] ?? null;
}
