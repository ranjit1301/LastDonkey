import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  BookOpen,
  Bot,
  Eye,
  EyeOff,
  LogOut,
  Settings,
  Trash2,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import {
  ACE_OF_SPADES_ID,
  formatCard,
  isRedSuit,
  sortHand,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  type Card,
  type GameState,
} from '../engine';
import { PlayingCard } from '../components/PlayingCard';
import { TrickOutcomeNotification } from '../components/TrickOutcomeNotification';
import type { AppSettings } from '../lib/settings';
import type { ClientGameStateView, ClientPlayerView, ClientRoomState } from '../server/roomTypes';

type UnifiedGameState = GameState | ClientGameStateView;

interface UnifiedPlayer {
  id: string;
  name: string;
  type: 'human' | 'bot';
  seatIndex: number;
  cardCount: number;
  hand: Card[];
  finished: boolean;
  finishOrder: number | null;
  removed: boolean;
  connected: boolean;
  consecutiveMissedTurns: number;
  avatarColor: string;
}

function normalizePlayers(gameState: UnifiedGameState): UnifiedPlayer[] {
  return gameState.players.map((p) => {
    const maybeClient = p as ClientPlayerView;
    const count =
      typeof maybeClient.cardCount === 'number' ? maybeClient.cardCount : p.hand.length;
    return {
      ...p,
      cardCount: count,
    };
  });
}

function computeLegalCards(state: UnifiedGameState, player: UnifiedPlayer): Card[] {
  if (state.phase !== 'playing' || state.currentTurnPlayerId !== player.id) return [];
  if (player.finished || player.removed || player.hand.length === 0) return [];

  if (state.isFirstTurnOfGame) {
    const ace = player.hand.find((c) => c.id === ACE_OF_SPADES_ID);
    if (ace) return [ace];
  }
  const ledSuit = state.currentTrick.ledSuit;
  if (!ledSuit) return [...player.hand];
  const sameSuit = player.hand.filter((c) => c.suit === ledSuit);
  return sameSuit.length > 0 ? sameSuit : [...player.hand];
}

interface CardTableScreenProps {
  gameState: UnifiedGameState;
  settings: AppSettings;
  roomCode: string;
  isOnline: boolean;
  onlineRoom?: ClientRoomState | null;
  connectionStatus?: 'connected' | 'reconnecting' | 'disconnected';
  trickNotificationDurationMs: number;
  onPlayCard: (playerId: string, cardId: string) => void;
  onLocalMissedTurn?: (playerId: string) => void;
  onContinueTrick: () => void;
  onToggleSound: () => void;
  onToggleOpenHands: () => void;
  onOpenRules: () => void;
  onOpenSettings: () => void;
  onVoluntaryExit: () => void;
  onOnlineRespondHostTransfer?: (accept: boolean) => void;
}

export const CardTableScreen: React.FC<CardTableScreenProps> = ({
  gameState,
  settings,
  roomCode,
  isOnline,
  onlineRoom,
  connectionStatus = 'connected',
  trickNotificationDurationMs,
  onPlayCard,
  onLocalMissedTurn,
  onContinueTrick,
  onToggleSound,
  onToggleOpenHands,
  onOpenRules,
  onOpenSettings,
  onVoluntaryExit,
  onOnlineRespondHostTransfer,
}) => {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [revealedPlayerId, setRevealedPlayerId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [localSecondsLeft, setLocalSecondsLeft] = useState<number>(settings.turnTimerSeconds);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const players = useMemo(() => normalizePlayers(gameState), [gameState]);
  const humanPlayers = useMemo(() => players.filter((p) => p.type === 'human'), [players]);
  const isPassAndPlay = !isOnline && humanPlayers.length > 1;

  const activeTurnPlayer = useMemo(
    () => players.find((p) => p.id === gameState.currentTurnPlayerId) ?? null,
    [players, gameState.currentTurnPlayerId]
  );

  // Perspective player displayed at bottom of table
  const perspectivePlayer: UnifiedPlayer = useMemo(() => {
    if (isOnline && onlineRoom) {
      return players.find((p) => p.id === onlineRoom.yourPlayerId) ?? players[0];
    }
    if (isPassAndPlay) {
      if (activeTurnPlayer && activeTurnPlayer.type === 'human') return activeTurnPlayer;
      return humanPlayers.find((p) => !p.finished && !p.removed) ?? humanPlayers[0];
    }
    return humanPlayers[0] ?? players[0];
  }, [isOnline, onlineRoom, isPassAndPlay, activeTurnPlayer, humanPlayers, players]);

  // Clear selection whenever turn or trick changes
  useEffect(() => {
    setSelectedCardId(null);
  }, [gameState.currentTurnPlayerId, gameState.currentTrick.trickNumber, gameState.phase]);

  // Pass-and-play privacy curtain
  useEffect(() => {
    if (!isPassAndPlay || settings.openHandsTesting) {
      setRevealedPlayerId(null);
      return;
    }
    if (activeTurnPlayer?.type === 'human' && revealedPlayerId !== activeTurnPlayer.id) {
      setRevealedPlayerId(null);
    }
  }, [
    activeTurnPlayer?.id,
    activeTurnPlayer?.type,
    isPassAndPlay,
    settings.openHandsTesting,
    revealedPlayerId,
  ]);

  const needsPrivacyCurtain =
    isPassAndPlay &&
    !settings.openHandsTesting &&
    gameState.phase === 'playing' &&
    activeTurnPlayer?.type === 'human' &&
    revealedPlayerId !== activeTurnPlayer.id;

  // Opponents in clockwise order after perspectivePlayer
  const opponents = useMemo(() => {
    const startIdx = players.findIndex((p) => p.id === perspectivePlayer.id);
    const ordered: UnifiedPlayer[] = [];
    for (let offset = 1; offset < players.length; offset++) {
      ordered.push(players[(startIdx + offset) % players.length]);
    }
    return ordered;
  }, [players, perspectivePlayer.id]);

  const isPerspectivePlayersTurn =
    gameState.phase === 'playing' &&
    gameState.currentTurnPlayerId === perspectivePlayer.id &&
    perspectivePlayer.type === 'human' &&
    !perspectivePlayer.removed &&
    !perspectivePlayer.finished;

  // Section 10: Exit Game is DISABLED mid-trick; only enabled between tricks!
  const exitAllowedNow =
    gameState.phase === 'finished' ||
    gameState.phase === 'trick_result' ||
    gameState.currentTrick.plays.length === 0;

  // Server deadline ticker for online rooms
  useEffect(() => {
    if (!isOnline || !onlineRoom?.turnDeadlineAt) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [isOnline, onlineRoom?.turnDeadlineAt]);

  // Local turn timer countdown for offline Practice / Pass-and-Play (Section 12 & 13)
  const localTimerActive =
    !isOnline &&
    isPerspectivePlayersTurn &&
    !needsPrivacyCurtain &&
    !confirmLeave &&
    settings.turnTimerSeconds > 0;

  useEffect(() => {
    if (!isOnline) {
      setLocalSecondsLeft(settings.turnTimerSeconds);
    }
  }, [
    isOnline,
    gameState.currentTurnPlayerId,
    gameState.currentTrick.trickNumber,
    gameState.currentTrick.plays.length,
    gameState.phase,
    settings.turnTimerSeconds,
    needsPrivacyCurtain,
  ]);

  useEffect(() => {
    if (!localTimerActive) return;
    if (localSecondsLeft <= 0) {
      onLocalMissedTurn?.(perspectivePlayer.id);
      return;
    }
    const id = window.setTimeout(() => {
      setLocalSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [localTimerActive, localSecondsLeft, onLocalMissedTurn, perspectivePlayer.id]);

  const displaySecondsLeft: number | null = useMemo(() => {
    if (isOnline) {
      if (!onlineRoom?.turnDeadlineAt || gameState.phase !== 'playing') return null;
      return Math.max(0, Math.ceil((onlineRoom.turnDeadlineAt - nowMs) / 1000));
    }
    return localTimerActive ? localSecondsLeft : null;
  }, [isOnline, onlineRoom?.turnDeadlineAt, gameState.phase, nowMs, localTimerActive, localSecondsLeft]);

  const legalCards = useMemo(
    () => (isPerspectivePlayersTurn ? computeLegalCards(gameState, perspectivePlayer) : []),
    [gameState, isPerspectivePlayersTurn, perspectivePlayer]
  );
  const legalCardIds = useMemo(() => new Set(legalCards.map((c) => c.id)), [legalCards]);

  const sortedHand = useMemo(
    () => sortHand(perspectivePlayer.hand, settings.sortOrder),
    [perspectivePlayer.hand, settings.sortOrder]
  );

  const selectedCard = useMemo(
    () => sortedHand.find((c) => c.id === selectedCardId) ?? null,
    [sortedHand, selectedCardId]
  );

  const highestLedPlay = useMemo(() => {
    const { ledSuit, plays } = gameState.currentTrick;
    if (!ledSuit || plays.length === 0) return null;
    return (
      plays
        .filter((tp) => tp.card.suit === ledSuit)
        .sort((a, b) => b.card.rank - a.card.rank)[0] ?? null
    );
  }, [gameState.currentTrick]);

  const handleCardTap = (card: Card) => {
    if (!isPerspectivePlayersTurn || !legalCardIds.has(card.id)) return;
    if (settings.playTapMode === 'single-tap') {
      onPlayCard(perspectivePlayer.id, card.id);
      return;
    }
    if (selectedCardId === card.id) {
      onPlayCard(perspectivePlayer.id, card.id);
      setSelectedCardId(null);
    } else {
      setSelectedCardId(card.id);
    }
  };

  const handleConfirmPlay = () => {
    if (!selectedCard || !isPerspectivePlayersTurn) return;
    onPlayCard(perspectivePlayer.id, selectedCard.id);
    setSelectedCardId(null);
  };

  const ledSuit = gameState.currentTrick.ledSuit;

  const turnSubtext = useMemo(() => {
    if (!isPerspectivePlayersTurn) {
      if (gameState.phase === 'trick_result') return 'Resolving trick...';
      if (activeTurnPlayer) {
        return gameState.isFirstTurnOfGame
          ? `${activeTurnPlayer.name} leads with A♠...`
          : `Waiting for ${activeTurnPlayer.name}...`;
      }
      return '';
    }
    if (gameState.isFirstTurnOfGame) {
      return 'Play the Ace of Spades (A♠) to start the game.';
    }
    if (!ledSuit) {
      return 'Lead any card from your hand.';
    }
    const hasSuit = perspectivePlayer.hand.some((c) => c.suit === ledSuit);
    if (hasSuit) {
      return `Follow the suit: play a ${SUIT_NAMES[ledSuit]} card.`;
    }
    return `No ${SUIT_NAMES[ledSuit]} in hand — play any card to cut (Rang Vapas)!`;
  }, [
    isPerspectivePlayersTurn,
    gameState.phase,
    gameState.isFirstTurnOfGame,
    activeTurnPlayer,
    ledSuit,
    perspectivePlayer.hand,
  ]);

  return (
    <div className="min-h-screen h-[100dvh] flex flex-col felt-surface overflow-hidden">
      {/* Top Wooden/Forest Header Bar (Matches Screenshot image_1d270c3e.png) */}
      <header className="shrink-0 walnut-rail px-3 sm:px-5 py-2.5 flex items-center justify-between gap-2 z-20">
        {/* Left: Exit Button (Disabled Mid-Trick per Section 10) + Room Code */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            disabled={!exitAllowedNow}
            onClick={() => setConfirmLeave(true)}
            aria-label={exitAllowedNow ? 'Exit game' : 'Exit disabled during trick'}
            title={
              exitAllowedNow
                ? 'Exit game between tricks'
                : 'Wait for the current trick to finish before exiting'
            }
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0 ${
              exitAllowedNow
                ? 'bg-[#214D2F] text-[#F5F2E8] hover:bg-[#2C643E] cursor-pointer'
                : 'bg-[#173621] text-[#6B8B74] opacity-55 cursor-not-allowed'
            }`}
          >
            <LogOut className="w-4 h-4" />
          </button>

          <span className="font-mono font-bold tracking-[0.14em] text-sm sm:text-base text-[#F5F2E8] whitespace-nowrap">
            {roomCode}
          </span>
        </div>

        {/* Center/Right: Out Count Pill + Utility Icons */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="px-3 py-1.5 rounded-full bg-[#13331E] border border-white/10 text-xs font-semibold text-[#E8F2EB] inline-flex items-center gap-1.5 tabular-nums">
            <Trash2 className="w-3.5 h-3.5 text-[#F0B429]" />
            <span>Out: {gameState.removedCards.length}</span>
          </div>

          {isPassAndPlay && (
            <button
              type="button"
              onClick={onToggleOpenHands}
              aria-label="Toggle open hands testing"
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                settings.openHandsTesting
                  ? 'bg-[#F0B429] text-[#1D160B]'
                  : 'bg-[#13331E] text-[#D8E8DD] hover:text-white'
              }`}
            >
              {settings.openHandsTesting ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleSound}
            aria-label={settings.soundEnabled ? 'Mute sound' : 'Unmute sound'}
            className="w-9 h-9 rounded-full bg-[#13331E] text-[#D8E8DD] hover:text-white flex items-center justify-center cursor-pointer"
          >
            {settings.soundEnabled ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4 opacity-60" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenRules}
            aria-label="How to play"
            className="w-9 h-9 rounded-full bg-[#13331E] text-[#D8E8DD] hover:text-white flex items-center justify-center cursor-pointer"
          >
            <BookOpen className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="w-9 h-9 rounded-full bg-[#13331E] text-[#D8E8DD] hover:text-white flex items-center justify-center cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Connection Reconnecting Banner (if WS momentarily drops) */}
      {isOnline && connectionStatus !== 'connected' && (
        <div className="bg-[#571C1C] text-[#FDE8E8] text-xs font-semibold px-4 py-1.5 flex items-center justify-center gap-2 z-20">
          <WifiOff className="w-3.5 h-3.5" />
          Reconnecting to table... Game continues without pausing.
        </div>
      )}

      {/* Pending Host Transfer Request in-game */}
      {onlineRoom?.pendingHostTransfer &&
        onlineRoom.pendingHostTransfer.toPlayerId === onlineRoom.yourPlayerId && (
          <div className="bg-[#F0B429] text-[#1F170A] px-4 py-2 text-xs sm:text-sm font-semibold flex flex-wrap items-center justify-center gap-3 z-20">
            <span>
              {onlineRoom.pendingHostTransfer.fromPlayerName} wants to transfer Host ownership to
              you.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOnlineRespondHostTransfer?.(true)}
                className="px-3 py-1 rounded-lg bg-[#1E5631] text-white text-xs font-bold cursor-pointer"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => onOnlineRespondHostTransfer?.(false)}
                className="px-3 py-1 rounded-lg bg-black/15 text-[#1F170A] text-xs font-bold cursor-pointer"
              >
                Decline
              </button>
            </div>
          </div>
        )}

      {/* Main Table Felt Body */}
      <main className="flex-1 min-h-0 relative flex flex-col justify-between gap-2 px-2.5 sm:px-6 pt-2 pb-2.5 overflow-y-auto">
        {/* TOP OPPONENTS GRID — All 1 to 5 opponents always 100% visible with zero horizontal cutoff */}
        <section aria-label="Opponents" className="relative z-10 shrink-0 w-full mx-auto">
          <div
            className={
              opponents.length === 1
                ? 'grid grid-cols-1 max-w-[210px] mx-auto gap-2'
                : opponents.length === 2
                  ? 'grid grid-cols-2 max-w-md mx-auto gap-2'
                  : opponents.length === 3
                    ? 'grid grid-cols-3 max-w-2xl mx-auto gap-1.5 sm:gap-2.5'
                    : opponents.length === 4
                      ? 'grid grid-cols-2 sm:grid-cols-4 max-w-3xl mx-auto gap-1.5 sm:gap-2.5'
                      : 'grid grid-cols-6 sm:grid-cols-5 max-w-4xl mx-auto gap-1.5 sm:gap-2.5'
            }
          >
            {opponents.map((opp, idx) => {
              const isTurn =
                gameState.phase === 'playing' && gameState.currentTurnPlayerId === opp.id;
              const playedThisTrick = gameState.currentTrick.plays.some(
                (tp) => tp.playerId === opp.id
              );
              const isCompactRow = opponents.length >= 4;
              // For 5 opponents on mobile (6-col grid): top row has 3 players (col-span-2 each),
              // bottom row has 2 players (col-span-3 each) so all 5 fit in 2 neat rows!
              const spanClass =
                opponents.length === 5
                  ? idx < 3
                    ? 'col-span-2 sm:col-span-1'
                    : 'col-span-3 sm:col-span-1'
                  : '';

              return (
                <div
                  key={opp.id}
                  className={`${spanClass} min-w-0 rounded-2xl transition-all border ${
                    isCompactRow
                      ? 'px-2 py-1.5 sm:px-3 sm:py-2.5 flex flex-row sm:flex-col items-center gap-2 sm:gap-1 text-left sm:text-center'
                      : 'px-2.5 py-2 sm:px-3 sm:py-2.5 flex flex-col items-center text-center'
                  } ${
                    opp.removed
                      ? 'bg-[#122D1C]/50 border-white/10 opacity-55'
                      : opp.finished
                        ? 'bg-[#143D24]/75 border-[#86EFAC]/40 opacity-85'
                        : isTurn
                          ? 'bg-[#26693D] border-[#F0B429] ring-1 ring-[#F0B429]/60 shadow-[0_0_18px_rgba(240,180,41,0.35)]'
                          : 'bg-[#174226]/88 border-white/12'
                  }`}
                >
                  <div className="relative shrink-0">
                    <div
                      className={`${
                        isCompactRow ? 'w-8 h-8 sm:w-10 sm:h-10 text-xs sm:text-sm' : 'w-9 h-9 sm:w-10 sm:h-10 text-sm'
                      } rounded-full flex items-center justify-center font-display font-bold border-2 ${
                        isTurn ? 'border-[#F0B429]' : 'border-white/25'
                      }`}
                      style={{
                        backgroundColor: opp.type === 'bot' ? '#244E32' : opp.avatarColor,
                        color: opp.type === 'bot' ? '#FFFFFF' : '#1E170F',
                      }}
                    >
                      {opp.type === 'bot' ? (
                        <Bot className={isCompactRow ? 'w-4 h-4 sm:w-5 sm:h-5' : 'w-4 h-4 sm:w-5 sm:h-5'} />
                      ) : (
                        opp.name.slice(0, 1).toUpperCase()
                      )}
                    </div>
                    {isTurn && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#F0B429] ring-2 ring-[#26693D]"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 sm:flex-none w-full">
                    <div
                      className={`${
                        isCompactRow ? 'mt-0 sm:mt-1' : 'mt-1'
                      } text-xs sm:text-sm font-bold text-white truncate leading-tight`}
                      title={opp.name}
                    >
                      {opp.name}
                    </div>

                    <div className="mt-0.5 text-[11px] font-medium text-[#CFE2D5] tabular-nums flex items-center justify-start sm:justify-center gap-1 flex-wrap leading-tight">
                      {opp.removed ? (
                        <span className="text-[#FCA5A5]">Removed</span>
                      ) : opp.finished ? (
                        <span className="text-[#86EFAC] font-semibold">
                          Safe · #{opp.finishOrder}
                        </span>
                      ) : (
                        <span>
                          {opp.cardCount} {opp.cardCount === 1 ? 'card' : 'cards'}
                        </span>
                      )}

                      {!opp.finished && !opp.removed && playedThisTrick && (
                        <span className="text-[10px] font-semibold text-[#A7F3D0]">· Played</span>
                      )}
                    </div>

                    {!opp.finished &&
                      !opp.removed &&
                      (!opp.connected || opp.consecutiveMissedTurns > 0) && (
                        <div className="mt-0.5 text-[10px] font-semibold text-[#FDE68A] leading-tight">
                          {!opp.connected ? 'Offline' : `Miss ${opp.consecutiveMissedTurns}/3`}
                        </div>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* CENTER BATTLE ZONE: Suit Pill + Played Cards + Prominent Amber Turn Banner */}
        <section
          aria-label="Current trick"
          className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center gap-2 sm:gap-3 py-1"
        >
          {/* Crisp White Suit Pill (Matches Screenshot!) */}
          <div className="px-4 py-1 rounded-full bg-white text-[#1B1815] shadow-md text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 shrink-0">
            {ledSuit ? (
              <>
                <span>Suit:</span>
                <span
                  className={`text-base leading-none ${isRedSuit(ledSuit) ? 'text-[#C81E1E]' : 'text-[#141A21]'}`}
                >
                  {SUIT_SYMBOLS[ledSuit]}
                </span>
              </>
            ) : (
              <span>Trick {gameState.currentTrick.trickNumber} · Lead Suit</span>
            )}
          </div>

          {/* Center Played Cards */}
          <div className="w-full max-w-3xl flex flex-wrap items-center justify-center gap-2 sm:gap-3.5 min-h-[84px] sm:min-h-[104px]">
            {gameState.currentTrick.plays.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/25 bg-black/15 px-5 py-4 text-center text-xs sm:text-sm text-[#DCEBE0]">
                {gameState.isFirstTurnOfGame
                  ? 'Ace of Spades (A♠) leads Trick 1'
                  : `${activeTurnPlayer?.name ?? 'Leader'} starts Trick ${gameState.currentTrick.trickNumber}`}
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {gameState.currentTrick.plays.map((tp) => {
                  const owner = players.find((p) => p.id === tp.playerId);
                  const isHighest = highestLedPlay?.card.id === tp.card.id;
                  const isOffSuit = ledSuit !== null && tp.card.suit !== ledSuit;
                  const cardSize = gameState.currentTrick.plays.length >= 4 ? 'sm' : 'md';

                  return (
                    <motion.div
                      key={tp.card.id}
                      initial={{ opacity: 0, y: 14, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="flex flex-col items-center gap-1"
                    >
                      <PlayingCard card={tp.card} size={cardSize} highlighted={isHighest} />
                      <span className="text-[11px] font-semibold text-white/95 max-w-[74px] sm:max-w-[84px] truncate">
                        {owner?.name ?? 'Player'}
                      </span>
                      {isOffSuit && (
                        <span className="text-[10px] font-bold text-[#FCA5A5] leading-none">
                          Cut!
                        </span>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>

          {/* Prominent Warm Amber Turn Prompt Banner (Matches Screenshot image_1d270c3e.png!) */}
          {isPerspectivePlayersTurn ? (
            <div className="w-full max-w-md rounded-2xl bg-[#F0A500] text-[#1D1508] px-4 py-2.5 shadow-lg shrink-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display font-bold text-sm sm:text-base">
                  Your turn!
                  {displaySecondsLeft !== null ? ` · ${displaySecondsLeft}s` : ''}
                </span>
                {perspectivePlayer.consecutiveMissedTurns > 0 && (
                  <span className="text-[11px] font-bold bg-black/15 px-2 py-0.5 rounded-md">
                    Missed {perspectivePlayer.consecutiveMissedTurns}/3
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm font-medium mt-0.5 leading-snug">{turnSubtext}</p>
            </div>
          ) : (
            <div className="px-4 py-2 rounded-xl bg-[#13361F]/90 border border-white/15 text-xs sm:text-sm text-[#E5F2E9] text-center max-w-md shrink-0">
              {turnSubtext}
              {displaySecondsLeft !== null && activeTurnPlayer?.type === 'human' && (
                <span className="ml-2 font-mono text-[#F5C954] tabular-nums">
                  ({displaySecondsLeft}s)
                </span>
              )}
            </div>
          )}
        </section>

        {/* BOTTOM ZONE: Fanned Hand + Bottom Play Footer (Matches Screenshot!) */}
        <section aria-label="Your hand" className="relative z-20 shrink-0 w-full max-w-4xl mx-auto">
          {perspectivePlayer.removed ? (
            <div className="rounded-2xl bg-[#361414]/90 border border-[#E05252]/40 p-4 text-center text-sm text-[#FDE8E8]">
              You were removed from this ongoing game after 3 consecutive missed turns. You can join
              the next game once this round finishes.
            </div>
          ) : perspectivePlayer.finished ? (
            <div className="rounded-2xl bg-[#133A22]/90 border border-[#86EFAC]/35 p-4 text-center text-sm text-[#E5F5EA]">
              You finished safe in{' '}
              <strong className="text-[#F5C954]">#{perspectivePlayer.finishOrder}</strong> place!
              Watching the remaining players finish.
            </div>
          ) : (
            <>
              {/* Fanned Playing Cards */}
              <div className="w-full overflow-x-auto no-scrollbar pt-4 pb-1.5 px-2">
                <div
                  className={`flex items-end justify-start sm:justify-center min-w-max mx-auto ${
                    sortedHand.length > 10
                      ? '-space-x-7 sm:-space-x-5'
                      : '-space-x-5 sm:-space-x-4'
                  }`}
                >
                  {sortedHand.map((card) => {
                    const playable = isPerspectivePlayersTurn && legalCardIds.has(card.id);
                    const dimmed = isPerspectivePlayersTurn && !playable;
                    const isSelected = selectedCardId === card.id;

                    return (
                      <div
                        key={card.id}
                        className={`transition-all ${isSelected ? 'z-30' : 'hover:z-20'}`}
                      >
                        <PlayingCard
                          card={card}
                          size="lg"
                          playable={playable}
                          selected={isSelected}
                          dimmed={dimmed}
                          highlighted={playable && !isSelected}
                          onClick={() => handleCardTap(card)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bottom Footer Bar: Player Name & Count + Large Rounded Play Button */}
              <div className="mt-1 flex items-center justify-between gap-4 px-1">
                <div className="min-w-0">
                  <div className="text-sm sm:text-base font-bold text-white truncate">
                    {perspectivePlayer.name}:{' '}
                    <span className="tabular-nums">{perspectivePlayer.cardCount}</span>
                  </div>
                  <div className="text-xs text-[#C4DEC9]">
                    {perspectivePlayer.cardCount === 1 ? 'card' : 'cards'}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!isPerspectivePlayersTurn || !selectedCard}
                  onClick={handleConfirmPlay}
                  className={`min-h-[48px] sm:min-h-[52px] min-w-[156px] sm:min-w-[200px] px-6 sm:px-7 py-2.5 sm:py-3 rounded-full font-display font-bold text-base sm:text-lg flex items-center justify-center gap-2 transition-all ${
                    isPerspectivePlayersTurn && selectedCard
                      ? 'btn-orange-3d cursor-pointer'
                      : 'bg-[#6F5841]/75 text-[#D8C5B0] cursor-not-allowed'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                    <ArrowUp className="w-4 h-4" />
                  </span>
                  {selectedCard ? `Play ${formatCard(selectedCard)}` : 'Play'}
                </button>
              </div>
            </>
          )}
        </section>
      </main>

      {/* Non-Blocking Successful / Failed Trick Notification Banner */}
      <AnimatePresence>
        {gameState.phase === 'trick_result' && gameState.lastOutcome && (
          <TrickOutcomeNotification
            outcome={gameState.lastOutcome}
            players={players}
            autoAdvance={isOnline ? true : settings.autoAdvanceTricks}
            durationMs={trickNotificationDurationMs}
            onContinue={onContinueTrick}
          />
        )}
      </AnimatePresence>

      {/* Pass-and-Play Privacy Handoff Curtain */}
      {needsPrivacyCurtain && activeTurnPlayer && (
        <div
          className="fixed inset-0 z-30 bg-[#102E1B]/96 backdrop-blur-xs flex items-center justify-center p-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-3xl bg-[#FAF5ED] text-[#261E18] p-7 text-center shadow-2xl">
            <div
              className="w-14 h-14 mx-auto rounded-full flex items-center justify-center font-display text-xl font-bold"
              style={{ backgroundColor: activeTurnPlayer.avatarColor }}
            >
              {activeTurnPlayer.name.slice(0, 1).toUpperCase()}
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold">
              Pass Device to {activeTurnPlayer.name}
            </h2>
            <p className="mt-2 text-sm text-[#6E6052]">
              Turn timer is paused until you tap below.
            </p>
            <button
              type="button"
              onClick={() => setRevealedPlayerId(activeTurnPlayer.id)}
              className="mt-6 w-full min-h-[50px] px-5 py-3 rounded-full btn-orange-3d font-bold text-base cursor-pointer"
            >
              Show {activeTurnPlayer.name}’s Hand
            </button>
            <button
              type="button"
              onClick={onToggleOpenHands}
              className="mt-3 w-full py-2 text-xs font-semibold text-[#5C4E41] hover:text-[#D95732] cursor-pointer"
            >
              Switch to Open Hands (Testing Mode)
            </button>
          </div>
        </div>
      )}

      {/* Voluntary Exit Confirmation Modal (Only reachable between tricks per Section 10) */}
      {confirmLeave && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-3xl bg-[#FAF5ED] text-[#261E18] p-6 shadow-2xl">
            <h2 className="font-display text-xl font-bold">Exit Game Between Tricks?</h2>
            <p className="mt-2 text-sm text-[#5C4E41] leading-relaxed">
              Your remaining cards will be shuffled and distributed clockwise among the remaining
              active players so the game can continue fairly.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#EFE6D8] text-[#261E18] text-sm font-semibold cursor-pointer"
              >
                Keep Playing
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmLeave(false);
                  onVoluntaryExit();
                }}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#D95732] text-white text-sm font-bold cursor-pointer"
              >
                Exit Game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
