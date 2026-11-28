import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  BookOpen,
  Eye,
  EyeOff,
  Flag,
  Layers,
  LogOut,
  Settings,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  WifiOff,
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
import { PlayerAvatar } from '../components/BotAvatar';
import { ConfettiBurst } from '../components/CelebrationEffects';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { DiscardedCardTracker } from '../components/DiscardedCardTracker';
import {
  FailedTrickAnimationOverlay,
  type FlyingCardTrajectory,
} from '../components/FailedTrickAnimationOverlay';
import { MediumAssistBar } from '../components/MediumAssistBar';
import { PlayerHandTray } from '../components/PlayerHandTray';
import { PlayingCard } from '../components/PlayingCard';
import { TrickOutcomeNotification } from '../components/TrickOutcomeNotification';
import {
  CALM_FACIAL_STATE,
  derivePlayerExpressionStates,
  getReliefEligiblePlayerIds,
  type PlayerFacialState,
} from '../lib/facialExpressions';
import {
  buildFailedTrickEventKey,
  buildSuccessTrickEventKey,
  FAILED_TRICK_TIMING_MS,
  RELIEF_ANIMATION_TIMING_MS,
  shouldPlayGameAnimations,
  type FailedTrickStage,
  type ReliefAnimationFrame,
} from '../lib/gameAnimations';
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
  botAvatarId?: string;
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

  // Track OS prefers-reduced-motion live so animations automatically disable when requested
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const animationsActive = shouldPlayGameAnimations(
    settings.animationsEnabled,
    prefersReducedMotion
  );

  // Authoritative 4-stage Failed Trick animation state (purely visual & non-blocking)
  const [failedAnimStage, setFailedAnimStage] = useState<FailedTrickStage>('idle');
  const [failedTrajectories, setFailedTrajectories] = useState<FlyingCardTrajectory[]>([]);
  const lastAnimatedFailedKeyRef = useRef<string | null>(null);

  // Server-authoritative 4-frame Sigh of Relief animation state on successful tricks (1.68s)
  const [reliefAnimState, setReliefAnimState] = useState<{
    frame: ReliefAnimationFrame;
    eligibleIds: ReadonlySet<string>;
  }>({ frame: 'idle', eligibleIds: new Set() });
  const lastAnimatedSuccessKeyRef = useRef<string | null>(null);
  const reliefTimersRef = useRef<number[]>([]);

  // Lightweight safe-finish / last-card celebration burst
  const [celebrationLabel, setCelebrationLabel] = useState<string | null>(null);
  const lastCelebratedKeyRef = useRef<string | null>(null);

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

  // Trigger 4-stage Failed Trick animation ONLY from server/engine-confirmed failed trick outcome
  const failedOutcome =
    gameState.phase === 'trick_result' && gameState.lastOutcome?.type === 'failed'
      ? gameState.lastOutcome
      : null;
  const failedEventKey = buildFailedTrickEventKey(failedOutcome);

  const failedOutcomeRef = useRef(failedOutcome);
  failedOutcomeRef.current = failedOutcome;

  useEffect(() => {
    const activeFailedOutcome = failedOutcomeRef.current;
    if (!activeFailedOutcome || !failedEventKey || !animationsActive) {
      setFailedAnimStage('idle');
      setFailedTrajectories([]);
      return;
    }

    if (lastAnimatedFailedKeyRef.current === failedEventKey) {
      return;
    }
    lastAnimatedFailedKeyRef.current = failedEventKey;

    // Measure live DOM centers of center trick cards and target recipient seat/hand for Stage 3
    const measureTrajectories = (): FlyingCardTrajectory[] => {
      const targetEl = document.querySelector<HTMLElement>(
        `[data-player-seat-id="${CSS.escape(activeFailedOutcome.collectorId)}"]`
      );
      const targetRect = targetEl?.getBoundingClientRect();
      const endX = targetRect
        ? targetRect.left + targetRect.width / 2
        : window.innerWidth / 2;
      const endY = targetRect
        ? targetRect.top + targetRect.height / 2
        : activeFailedOutcome.collectorId === perspectivePlayer.id
          ? window.innerHeight - 90
          : 90;

      const count = activeFailedOutcome.collectedCards.length;
      return activeFailedOutcome.collectedCards.map((card, idx) => {
        const cardEl = document.querySelector<HTMLElement>(
          `[data-trick-card-id="${CSS.escape(card.id)}"]`
        );
        const cardRect = cardEl?.getBoundingClientRect();
        const startX = cardRect
          ? cardRect.left + cardRect.width / 2
          : window.innerWidth / 2 + (idx - (count - 1) / 2) * 44;
        const startY = cardRect ? cardRect.top + cardRect.height / 2 : window.innerHeight * 0.44;

        // Curved lateral arc so cards swoop naturally rather than moving in a stiff line
        const lateralArc = (idx - (count - 1) / 2) * 28 + (endY > startY ? 26 : -26);
        const midX = (startX + endX) / 2 + lateralArc;
        const midY = (startY + endY) / 2 - 28;

        return {
          card,
          startX,
          startY,
          midX,
          midY,
          endX,
          endY,
          rotateMid: (idx % 2 === 0 ? -1 : 1) * (10 + (idx % 3) * 4),
          rotateEnd: (idx % 2 === 0 ? 1 : -1) * 14,
          delaySec: Math.min(idx * 0.045, 0.22),
        };
      });
    };

    setFailedAnimStage('banner');
    setFailedTrajectories([]);

    const t2 = window.setTimeout(() => {
      setFailedAnimStage('reaction');
    }, FAILED_TRICK_TIMING_MS.stage2ReactionMs);

    const t3 = window.setTimeout(() => {
      setFailedTrajectories(measureTrajectories());
      setFailedAnimStage('flying');
    }, FAILED_TRICK_TIMING_MS.stage3FlyingMs);

    const t4 = window.setTimeout(() => {
      setFailedAnimStage('finishing');
      setFailedTrajectories([]);
    }, FAILED_TRICK_TIMING_MS.stage4FinishingMs);

    const tDone = window.setTimeout(() => {
      setFailedAnimStage('idle');
    }, FAILED_TRICK_TIMING_MS.totalDurationMs);

    return () => {
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      window.clearTimeout(tDone);
    };
  }, [failedEventKey, animationsActive, perspectivePlayer.id]);

  // Trigger synchronized 4-frame Sigh of Relief ONLY from server/engine-confirmed successful tricks
  const successOutcome =
    gameState.phase === 'trick_result' && gameState.lastOutcome?.type === 'success'
      ? gameState.lastOutcome
      : null;
  const successEventKey = buildSuccessTrickEventKey(successOutcome);

  const successOutcomeRef = useRef(successOutcome);
  successOutcomeRef.current = successOutcome;
  const playersRef = useRef(players);
  playersRef.current = players;

  const clearReliefTimers = () => {
    for (const id of reliefTimersRef.current) {
      window.clearTimeout(id);
    }
    reliefTimersRef.current = [];
  };

  // Clear timers strictly on unmount
  useEffect(() => () => clearReliefTimers(), []);

  // Immediately cancel any running relief animation if animations turn off or a failed trick starts
  useEffect(() => {
    if (!animationsActive || failedEventKey) {
      clearReliefTimers();
      setReliefAnimState((prev) =>
        prev.frame === 'idle' ? prev : { frame: 'idle', eligibleIds: new Set() }
      );
    }
  }, [animationsActive, failedEventKey]);

  // Synchronized 1.68s Sigh of Relief sequence for all active (non-finished) players simultaneously
  useEffect(() => {
    const activeSuccess = successOutcomeRef.current;
    if (!activeSuccess || !successEventKey || !animationsActive) {
      return;
    }
    if (lastAnimatedSuccessKeyRef.current === successEventKey) {
      return;
    }
    lastAnimatedSuccessKeyRef.current = successEventKey;

    const eligibleIds = new Set(
      getReliefEligiblePlayerIds(playersRef.current, activeSuccess)
    );
    if (eligibleIds.size === 0) {
      return;
    }

    clearReliefTimers();
    setReliefAnimState({ frame: 'hold', eligibleIds });

    const tExhale = window.setTimeout(() => {
      setReliefAnimState({ frame: 'exhale', eligibleIds });
    }, RELIEF_ANIMATION_TIMING_MS.frame1ExhaleMs);

    const tSmile = window.setTimeout(() => {
      setReliefAnimState({ frame: 'smile', eligibleIds });
    }, RELIEF_ANIMATION_TIMING_MS.frame2SmileMs);

    const tSettle = window.setTimeout(() => {
      setReliefAnimState({ frame: 'settle', eligibleIds });
    }, RELIEF_ANIMATION_TIMING_MS.frame3SettleMs);

    const tDone = window.setTimeout(() => {
      setReliefAnimState({ frame: 'idle', eligibleIds: new Set() });
      reliefTimersRef.current = [];
    }, RELIEF_ANIMATION_TIMING_MS.totalDurationMs);

    reliefTimersRef.current = [tExhale, tSmile, tSettle, tDone];
  }, [successEventKey, animationsActive]);

  // Reset trick animation dedup keys when starting a fresh match (trick 1)
  useEffect(() => {
    if (gameState.currentTrick.trickNumber === 1 && gameState.phase === 'playing') {
      lastAnimatedFailedKeyRef.current = null;
      lastAnimatedSuccessKeyRef.current = null;
      lastCelebratedKeyRef.current = null;
      clearReliefTimers();
      setReliefAnimState({ frame: 'idle', eligibleIds: new Set() });
    }
  }, [gameState.currentTrick.trickNumber, gameState.phase]);

  // Optional lightweight celebration when a player finishes safe on a trick
  useEffect(() => {
    if (!animationsActive) {
      setCelebrationLabel(null);
      return;
    }
    const outcome = gameState.lastOutcome;
    if (
      (gameState.phase === 'trick_result' || gameState.phase === 'finished') &&
      outcome &&
      outcome.newlyFinishedIds.length > 0
    ) {
      const key = `finish:${outcome.trickNumber}:${outcome.newlyFinishedIds.join(',')}`;
      if (lastCelebratedKeyRef.current === key) return;
      lastCelebratedKeyRef.current = key;
      const names = outcome.newlyFinishedIds
        .map((id) => players.find((p) => p.id === id)?.name ?? 'Player')
        .join(' & ');
      setCelebrationLabel(`${names} Finished Safe!`);
      const timer = window.setTimeout(() => setCelebrationLabel(null), 1400);
      return () => window.clearTimeout(timer);
    }
  }, [animationsActive, gameState.phase, gameState.lastOutcome, players]);

  // Authoritative facial expressions (server-computed in online mode, trickHistory-derived locally)
  const playerExpressions = useMemo<Record<string, PlayerFacialState>>(() => {
    const maybeClientGame = gameState as ClientGameStateView;
    if (maybeClientGame.playerExpressions) {
      return maybeClientGame.playerExpressions;
    }
    return derivePlayerExpressionStates({
      playerIds: players.map((p) => p.id),
      trickHistory: gameState.trickHistory,
      lastOutcome: gameState.lastOutcome,
      phase: gameState.phase,
      donkeyPlayerId: gameState.donkeyPlayerId,
      finishedPlayerIds: players.filter((p) => p.finished).map((p) => p.id),
    });
  }, [gameState, players]);

  const getPlayerFacialState = (player: UnifiedPlayer): PlayerFacialState => {
    const state = playerExpressions[player.id];
    if (state) return state;
    if (player.finished) {
      return {
        ...CALM_FACIAL_STATE,
        expression: 'happy',
        label: 'Finished Safe',
      };
    }
    return CALM_FACIAL_STATE;
  };

  const getPlayerStageEffect = (playerId: string): 'none' | 'shock' | 'dizzy' => {
    if (
      animationsActive &&
      failedOutcome &&
      failedOutcome.collectorId === playerId
    ) {
      if (failedAnimStage === 'reaction' || failedAnimStage === 'flying') {
        return 'shock';
      }
      if (failedAnimStage === 'finishing') {
        return 'dizzy';
      }
    }
    return 'none';
  };

  const getPlayerReliefFrame = (player: UnifiedPlayer): ReliefAnimationFrame => {
    if (!animationsActive || player.finished || player.removed) {
      return 'idle';
    }
    if (reliefAnimState.frame !== 'idle' && reliefAnimState.eligibleIds.has(player.id)) {
      return reliefAnimState.frame;
    }
    return 'idle';
  };

  const getPlayerPenaltyDelta = (playerId: string): number | null => {
    if (
      animationsActive &&
      failedOutcome &&
      failedOutcome.collectorId === playerId &&
      failedAnimStage === 'finishing'
    ) {
      return failedOutcome.collectedCards.length;
    }
    return null;
  };

  const isSuccessSweepActive =
    animationsActive &&
    gameState.phase === 'trick_result' &&
    gameState.lastOutcome?.type === 'success';

  const isFailedShakeActive =
    animationsActive &&
    failedOutcome !== null &&
    (failedAnimStage === 'banner' || failedAnimStage === 'reaction');

  const isFailedCardsHiddenInFlight =
    animationsActive && failedOutcome !== null && failedAnimStage === 'flying';

  const collectorName = failedOutcome
    ? players.find((p) => p.id === failedOutcome.collectorId)?.name ?? 'Player'
    : '';

  return (
    <div className="min-h-screen h-[100dvh] flex flex-col felt-surface overflow-hidden">
      {/* Top Wooden/Forest Header Bar */}
      <header className="shrink-0 walnut-rail px-2.5 sm:px-5 py-1.5 sm:py-2 [@media(max-height:500px)]:py-1 flex items-center justify-between gap-1.5 sm:gap-2 z-20">
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
        <main className="flex-1 min-w-0 min-h-0 relative flex flex-col justify-between gap-1.5 sm:gap-2 px-2.5 sm:px-6 py-1.5 sm:py-2 overflow-x-hidden overflow-y-auto">
        {/* MEDIUM MODE ONLY: Exact Remaining Suit Counts + Occasional Unobtrusive Hint */}
        {difficulty === 'medium' && (
          <MediumAssistBar removedCards={gameState.removedCards} hint={mediumHint} />
        )}

        {/* ORIGINAL TOP OPPONENTS ROW: Flat horizontal opponent seats with fictional bot caricature avatars */}
        <section
          aria-label="Opponents"
          data-testid="original-opponents-row"
          className="relative z-10 shrink-0 w-full max-w-5xl mx-auto"
        >
          <div className="flex items-stretch justify-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
            {opponents.map((opp) => {
              const isTurn =
                gameState.phase === 'playing' && gameState.currentTurnPlayerId === opp.id;
              const hasPlayedThisTrick = gameState.currentTrick.plays.some(
                (tp) => tp.playerId === opp.id
              );
              const facialState = getPlayerFacialState(opp);
              const stageEffect = getPlayerStageEffect(opp.id);
              const penaltyDelta = getPlayerPenaltyDelta(opp.id);
              const isPenalizedHighlight =
                animationsActive &&
                failedOutcome?.collectorId === opp.id &&
                failedAnimStage !== 'idle';

              const cardWidthClass =
                opponents.length <= 2
                  ? 'flex-1 max-w-[200px] min-w-[126px]'
                  : opponents.length === 3
                    ? 'flex-1 max-w-[180px] min-w-[98px]'
                    : 'flex-1 max-w-[168px] min-w-[84px] sm:min-w-[116px]';

              return (
                <div
                  key={opp.id}
                  data-player-seat-id={opp.id}
                  data-active-seat={isTurn ? 'true' : 'false'}
                  className={`relative rounded-2xl px-2 py-2 sm:px-3.5 sm:py-2.5 flex flex-col items-center text-center transition-all border ${cardWidthClass} ${
                    isPenalizedHighlight
                      ? 'bg-[#451717]/95 border-[#F87171] shadow-[0_0_20px_rgba(248,113,113,0.42)]'
                      : isTurn
                        ? 'bg-[#1A4E2C]/96 border-[#F5C954] shadow-[0_0_18px_rgba(245,201,84,0.34)]'
                        : opp.finished
                          ? 'bg-[#123820]/75 border-[#86EFAC]/30 opacity-85'
                          : opp.removed
                            ? 'bg-[#2C1A1A]/75 border-[#F87171]/25 opacity-65'
                            : 'bg-[#154124]/92 border-white/14'
                  }`}
                >
                  <PlayerAvatar
                    name={opp.name}
                    type={opp.type}
                    avatarColor={opp.avatarColor}
                    botAvatarId={opp.botAvatarId}
                    playerId={opp.id}
                    size={opponents.length >= 4 ? 'sm' : 'md'}
                    expression={facialState.expression}
                    expressionIntensity={facialState.intensity}
                    failStreak={facialState.consecutiveFailStreak}
                    reliefFrame={getPlayerReliefFrame(opp)}
                    stageEffect={stageEffect}
                    showHumanFace
                    activeTurn={isTurn}
                    disconnected={!opp.connected && opp.type === 'human'}
                    penaltyDelta={penaltyDelta}
                    animated={animationsActive}
                  />

                  <div
                    className="mt-1.5 w-full font-bold text-xs sm:text-sm text-white truncate leading-tight"
                    title={opp.name}
                  >
                    {opp.name}
                  </div>

                  <div className="mt-0.5 text-[11px] sm:text-xs text-[#C8DFD0] tabular-nums leading-tight flex items-center justify-center gap-1 flex-wrap">
                    {opp.removed ? (
                      <span className="text-[#FCA5A5] font-semibold">Removed</span>
                    ) : opp.finished ? (
                      <span className="text-[#86EFAC] font-semibold">
                        Safe #{opp.finishOrder}
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold text-[#E8F5EC]">
                          {opp.cardCount} {opp.cardCount === 1 ? 'card' : 'cards'}
                        </span>
                        {!opp.connected && opp.type === 'human' ? (
                          <span className="inline-flex items-center gap-0.5 text-[#FCA5A5] font-semibold">
                            <WifiOff className="w-3 h-3 shrink-0" aria-hidden="true" />
                            <span>Off</span>
                          </span>
                        ) : isTurn ? (
                          <span className="text-[#F5C954] font-bold">· Turn</span>
                        ) : hasPlayedThisTrick ? (
                          <span className="text-[#86EFAC] font-semibold">· Played</span>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ORIGINAL CENTRAL GREEN-FELT PLAYING AREA (No oval border or rearranged seating) */}
        <section
          aria-label="Current trick"
          data-testid="original-center-felt"
          className="grow shrink-0 min-h-[120px] flex flex-col items-center justify-center gap-2 sm:gap-3 py-1 relative z-10"
        >
          {/* Led Suit Pill / Leading Cue */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {ledSuit ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF7F0] text-[#1D1B18] px-3.5 py-1 text-xs sm:text-sm font-bold shadow-[0_6px_16px_rgba(0,0,0,0.28)] border border-black/10">
                <span className="text-[#5C5347] font-semibold">Suit:</span>
                <span
                  className={`text-base sm:text-lg leading-none ${
                    isRedSuit(ledSuit) ? 'text-[#C81E1E]' : 'text-[#141A21]'
                  }`}
                >
                  {SUIT_SYMBOLS[ledSuit]}
                </span>
                <span className="hidden sm:inline text-xs font-bold text-[#261E18]">
                  {SUIT_NAMES[ledSuit]}
                </span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-[#133820]/90 border border-white/15 px-3.5 py-1 text-xs font-semibold text-[#DCECE1] tabular-nums">
                <Sparkles className="w-3.5 h-3.5 text-[#F5C954] shrink-0" aria-hidden="true" />
                <span>
                  {gameState.isFirstTurnOfGame
                    ? 'Trick 1 · Play A♠ to lead'
                    : `Trick ${gameState.currentTrick.trickNumber} · ${
                        activeTurnPlayer ? `${activeTurnPlayer.name} leads` : 'Open lead'
                      }`}
                </span>
              </div>
            )}
          </div>

          {/* Played Cards on Open Green Felt */}
          <div className="w-full max-w-4xl flex items-end justify-center gap-2 sm:gap-3.5 flex-wrap px-1 min-h-[96px] sm:min-h-[122px]">
            {gameState.currentTrick.plays.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/18 bg-[#123820]/35 px-5 py-4 text-xs sm:text-sm text-[#C8DFD0]/85 text-center">
                {gameState.isFirstTurnOfGame
                  ? 'Waiting for the Ace of Spades (A♠) to start the match'
                  : 'Waiting for the first card of this trick'}
              </div>
            ) : (
              gameState.currentTrick.plays.map((play) => {
                const owner = players.find((p) => p.id === play.playerId);
                const isHighest = highestLedPlay?.card.id === play.card.id;
                const isOffSuitCut =
                  failedOutcome !== null && failedOutcome.offSuitPlay.card.id === play.card.id;
                const isFailedCard = failedOutcome !== null;

                return (
                  <motion.div
                    key={`${gameState.currentTrick.trickNumber}-${play.card.id}`}
                    data-trick-card-id={play.card.id}
                    initial={animationsActive ? { opacity: 0, y: 12, scale: 0.92 } : false}
                    animate={{
                      opacity: isFailedCardsHiddenInFlight ? 0.16 : 1,
                      y: 0,
                      scale: isFailedCardsHiddenInFlight ? 0.88 : 1,
                    }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className={`flex flex-col items-center gap-1 ${
                      isFailedShakeActive
                        ? 'failed-trick-card-shake'
                        : isSuccessSweepActive
                          ? 'trick-sweep-success'
                          : ''
                    }`}
                  >
                    <div
                      className={`rounded-xl transition-shadow ${
                        isOffSuitCut
                          ? 'ring-2 ring-[#F87171] shadow-[0_0_18px_rgba(248,113,113,0.75)]'
                          : isFailedCard
                            ? 'ring-2 ring-[#FBBF24]/90 shadow-[0_0_14px_rgba(251,191,36,0.5)]'
                            : ''
                      }`}
                    >
                      <PlayingCard
                        card={play.card}
                        size="sm"
                        highlighted={!isFailedCard && isHighest}
                      />
                    </div>
                    <span
                      className="text-[11px] sm:text-xs font-semibold text-[#EAF4ED] max-w-[74px] sm:max-w-[88px] truncate text-center drop-shadow-xs"
                      title={owner?.name ?? 'Player'}
                    >
                      {owner?.name ?? 'Player'}
                    </span>
                  </motion.div>
                );
              })
            )}
          </div>

          {/* Dedicated Non-Overlapping Status / Turn / Trick Outcome Banner Slot */}
          <div className="w-full flex justify-center px-1">
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
          </div>
        </section>

        {/* LOCAL PLAYER ZONE — Preserved Horizontal Hand Tray + Bottom Play Footer */}
        <section
          aria-label="Your hand"
          data-player-seat-id={perspectivePlayer.id}
          className="relative z-20 shrink-0 w-full max-w-4xl mx-auto"
        >
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
                <div className="min-w-0 flex-1 flex items-center gap-2.5">
                  {/* Local player avatar showing real facial expressions & consecutive-failure streaks */}
                  {(() => {
                    const localFacial = getPlayerFacialState(perspectivePlayer);
                    const localStageEffect = getPlayerStageEffect(perspectivePlayer.id);
                    return (
                      <PlayerAvatar
                        name={perspectivePlayer.name}
                        type={perspectivePlayer.type}
                        avatarColor={perspectivePlayer.avatarColor}
                        botAvatarId={perspectivePlayer.botAvatarId}
                        playerId={perspectivePlayer.id}
                        size="sm"
                        expression={localFacial.expression}
                        expressionIntensity={localFacial.intensity}
                        failStreak={localFacial.consecutiveFailStreak}
                        reliefFrame={getPlayerReliefFrame(perspectivePlayer)}
                        stageEffect={localStageEffect}
                        showHumanFace
                        activeTurn={turnState.canActNow}
                        penaltyDelta={getPlayerPenaltyDelta(perspectivePlayer.id)}
                        animated={animationsActive}
                      />
                    );
                  })()}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="text-sm sm:text-base font-bold text-white truncate"
                        title={perspectivePlayer.name}
                      >
                        {perspectivePlayer.name}
                      </span>
                      {turnState.canActNow && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F5C954] text-[#1A1205] text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider shadow-sm shrink-0">
                          <span
                            aria-hidden="true"
                            className="turn-dot-pulse w-1.5 h-1.5 rounded-full bg-[#1B4D2B]"
                          />
                          Your Turn
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#C4DEC9] tabular-nums whitespace-nowrap">
                      <span className="font-semibold text-[#E8F5EC]">
                        {perspectivePlayer.cardCount}{' '}
                        {perspectivePlayer.cardCount === 1 ? 'card' : 'cards'}
                      </span>
                      {turnState.canActNow && (
                        <span className="ml-1.5 text-[#FDE68A] font-semibold">
                          · {turnState.legalCards.length} playable
                        </span>
                      )}
                    </div>
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
      {/* Non-Blocking 4-Stage Failed Trick Animation Overlay */}
      {animationsActive && (
        <FailedTrickAnimationOverlay
          outcome={failedOutcome}
          stage={failedAnimStage}
          collectorName={collectorName}
          trajectories={failedTrajectories}
        />
      )}

      {/* Lightweight Safe-Finish Celebration Confetti */}
      <ConfettiBurst active={Boolean(animationsActive && celebrationLabel)} label={celebrationLabel} />
    </div>
  );
};
