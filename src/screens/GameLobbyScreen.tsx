import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  Clock,
  Copy,
  Crown,
  Globe,
  Link2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  ShieldOff,
  User,
  X,
} from 'lucide-react';
import { DIFFICULTY_META, getDealingCounts, type PlayerConfig } from '../engine';
import { PlayerAvatar } from '../components/BotAvatar';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { DifficultySelector } from '../components/DifficultySelector';
import type { ConnectionStatusInfo } from '../lib/multiplayerClient';
import {
  addLocalLobbySeat,
  AVATAR_COLORS,
  removeLocalLobbySeat,
  updateLocalLobbyPlayer,
  validateLocalLobbyConfig,
  type LocalLobbyConfig,
  type TurnTimerSeconds,
} from '../lib/settings';
import type { ClientRoomState } from '../server/roomTypes';

const ONLINE_TIMER_OPTIONS: readonly TurnTimerSeconds[] = [0, 10, 15, 20, 30];

interface GameLobbyScreenProps {
  /** Present when in a live online multiplayer room */
  onlineRoom: ClientRoomState | null;
  /** Present when in offline Practice / Pass-and-Play lobby */
  localConfig: LocalLobbyConfig | null;
  onUpdateLocalConfig?: (next: LocalLobbyConfig) => void;
  onStartLocalGame?: (config: LocalLobbyConfig) => void;
  onLeave: () => void;
  // Online multiplayer actions
  onOnlineAddBot?: () => void;
  onOnlineRemoveSeat?: (targetPlayerId: string) => void;
  onOnlineStartGame?: () => void;
  onOnlineCancelRoom?: () => void;
  onOnlineRevokeInvite?: () => void;
  onOnlineRegenerateCode?: () => void;
  onOnlineUpdateTurnTimer?: (turnTimerSeconds: TurnTimerSeconds) => void;
  onOnlineRequestHostTransfer?: (targetPlayerId: string) => void;
  onOnlineRespondHostTransfer?: (accept: boolean) => void;
  connectionInfo?: ConnectionStatusInfo;
  onRetryReconnect?: () => void;
  onReturnHome?: () => void;
}

export const GameLobbyScreen: React.FC<GameLobbyScreenProps> = ({
  onlineRoom,
  localConfig,
  onUpdateLocalConfig,
  onStartLocalGame,
  onLeave,
  onOnlineAddBot,
  onOnlineRemoveSeat,
  onOnlineStartGame,
  onOnlineCancelRoom,
  onOnlineRevokeInvite,
  onOnlineRegenerateCode,
  onOnlineUpdateTurnTimer,
  onOnlineRequestHostTransfer,
  onOnlineRespondHostTransfer,
  connectionInfo,
  onRetryReconnect,
  onReturnHome,
}) => {
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!onlineRoom?.vacancyExpiresAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [onlineRoom?.vacancyExpiresAt]);

  const isOnline = Boolean(onlineRoom);
  const capacity = onlineRoom ? onlineRoom.capacity : localConfig?.capacity ?? 4;
  const roomCode = onlineRoom ? onlineRoom.roomCode : localConfig?.roomCode ?? 'LOCAL1';
  const tableName = onlineRoom ? onlineRoom.tableName : localConfig?.tableName ?? 'Practice Lobby';
  const seatsCount = onlineRoom ? onlineRoom.seats.length : localConfig?.players.length ?? 0;
  const dealingCounts = getDealingCounts(Math.max(2, Math.min(6, seatsCount)));

  const isHumanHost = onlineRoom
    ? onlineRoom.hostPlayerId === onlineRoom.yourPlayerId
    : true;

  const inviteUrl =
    onlineRoom && onlineRoom.inviteToken
      ? `${window.location.origin}/?room=${encodeURIComponent(onlineRoom.roomCode)}&invite=${encodeURIComponent(onlineRoom.inviteToken)}`
      : '';

  const handleCopy = (text: string, kind: 'code' | 'link') => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedType(kind);
    window.setTimeout(() => setCopiedType(null), 1800);
  };

  // Local lobby helpers (enforcing Seat-0 guardrail & Practice vs Bots / Pass-and-Play mode sync)
  const updateLocalPlayer = (index: number, patch: Partial<PlayerConfig>) => {
    if (!localConfig || !onUpdateLocalConfig) return;
    onUpdateLocalConfig(updateLocalLobbyPlayer(localConfig, index, patch));
  };

  const addLocalSeat = () => {
    if (!localConfig || !onUpdateLocalConfig || localConfig.players.length >= 6) return;
    onUpdateLocalConfig(addLocalLobbySeat(localConfig));
  };

  const removeLocalSeat = (index: number) => {
    if (!localConfig || !onUpdateLocalConfig) return;
    onUpdateLocalConfig(removeLocalLobbySeat(localConfig, index));
  };

  const localValidation = !isOnline ? validateLocalLobbyConfig(localConfig) : null;

  const vacancyRemainingSec = onlineRoom?.vacancyExpiresAt
    ? Math.max(0, Math.ceil((onlineRoom.vacancyExpiresAt - nowMs) / 1000))
    : null;

  const formatMmSs = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const isOnlineDisconnected =
    Boolean(onlineRoom) && Boolean(connectionInfo) && connectionInfo!.status !== 'connected';

  const canStartOnline =
    Boolean(onlineRoom) &&
    !isOnlineDisconnected &&
    isHumanHost &&
    onlineRoom!.seats.length === onlineRoom!.capacity;

  const emptySlotsCount = isOnline
    ? Math.max(0, capacity - seatsCount)
    : Math.max(0, 6 - seatsCount);

  return (
    <div className="min-h-screen cream-surface overflow-x-hidden flex flex-col">
      {/* Header matching Emergent Lobby Reference */}
      <header className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-5 pb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onLeave}
            aria-label="Leave lobby"
            className="w-11 h-11 rounded-full bg-[#EFE6D8] hover:bg-[#E6DAC7] flex items-center justify-center text-[#261E18] transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#261E18] leading-tight">
              Lobby
            </h1>
            <p className="text-xs text-[#6E6052] truncate">
              {isOnline
                ? tableName
                : `${tableName} · ${localConfig?.mode === 'pass-and-play' ? 'Pass-and-Play' : 'Practice vs Bots'}`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => handleCopy(roomCode, 'code')}
          className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#EFE6D8] border border-[#DDD1BE] text-xs font-mono font-bold tracking-wider text-[#261E18] inline-flex items-center gap-1.5 hover:border-[#D95732] transition-colors cursor-pointer shrink-0"
          title="Copy room code"
        >
          {copiedType === 'code' ? (
            <Check className="w-3.5 h-3.5 text-[#365B40]" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-[#D95732]" />
          )}
          {roomCode}
        </button>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 pb-32 pt-2 space-y-5">
        {isOnline && connectionInfo && connectionInfo.status !== 'connected' && (
          <ConnectionBanner
            connectionInfo={connectionInfo}
            variant="lobby"
            onRetryNow={onRetryReconnect}
            onReturnHome={onReturnHome ?? onLeave}
          />
        )}

        {/* Pending Host Transfer Request Banner (Section 19) */}
        {onlineRoom?.pendingHostTransfer &&
          onlineRoom.pendingHostTransfer.toPlayerId === onlineRoom.yourPlayerId && (
            <div className="rounded-2xl bg-[#FFF6E0] border border-[#E5B84B] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-sm text-[#3A2B09]">
                <strong>{onlineRoom.pendingHostTransfer.fromPlayerName}</strong> wants to transfer
                Host ownership to you.
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onOnlineRespondHostTransfer?.(true)}
                  className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#365B40] text-white text-xs font-bold cursor-pointer"
                >
                  Accept Host
                </button>
                <button
                  type="button"
                  onClick={() => onOnlineRespondHostTransfer?.(false)}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#EFE6D8] text-[#3A2E25] text-xs font-semibold cursor-pointer"
                >
                  Decline
                </button>
              </div>
            </div>
          )}

        {/* Online Room Share / Visibility / AI Host Info Bar */}
        {onlineRoom && (
          <section className="rounded-2xl bg-[#F4ECE0] border border-[#E2D6C4] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[#4E4136]">
              <span className="inline-flex items-center gap-1.5">
                {onlineRoom.visibility === 'private' ? (
                  <Lock className="w-3.5 h-3.5 text-[#D95732]" />
                ) : (
                  <Globe className="w-3.5 h-3.5 text-[#365B40]" />
                )}
                {onlineRoom.visibility === 'private' ? 'Private Room' : 'Public Room'} · Fixed{' '}
                {onlineRoom.capacity} Players · {DIFFICULTY_META[onlineRoom.difficulty ?? 'easy'].shortTag}
              </span>

              {onlineRoom.aiHostActive && (
                <span className="inline-flex items-center gap-1.5 text-[#365B40]">
                  <Bot className="w-3.5 h-3.5" />
                  AI Room Host Active
                </span>
              )}
            </div>

            {onlineRoom.aiHostActive && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-xl bg-[#EBF5EE] border border-[#B7D5C0] px-3.5 py-2 text-xs text-[#1E4A2C] flex items-center gap-2"
              >
                <Bot className="w-4 h-4 shrink-0 text-[#365B40]" aria-hidden="true" />
                <span>
                  {onlineRoom.seats.length < onlineRoom.capacity
                    ? 'AI Room Host is managing this lobby and will automatically start once all seats are filled.'
                    : 'Room is full — AI Room Host is starting the game.'}
                </span>
              </div>
            )}

            {vacancyRemainingSec !== null && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-xl bg-[#FFF6E0] border border-[#E5B84B] px-3.5 py-2 text-xs text-[#4A3508] flex items-center gap-2 tabular-nums"
              >
                <Clock className="w-4 h-4 shrink-0 text-[#C98500]" aria-hidden="true" />
                <span>
                  Public vacancy timer: room will close in{' '}
                  <strong>{formatMmSs(vacancyRemainingSec)}</strong> if no replacement joins.
                </span>
              </div>
            )}

            {/* Turn Timer Configuration (Host-editable in waiting lobby, synced read-only for guests) */}
            <div className="pt-2.5 border-t border-[#E2D6C4] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#3A2E25]">
                  <Clock className="w-3.5 h-3.5 text-[#365B40] shrink-0" />
                  <span>Turn Timer</span>
                  {!isHumanHost && (
                    <span className="text-[11px] font-medium text-[#736456]">· Host setting</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-[#6E6052]">
                  {onlineRoom.turnTimerSeconds === 0
                    ? 'No turn countdown while connected (15s fallback if disconnected).'
                    : `Auto-plays a random legal card after ${onlineRoom.turnTimerSeconds}s.`}
                </p>
              </div>

              {isHumanHost && onlineRoom.status === 'waiting' ? (
                <div
                  role="group"
                  aria-label="Turn timer setting"
                  className="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-[#E9DFCE] shrink-0"
                >
                  {ONLINE_TIMER_OPTIONS.map((sec) => {
                    const active = onlineRoom.turnTimerSeconds === sec;
                    return (
                      <button
                        key={sec}
                        type="button"
                        disabled={isOnlineDisconnected}
                        aria-pressed={active}
                        onClick={() => onOnlineUpdateTurnTimer?.(sec)}
                        className={`min-h-[38px] px-2.5 py-1 rounded-lg text-xs font-semibold font-mono tabular-nums cursor-pointer transition-colors disabled:opacity-55 disabled:cursor-not-allowed ${
                          active
                            ? 'bg-[#365B40] text-white shadow-xs'
                            : 'text-[#4E4136] hover:text-[#261E18]'
                        }`}
                      >
                        {sec === 0 ? 'Off' : `${sec}s`}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span className="inline-flex items-center self-start sm:self-center px-3 py-1.5 rounded-xl bg-[#FAF5ED] border border-[#D8CBB8] text-xs font-mono font-bold text-[#261E18] tabular-nums shrink-0">
                  {onlineRoom.turnTimerSeconds === 0 ? 'Off' : `${onlineRoom.turnTimerSeconds}s`}
                </span>
              )}
            </div>

            {/* Invitation Sharing & Host Controls (Sections 17 & 21) */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleCopy(inviteUrl, 'link')}
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#FAF5ED] border border-[#D8CBB8] text-xs font-semibold text-[#261E18] hover:border-[#D95732] inline-flex items-center gap-1.5 cursor-pointer"
              >
                {copiedType === 'link' ? (
                  <Check className="w-3.5 h-3.5 text-[#365B40]" />
                ) : (
                  <Link2 className="w-3.5 h-3.5 text-[#D95732]" />
                )}
                {copiedType === 'link' ? 'Invite Link Copied' : 'Copy Invite Link'}
              </button>

              {isHumanHost && (
                <>
                  <button
                    type="button"
                    onClick={onOnlineRevokeInvite}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#FAF5ED] border border-[#D8CBB8] text-xs font-semibold text-[#5C4E41] hover:border-[#D95732] inline-flex items-center gap-1.5 cursor-pointer"
                    title="Revoke old invite link and create a new one"
                  >
                    <ShieldOff className="w-3.5 h-3.5" />
                    Revoke Link
                  </button>

                  <button
                    type="button"
                    onClick={onOnlineRegenerateCode}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#FAF5ED] border border-[#D8CBB8] text-xs font-semibold text-[#5C4E41] hover:border-[#D95732] inline-flex items-center gap-1.5 cursor-pointer"
                    title="Generate a fresh 6-character room code"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    New Code
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {/* Local Practice vs Bots / Pass-and-Play Difficulty Selector */}
        {!onlineRoom && localConfig && onUpdateLocalConfig && (
          <section className="rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] p-4 sm:p-5 shadow-xs">
            <DifficultySelector
              compact
              value={localConfig.difficulty}
              onChange={(difficulty) =>
                onUpdateLocalConfig({
                  ...localConfig,
                  difficulty,
                })
              }
            />
          </section>
        )}

        {/* Section Heading: Players · X/Y (Matches Screenshot) */}
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-bold text-[#261E18] tabular-nums">
            Players · {seatsCount}/{isOnline ? capacity : 6}
          </h2>
          {seatsCount >= 2 && (
            <span className="text-xs font-mono text-[#6E6052] tabular-nums">
              Deal: {dealingCounts.join(', ')}
            </span>
          )}
        </div>

        {/* 2-Column Beige Seat Cards Grid (Matches Screenshot image_c92f6561.png) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
          {onlineRoom
            ? onlineRoom.seats.map((seat) => {
                const isYou = seat.playerId === onlineRoom.yourPlayerId;
                const isHost = seat.playerId === onlineRoom.hostPlayerId;
                const canTransfer =
                  isHumanHost && !isYou && seat.type === 'human' && seat.connected;
                const canRemove = isHumanHost && !isYou;

                return (
                  <div
                    key={seat.playerId}
                    className="relative min-w-0 rounded-3xl bg-[#EFE6D8] border border-[#E2D6C4] px-3.5 sm:px-4 py-5 flex flex-col items-center text-center shadow-xs"
                  >
                    {canRemove && (
                      <button
                        type="button"
                        disabled={isOnlineDisconnected}
                        onClick={() => onOnlineRemoveSeat?.(seat.playerId)}
                        aria-label={`Remove ${seat.name}`}
                        className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-[#E3D7C5] hover:bg-[#D8C9B3] flex items-center justify-center text-[#3A2E25] transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}

                    {/* Avatar Circle (Fictional Indian caricature for bots; classic initial circle for humans) */}
                    <PlayerAvatar
                      name={seat.name}
                      type={seat.type}
                      avatarColor={seat.avatarColor}
                      botAvatarId={seat.botAvatarId}
                      playerId={seat.playerId}
                      size="lg"
                      disconnected={!seat.connected && seat.type === 'human'}
                    />

                    <div className="mt-3 font-bold text-sm sm:text-base text-[#261E18] truncate w-full">
                      {seat.name}
                    </div>

                    <div className="mt-0.5 text-xs text-[#736456]">
                      {isYou && isHost
                        ? 'You · Host'
                        : isYou
                          ? 'You'
                          : isHost
                            ? 'Host'
                            : seat.type === 'bot'
                              ? `Bot · ${DIFFICULTY_META[onlineRoom.difficulty ?? 'easy'].label}`
                              : !seat.connected && seat.playerId === onlineRoom.suspendedHostId
                                ? 'Host (Disconnected)'
                                : seat.connected
                                  ? 'Player'
                                  : 'Disconnected'}
                    </div>

                    {canTransfer && (
                      <button
                        type="button"
                        onClick={() => onOnlineRequestHostTransfer?.(seat.playerId)}
                        className="mt-2.5 px-2.5 py-1 rounded-lg bg-[#FAF5ED] border border-[#D8CBB8] text-[11px] font-semibold text-[#3A2E25] hover:border-[#D95732] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Crown className="w-3 h-3 text-[#D95732]" />
                        Make Host
                      </button>
                    )}
                  </div>
                );
              })
            : localConfig?.players.map((player, index) => {
                const isHost = index === 0;
                return (
                  <div
                    key={player.id}
                    className="relative rounded-3xl bg-[#EFE6D8] border border-[#E2D6C4] px-3.5 py-5 flex flex-col items-center text-center shadow-xs"
                  >
                    {!isHost && localConfig.players.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeLocalSeat(index)}
                        aria-label={`Remove ${player.name}`}
                        className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-[#E3D7C5] hover:bg-[#D8C9B3] flex items-center justify-center text-[#3A2E25] transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}

                    <PlayerAvatar
                      name={player.name}
                      type={player.type}
                      avatarColor={player.avatarColor ?? AVATAR_COLORS[index % 6]}
                      botAvatarId={player.botAvatarId}
                      playerId={player.id}
                      size="lg"
                    />

                    <input
                      type="text"
                      maxLength={18}
                      value={player.name}
                      onChange={(e) => updateLocalPlayer(index, { name: e.target.value })}
                      aria-label={`Seat ${index + 1} name`}
                      className="mt-3 w-full text-center bg-transparent font-bold text-sm sm:text-base text-[#261E18] border-b border-transparent focus:border-[#D95732] focus:outline-none truncate"
                    />

                    {isHost ? (
                      <span
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#5C4E41]"
                        title="Seat 1 always remains your human seat in Local Mode"
                      >
                        <User className="w-3 h-3" />
                        You · Host
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          updateLocalPlayer(index, {
                            type: player.type === 'human' ? 'bot' : 'human',
                          })
                        }
                        className="mt-1.5 inline-flex items-center gap-1 text-xs text-[#6E6052] hover:text-[#D95732] cursor-pointer"
                        title="Tap to switch Human / Bot"
                      >
                        {player.type === 'human' ? (
                          <>
                            <User className="w-3 h-3" />
                            Human
                          </>
                        ) : (
                          <>
                            <Bot className="w-3 h-3" />
                            Bot · {DIFFICULTY_META[localConfig.difficulty].label}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}

          {/* Dashed Empty Seat Slots (Matches Screenshot) */}
          {Array.from({ length: emptySlotsCount }).map((_, idx) => (
            <button
              key={`empty-${idx}`}
              type="button"
              onClick={
                isOnline
                  ? isHumanHost
                    ? onOnlineAddBot
                    : undefined
                  : addLocalSeat
              }
              disabled={isOnline && (!isHumanHost || isOnlineDisconnected)}
              className="min-h-[144px] min-w-0 rounded-3xl border-2 border-dashed border-[#D6C8B4] bg-[#FAF5ED]/60 flex flex-col items-center justify-center gap-1.5 text-[#8A7B6B] hover:border-[#D95732] hover:text-[#D95732] transition-colors disabled:opacity-65 disabled:cursor-default cursor-pointer px-3"
            >
              {(isOnline ? isHumanHost : true) ? (
                <>
                  <Plus className="w-5 h-5" />
                  <span className="text-xs font-semibold">
                    {isOnline
                      ? `Add ${DIFFICULTY_META[onlineRoom?.difficulty ?? 'easy'].label} Bot`
                      : 'Add Player'}
                  </span>
                </>
              ) : (
                <span className="text-xs font-medium">Open Seat</span>
              )}
            </button>
          ))}
        </div>
      </main>

      {/* Bottom Sticky Action Footer (Matches Screenshot) */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-[#FAF5ED]/95 backdrop-blur-xs border-t border-[#E4D8C6] px-4 py-3.5">
        <div className="w-full max-w-3xl mx-auto flex items-center gap-2.5 sm:gap-3">
          {isOnline && isHumanHost && (
            <button
              type="button"
              disabled={isOnlineDisconnected}
              onClick={onOnlineCancelRoom}
              className="min-h-[52px] px-4 rounded-full bg-[#EFE6D8] text-[#7D2915] font-semibold text-sm hover:bg-[#F5DCD5] transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            >
              Cancel
            </button>
          )}

          {isOnline ? (
            <button
              type="button"
              disabled={!canStartOnline}
              onClick={onOnlineStartGame}
              className="flex-1 min-h-[54px] px-5 sm:px-6 rounded-full btn-orange-3d font-bold text-base sm:text-lg flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-5 h-5 fill-current shrink-0" />
              {isOnlineDisconnected
                ? 'Reconnecting...'
                : onlineRoom!.seats.length < onlineRoom!.capacity
                  ? `Waiting (${onlineRoom!.seats.length}/${onlineRoom!.capacity})`
                  : isHumanHost
                    ? 'Start Game'
                    : onlineRoom!.aiHostActive
                      ? 'AI Host Starting...'
                      : 'Waiting for Host...'}
            </button>
          ) : (
            <button
              type="button"
              disabled={!localValidation?.ok}
              onClick={() => {
                if (localValidation?.ok) {
                  onStartLocalGame?.(localValidation.config);
                }
              }}
              className="flex-1 min-h-[54px] px-6 rounded-full btn-orange-3d font-bold text-lg flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-5 h-5 fill-current" />
              Start Game
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
