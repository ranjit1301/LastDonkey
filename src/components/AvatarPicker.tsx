import React from 'react';
import { Check, Shuffle } from 'lucide-react';
import { BOT_AVATAR_PROFILES, getBotAvatarById } from '../lib/botAvatars';
import { PlayerAvatar } from './BotAvatar';

interface AvatarPickerProps {
  /** Selected character avatar ID, or empty string when using automatic unused assignment */
  selectedAvatarId: string;
  onSelect: (avatarId: string) => void;
  /** Optional "Auto" option allowing the server/lobby to automatically assign an unused character */
  allowAuto?: boolean;
  /** Character IDs currently taken by other players in the same room (disabled in picker) */
  takenAvatarIds?: ReadonlySet<string>;
  /** Compact layout for inline panels */
  compact?: boolean;
  ariaLabel?: string;
}

/**
 * Reusable 12-character avatar picker reusing the approved Last Donkey character artwork.
 * Supports pre-join guest selection (with optional Auto assignment) and waiting-lobby changes.
 */
export const AvatarPicker: React.FC<AvatarPickerProps> = ({
  selectedAvatarId,
  onSelect,
  allowAuto = false,
  takenAvatarIds,
  compact = false,
  ariaLabel = 'Choose your character avatar',
}) => {
  const activeProfile = getBotAvatarById(selectedAvatarId);

  return (
    <div className="space-y-2.5" role="group" aria-label={ariaLabel}>
      <div className="flex items-center justify-between gap-2 text-xs text-[#6E6052]">
        <span className="font-semibold text-[#3A2E25]">
          {activeProfile
            ? `${activeProfile.name} · ${activeProfile.personality}`
            : 'Auto-assign an unused character on join'}
        </span>
        {allowAuto && selectedAvatarId && (
          <button
            type="button"
            onClick={() => onSelect('')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#FAF5ED] border border-[#D8CBB8] text-[11px] font-semibold text-[#5C4E41] hover:border-[#D95732] hover:text-[#D95732] transition-colors cursor-pointer shrink-0"
          >
            <Shuffle className="w-3 h-3" aria-hidden="true" />
            Auto
          </button>
        )}
      </div>

      <div
        className={`grid ${
          compact ? 'grid-cols-4 sm:grid-cols-6 gap-1.5' : 'grid-cols-4 sm:grid-cols-6 gap-2'
        }`}
      >
        {BOT_AVATAR_PROFILES.map((profile) => {
          const isSelected = selectedAvatarId === profile.id;
          const isTaken = Boolean(takenAvatarIds?.has(profile.id) && !isSelected);

          return (
            <button
              key={profile.id}
              type="button"
              disabled={isTaken}
              aria-pressed={isSelected}
              aria-label={
                isTaken
                  ? `${profile.name} (already taken)`
                  : `Select ${profile.name} (${profile.personality})`
              }
              title={isTaken ? `${profile.name} — already taken in room` : `${profile.name} — ${profile.personality}`}
              onClick={() => onSelect(profile.id)}
              className={`relative flex flex-col items-center gap-1 rounded-2xl p-1.5 sm:p-2 border transition-all text-center ${
                isSelected
                  ? 'bg-[#FAF5ED] border-[#D95732] ring-2 ring-[#D95732]/30 shadow-xs cursor-pointer'
                  : isTaken
                    ? 'bg-[#EAE0D0]/60 border-[#DFD3C1] opacity-45 cursor-not-allowed'
                    : 'bg-[#FAF5ED]/75 border-[#DFD3C1] hover:border-[#D95732] hover:bg-[#FAF5ED] cursor-pointer'
              }`}
            >
              <PlayerAvatar
                name={profile.name}
                type="human"
                avatarColor={profile.accentColor}
                avatarId={profile.id}
                size="sm"
                animated={false}
              />
              <span className="text-[10px] font-semibold text-[#3A2E25] leading-tight truncate w-full">
                {profile.name.split(' ')[0]}
              </span>
              {isSelected && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[#D95732] text-white flex items-center justify-center shadow-xs"
                >
                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                </span>
              )}
              {isTaken && (
                <span className="absolute inset-x-1 bottom-1 rounded bg-[#261E18]/80 text-[8px] font-bold text-[#FAF5ED] py-0.5 leading-none">
                  Taken
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
