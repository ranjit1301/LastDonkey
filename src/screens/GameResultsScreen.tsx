import React, { useEffect, useState } from 'react';
import { Check, Clock, Home, Play, RotateCcw, Trophy, Users, X } from 'lucide-react';
import { PlayerAvatar } from '../components/BotAvatar';
import { ConfettiBurst } from '../components/CelebrationEffects';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { DonkeyEmblem } from '../components/DonkeyEmblem';
import { PlayingCard } from '../components/PlayingCard';
import { TrickHistorySection } from '../components/TrickHistorySection';
import { DIFFICULTY_META, sortHand, type GameState } from '../engine';
import { shouldPlayGameAnimations } from '../lib/gameAnimations';
import { shouldUseCompactResultsHand } from '../lib/handLayout';
import type { ConnectionStatusInfo } from '../lib/multiplayerClient';
import type { ClientGameStateView, ClientRoomState } from '../server/roomTypes';

interface GameResultsScreenProps {
  gameState: GameState | ClientGameStateView;
  onlineRoom?: ClientRoomState | null;
  practiceEndedEarly?: boolean;
  animationsEnabled?: boolean;
  onLocalPlayAgain?: () => void;
  onBackToLobby?: () => void;
  onMainMenu: () => void;
  // Section 20 online rematch actions
  onOnlineRequestRematch?: () => void;
  onOnlineRespondRematch?: (accept: boolean) => void;
  onOnlineStartRematch?: () => void;
  connectionInfo?: ConnectionStatusInfo;
  onRetryReconnect?: () => void;
}

export const GameResultsScreen: React.FC<GameResultsScreenProps> = ({
  gameState,
  onlineRoom,
  practiceEndedEarly = false,
  animationsEnabled = true,
  onLocalPlayAgain,
  onBackToLobby,
  onMainMenu,
  onOnlineRequestRematch,
  onOnlineRespondRematch,
  onOnlineStartRematch,
  connectionInfo,
  onRetryReconnect,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showWinConfetti, setShowWinConfetti] = useState(false);

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

  const animationsActive = shouldPlayGameAnimations(animationsEnabled, prefersReducedMotion);

  useEffect(() => {
    if (!onlineRoom?.rematch) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [onlineRoom?.rematch]);

  const donkeyPlayer =
    gameState.players.find((p) => p.id === gameState.donkeyPlayerId) ?? null;

  const successfulTricks = gameState.trickHistory.filter((t) => t.type === 'success').length;
  const failedTricks = gameState.trickHistory.filter((t) => t.type === 'failed').length;

  const isOnline = Boolean(onlineRoom);
  const isOnlineDisconnected =
    isOnline && Boolean(connectionInfo && connectionInfo.status !== 'connected');
  const isEarlyPracticeFinish = !isOnline && practiceEndedEarly && gameState.phase !== 'finished';
  const humanPlayer =
    gameState.players.find((p) => p.type === 'human') ?? null;
  const stillPlayingPlayers = isEarlyPracticeFinish
    ? gameState.players.filter((p) => !p.finished && !p.removed)
    : [];

  const isHost = onlineRoom
    ? onlineRoom.hostPlayerId === onlineRoom.yourPlayerId || onlineRoom.aiHostActive
    : true;
  const rematch = onlineRoom?.rematch ?? null;

  const rematchSecondsLeft = rematch
    ? Math.max(0, Math.ceil((rematch.expiresAt - nowMs) / 1000))
    : null;

  const myVote =
    rematch && onlineRoom ? rematch.votes[onlineRoom.yourPlayerId] ?? 'pending' : null;
  const eligibleSeats = onlineRoom
    ? onlineRoom.seats.filter((s) => s.type === 'bot' || s.connected)
    : [];
  const canRequestRematch = eligibleSeats.length >= 2;
  const acceptedCount =
    rematch && onlineRoom
      ? onlineRoom.seats.filter(
          (s) => (s.type === 'bot' || s.connected) && rematch.votes[s.playerId] === 'accepted'
        ).length
      : 0;
  const isRematchWindowOpen = rematchSecondsLeft !== null && rematchSecondsLeft > 0;

  const viewerPlayer = onlineRoom
    ? gameState.players.find((p) => p.id === onlineRoom.yourPlayerId) ?? null
    : humanPlayer;
  const viewerFinishedSafe =
    Boolean(viewerPlayer?.finished) && viewerPlayer?.id !== gameState.donkeyPlayerId;

  useEffect(() => {
    if (!animationsActive || !viewerFinishedSafe) {
      setShowWinConfetti(false);
      return;
    }
    setShowWinConfetti(true);
    const timer = window.setTimeout(() => setShowWinConfetti(false), 1500);
    return () => window.clearTimeout(timer);
  }, [animationsActive, viewerFinishedSafe]);

  return (
    <div className="min-h-screen cream-surface overflow-x-hidden flex flex-col">
      <header className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-5 pb-3 flex items-center justify-between gap-2">
        <span className="font-display text-xl font-bold text-[#D95732]">Last Donkey</span>
        <span className="text-xs font-semibold text-[#6E6052]">
          {DIFFICULTY_META[gameState.difficulty ?? 'easy'].shortTag} ·{' '}
          {isEarlyPracticeFinish ? 'Practice Complete' : 'Match Complete'}
        </span>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 pb-10 space-y-5">
        {isOnline && connectionInfo && connectionInfo.status !== 'connected' && (
          <ConnectionBanner
            connectionInfo={connectionInfo}
            variant="lobby"
            onRetryNow={onRetryReconnect}
            onReturnHome={onMainMenu}
          />
        )}
        {/* Hero Result Card */}
        {isEarlyPracticeFinish && humanPlayer ? (
          <section className="rounded-3xl felt-surface p-6 sm:p-8 text-center flex flex-col items-center shadow-lg">
            <div className="w-20 h-20 rounded-full bg-[#245C36] border-2 border-[#F5C954] flex items-center justify-center shadow-lg">
              <Trophy className="w-10 h-10 text-[#F5C954]" />
            </div>

            <p className="mt-4 text-xs sm:text-sm font-semibold text-[#F5C954]">
              Practice Game Complete · Safe Finish
            </p>
            <h1 className="mt-1 font-display text-3xl sm:text-5xl font-bold text-white">
              You Finished #{humanPlayer.finishOrder ?? 1}
            </h1>
            <p className="mt-2.5 text-sm text-[#D6E8DC] max-w-md leading-relaxed">
              {humanPlayer.name} cleared all cards safely and ended this practice session early.{' '}
              {stillPlayingPlayers.length} bots were still playing, so no Donkey was declared.
            </p>
          </section>
        ) : (
          <section className="rounded-3xl felt-surface p-6 sm:p-8 text-center flex flex-col items-center shadow-lg">
            {donkeyPlayer ? (
              <div className="mt-4 flex flex-col items-center">
                <PlayerAvatar
                  name={donkeyPlayer.name}
                  type={donkeyPlayer.type}
                  avatarColor={donkeyPlayer.avatarColor}
                  botAvatarId={donkeyPlayer.botAvatarId}
                  playerId={donkeyPlayer.id}
                  size="xl"
                  expression="donkey"
                  expressionIntensity={3}
                  showHumanFace
                  animated={animationsActive}
                />
                <span className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-[#3A1414]/90 border border-[#F87171]/60 px-3 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-[#FECACA] shadow-sm">
                  Last Donkey
                </span>
              </div>
            ) : (
              <DonkeyEmblem size={96} className="drop-shadow-[0_10px_18px_rgba(0,0,0,0.4)]" />
            )}

            <p className="mt-3 text-xs sm:text-sm font-semibold text-[#F5C954]">
              {donkeyPlayer ? 'The Last Donkey Is' : 'Simultaneous Finish'}
            </p>
            <h1 className="mt-1 font-display text-3xl sm:text-5xl font-bold text-white">
              {donkeyPlayer ? donkeyPlayer.name : 'No Donkey This Round'}
            </h1>
            {gameState.endReason && (
              <p className="mt-2 text-sm text-[#D6E8DC] max-w-md">{gameState.endReason}</p>
            )}

            {donkeyPlayer && donkeyPlayer.hand.length > 0 && (
              <div className="mt-5 w-full">
                <p className="text-xs text-[#C7DFCE] mb-2.5 tabular-nums">
                  Remaining cards left in {donkeyPlayer.name}’s hand ({donkeyPlayer.hand.length})
                </p>
                {shouldUseCompactResultsHand(donkeyPlayer.hand.length) ? (
                  <div
                    aria-label="Remaining cards in Donkey hand"
                    data-compact-donkey-hand="true"
                    className="max-h-[210px] sm:max-h-[228px] overflow-y-auto hand-scrollbar rounded-2xl bg-black/20 border border-white/12 p-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      {sortHand(donkeyPlayer.hand, 'desc').map((card) => (
                        <PlayingCard key={card.id} card={card} size="xs" />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {sortHand(donkeyPlayer.hand, 'desc').map((card) => (
                      <PlayingCard key={card.id} card={card} size="sm" />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Section 20: Online 30-Second Rematch Panel */}
        {isOnline && rematch && onlineRoom && (
          <section
            aria-label="Rematch invitation"
            className="rounded-3xl bg-[#FFF6E0] border border-[#E5B84B] p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-[#3A2B09]">Rematch Invitation</h2>
              {rematchSecondsLeft !== null && (
                <span
                  role="status"
                  aria-live="polite"
                  className="inline-flex items-center gap-1 text-xs font-mono font-bold text-[#9A5B00] tabular-nums"
                >
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  {rematchSecondsLeft}s left
                </span>
              )}
            </div>

            {/* Individual player votes */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {onlineRoom.seats.map((seat) => {
                const vote = rematch.votes[seat.playerId] ?? 'pending';
                return (
                  <div
                    key={seat.playerId}
                    className="min-w-0 rounded-xl bg-white/80 border border-[#E7D4A3] px-3 py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <PlayerAvatar
                        name={seat.name}
                        type={seat.type}
                        avatarColor={seat.avatarColor}
                        botAvatarId={seat.botAvatarId}
                        playerId={seat.playerId}
                        size="xs"
                        animated={false}
                      />
                      <span className="font-semibold text-[#261E18] truncate">{seat.name}</span>
                    </div>
                    <span
                      className={`font-bold shrink-0 inline-flex items-center gap-1 ${
                        vote === 'accepted'
                          ? 'text-[#2E6340]'
                          : vote === 'declined'
                            ? 'text-[#B92D14]'
                            : 'text-[#8C6D23]'
                      }`}
                    >
                      {vote === 'accepted' ? (
                        <Check className="w-3 h-3" aria-hidden="true" />
                      ) : vote === 'declined' ? (
                        <X className="w-3 h-3" aria-hidden="true" />
                      ) : (
                        <Clock className="w-3 h-3" aria-hidden="true" />
                      )}
                      {vote === 'accepted' ? 'In' : vote === 'declined' ? 'Out' : 'Waiting'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Respond buttons for invited players */}
            {myVote === 'pending' && isRematchWindowOpen && (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={isOnlineDisconnected}
                  onClick={() => onOnlineRespondRematch?.(true)}
                  className="flex-1 min-h-[44px] rounded-xl bg-[#365B40] text-white font-bold text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="w-4 h-4" />
                  Accept Rematch
                </button>
                <button
                  type="button"
                  disabled={isOnlineDisconnected}
                  onClick={() => onOnlineRespondRematch?.(false)}
                  className="flex-1 min-h-[44px] rounded-xl bg-[#EFE6D8] text-[#7D2915] font-bold text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X className="w-4 h-4" />
                  Decline
                </button>
              </div>
            )}

            {/* Host start rematch button (allows smaller group >= 2 per Section 20) */}
            {onlineRoom.hostPlayerId === onlineRoom.yourPlayerId && (
              <button
                type="button"
                disabled={acceptedCount < 2 || isOnlineDisconnected}
                onClick={onOnlineStartRematch}
                className="w-full min-h-[48px] rounded-full btn-orange-3d font-bold text-base inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4 fill-current" />
                Start Rematch with {acceptedCount} Accepted Players
              </button>
            )}
          </section>
        )}

        {/* Finishing Order (Respecting Simultaneous Finishers per Section 7 & 9) */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
          <section className="sm:col-span-7 rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-4 h-4 text-[#D95732]" />
              <h2 className="font-display text-lg font-bold text-[#261E18]">Finishing Order</h2>
            </div>

            <div className="divide-y divide-[#DFD3C1]">
              {gameState.finishGroups.map((group, groupIdx) => {
                const rankNumber =
                  gameState.finishGroups
                    .slice(0, groupIdx)
                    .reduce((sum, g) => sum + g.length, 0) + 1;
                const groupPlayers = group
                  .map((id) => gameState.players.find((p) => p.id === id))
                  .filter((p): p is (typeof gameState.players)[number] => Boolean(p));
                const names =
                  groupPlayers.length > 0
                    ? groupPlayers.map((p) => p.name).join(' & ')
                    : 'Player';

                return (
                  <div
                    key={group.join('-')}
                    className="py-2.5 flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono font-bold text-xs text-[#365B40] w-8 tabular-nums shrink-0">
                        #{rankNumber}
                      </span>
                      <div className="flex items-center -space-x-1.5 shrink-0">
                        {groupPlayers.map((p) => (
                          <PlayerAvatar
                            key={p.id}
                            name={p.name}
                            type={p.type}
                            avatarColor={p.avatarColor}
                            botAvatarId={p.botAvatarId}
                            playerId={p.id}
                            size="xs"
                            animated={false}
                          />
                        ))}
                      </div>
                      <span className="font-semibold text-[#261E18] truncate">{names}</span>
                    </div>
                    <span className="text-xs font-semibold text-[#365B40] shrink-0">
                      {group.length > 1 ? 'Simultaneous Safe' : 'Safe'}
                    </span>
                  </div>
                );
              })}

              {donkeyPlayer && !isEarlyPracticeFinish && (
                <div className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono font-bold text-xs text-[#D95732] w-8 shrink-0">
                      Last
                    </span>
                    <PlayerAvatar
                      name={donkeyPlayer.name}
                      type={donkeyPlayer.type}
                      avatarColor={donkeyPlayer.avatarColor}
                      botAvatarId={donkeyPlayer.botAvatarId}
                      playerId={donkeyPlayer.id}
                      size="xs"
                      animated={false}
                    />
                    <span className="font-bold text-[#261E18] truncate">{donkeyPlayer.name}</span>
                  </div>
                  <span className="text-xs font-bold text-[#D95732] shrink-0 tabular-nums">
                    Donkey ({donkeyPlayer.hand.length})
                  </span>
                </div>
              )}

              {isEarlyPracticeFinish &&
                stillPlayingPlayers.map((p) => (
                  <div
                    key={p.id}
                    className="py-2.5 flex items-center justify-between gap-3 text-sm text-[#6E6052]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono font-semibold text-xs text-[#8A7A6B] w-8 shrink-0">
                        —
                      </span>
                      <PlayerAvatar
                        name={p.name}
                        type={p.type}
                        avatarColor={p.avatarColor}
                        botAvatarId={p.botAvatarId}
                        playerId={p.id}
                        size="xs"
                        animated={false}
                      />
                      <span className="font-medium text-[#4A3F35] truncate">{p.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-[#7A6B5C] shrink-0 tabular-nums">
                      Still Playing ({p.hand.length}{' '}
                      {p.hand.length === 1 ? 'card' : 'cards'})
                    </span>
                  </div>
                ))}

              {gameState.players
                .filter((p) => p.removed)
                .map((p) => (
                  <div
                    key={p.id}
                    className="py-2.5 flex items-center justify-between gap-3 text-xs text-[#736456]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <PlayerAvatar
                        name={p.name}
                        type={p.type}
                        avatarColor={p.avatarColor}
                        botAvatarId={p.botAvatarId}
                        playerId={p.id}
                        size="xs"
                        disconnected
                        animated={false}
                      />
                      <span className="truncate">{p.name}</span>
                    </div>
                    <span>Removed / Exited</span>
                  </div>
                ))}
            </div>
          </section>

          <section className="sm:col-span-5 rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] p-5">
            <h2 className="font-display text-lg font-bold text-[#261E18] mb-3">Match Summary</h2>
            <dl className="space-y-2.5 text-sm tabular-nums">
              <div className="flex justify-between py-1.5 border-b border-[#DFD3C1]">
                <dt className="text-[#6E6052]">Total Tricks</dt>
                <dd className="font-mono font-bold text-[#261E18]">
                  {gameState.trickHistory.length}
                </dd>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#DFD3C1]">
                <dt className="text-[#6E6052]">Successful Tricks</dt>
                <dd className="font-mono font-bold text-[#365B40]">{successfulTricks}</dd>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#DFD3C1]">
                <dt className="text-[#6E6052]">Failed Cuts</dt>
                <dd className="font-mono font-bold text-[#D95732]">{failedTricks}</dd>
              </div>
              <div className="flex justify-between py-1.5">
                <dt className="text-[#6E6052]">Cards Cleared</dt>
                <dd className="font-mono font-bold text-[#261E18]">
                  {gameState.removedCards.length} / 52
                </dd>
              </div>
            </dl>
          </section>
        </div>

        {/* Collapsible Chronological Trick History */}
        <TrickHistorySection
          trickHistory={gameState.trickHistory}
          players={gameState.players}
          fallbackSeats={onlineRoom?.seats}
        />

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 pt-1">
          {isOnline ? (
            !rematch &&
            isHost && (
              <button
                type="button"
                disabled={!canRequestRematch || isOnlineDisconnected}
                onClick={onOnlineRequestRematch}
                title={
                  isOnlineDisconnected
                    ? 'Reconnect to request a rematch'
                    : canRequestRematch
                      ? 'Start a 30-second rematch vote'
                      : 'At least 2 eligible players are required for a rematch'
                }
                className="min-h-[52px] px-7 py-3 rounded-full btn-orange-3d font-bold text-base inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" />
                {canRequestRematch
                  ? 'Restart Game (30s Rematch)'
                  : 'Need 2+ Players for Rematch'}
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                onClick={onLocalPlayAgain}
                className="min-h-[52px] px-7 py-3 rounded-full btn-orange-3d font-bold text-base inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                {isEarlyPracticeFinish ? 'Start New Game' : 'Play Again'}
              </button>
              {onBackToLobby && (
                <button
                  type="button"
                  onClick={onBackToLobby}
                  className="min-h-[52px] px-6 py-3 rounded-full btn-forest-3d font-bold text-base inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Users className="w-4 h-4" />
                  Back to Lobby
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={onMainMenu}
            className="min-h-[52px] px-6 py-3 rounded-full bg-[#EFE6D8] hover:bg-[#E5D9C6] border border-[#DDD1BE] text-[#261E18] font-bold text-base inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Home className="w-4 h-4" />
            Home
          </button>
        </div>
      </main>
      <ConfettiBurst active={showWinConfetti} />
    </div>
  );
};
