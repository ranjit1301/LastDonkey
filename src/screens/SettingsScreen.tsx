import React from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { PWAInstallButton } from '../components/PWAInstallButton';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type GameSpeed,
  type PlayTapMode,
  type TurnTimerSeconds,
} from '../lib/settings';

interface SettingsScreenProps {
  settings: AppSettings;
  onUpdate: (next: AppSettings) => void;
  onBack: () => void;
  backLabel?: string;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  onUpdate,
  onBack,
  backLabel = 'Back',
}) => {
  const patch = (partial: Partial<AppSettings>) => {
    onUpdate({ ...settings, ...partial });
  };

  return (
    <div className="min-h-screen cream-surface flex flex-col">
      <header className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-5 pb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-3.5 rounded-full bg-[#EFE6D8] hover:bg-[#E5D9C6] inline-flex items-center gap-2 text-sm font-semibold text-[#261E18] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </button>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#261E18]">Settings</h1>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 pb-10 space-y-5">
        <div className="rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] divide-y divide-[#DFD3C1] overflow-hidden shadow-sm">
          {/* Sound Effects */}
          <div className="p-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#261E18]">Sound Effects</h2>
              <p className="mt-0.5 text-xs sm:text-sm text-[#6E6052]">
                Gentle card flicks, trick chimes, and soft cut feedback.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.soundEnabled}
              onClick={() => patch({ soundEnabled: !settings.soundEnabled })}
              className={`min-h-[40px] px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                settings.soundEnabled
                  ? 'bg-[#365B40] text-white'
                  : 'bg-[#E6DAC7] text-[#5C4E41]'
              }`}
            >
              {settings.soundEnabled ? 'On' : 'Off'}
            </button>
          </div>

          {/* Game Animations */}
          <div className="p-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#261E18]">Game Animations</h2>
              <p className="mt-0.5 text-xs sm:text-sm text-[#6E6052]">
                Failed-trick card flights, avatar reactions, and celebration effects.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.animationsEnabled}
              aria-label="Game Animations"
              onClick={() => patch({ animationsEnabled: !settings.animationsEnabled })}
              className={`min-h-[40px] px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                settings.animationsEnabled
                  ? 'bg-[#365B40] text-white'
                  : 'bg-[#E6DAC7] text-[#5C4E41]'
              }`}
            >
              {settings.animationsEnabled ? 'On' : 'Off'}
            </button>
          </div>

          {/* Turn Timer */}
          <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#261E18]">
                Player Turn Timer
              </h2>
              <p className="mt-0.5 text-xs sm:text-sm text-[#6E6052]">
                Auto-plays a random legal card when time reaches 0.
              </p>
            </div>
            <div
              role="group"
              aria-label="Player turn timer"
              className="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-[#E8DDCC] self-start sm:self-auto"
            >
              {([0, 10, 15, 20, 30] as TurnTimerSeconds[]).map((sec) => (
                <button
                  key={sec}
                  type="button"
                  aria-pressed={settings.turnTimerSeconds === sec}
                  onClick={() => patch({ turnTimerSeconds: sec })}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold font-mono tabular-nums cursor-pointer transition-colors ${
                    settings.turnTimerSeconds === sec
                      ? 'bg-[#D95732] text-white'
                      : 'text-[#4E4136] hover:text-[#261E18]'
                  }`}
                >
                  {sec === 0 ? 'Off' : `${sec}s`}
                </button>
              ))}
            </div>
          </div>

          {/* Card Play Tap Mode */}
          <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#261E18]">
                Card Selection Control
              </h2>
              <p className="mt-0.5 text-xs sm:text-sm text-[#6E6052]">
                Select &amp; Play prevents accidental card taps on mobile.
              </p>
            </div>
            <div
              role="group"
              aria-label="Card selection control"
              className="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-[#E8DDCC] self-start sm:self-auto"
            >
              {(
                [
                  { id: 'confirm', label: 'Select & Play' },
                  { id: 'single-tap', label: 'Single Tap' },
                ] as { id: PlayTapMode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={settings.playTapMode === opt.id}
                  onClick={() => patch({ playTapMode: opt.id })}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors whitespace-nowrap ${
                    settings.playTapMode === opt.id
                      ? 'bg-[#365B40] text-white'
                      : 'text-[#4E4136] hover:text-[#261E18]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hand Sort Order */}
          <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#261E18]">Hand Sort Order</h2>
              <p className="mt-0.5 text-xs sm:text-sm text-[#6E6052]">
                Sort cards within each suit from Ace to 2, or 2 to Ace.
              </p>
            </div>
            <div
              role="group"
              aria-label="Hand sort order"
              className="inline-flex gap-1 p-1 rounded-xl bg-[#E8DDCC] self-start sm:self-auto"
            >
              <button
                type="button"
                aria-pressed={settings.sortOrder === 'desc'}
                onClick={() => patch({ sortOrder: 'desc' })}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors whitespace-nowrap ${
                  settings.sortOrder === 'desc'
                    ? 'bg-[#365B40] text-white'
                    : 'text-[#4E4136] hover:text-[#261E18]'
                }`}
              >
                A → 2
              </button>
              <button
                type="button"
                aria-pressed={settings.sortOrder === 'asc'}
                onClick={() => patch({ sortOrder: 'asc' })}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors whitespace-nowrap ${
                  settings.sortOrder === 'asc'
                    ? 'bg-[#365B40] text-white'
                    : 'text-[#4E4136] hover:text-[#261E18]'
                }`}
              >
                2 → A
              </button>
            </div>
          </div>

          {/* Local Practice Pace */}
          <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#261E18]">Practice Game Pace</h2>
              <p className="mt-0.5 text-xs sm:text-sm text-[#6E6052]">
                Bot turn speed and trick banner timing in local games.
              </p>
            </div>
            <div
              role="group"
              aria-label="Practice game pace"
              className="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-[#E8DDCC] self-start sm:self-auto"
            >
              {(
                [
                  { id: 'relaxed', label: 'Relaxed' },
                  { id: 'normal', label: 'Normal' },
                  { id: 'fast', label: 'Fast' },
                ] as { id: GameSpeed; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={settings.gameSpeed === opt.id}
                  onClick={() => patch({ gameSpeed: opt.id })}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors whitespace-nowrap ${
                    settings.gameSpeed === opt.id
                      ? 'bg-[#365B40] text-white'
                      : 'text-[#4E4136] hover:text-[#261E18]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Auto-Continue Trick Notifications */}
          <div className="p-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#261E18]">
                Auto-Continue Trick Banners
              </h2>
              <p className="mt-0.5 text-xs sm:text-sm text-[#6E6052]">
                Automatically move into the next trick in local games.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoAdvanceTricks}
              onClick={() => patch({ autoAdvanceTricks: !settings.autoAdvanceTricks })}
              className={`min-h-[40px] px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                settings.autoAdvanceTricks
                  ? 'bg-[#365B40] text-white'
                  : 'bg-[#E6DAC7] text-[#5C4E41]'
              }`}
            >
              {settings.autoAdvanceTricks ? 'Auto' : 'Manual'}
            </button>
          </div>

          {/* Open Hands Pass-and-Play Mode */}
          <div className="p-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#261E18]">
                Pass-and-Play Open Hands
              </h2>
              <p className="mt-0.5 text-xs sm:text-sm text-[#6E6052]">
                Skip device handoff screens when testing all seats locally.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.openHandsTesting}
              onClick={() => patch({ openHandsTesting: !settings.openHandsTesting })}
              className={`min-h-[40px] px-4 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                settings.openHandsTesting
                  ? 'bg-[#365B40] text-white'
                  : 'bg-[#E6DAC7] text-[#5C4E41]'
              }`}
            >
              {settings.openHandsTesting ? 'On' : 'Off'}
            </button>
          </div>

          <PWAInstallButton variant="card" />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onUpdate({ ...DEFAULT_SETTINGS, playerName: settings.playerName })}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#EFE6D8] border border-[#DDD1BE] text-xs font-semibold text-[#3A2E25] hover:border-[#D95732] inline-flex items-center gap-2 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to Defaults
          </button>
        </div>
      </main>
    </div>
  );
};
