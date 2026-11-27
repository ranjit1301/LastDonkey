import {
  getLegalCards,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  type Card,
  type GameState,
  type LegalCardsStateView,
} from '../engine/index.ts';
import type { ConnectionStatus } from './multiplayerClient.ts';
import type { ClientGameStateView, ClientRoomState } from '../server/roomTypes.ts';

export type UnifiedTableGameState = GameState | ClientGameStateView;

export interface TablePerspectivePlayer {
  id: string;
  name: string;
  type: 'human' | 'bot';
  hand: readonly Card[];
  finished: boolean;
  removed: boolean;
  connected: boolean;
  avatarColor?: string;
}

export interface CardSelectionState {
  isLegal: boolean;
  isSelectable: boolean;
  isVisuallyDisabled: boolean;
  isWaitingMuted: boolean;
}

export type TurnBannerMode =
  | 'your_turn'
  | 'reconnecting_your_turn'
  | 'other_turn'
  | 'trick_resolving'
  | 'finished_spectating'
  | 'removed'
  | 'waiting';

export interface TableTurnBanner {
  mode: TurnBannerMode;
  headline: string;
  subtext: string;
  activePlayerName: string | null;
  activePlayerColor: string | null;
  showYourTurnHighlight: boolean;
}

export interface DeriveTableTurnStateParams {
  gameState: UnifiedTableGameState;
  perspectivePlayer: TablePerspectivePlayer;
  activeTurnPlayer: TablePerspectivePlayer | null;
  selectedCardId: string | null;
  isOnline: boolean;
  onlineRoom?: Pick<ClientRoomState, 'status' | 'yourPlayerId'> | null;
  connectionStatus?: ConnectionStatus;
  needsPrivacyCurtain?: boolean;
}

export interface TableTurnState {
  /** True ONLY when the local viewer is permitted to select and play a card right now. */
  canActNow: boolean;
  /** True when the perspective player's seat holds the active turn in gameState (even if disconnected). */
  isPlayersSeatTurn: boolean;
  /** True when it is the player's seat turn online, but their socket/seat is currently disconnected. */
  isDisconnectedOnOwnTurn: boolean;
  /** Authoritative legal cards computed directly via engine getLegalCards (empty unless canActNow). */
  legalCards: Card[];
  legalCardIds: Set<string>;
  /** Selected card ONLY if it is still in hand and currently legal while canActNow is true. */
  validSelectedCard: Card | null;
  /** True ONLY when canActNow is true and validSelectedCard is non-null. */
  canPlaySelectedCard: boolean;
  /** Consistent card interaction/visual state across all difficulty modes. */
  getCardSelectionState: (cardId: string) => CardSelectionState;
  /** Primary turn visibility banner & highlight state. */
  turnBanner: TableTurnBanner;
}

/**
 * Single authoritative check determining whether the perspective viewer
 * is entitled to act right now.
 *
 * Returns false when disconnected, reconnecting, eliminated/removed,
 * finished/spectating, behind a pass-and-play privacy curtain, between tricks,
 * waiting in lobby, or when another player holds the turn.
 */
export function canPerspectivePlayerAct(params: {
  gameState: Pick<UnifiedTableGameState, 'phase' | 'currentTurnPlayerId'>;
  perspectivePlayer: TablePerspectivePlayer;
  isOnline: boolean;
  onlineRoom?: Pick<ClientRoomState, 'status' | 'yourPlayerId'> | null;
  connectionStatus?: ConnectionStatus;
  needsPrivacyCurtain?: boolean;
}): boolean {
  const {
    gameState,
    perspectivePlayer,
    isOnline,
    onlineRoom,
    connectionStatus = 'connected',
    needsPrivacyCurtain = false,
  } = params;

  if (gameState.phase !== 'playing') return false;
  if (needsPrivacyCurtain) return false;
  if (perspectivePlayer.type !== 'human') return false;
  if (perspectivePlayer.removed || perspectivePlayer.finished) return false;
  if (perspectivePlayer.hand.length === 0) return false;
  if (gameState.currentTurnPlayerId !== perspectivePlayer.id) return false;

  if (isOnline) {
    if (!onlineRoom || onlineRoom.status !== 'playing') return false;
    if (onlineRoom.yourPlayerId !== perspectivePlayer.id) return false;
    if (connectionStatus !== 'connected') return false;
    if (!perspectivePlayer.connected) return false;
  }

  return true;
}

/**
 * Single source of truth for card table turn visibility, card selectability,
 * and Play button enablement. Reuses engine getLegalCards directly so client
 * selection rules stay 100% consistent with server-side validation.
 */
export function deriveTableTurnState(params: DeriveTableTurnStateParams): TableTurnState {
  const {
    gameState,
    perspectivePlayer,
    activeTurnPlayer,
    selectedCardId,
    isOnline,
    onlineRoom,
    connectionStatus = 'connected',
    needsPrivacyCurtain = false,
  } = params;

  const isSeatOwnedByViewer =
    !isOnline || (onlineRoom != null && onlineRoom.yourPlayerId === perspectivePlayer.id);

  const isPlayersSeatTurn =
    gameState.phase === 'playing' &&
    isSeatOwnedByViewer &&
    perspectivePlayer.type === 'human' &&
    !perspectivePlayer.removed &&
    !perspectivePlayer.finished &&
    gameState.currentTurnPlayerId === perspectivePlayer.id;

  const canActNow = canPerspectivePlayerAct({
    gameState,
    perspectivePlayer,
    isOnline,
    onlineRoom,
    connectionStatus,
    needsPrivacyCurtain,
  });

  const isDisconnectedOnOwnTurn =
    isOnline &&
    isPlayersSeatTurn &&
    !canActNow &&
    (connectionStatus !== 'connected' || !perspectivePlayer.connected);

  const legalCards = canActNow
    ? getLegalCards(gameState as LegalCardsStateView, perspectivePlayer.id)
    : [];
  const legalCardIds = new Set(legalCards.map((c) => c.id));

  const validSelectedCard =
    canActNow && selectedCardId !== null && legalCardIds.has(selectedCardId)
      ? perspectivePlayer.hand.find((c) => c.id === selectedCardId) ?? null
      : null;

  const canPlaySelectedCard = canActNow && validSelectedCard !== null;

  const getCardSelectionState = (cardId: string): CardSelectionState => {
    const isLegal = canActNow && legalCardIds.has(cardId);
    return {
      isLegal,
      isSelectable: isLegal,
      isVisuallyDisabled: canActNow && !isLegal,
      isWaitingMuted: !canActNow,
    };
  };

  const ledSuit = gameState.currentTrick.ledSuit;
  let turnBanner: TableTurnBanner;

  if (canActNow) {
    let subtext: string;
    if (gameState.isFirstTurnOfGame) {
      subtext = 'Play the Ace of Spades (A♠) to start the game.';
    } else if (!ledSuit) {
      subtext = 'Lead any card from your hand.';
    } else if (perspectivePlayer.hand.some((c) => c.suit === ledSuit)) {
      subtext = `Follow ${SUIT_NAMES[ledSuit]} (${SUIT_SYMBOLS[ledSuit]}) — select a highlighted card.`;
    } else {
      subtext = `No ${SUIT_NAMES[ledSuit]} in hand — play any card to cut (Rang Vapas)!`;
    }

    turnBanner = {
      mode: 'your_turn',
      headline: 'YOUR TURN!',
      subtext,
      activePlayerName: perspectivePlayer.name,
      activePlayerColor: perspectivePlayer.avatarColor ?? null,
      showYourTurnHighlight: true,
    };
  } else if (isDisconnectedOnOwnTurn) {
    turnBanner = {
      mode: 'reconnecting_your_turn',
      headline: 'Reconnecting...',
      subtext: 'Restoring your connection before you can play a card.',
      activePlayerName: perspectivePlayer.name,
      activePlayerColor: perspectivePlayer.avatarColor ?? null,
      showYourTurnHighlight: false,
    };
  } else if (gameState.phase === 'trick_result') {
    turnBanner = {
      mode: 'trick_resolving',
      headline: 'Resolving trick...',
      subtext: 'Preparing the next lead.',
      activePlayerName: null,
      activePlayerColor: null,
      showYourTurnHighlight: false,
    };
  } else if (gameState.phase === 'playing' && activeTurnPlayer) {
    const otherHeadline = `${activeTurnPlayer.name}’s Turn`;
    const otherSubtext = gameState.isFirstTurnOfGame
      ? `Waiting for ${activeTurnPlayer.name} to lead with A♠...`
      : perspectivePlayer.finished
        ? `Spectating · Waiting for ${activeTurnPlayer.name} to play...`
        : perspectivePlayer.removed
          ? `Removed · Watching ${activeTurnPlayer.name} play...`
          : `Waiting for ${activeTurnPlayer.name} to play...`;

    turnBanner = {
      mode: 'other_turn',
      headline: otherHeadline,
      subtext: otherSubtext,
      activePlayerName: activeTurnPlayer.name,
      activePlayerColor: activeTurnPlayer.avatarColor ?? null,
      showYourTurnHighlight: false,
    };
  } else if (perspectivePlayer.removed) {
    turnBanner = {
      mode: 'removed',
      headline: 'Removed from match',
      subtext: 'Watching remaining players finish this round.',
      activePlayerName: null,
      activePlayerColor: null,
      showYourTurnHighlight: false,
    };
  } else if (perspectivePlayer.finished) {
    turnBanner = {
      mode: 'finished_spectating',
      headline: 'Finished safe',
      subtext: 'Watching remaining players finish this round.',
      activePlayerName: null,
      activePlayerColor: null,
      showYourTurnHighlight: false,
    };
  } else {
    turnBanner = {
      mode: 'waiting',
      headline: 'Waiting for match...',
      subtext: '',
      activePlayerName: null,
      activePlayerColor: null,
      showYourTurnHighlight: false,
    };
  }

  return {
    canActNow,
    isPlayersSeatTurn,
    isDisconnectedOnOwnTurn,
    legalCards,
    legalCardIds,
    validSelectedCard,
    canPlaySelectedCard,
    getCardSelectionState,
    turnBanner,
  };
}
