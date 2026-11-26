import {
  canVoluntarilyExit,
  removePlayerAndRedistribute,
  type GameState,
} from '../engine';
import type { RoomNotification } from '../server/roomTypes';

export interface LocalExitOptions {
  isPassAndPlay: boolean;
  rng?: () => number;
}

export type LocalVoluntaryExitResult =
  | {
      ok: false;
      error: string;
      nextState: GameState;
      shouldLeaveToLobby: false;
      shouldResetReveal: false;
    }
  | {
      ok: true;
      exitedPlayerId: string | null;
      exitedPlayerName: string | null;
      cardsDistributedCount: number;
      nextState: GameState | null;
      shouldLeaveToLobby: boolean;
      shouldResetReveal: boolean;
      toast: { kind: RoomNotification['kind']; message: string } | null;
    };

/**
 * Authoritative local voluntary-exit handler shared by Practice vs Bots and Pass-and-Play.
 *
 * - Practice vs Bots (1 human + bots): preserves existing behavior — validates between-tricks exit,
 *   redistributes if active, and returns the sole human player to the local lobby.
 * - Pass-and-Play (2+ humans): removes ONLY the exiting human player between tricks, shuffles &
 *   redistributes their remaining cards clockwise to active players, keeps the match alive for the
 *   remaining players (or applies Donkey determination if only 1 active player remains), prevents
 *   duplicate exit actions, and forces a clean privacy handoff to the next human player.
 */
export function executeLocalVoluntaryExit(
  state: GameState,
  requestedPlayerId: string | null | undefined,
  options: LocalExitOptions
): LocalVoluntaryExitResult {
  const { isPassAndPlay, rng = Math.random } = options;

  if (state.phase === 'finished') {
    if (!isPassAndPlay) {
      return {
        ok: true,
        exitedPlayerId: null,
        exitedPlayerName: null,
        cardsDistributedCount: 0,
        nextState: null,
        shouldLeaveToLobby: true,
        shouldResetReveal: true,
        toast: null,
      };
    }
    return {
      ok: false,
      error: 'Game has already ended.',
      nextState: state,
      shouldLeaveToLobby: false,
      shouldResetReveal: false,
    };
  }

  // Strictly block mid-trick voluntary exits without mutating game state
  if (!canVoluntarilyExit(state)) {
    return {
      ok: false,
      error: 'You cannot exit in the middle of a trick. Please wait until the trick finishes.',
      nextState: state,
      shouldLeaveToLobby: false,
      shouldResetReveal: false,
    };
  }

  // Practice vs Bots: preserve existing single-human exit behavior unchanged
  if (!isPassAndPlay) {
    const requestedActiveHuman = requestedPlayerId
      ? state.players.find(
          (p) => p.id === requestedPlayerId && p.type === 'human' && !p.removed && !p.finished
        )
      : undefined;
    const humanSeat =
      requestedActiveHuman ??
      state.players.find((p) => p.type === 'human' && !p.removed && !p.finished);

    if (!humanSeat) {
      return {
        ok: true,
        exitedPlayerId: null,
        exitedPlayerName: null,
        cardsDistributedCount: 0,
        nextState: null,
        shouldLeaveToLobby: true,
        shouldResetReveal: true,
        toast: null,
      };
    }

    const res = removePlayerAndRedistribute(state, humanSeat.id, 'voluntary_exit', rng);
    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        nextState: state,
        shouldLeaveToLobby: false,
        shouldResetReveal: false,
      };
    }

    const distributed = res.state.lastRedistribution?.cardsDistributedCount ?? 0;
    return {
      ok: true,
      exitedPlayerId: humanSeat.id,
      exitedPlayerName: humanSeat.name,
      cardsDistributedCount: distributed,
      nextState: null,
      shouldLeaveToLobby: true,
      shouldResetReveal: true,
      toast: {
        kind: 'info',
        message:
          distributed > 0
            ? `Exited between tricks. ${distributed} ${distributed === 1 ? 'card' : 'cards'} redistributed.`
            : 'Exited between tricks.',
      },
    };
  }

  // Pass-and-Play: exit ONLY the targeted active human player while keeping the match intact
  const target = requestedPlayerId
    ? state.players.find((p) => p.id === requestedPlayerId)
    : undefined;

  if (!target || target.type !== 'human') {
    return {
      ok: false,
      error: 'No active human player is selected to exit.',
      nextState: state,
      shouldLeaveToLobby: false,
      shouldResetReveal: false,
    };
  }

  if (target.removed) {
    return {
      ok: false,
      error: `${target.name} has already exited the game.`,
      nextState: state,
      shouldLeaveToLobby: false,
      shouldResetReveal: false,
    };
  }

  if (target.finished) {
    return {
      ok: false,
      error: `${target.name} has already finished all cards.`,
      nextState: state,
      shouldLeaveToLobby: false,
      shouldResetReveal: false,
    };
  }

  const res = removePlayerAndRedistribute(state, target.id, 'voluntary_exit', rng);
  if (!res.ok) {
    return {
      ok: false,
      error: res.error,
      nextState: state,
      shouldLeaveToLobby: false,
      shouldResetReveal: false,
    };
  }

  const distributed = res.state.lastRedistribution?.cardsDistributedCount ?? 0;
  let message: string;
  if (res.state.phase === 'finished') {
    message = res.state.endReason ?? `${target.name} exited the game.`;
  } else if (distributed > 0) {
    message = `${target.name} left the game. ${distributed} ${distributed === 1 ? 'card' : 'cards'} redistributed clockwise.`;
  } else {
    message = `${target.name} left the game.`;
  }

  return {
    ok: true,
    exitedPlayerId: target.id,
    exitedPlayerName: target.name,
    cardsDistributedCount: distributed,
    nextState: res.state,
    shouldLeaveToLobby: false,
    shouldResetReveal: true,
    toast: {
      kind: 'info',
      message,
    },
  };
}

export interface PassAndPlayPlayerView {
  id: string;
  type: 'human' | 'bot';
  finished: boolean;
  removed: boolean;
}

/**
 * Resolves which human seat is represented at the bottom of the Pass-and-Play table:
 * - On an active human's turn: strictly that active human.
 * - Between tricks (trick_result) or during a bot's turn: keeps the currently revealed active human
 *   (the person still holding the device) before falling back to nextLeaderId or the first active human.
 */
export function resolvePassAndPlayPerspectivePlayer<T extends PassAndPlayPlayerView>(params: {
  phase: GameState['phase'];
  activeTurnPlayer: T | null;
  nextLeaderId: string | null;
  players: readonly T[];
  revealedPlayerId: string | null;
}): T {
  const { phase, activeTurnPlayer, nextLeaderId, players, revealedPlayerId } = params;
  const humanPlayers = players.filter((p) => p.type === 'human');

  if (phase === 'playing' && activeTurnPlayer && activeTurnPlayer.type === 'human') {
    return activeTurnPlayer;
  }

  if (revealedPlayerId) {
    const revealedActive = humanPlayers.find(
      (p) => p.id === revealedPlayerId && !p.finished && !p.removed
    );
    if (revealedActive) return revealedActive;
  }

  if (nextLeaderId) {
    const nextLeaderHuman = humanPlayers.find(
      (p) => p.id === nextLeaderId && !p.finished && !p.removed
    );
    if (nextLeaderHuman) return nextLeaderHuman;
  }

  return humanPlayers.find((p) => !p.finished && !p.removed) ?? humanPlayers[0] ?? players[0];
}

/**
 * True when Pass-and-Play must display the full-screen "Pass Device" privacy handoff curtain
 * before revealing the active human player's cards.
 */
export function shouldShowPassAndPlayPrivacyCurtain(params: {
  isPassAndPlay: boolean;
  openHandsTesting: boolean;
  phase: GameState['phase'];
  activeTurnPlayer: PassAndPlayPlayerView | null;
  revealedPlayerId: string | null;
}): boolean {
  const { isPassAndPlay, openHandsTesting, phase, activeTurnPlayer, revealedPlayerId } = params;
  if (!isPassAndPlay || openHandsTesting) return false;
  if (phase !== 'playing' || !activeTurnPlayer) return false;
  if (activeTurnPlayer.type !== 'human' || activeTurnPlayer.removed || activeTurnPlayer.finished) {
    return false;
  }
  return revealedPlayerId !== activeTurnPlayer.id;
}

/**
 * True when Pass-and-Play must conceal hand cards at the bottom of the table so one human
 * can NEVER glimpse another human's cards (e.g., during trick_result, bot turns, or immediately
 * after another human voluntarily exits before the next human confirms handoff).
 */
export function shouldHidePassAndPlayHand(params: {
  isPassAndPlay: boolean;
  openHandsTesting: boolean;
  phase: GameState['phase'];
  activeTurnPlayer: PassAndPlayPlayerView | null;
  perspectivePlayer: PassAndPlayPlayerView;
  revealedPlayerId: string | null;
}): boolean {
  const {
    isPassAndPlay,
    openHandsTesting,
    phase,
    activeTurnPlayer,
    perspectivePlayer,
    revealedPlayerId,
  } = params;
  if (!isPassAndPlay || openHandsTesting) return false;
  if (phase !== 'playing' || !activeTurnPlayer) return true;
  if (activeTurnPlayer.type !== 'human') return true;
  if (activeTurnPlayer.id !== perspectivePlayer.id) return true;
  return revealedPlayerId !== perspectivePlayer.id;
}
