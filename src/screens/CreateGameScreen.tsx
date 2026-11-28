import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bot, ChevronDown, ChevronUp, Globe, Lock, Users } from 'lucide-react';
import { getDealingCounts, type DifficultyMode } from '../engine';
import { AvatarPicker } from '../components/AvatarPicker';
import { PlayerAvatar } from '../components/BotAvatar';
import { DifficultySelector } from '../components/DifficultySelector';
import { getBotAvatarById } from '../lib/botAvatars';
import {
  buildDefaultPlayers,
  generateRoomCode,
  sanitizeLocalLobbyConfig,
  type LocalLobbyConfig,
  type TurnTimerSeconds,
} from '../lib/settings';
import type { RoomVisibility } from '../server/roomTypes';

export type CreateRoomMode = 'online' | 'practice' | 'pass-and-play';

interface CreateGameScreenProps {
  initialMode: CreateRoomMode;
  initialPlayerName: string;
  initialAvatarId: string;
  defaultTurnTimer: TurnTimerSeconds;
  defaultDifficulty: DifficultyMode;
  onBack: () => void;
  onSaveAvatarId: (avatarId: string) => void;
  onCreateOnlineRoom: (params: {
    playerName: string;
    tableName: string;
    capacity: number;
    visibility: RoomVisibility;
    turnTimerSeconds: TurnTimerSeconds;
    difficulty: DifficultyMode;
    avatarId?: string;
  }) => void;
  onCreateLocalLobby: (config: LocalLobbyConfig) => void;
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6] as const;

export const CreateGameScreen: React.FC<CreateGameScreenProps> = ({
  initialMode,
  initialPlayerName,
  initialAvatarId,
  defaultTurnTimer,
  defaultDifficulty,
  onBack,
  onSaveAvatarId,
  onCreateOnlineRoom,
  onCreateLocalLobby,
}) => {
  const [createMode, setCreateMode] = useState<CreateRoomMode>(initialMode);
  const [hostName, setHostName] = useState(initialPlayerName || 'Player');
  const [selectedAvatarId, setSelectedAvatarId] = useState(initialAvatarId);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [tableName, setTableName] = useState('');
  const [capacity, setCapacity] = useState<number>(4);
  const [visibility, setVisibility] = useState<RoomVisibility>('private');
  const [turnTimerSeconds, setTurnTimerSeconds] = useState<TurnTimerSeconds>(defaultTurnTimer);
  const [difficulty, setDifficulty] = useState<DifficultyMode>(defaultDifficulty);

  const selectedAvatarProfile = getBotAvatarById(selectedAvatarId);
  const dealingCounts = getDealingCounts(capacity);

  useEffect(() => {
    setSelectedAvatarId(initialAvatarId);
  }, [initialAvatarId]);

  const handleSelectAvatar = (nextAvatarId: string) => {
    setSelectedAvatarId(nextAvatarId);
    onSaveAvatarId(nextAvatarId);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = hostName.trim() || 'Player';
    const cleanTable = tableName.trim() || `${cleanName}’s Table`;
    const chosenAvatarId = selectedAvatarProfile?.id;

    if (createMode === 'online') {
      onCreateOnlineRoom({
        playerName: cleanName,
        tableName: cleanTable,
        capacity,
        visibility,
        turnTimerSeconds,
        difficulty,
        avatarId: chosenAvatarId,
      });
      return;
    }

    const localMode = createMode === 'pass-and-play' ? 'pass-and-play' : 'bots';
    onCreateLocalLobby(
      sanitizeLocalLobbyConfig({
        roomCode: generateRoomCode(),
        tableName: cleanTable,
        mode: localMode,
        visibility: 'private',
        capacity,
        difficulty,
        players: buildDefaultPlayers(capacity, cleanName, localMode, Math.random, chosenAvatarId),
      })
    );
  };

  return (
    <div className="min-h-screen cream-surface overflow-x-hidden flex flex-col">
      <header className="w-full max-w-2xl mx-auto px-4 sm:px-6 pt-5 pb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to home"
          className="w-11 h-11 rounded-full bg-[#EFE6D8] hover:bg-[#E6DAC7] flex items-center justify-center text-[#261E18] transition-colors cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#261E18]">
            {createMode === 'online'
              ? 'Create Online Room'
              : createMode === 'pass-and-play'
                ? 'Pass-and-Play Setup'
                : 'Practice vs Bots'}
          </h1>
          <p className="text-xs text-[#6E6052]">Choose room size (2–6 players) and settings</p>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 pb-10">
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] p-5 sm:p-7 space-y-6 shadow-sm"
        >
          {/* Mode Switcher */}
          <div
            role="group"
            aria-label="Game mode"
            className="grid grid-cols-3 gap-1.5 sm:gap-2 p-1.5 rounded-2xl bg-[#E9DFCE]"
          >
            {(
              [
                { id: 'online', label: 'Online Room', icon: Globe },
                { id: 'practice', label: 'Practice Bots', icon: Bot },
                { id: 'pass-and-play', label: 'Pass & Play', icon: Users },
              ] as const
            ).map(({ id, label, icon: Icon }) => {
              const active = createMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCreateMode(id)}
                  className={`min-h-[46px] px-1.5 sm:px-2.5 py-2 rounded-xl text-[11px] sm:text-sm font-semibold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 text-center leading-tight transition-all cursor-pointer ${
                    active
                      ? 'bg-[#FAF5ED] text-[#261E18] shadow-sm'
                      : 'text-[#5C4E41] hover:text-[#261E18]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Name Inputs + Character Avatar */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="create-host-name"
                  className="block text-sm font-semibold text-[#3A2E25] mb-1.5"
                >
                  Your Name
                </label>
                <input
                  id="create-host-name"
                  type="text"
                  maxLength={20}
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="Your nickname"
                  className="w-full min-h-[48px] px-4 rounded-xl bg-[#FAF5ED] border border-[#D8CBB8] text-[#261E18] font-medium focus:outline-none focus:border-[#D95732]"
                />
              </div>

              <div>
                <label
                  htmlFor="create-table-name"
                  className="block text-sm font-semibold text-[#3A2E25] mb-1.5"
                >
                  Room Name (optional)
                </label>
                <input
                  id="create-table-name"
                  type="text"
                  maxLength={28}
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="Evening Rang Vapas"
                  className="w-full min-h-[48px] px-4 rounded-xl bg-[#FAF5ED] border border-[#D8CBB8] text-[#261E18] font-medium focus:outline-none focus:border-[#D95732]"
                />
              </div>
            </div>

            <div>
              <span className="block text-sm font-semibold text-[#3A2E25] mb-1.5">
                Your Avatar
              </span>
              <div className="rounded-2xl bg-[#EFE6D8] border border-[#DFD3C1] p-3">
                <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 sm:gap-3">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {selectedAvatarProfile ? (
                      <PlayerAvatar
                        name={selectedAvatarProfile.name}
                        type="human"
                        avatarColor={selectedAvatarProfile.accentColor}
                        avatarId={selectedAvatarProfile.id}
                        size="sm"
                        animated={false}
                      />
                    ) : (
                      <span className="w-9 h-9 rounded-full bg-[#365B40] text-[#FAF5ED] flex items-center justify-center text-xs font-bold shrink-0">
                        Auto
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#261E18] leading-snug">
                        {selectedAvatarProfile ? selectedAvatarProfile.name : 'Auto-Assigned Character'}
                      </div>
                      <div className="text-[11px] text-[#6E6052] leading-snug">
                        {selectedAvatarProfile
                          ? selectedAvatarProfile.personality
                          : 'An unused character will be assigned automatically'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="create-avatar-trigger"
                    aria-expanded={avatarPickerOpen}
                    onClick={() => setAvatarPickerOpen((prev) => !prev)}
                    className="w-full sm:w-auto min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-xl bg-[#FAF5ED] border border-[#D8CBB8] text-xs font-semibold text-[#3A2E25] hover:border-[#D95732] transition-colors cursor-pointer shrink-0 inline-flex items-center justify-center gap-1.5"
                  >
                    <span>
                      {avatarPickerOpen
                        ? 'Done'
                        : selectedAvatarProfile
                          ? 'Change Avatar'
                          : 'Choose Avatar'}
                    </span>
                    {avatarPickerOpen ? (
                      <ChevronUp className="w-3.5 h-3.5 text-[#D95732]" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-[#D95732]" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {avatarPickerOpen && (
                  <div className="mt-3 pt-3 border-t border-[#DFD3C1]">
                    <AvatarPicker
                      selectedAvatarId={selectedAvatarId}
                      onSelect={(id) => {
                        handleSelectAvatar(id);
                        if (id) setAvatarPickerOpen(false);
                      }}
                      allowAuto
                      compact
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Room Capacity (Fixed 2-6 Players per Section 16) */}
          <div>
            <div className="flex items-baseline justify-between gap-2 mb-2.5">
              <span className="text-sm font-semibold text-[#3A2E25]">Room Capacity</span>
              <span className="text-xs font-mono text-[#365B40] font-semibold tabular-nums">
                Deal: {dealingCounts.join(' · ')} cards
              </span>
            </div>

            <div role="group" aria-label="Room capacity" className="grid grid-cols-5 gap-2">
              {PLAYER_COUNTS.map((count) => {
                const active = capacity === count;
                return (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setCapacity(count)}
                    className={`min-h-[50px] rounded-2xl font-bold text-base tabular-nums transition-all cursor-pointer border ${
                      active
                        ? 'bg-[#D95732] text-white border-[#B24121] shadow-sm'
                        : 'bg-[#FAF5ED] text-[#3A2E25] border-[#D8CBB8] hover:border-[#D95732]'
                    }`}
                  >
                    {count}P
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-[#6E6052]">
              Fixed room size: game starts once all {capacity} seats are filled. Extra cards always
              go to the first seats clockwise.
            </p>
          </div>

          {/* Difficulty Mode Selection (Easy · Medium · Hard) */}
          <DifficultySelector value={difficulty} onChange={setDifficulty} />

          {/* Private vs Public Room Toggle (Online Only) */}
          {createMode === 'online' && (
            <div>
              <span className="block text-sm font-semibold text-[#3A2E25] mb-2.5">
                Room Visibility
              </span>
              <div role="group" aria-label="Room visibility" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  aria-pressed={visibility === 'private'}
                  onClick={() => setVisibility('private')}
                  className={`p-4 rounded-2xl text-left transition-all cursor-pointer border ${
                    visibility === 'private'
                      ? 'bg-[#FAF5ED] border-[#D95732] ring-2 ring-[#D95732]/20'
                      : 'bg-[#EFE6D8] border-[#D8CBB8] hover:bg-[#FAF5ED]'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm text-[#261E18]">
                    <Lock className="w-4 h-4 text-[#D95732]" aria-hidden="true" />
                    Private Room
                  </div>
                  <p className="mt-1 text-xs text-[#6E6052] leading-relaxed">
                    Invite friends by 6-character code or revocable link. Hidden from public
                    discovery and stays open until you cancel.
                  </p>
                </button>

                <button
                  type="button"
                  aria-pressed={visibility === 'public'}
                  onClick={() => setVisibility('public')}
                  className={`p-4 rounded-2xl text-left transition-all cursor-pointer border ${
                    visibility === 'public'
                      ? 'bg-[#FAF5ED] border-[#365B40] ring-2 ring-[#365B40]/20'
                      : 'bg-[#EFE6D8] border-[#D8CBB8] hover:bg-[#FAF5ED]'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm text-[#261E18]">
                    <Globe className="w-4 h-4 text-[#365B40]" aria-hidden="true" />
                    Public Room
                  </div>
                  <p className="mt-1 text-xs text-[#6E6052] leading-relaxed">
                    Listed in Public Rooms so players can join open seats directly until full.
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* Turn Timer Setting */}
          {createMode === 'online' && (
            <div>
              <span className="block text-sm font-semibold text-[#3A2E25] mb-2">
                Turn Timer (Auto-Plays Random Legal Card)
              </span>
              <div
                role="group"
                aria-label="Turn timer"
                className="inline-flex flex-wrap gap-1.5 p-1 rounded-xl bg-[#E9DFCE]"
              >
                {([0, 10, 15, 20, 30] as TurnTimerSeconds[]).map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    aria-pressed={turnTimerSeconds === sec}
                    onClick={() => setTurnTimerSeconds(sec)}
                    className={`min-h-[38px] px-3.5 py-2 rounded-lg text-xs font-semibold font-mono tabular-nums cursor-pointer transition-colors ${
                      turnTimerSeconds === sec
                        ? 'bg-[#365B40] text-white'
                        : 'text-[#4E4136] hover:text-[#261E18]'
                    }`}
                  >
                    {sec === 0 ? 'Off' : `${sec}s`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            className="w-full min-h-[54px] px-6 py-3.5 rounded-full btn-orange-3d font-bold text-base transition-all cursor-pointer"
          >
            {createMode === 'online' ? 'Create Room & Open Lobby' : 'Open Local Lobby'}
          </button>
        </form>
      </main>
    </div>
  );
};
