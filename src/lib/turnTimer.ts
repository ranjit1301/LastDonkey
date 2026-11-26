import type { GameState } from '../engine';
import type { TurnTimerSeconds } from './settings';
import type { ClientRoomState } from '../server/roomTypes';

export interface LocalTurnTimerState {
  turnKey: string | null;
  playerId: string | null;
  deadlineAt: number | null;
}

export const EMPTY_LOCAL_TURN_TIMER: LocalTurnTimerState = {
  turnKey: null,
  playerId: null,
  deadlineAt: null,
};

/**
 * Uniquely identifies an active card-play turn within a game so the deadline
 * is created once per turn and never unintentionally reset on re-render or overlay navigation.
 */
export function buildTurnKey(
  state: Pick<GameState, 'phase' | 'currentTurnPlayerId' | 'currentTrick'> | null | undefined
): string | null {
  if (!state || state.phase !== 'playing' || !state.currentTurnPlayerId) {
    return null;
  }
  return `${state.currentTrick.trickNumber}:${state.currentTrick.plays.length}:${state.currentTurnPlayerId}`;
}

/**
 * Pure deadline-based local turn timer state transition:
 * - Preserves the exact existing deadline when staying on the same turn (e.g., opening/closing Rules or Settings).
 * - Never extends or resets an active turn's deadline if Settings changes mid-turn to a longer duration.
 * - Clamps the deadline if Settings shortens the duration mid-turn.
 * - Disables timeout completely when turnTimerSeconds is 0 (Off).
 */
export function syncLocalTurnTimer(
  prev: LocalTurnTimerState,
  params: {
    turnKey: string | null;
    playerId: string | null;
    timerEligible: boolean;
    turnTimerSeconds: TurnTimerSeconds;
    nowMs: number;
  }
): LocalTurnTimerState {
  const { turnKey, playerId, timerEligible, turnTimerSeconds, nowMs } = params;

  if (!turnKey || !playerId) {
    return EMPTY_LOCAL_TURN_TIMER;
  }

  // Timer Off disables automatic timeout completely
  if (turnTimerSeconds <= 0) {
    return {
      turnKey,
      playerId,
      deadlineAt: null,
    };
  }

  // Not yet eligible (e.g., waiting behind Pass-and-Play privacy handoff curtain or bot's turn)
  if (!timerEligible) {
    if (prev.turnKey === turnKey && prev.deadlineAt !== null) {
      // Once a turn's timer has started, preserve its exact deadline
      return prev;
    }
    return {
      turnKey,
      playerId,
      deadlineAt: null,
    };
  }

  const maxAllowedDeadline = nowMs + turnTimerSeconds * 1000;

  // Same active turn with an existing deadline -> NEVER reset or extend!
  if (prev.turnKey === turnKey && prev.playerId === playerId && prev.deadlineAt !== null) {
    const preservedDeadline = Math.min(prev.deadlineAt, maxAllowedDeadline);
    if (preservedDeadline === prev.deadlineAt) {
      return prev;
    }
    return {
      turnKey,
      playerId,
      deadlineAt: preservedDeadline,
    };
  }

  // Brand-new eligible turn (or timer switched from Off -> On mid-turn)
  return {
    turnKey,
    playerId,
    deadlineAt: maxAllowedDeadline,
  };
}

export function getRemainingSeconds(deadlineAt: number | null, nowMs: number): number | null {
  if (deadlineAt === null) return null;
  return Math.max(0, Math.ceil((deadlineAt - nowMs) / 1000));
}

export function isTimerExpired(deadlineAt: number | null, nowMs: number): boolean {
  return deadlineAt !== null && nowMs >= deadlineAt;
}

export interface OverlayTurnAlert {
  isYourTurn: boolean;
  activePlayerName: string;
  remainingSeconds: number | null;
  urgent: boolean;
  isOnline: boolean;
}

/**
 * Computes the live active-turn alert banner shown while Rules or Settings is open
 * above an active table, keeping both online (server-authoritative) and local timers visible.
 */
export function computeOverlayTurnAlert(params: {
  isOnline: boolean;
  onlineRoom: ClientRoomState | null;
  localGame: GameState | null;
  localDeadlineAt: number | null;
  nowMs: number;
}): OverlayTurnAlert | null {
  const { isOnline, onlineRoom, localGame, localDeadlineAt, nowMs } = params;

  if (isOnline) {
    const gs = onlineRoom?.gameState;
    if (!onlineRoom || onlineRoom.status !== 'playing' || !gs || gs.phase !== 'playing') {
      return null;
    }
    const isYourTurn = gs.currentTurnPlayerId === onlineRoom.yourPlayerId;
    const activePlayer = gs.players.find((p) => p.id === gs.currentTurnPlayerId);
    const remainingSeconds =
      isYourTurn && onlineRoom.turnDeadlineAt
        ? getRemainingSeconds(onlineRoom.turnDeadlineAt, nowMs)
        : null;
    return {
      isYourTurn,
      activePlayerName: isYourTurn ? 'You' : activePlayer?.name ?? 'Player',
      remainingSeconds,
      urgent: isYourTurn && remainingSeconds !== null && remainingSeconds <= 5,
      isOnline: true,
    };
  }

  if (!localGame || localGame.phase !== 'playing') {
    return null;
  }

  const activePlayer = localGame.players.find((p) => p.id === localGame.currentTurnPlayerId);
  if (!activePlayer) return null;

  const isHumanTurn = activePlayer.type === 'human' && !activePlayer.removed && !activePlayer.finished;
  const remainingSeconds = isHumanTurn ? getRemainingSeconds(localDeadlineAt, nowMs) : null;
  return {
    isYourTurn: isHumanTurn,
    activePlayerName: activePlayer.name,
    remainingSeconds,
    urgent: isHumanTurn && remainingSeconds !== null && remainingSeconds <= 5,
    isOnline: false,
  };
}

export interface TrickBannerInteraction {
  allowClickToAdvance: boolean;
  showManualContinueButton: boolean;
  showProgressBar: boolean;
  tooltip: string | undefined;
  cursorClass: string;
}

/**
 * Authoritative interaction contract for TrickOutcomeNotification:
 * - Online (server-controlled): strictly non-clickable, no misleading cursor/tooltip, no Continue button;
 *   server controls progression for all connected players consistently.
 * - Offline/Local: preserves existing Auto (tap-to-continue + progress bar) and Manual (Continue button) modes.
 */
export function getTrickBannerInteraction(params: {
  isServerControlled: boolean;
  autoAdvance: boolean;
}): TrickBannerInteraction {
  if (params.isServerControlled) {
    return {
      allowClickToAdvance: false,
      showManualContinueButton: false,
      showProgressBar: true,
      tooltip: undefined,
      cursorClass: '',
    };
  }

  if (params.autoAdvance) {
    return {
      allowClickToAdvance: true,
      showManualContinueButton: false,
      showProgressBar: true,
      tooltip: 'Tap to continue immediately',
      cursorClass: 'cursor-pointer',
    };
  }

  return {
    allowClickToAdvance: false,
    showManualContinueButton: true,
    showProgressBar: false,
    tooltip: undefined,
    cursorClass: '',
  };
}
