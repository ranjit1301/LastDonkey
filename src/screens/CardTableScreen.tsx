import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  BookOpen,
  Bot,
  Eye,
  EyeOff,
  Flag,
  Layers,
  LogOut,
  Settings,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  canFinishPracticeSessionEarly,
  DIFFICULTY_META,
  formatCard,
  getMediumStrategicHint,
  isRedSuit,
  sortHand,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  type Card,
  type DifficultyMode,
  type GameState,
} from '../engine';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { DiscardedCardTracker } from '../components/DiscardedCardTracker';
import { MediumAssistBar } from '../components/MediumAssistBar';
import { PlayerHandTray } from '../components/PlayerHandTray';
import { PlayingCard } from '../components/PlayingCard';
import { TrickOutcomeNotification } from '../components/TrickOutcomeNotification';
import {
  resolvePassAndPlayPerspectivePlayer,
  shouldHidePassAndPlayHand,
  shouldShowPassAndPlayPrivacyCurtain,
} from '../lib/localExit';
import { deriveTableTurnState } from '../lib/tableTurnState';
import {
  buildTurnKey,
  EMPTY_LOCAL_TURN_TIMER,
  getRemainingSeconds,
  isTimerExpired,
  syncLocalTurnTimer,
  type LocalTurnTimerState,
} from '../lib/turnTimer';
import type { ConnectionStatusInfo } from '../lib/multiplayerClient';
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

interface CardTableScreenProps {
  gameState: UnifiedGameState;
  settings: AppSettings;
  roomCode: string;
  isOnline: boolean;
  onlineRoom?: ClientRoomState | null;
  connectionInfo?: ConnectionStatusInfo;
  onRetryReconnect?: () => void;
  onReturnHome?: () => void;
  trickNotificationDurationMs: number;
  onPlayCard: (playerId: string, cardId: string) => void;
  onLocalMissedTurn?: (playerId: string) => void;
  onLocalTurnDeadlineChange?: (deadlineAt: number | null) => void;
  onContinueTrick: () => void;
  onToggleSound: () => void;
  onToggleOpenHands: () => void;
  onOpenRules: () => void;
  onOpenSettings: () => void;
  onVoluntaryExit: (exitingPlayerId?: string) => void;
  isPracticeVsBots?: boolean;
  onFinishPracticeEarly?: () => void;
  onOnlineRespondHostTransfer?: (accept: boolean) => void;
}

export const CardTableScreen: React.FC<CardTableScreenProps> = ({
  gameState,
  settings,
  roomCode,
  isOnline,
  onlineRoom,
  connectionInfo = { status: 'connected', attempt: 0 },
  onRetryReconnect,
  onReturnHome,
  trickNotificationDurationMs,
  onPlayCard,
  onLocalMissedTurn,
  onLocalTurnDeadlineChange,
  onContinueTrick,
  onToggleSound,
  onToggleOpenHands,
  onOpenRules,
  onOpenSettings,
  onVoluntaryExit,
  isPracticeVsBots = false,
  onFinishPracticeEarly,
  onOnlineRespondHostTransfer,
}) => {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [revealedPlayerId, setRevealedPlayerId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmFinishPractice, setConfirmFinishPractice] = useState(false);
  const [discardDrawerOpen, setDiscardDrawerOpen] = useState(false);
  const [ruleNotice, setRuleNotice] = useState<string | null>(null);
  const [localTimerState, setLocalTimerState] =
    useState<LocalTurnTimerState>(EMPTY_LOCAL_TURN_TIMER);
  const firedTimeoutTurnKeyRef = useRef<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const difficulty: DifficultyMode = gameState.difficulty ?? 'easy';
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
      return resolvePassAndPlayPerspectivePlayer({
        phase: gameState.phase,
        activeTurnPlayer,
        nextLeaderId: gameState.lastOutcome?.nextLeaderId ?? null,
        players,
        revealedPlayerId,
      });
    }
    return humanPlayers[0] ?? players[0];
  }, [
    isOnline,
    onlineRoom,
    isPassAndPlay,
    gameState.phase,
    gameState.lastOutcome?.nextLeaderId,
    activeTurnPlayer,
    players,
    revealedPlayerId,
    humanPlayers,
  ]);

  // Clear selection and any inline rule reminder whenever turn or trick changes
  useEffect(() => {
    setSelectedCardId(null);
    setRuleNotice(null);
  }, [gameState.currentTurnPlayerId, gameState.currentTrick.trickNumber, gameState.phase]);

  // Pass-and-play privacy curtain & reset whenever revealed player exits/finishes or another human is up
  useEffect(() => {
    if (!isPassAndPlay || settings.openHandsTesting) {
      setRevealedPlayerId(null);
      return;
    }
    if (revealedPlayerId) {
      const revealedSeat = players.find((p) => p.id === revealedPlayerId);
      if (!revealedSeat || revealedSeat.removed || revealedSeat.finished) {
        setRevealedPlayerId(null);
        return;
      }
    }
    if (activeTurnPlayer?.type === 'human' && revealedPlayerId !== activeTurnPlayer.id) {
      setRevealedPlayerId(null);
    }
  }, [
    activeTurnPlayer?.id,
    activeTurnPlayer?.type,
    isPassAndPlay,
    players,
    settings.openHandsTesting,
    revealedPlayerId,
  ]);

  const needsPrivacyCurtain = shouldShowPassAndPlayPrivacyCurtain({
    isPassAndPlay,
    openHandsTesting: settings.openHandsTesting,
    phase: gameState.phase,
    activeTurnPlayer,
    revealedPlayerId,
  });

  const hidePassAndPlayHand = shouldHidePassAndPlayHand({
    isPassAndPlay,
    openHandsTesting: settings.openHandsTesting,
    phase: gameState.phase,
    activeTurnPlayer,
    perspectivePlayer,
    revealedPlayerId,
  });

  // Opponents in clockwise order after perspectivePlayer
  const opponents = useMemo(() => {
    const startIdx = players.findIndex((p) => p.id === perspectivePlayer.id);
    const ordered: UnifiedPlayer[] = [];
    for (let offset = 1; offset < players.length; offset++) {
      ordered.push(players[(startIdx + offset) % players.length]);
    }
    return ordered;
  }, [players, perspectivePlayer.id]);

  // Single authoritative turn & card-selection state (matches server-side getLegalCards rules)
  const turnState = useMemo(
    () =>
      deriveTableTurnState({
        gameState,
        perspectivePlayer,
        activeTurnPlayer,
        selectedCardId,
        isOnline,
        onlineRoom,
        connectionStatus: connectionInfo.status,
        needsPrivacyCurtain,
      }),
    [
      gameState,
      perspectivePlayer,
      activeTurnPlayer,
      selectedCardId,
      isOnline,
      onlineRoom,
      connectionInfo.status,
      needsPrivacyCurtain,
    ]
  );

  // Clear stale or invalid selection immediately on turn/trick/suit/phase/connection changes
  useEffect(() => {
    if (!turnState.canActNow) {
      setSelectedCardId(null);
      setRuleNotice(null);
      return;
    }
    if (selectedCardId !== null && !turnState.legalCardIds.has(selectedCardId)) {
      setSelectedCardId(null);
    }
  }, [
    turnState.canActNow,
    turnState.legalCardIds,
    selectedCardId,
    gameState.currentTurnPlayerId,
    gameState.currentTrick.trickNumber,
    gameState.currentTrick.ledSuit,
    gameState.phase,
  ]);

  // Section 10: Exit Game is DISABLED mid-trick for active players;
  // officially finished (or already removed) online players can exit anytime without affecting the game.
  const isFinishedOnlineExit =
    isOnline && (perspectivePlayer.finished || perspectivePlayer.removed);
  const canActivePassAndPlayExit =
    !isPassAndPlay ||
    (perspectivePlayer.type === 'human' && !perspectivePlayer.finished && !perspectivePlayer.removed);
  const exitAllowedNow =
    isFinishedOnlineExit ||
    (canActivePassAndPlayExit &&
      (gameState.phase === 'finished' ||
        gameState.phase === 'trick_result' ||
        gameState.currentTrick.plays.length === 0));

  // Practice vs Bots only: allow finishing the practice session early ONLY after official finish confirmation
  const canFinishPracticeEarly = useMemo(
    () =>
      !isOnline &&
      !isPassAndPlay &&
      Boolean(onFinishPracticeEarly) &&
      canFinishPracticeSessionEarly(
        { phase: gameState.phase, players },
        perspectivePlayer.id,
        isPracticeVsBots
      ),
    [
      isOnline,
      isPassAndPlay,
      onFinishPracticeEarly,
      gameState.phase,
      players,
      perspectivePlayer.id,
      isPracticeVsBots,
    ]
  );

  // Close the early-finish dialog automatically if the practice match ends naturally
  useEffect(() => {
    if (!canFinishPracticeEarly) {
      setConfirmFinishPractice(false);
    }
  }, [canFinishPracticeEarly]);

  // Escape key dismisses active confirmation modals cleanly for keyboard users
  useEffect(() => {
    if (!confirmLeave && !confirmFinishPractice) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConfirmLeave(false);
        setConfirmFinishPractice(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmLeave, confirmFinishPractice]);

  // Server deadline ticker for online rooms (authoritative on server)
  useEffect(() => {
    if (!isOnline || !onlineRoom?.turnDeadlineAt) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [isOnline, onlineRoom?.turnDeadlineAt]);

  // Deadline-based local turn timer (preserves exact remaining time across Rules/Settings overlays)
  const localTurnKey = !isOnline ? buildTurnKey(gameState) : null;
  const localTimerEligible = !isOnline && turnState.canActNow;

  useEffect(() => {
    if (isOnline) {
      setLocalTimerState(EMPTY_LOCAL_TURN_TIMER);
      return;
    }
    const now = Date.now();
    setNowMs(now);
    setLocalTimerState((prev) =>
      syncLocalTurnTimer(prev, {
        turnKey: localTurnKey,
        playerId: perspectivePlayer.id,
        timerEligible: localTimerEligible,
        turnTimerSeconds: settings.turnTimerSeconds,
        nowMs: now,
      })
    );
  }, [
    isOnline,
    localTurnKey,
    perspectivePlayer.id,
    localTimerEligible,
    settings.turnTimerSeconds,
  ]);

  useEffect(() => {
    onLocalTurnDeadlineChange?.(isOnline ? null : localTimerState.deadlineAt);
  }, [isOnline, localTimerState.deadlineAt, onLocalTurnDeadlineChange]);

  useEffect(() => {
    firedTimeoutTurnKeyRef.current = null;
  }, [localTimerState.turnKey]);

  useEffect(() => {
    if (isOnline || !localTimerState.deadlineAt || !localTimerState.turnKey || !localTimerState.playerId) {
      return;
    }

    const checkTick = () => {
      const now = Date.now();
      setNowMs(now);
      if (
        isTimerExpired(localTimerState.deadlineAt, now) &&
        firedTimeoutTurnKeyRef.current !== localTimerState.turnKey
      ) {
        firedTimeoutTurnKeyRef.current = localTimerState.turnKey;
        onLocalMissedTurn?.(localTimerState.playerId!);
      }
    };

    checkTick();
    const id = window.setInterval(checkTick, 250);
    return () => window.clearInterval(id);
  }, [
    isOnline,
    localTimerState.deadlineAt,
    localTimerState.turnKey,
    localTimerState.playerId,
    onLocalMissedTurn,
  ]);

  const displaySecondsLeft: number | null = useMemo(() => {
    if (isOnline) {
      if (!onlineRoom?.turnDeadlineAt || gameState.phase !== 'playing') return null;
      return getRemainingSeconds(onlineRoom.turnDeadlineAt, nowMs);
    }
    if (!localTimerState.deadlineAt || gameState.phase !== 'playing') return null;
    return getRemainingSeconds(localTimerState.deadlineAt, nowMs);
  }, [isOnline, onlineRoom?.turnDeadlineAt, gameState.phase, nowMs, localTimerState.deadlineAt]);

  const sortedHand = useMemo(
    () => sortHand(perspectivePlayer.hand, settings.sortOrder),
    [perspectivePlayer.hand, settings.sortOrder]
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

  const mediumHint = useMemo(
    () =>
      difficulty === 'medium' ? getMediumStrategicHint(gameState, perspectivePlayer.id) : null,
    [difficulty, gameState, perspectivePlayer.id]
  );

  const handleCardTap = (card: Card) => {
    if (!turnState.canActNow) return;
    if (!turnState.legalCardIds.has(card.id)) {
      if (gameState.isFirstTurnOfGame) {
        setRuleNotice('Play the Ace of Spades (A♠) to start the game.');
      } else if (gameState.currentTrick.ledSuit) {
        setRuleNotice(
          `You must follow ${SUIT_NAMES[gameState.currentTrick.ledSuit]} (${SUIT_SYMBOLS[gameState.currentTrick.ledSuit]}).`
        );
      }
      return;
    }
    setRuleNotice(null);
    if (settings.playTapMode === 'single-tap') {
      onPlayCard(perspectivePlayer.id, card.id);
      return;
    }
    if (turnState.validSelectedCard?.id === card.id) {
      onPlayCard(perspectivePlayer.id, card.id);
      setSelectedCardId(null);
    } else {
      setSelectedCardId(card.id);
    }
  };

  const handleConfirmPlay = () => {
    if (!turnState.canPlaySelectedCard || !turnState.validSelectedCard) return;
    setRuleNotice(null);
    onPlayCard(perspectivePlayer.id, turnState.validSelectedCard.id);
    setSelectedCardId(null);
  };

  const ledSuit = gameState.currentTrick.ledSuit;

  return (
    <div className="min-h-screen h-[100dvh] flex flex-col felt-surface overflow-hidden">
      {/* Top Wooden/Forest Header Bar */}
      <header className="shrink-0 walnut-rail px-2.5 sm:px-5 py-1.5 sm:py-2 flex items-center justify-between gap-1.5 sm:gap-2 z-20">
        {/* Left: Exit Button (Disabled Mid-Trick per Section 10) + Room Code */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
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
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors shrink-0 ${
              exitAllowedNow
                ? 'bg-[#214D2F] text-[#F5F2E8] hover:bg-[#2C643E] cursor-pointer'
                : 'bg-[#173621] text-[#6B8B74] opacity-55 cursor-not-allowed'
            }`}
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
          </button>

          <span className="font-mono font-bold tracking-[0.1em] sm:tracking-[0.14em] text-xs sm:text-base text-[#F5F2E8] whitespace-nowrap truncate">
            {roomCode}
          </span>

          <span
            className={`hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide border whitespace-nowrap ${
              difficulty === 'easy'
                ? 'bg-[#1D5631] text-[#D2F5DD] border-[#6EE7B7]/30'
                : difficulty === 'medium'
                  ? 'bg-[#4E380B] text-[#FDE68A] border-[#F0B429]/35'
                  : 'bg-[#571F17] text-[#FED7D2] border-[#F87171]/35'
            }`}
          >
            {DIFFICULTY_META[difficulty].label}
          </span>
        </div>

        {/* Center/Right: Easy Mobile Discards Toggle + Out Count Pill + Utility Icons */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {difficulty === 'easy' && (
            <button
              type="button"
              onClick={() => setDiscardDrawerOpen(true)}
              aria-label={`Open discarded cards tracker (${gameState.removedCards.length} discarded)`}
              className="lg:hidden min-h-[36px] px-2.5 sm:px-3 py-1.5 rounded-full bg-[#1C4D2D] hover:bg-[#246038] border border-[#F0B429]/45 text-[11px] sm:text-xs font-semibold text-[#FDF3D1] inline-flex items-center gap-1 cursor-pointer tabular-nums"
            >
              <Layers className="w-3.5 h-3.5 text-[#F0B429] shrink-0" aria-hidden="true" />
              <span className="hidden min-[360px]:inline">Discards:</span>
              <span>{gameState.removedCards.length}</span>
            </button>
          )}

          {difficulty !== 'hard' && (
            <div
              className={`${
                difficulty === 'easy' ? 'hidden lg:inline-flex' : 'inline-flex'
              } px-2.5 sm:px-3 py-1.5 rounded-full bg-[#13331E] border border-white/10 text-xs font-semibold text-[#E8F2EB] items-center gap-1.5 tabular-nums`}
            >
              <Trash2 className="w-3.5 h-3.5 text-[#F0B429]" aria-hidden="true" />
              <span>Out: {gameState.removedCards.length}</span>
            </div>
          )}

          {isPassAndPlay && (
            <button
              type="button"
              onClick={onToggleOpenHands}
              aria-label="Toggle open hands testing"
              aria-pressed={settings.openHandsTesting}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                settings.openHandsTesting
                  ? 'bg-[#F0B429] text-[#1D160B]'
                  : 'bg-[#13331E] text-[#D8E8DD] hover:text-white'
              }`}
            >
              {settings.openHandsTesting ? (
                <Eye className="w-4 h-4" aria-hidden="true" />
              ) : (
                <EyeOff className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleSound}
            aria-label={settings.soundEnabled ? 'Mute sound' : 'Unmute sound'}
            aria-pressed={settings.soundEnabled}
            className="w-9 h-9 rounded-full bg-[#13331E] text-[#D8E8DD] hover:text-white flex items-center justify-center cursor-pointer"
          >
            {settings.soundEnabled ? (
              <Volume2 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <VolumeX className="w-4 h-4 opacity-60" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenRules}
            aria-label="How to play"
            className="w-9 h-9 rounded-full bg-[#13331E] text-[#D8E8DD] hover:text-white flex items-center justify-center cursor-pointer"
          >
            <BookOpen className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="w-9 h-9 rounded-full bg-[#13331E] text-[#D8E8DD] hover:text-white flex items-center justify-center cursor-pointer"
          >
            <Settings className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Connection Status Banner (Connecting / Reconnecting / Failed) */}
      {isOnline && connectionInfo.status !== 'connected' && (
        <ConnectionBanner
          connectionInfo={connectionInfo}
          variant="table"
          onRetryNow={onRetryReconnect}
          onReturnHome={onReturnHome}
        />
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

      {/* Body Wrapper: Table Felt + Desktop Easy Mode Discarded-Card Sidebar */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Main Table Felt Body */}
        <main className="flex-1 min-w-0 min-h-0 relative flex flex-col justify-between gap-2 px-2.5 sm:px-6 py-2 overflow-y-auto">
        {/* TOP OPPONENTS GRID — Sleek compact horizontal cards so all 1 to 5 opponents fit with generous breathing room */}
        <section aria-label="Opponents" className="relative z-10 shrink-0 w-full mx-auto">
          <div
            className={
              opponents.length === 1
                ? 'grid grid-cols-1 max-w-[220px] mx-auto gap-2'
                : opponents.length === 2
                  ? 'grid grid-cols-2 max-w-md mx-auto gap-2'
                  : opponents.length === 3
                    ? 'grid grid-cols-3 max-w-2xl mx-auto gap-1.5 sm:gap-2'
                    : opponents.length === 4
                      ? 'grid grid-cols-2 sm:grid-cols-4 max-w-4xl mx-auto gap-1.5 sm:gap-2'
                      : 'grid grid-cols-6 sm:grid-cols-5 max-w-5xl mx-auto gap-1.5 sm:gap-2'
            }
          >
            {opponents.map((opp, idx) => {
              const isTurn =
                gameState.phase === 'playing' && gameState.currentTurnPlayerId === opp.id;
              const playedThisTrick = gameState.currentTrick.plays.some(
                (tp) => tp.playerId === opp.id
              );
              const spanClass =
                opponents.length === 5
                  ? idx < 3
                    ? 'col-span-2 sm:col-span-1'
                    : 'col-span-3 sm:col-span-1'
                  : '';

              return (
                <div
                  key={opp.id}
                  className={`${spanClass} min-w-0 rounded-xl sm:rounded-2xl transition-all border px-2 py-1.5 sm:px-2.5 sm:py-2 flex flex-row items-center gap-2 text-left ${
                    opp.removed
                      ? 'bg-[#122D1C]/50 border-white/10 opacity-55'
                      : opp.finished
                        ? 'bg-[#143D24]/75 border-[#86EFAC]/40 opacity-85'
                        : isTurn
                          ? 'bg-[#26693D] border-[#F0B429] ring-1 ring-[#F0B429]/60 shadow-[0_0_16px_rgba(240,180,41,0.35)]'
                          : 'bg-[#174226]/88 border-white/12'
                  }`}
                >
                  <div className="relative shrink-0">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-display text-xs sm:text-sm font-bold border-2 ${
                        isTurn ? 'border-[#F0B429]' : 'border-white/25'
                      }`}
                      style={{
                        backgroundColor: opp.type === 'bot' ? '#244E32' : opp.avatarColor,
                        color: opp.type === 'bot' ? '#FFFFFF' : '#1E170F',
                      }}
                    >
                      {opp.type === 'bot' ? (
                        <Bot className="w-4 h-4" />
                      ) : (
                        opp.name.slice(0, 1).toUpperCase()
                      )}
                    </div>
                    {isTurn && (
                      <span
                        aria-hidden="true"
                        className="turn-dot-pulse absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#F5C954] ring-2 ring-[#26693D]"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div
                      className="text-xs sm:text-sm font-bold text-white truncate leading-tight"
                      title={opp.name}
                    >
                      {opp.name}
                    </div>

                    <div className="mt-0.5 text-[11px] font-medium text-[#CFE2D5] tabular-nums flex items-center justify-start gap-1 flex-wrap leading-tight">
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

                      {!opp.finished && !opp.removed && isTurn && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#F5C954] text-[#1D1508] text-[10px] font-extrabold uppercase tracking-wide">
                          Turn
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

        {/* MEDIUM MODE ONLY: Exact Remaining Suit Counts + Occasional Unobtrusive Hint */}
        {difficulty === 'medium' && (
          <MediumAssistBar removedCards={gameState.removedCards} hint={mediumHint} />
        )}

        {/* CENTER BATTLE ZONE: Suit Pill + Played Cards + Single Inline Status / Trick Outcome Slot */}
        <section
          aria-label="Current trick"
          className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center gap-2 sm:gap-2.5 py-1"
        >
          {/* Crisp White Suit Pill */}
          <div className="px-3.5 py-0.5 rounded-full bg-white text-[#1B1815] shadow-md text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 shrink-0">
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
          <div className="w-full max-w-3xl flex flex-wrap items-center justify-center gap-2 sm:gap-3 min-h-[80px] sm:min-h-[96px]">
            {gameState.currentTrick.plays.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/25 bg-black/15 px-5 py-3.5 text-center text-xs sm:text-sm text-[#DCEBE0]">
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
                      <PlayingCard
                        card={tp.card}
                        size={cardSize}
                        highlighted={difficulty !== 'hard' && isHighest}
                      />
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

          {/* Single Clean Inline Status Slot (Trick Outcome OR Turn Indicator — never stacked/overlapping!) */}
          <AnimatePresence mode="wait">
            {gameState.phase === 'trick_result' && gameState.lastOutcome ? (
              <TrickOutcomeNotification
                key={`trick-outcome-${gameState.lastOutcome.trickNumber}`}
                outcome={gameState.lastOutcome}
                players={players}
                autoAdvance={isOnline ? true : settings.autoAdvanceTricks}
                durationMs={trickNotificationDurationMs}
                isServerControlled={isOnline}
                onContinue={isOnline ? undefined : onContinueTrick}
              />
            ) : turnState.turnBanner.showYourTurnHighlight ? (
              <div
                key="your-turn-banner"
                role="status"
                aria-live="polite"
                data-testid="your-turn-banner"
                className="w-full max-w-lg rounded-2xl bg-gradient-to-r from-[#F5B700] via-[#F0A500] to-[#F5B700] border-2 border-[#FFF3BF] text-[#1A1205] px-3.5 py-2 shadow-[0_8px_24px_-4px_rgba(245,183,0,0.48)] shrink-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      aria-hidden="true"
                      className="turn-dot-pulse w-2.5 h-2.5 rounded-full bg-[#1B4D2B] ring-2 ring-[#FFF6D6] shrink-0"
                    />
                    <span className="font-display font-extrabold text-sm sm:text-base tracking-wide uppercase shrink-0">
                      {turnState.turnBanner.headline}
                    </span>
                    <span className="hidden sm:inline text-xs font-semibold text-[#261A07]/90 truncate">
                      · {turnState.turnBanner.subtext}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {perspectivePlayer.consecutiveMissedTurns > 0 && (
                      <span className="text-[11px] font-bold bg-black/15 px-2 py-0.5 rounded-md">
                        Missed {perspectivePlayer.consecutiveMissedTurns}/3
                      </span>
                    )}
                    {displaySecondsLeft !== null && (
                      <span
                        aria-label={`${displaySecondsLeft} seconds remaining`}
                        className={`font-mono font-bold text-xs px-2.5 py-0.5 rounded-full tabular-nums ${
                          displaySecondsLeft <= 5
                            ? 'bg-[#991B1B] text-white'
                            : 'bg-[#1D1508]/90 text-[#FFF4CC]'
                        }`}
                      >
                        {displaySecondsLeft}s
                      </span>
                    )}
                  </div>
                </div>
                <p className="sm:hidden text-xs font-semibold mt-0.5 leading-snug text-[#261A07]">
                  {turnState.turnBanner.subtext}
                </p>
              </div>
            ) : turnState.turnBanner.mode === 'reconnecting_your_turn' ? (
              <div
                key="reconnecting-banner"
                role="status"
                aria-live="polite"
                className="w-full max-w-md px-4 py-1.5 rounded-2xl bg-[#2E2410]/95 border border-[#F0B429]/55 text-[#FEF3C7] text-center shrink-0"
              >
                <div className="text-xs sm:text-sm font-bold">{turnState.turnBanner.headline}</div>
                <p className="text-[11px] text-[#FDE68A]/90">{turnState.turnBanner.subtext}</p>
              </div>
            ) : turnState.turnBanner.mode === 'other_turn' ? (
              <div
                key="other-turn-banner"
                role="status"
                aria-live="polite"
                data-testid="other-turn-banner"
                className="w-full max-w-md px-3.5 py-1.5 rounded-2xl bg-[#13361F]/92 border border-white/18 text-[#E5F2E9] shrink-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      aria-hidden="true"
                      className="turn-dot-pulse w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: turnState.turnBanner.activePlayerColor ?? '#F5C954',
                      }}
                    />
                    <span className="font-display font-bold text-xs sm:text-sm text-white truncate">
                      {turnState.turnBanner.headline}
                    </span>
                    <span className="hidden sm:inline text-xs text-[#CFE2D5] truncate">
                      · {turnState.turnBanner.subtext}
                    </span>
                  </div>
                  {displaySecondsLeft !== null && activeTurnPlayer?.type === 'human' && (
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-full bg-black/25 text-[#F5C954] tabular-nums shrink-0">
                      {displaySecondsLeft}s
                    </span>
                  )}
                </div>
                <p className="sm:hidden text-[11px] text-[#CFE2D5] mt-0.5 leading-snug">
                  {turnState.turnBanner.subtext}
                </p>
              </div>
            ) : (
              <div
                key="fallback-status"
                role="status"
                aria-live="polite"
                className="px-4 py-1.5 rounded-xl bg-[#13361F]/90 border border-white/15 text-xs sm:text-sm text-[#E5F2E9] text-center max-w-md shrink-0"
              >
                {turnState.turnBanner.headline}
              </div>
            )}
          </AnimatePresence>
        </section>

        {/* BOTTOM ZONE: Fanned Hand + Bottom Play Footer (Matches Screenshot!) */}
        <section aria-label="Your hand" className="relative z-20 shrink-0 w-full max-w-4xl mx-auto">
          {perspectivePlayer.removed ? (
            <div className="rounded-2xl bg-[#361414]/90 border border-[#E05252]/40 p-4 text-center text-sm text-[#FDE8E8]">
              You were removed from this ongoing game after 3 consecutive missed turns. You can join
              the next game once this round finishes.
            </div>
          ) : perspectivePlayer.finished ? (
            <div className="rounded-2xl bg-[#133A22]/92 border border-[#86EFAC]/35 p-4 text-center text-sm text-[#E5F5EA] flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-center sm:text-left">
                You finished safe in{' '}
                <strong className="text-[#F5C954]">#{perspectivePlayer.finishOrder}</strong> place!{' '}
                {canFinishPracticeEarly
                  ? 'You can finish this practice game now or keep watching the bots.'
                  : 'Watching the remaining players finish.'}
              </div>
              {canFinishPracticeEarly && (
                <button
                  type="button"
                  onClick={() => setConfirmFinishPractice(true)}
                  className="shrink-0 min-h-[44px] px-5 py-2.5 rounded-full btn-orange-3d font-display font-bold text-sm inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Flag className="w-4 h-4" />
                  Finish Game
                </button>
              )}
            </div>
          ) : hidePassAndPlayHand ? (
            <div className="rounded-2xl bg-[#13361F]/88 border border-white/15 p-4 text-center text-sm text-[#D7E8DC]">
              {gameState.phase === 'trick_result'
                ? 'Trick resolved — cards stay hidden until the next player takes the device.'
                : activeTurnPlayer?.type === 'bot'
                  ? `Cards hidden while ${activeTurnPlayer.name} plays.`
                  : 'Pass the device to the next player to view their hand.'}
            </div>
          ) : (
            <div
              data-active-turn={turnState.canActNow ? 'true' : 'false'}
              className={`rounded-2xl sm:rounded-3xl border px-2.5 sm:px-3.5 pt-2 pb-2 transition-all ${
                turnState.canActNow
                  ? 'turn-area-active'
                  : 'border-white/12 bg-[#10301C]/45'
              }`}
            >
              {ruleNotice && (
                <p
                  role="alert"
                  className="text-center text-xs font-semibold text-[#FDE68A] mb-1"
                >
                  {ruleNotice}
                </p>
              )}

              {/* Progressive Large-Hand Tray with Scroll Controls, Suit-Jump & Auto-Scroll */}
              <PlayerHandTray
                sortedHand={sortedHand}
                ledSuit={ledSuit}
                canActNow={turnState.canActNow}
                isFirstTurnOfGame={gameState.isFirstTurnOfGame}
                turnContextKey={`${gameState.currentTrick.trickNumber}:${gameState.currentTurnPlayerId ?? 'none'}:${gameState.phase}`}
                legalCardIds={turnState.legalCardIds}
                selectedCardId={turnState.validSelectedCard?.id ?? null}
                getCardSelectionState={turnState.getCardSelectionState}
                onCardTap={handleCardTap}
              />

              {/* Bottom Footer Bar: Player Name, Turn Status & Prominent Play Button */}
              <div className="mt-1 flex items-center justify-between gap-2.5 sm:gap-4 px-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm sm:text-base font-bold text-white truncate">
                      {perspectivePlayer.name}:{' '}
                      <span className="tabular-nums">{perspectivePlayer.cardCount}</span>
                    </span>
                    {turnState.canActNow && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F5C954] text-[#1A1205] text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider shadow-sm shrink-0">
                        <span
                          aria-hidden="true"
                          className="turn-dot-pulse w-1.5 h-1.5 rounded-full bg-[#1B4D2B]"
                        />
                        Your Turn
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#C4DEC9]">
                    {perspectivePlayer.cardCount === 1 ? 'card' : 'cards'}
                    {turnState.canActNow && (
                      <span className="ml-1.5 text-[#FDE68A] font-semibold">
                        · {turnState.legalCards.length} playable
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!turnState.canPlaySelectedCard}
                  onClick={handleConfirmPlay}
                  className={`min-h-[44px] sm:min-h-[46px] min-w-[140px] sm:min-w-[196px] px-4 sm:px-6 py-2 rounded-full font-display font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-all shrink-0 ${
                    turnState.canPlaySelectedCard
                      ? 'btn-orange-3d ring-2 ring-[#FDE68A]/90 shadow-[0_4px_0_#A83C1E,0_0_22px_rgba(245,190,48,0.48)] cursor-pointer'
                      : turnState.canActNow
                        ? 'bg-[#225433] border-2 border-[#F5C954]/65 text-[#FEF3C7] cursor-not-allowed'
                        : 'bg-[#163621]/80 border border-white/10 text-[#9CB8A5] cursor-not-allowed'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      turnState.canPlaySelectedCard
                        ? 'bg-white/25'
                        : turnState.canActNow
                          ? 'bg-[#F5C954]/20 text-[#F5C954]'
                          : 'bg-white/10'
                    }`}
                  >
                    <ArrowUp className="w-4 h-4" aria-hidden="true" />
                  </span>
                  {turnState.validSelectedCard
                    ? `Play ${formatCard(turnState.validSelectedCard)}`
                    : turnState.canActNow
                      ? 'Select a Card'
                      : 'Play'}
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* EASY MODE ONLY: Desktop Permanent Discarded-Card Sidebar */}
      {difficulty === 'easy' && (
        <DiscardedCardTracker removedCards={gameState.removedCards} variant="sidebar" />
      )}
      </div>

      {/* EASY MODE ONLY: Mobile Collapsible Discarded-Card Drawer */}
      {difficulty === 'easy' && (
        <DiscardedCardTracker
          removedCards={gameState.removedCards}
          variant="drawer"
          open={discardDrawerOpen}
          onClose={() => setDiscardDrawerOpen(false)}
        />
      )}

      {/* Pass-and-Play Privacy Handoff Curtain */}
      {needsPrivacyCurtain && activeTurnPlayer && (
        <div
          className="fixed inset-0 z-30 bg-[#102E1B]/96 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="privacy-curtain-title"
        >
          <div className="w-full max-w-sm max-h-[90dvh] overflow-y-auto rounded-3xl bg-[#FAF5ED] text-[#261E18] p-6 sm:p-7 text-center shadow-2xl">
            <div
              className="w-14 h-14 mx-auto rounded-full flex items-center justify-center font-display text-xl font-bold"
              style={{ backgroundColor: activeTurnPlayer.avatarColor }}
            >
              {activeTurnPlayer.name.slice(0, 1).toUpperCase()}
            </div>
            <h2 id="privacy-curtain-title" className="mt-4 font-display text-2xl font-bold">
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

      {/* Voluntary Exit Confirmation Modal */}
      {confirmLeave && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-exit-title"
          onClick={() => setConfirmLeave(false)}
        >
          <div
            className="w-full max-w-sm max-h-[90dvh] overflow-y-auto rounded-3xl bg-[#FAF5ED] text-[#261E18] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-exit-title" className="font-display text-xl font-bold">
              {isFinishedOnlineExit
                ? 'Leave Ongoing Table?'
                : isPassAndPlay
                  ? `Exit Game as ${perspectivePlayer.name}?`
                  : 'Exit Game Between Tricks?'}
            </h2>
            <p className="mt-2 text-sm text-[#5C4E41] leading-relaxed">
              {isFinishedOnlineExit
                ? perspectivePlayer.finished
                  ? 'You have already finished your cards. Leaving now will preserve your finishing position and will not affect the remaining players.'
                  : 'You are no longer active in this round. Leaving now will return you to the Welcome screen.'
                : isPassAndPlay
                  ? `${perspectivePlayer.name}’s remaining cards will be shuffled and distributed clockwise among the remaining active players, and the match will continue for everyone else.`
                  : 'Your remaining cards will be shuffled and distributed clockwise among the remaining active players so the game can continue fairly.'}
            </p>
            <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#EFE6D8] text-[#261E18] text-sm font-semibold cursor-pointer"
              >
                {isFinishedOnlineExit ? 'Continue Watching' : 'Keep Playing'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmLeave(false);
                  onVoluntaryExit(perspectivePlayer.id);
                }}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#D95732] text-white text-sm font-bold cursor-pointer"
              >
                {isFinishedOnlineExit
                  ? 'Leave Table'
                  : isPassAndPlay
                    ? `Exit as ${perspectivePlayer.name}`
                    : 'Exit Game'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Practice vs Bots Early Finish Confirmation Dialog */}
      {confirmFinishPractice && canFinishPracticeEarly && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="finish-practice-title"
          onClick={() => setConfirmFinishPractice(false)}
        >
          <div
            className="w-full max-w-sm max-h-[90dvh] overflow-y-auto rounded-3xl bg-[#FAF5ED] text-[#261E18] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="finish-practice-title" className="font-display text-xl font-bold">
              Finish Practice Game?
            </h2>
            <p className="mt-2 text-sm text-[#5C4E41] leading-relaxed">
              You have finished your cards. Would you like to end this practice game?
            </p>
            <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmFinishPractice(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#EFE6D8] hover:bg-[#E5D9C6] text-[#261E18] text-sm font-semibold cursor-pointer"
              >
                Continue Watching
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmFinishPractice(false);
                  onFinishPracticeEarly?.();
                }}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#D95732] hover:bg-[#C44B27] text-white text-sm font-bold cursor-pointer"
              >
                Finish Game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
