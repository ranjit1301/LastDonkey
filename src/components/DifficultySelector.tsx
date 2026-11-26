import React from 'react';
import { Eye, Flame, Compass } from 'lucide-react';
import { DIFFICULTY_META, type DifficultyMode } from '../engine';

interface DifficultySelectorProps {
  value: DifficultyMode;
  onChange: (next: DifficultyMode) => void;
  compact?: boolean;
  label?: string;
}

const MODES: { id: DifficultyMode; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'easy', icon: Eye },
  { id: 'medium', icon: Compass },
  { id: 'hard', icon: Flame },
];

export const DifficultySelector: React.FC<DifficultySelectorProps> = ({
  value,
  onChange,
  compact = false,
  label = 'Difficulty Mode',
}) => {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-sm font-semibold text-[#3A2E25]">{label}</span>
        <span className="text-xs font-semibold text-[#365B40]">
          {DIFFICULTY_META[value].shortTag}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {MODES.map(({ id, icon: Icon }) => {
          const meta = DIFFICULTY_META[id];
          const active = value === id;

          const activeRing =
            id === 'easy'
              ? 'border-[#365B40] ring-2 ring-[#365B40]/20 bg-[#FAF5ED]'
              : id === 'medium'
                ? 'border-[#C98500] ring-2 ring-[#C98500]/20 bg-[#FAF5ED]'
                : 'border-[#D95732] ring-2 ring-[#D95732]/20 bg-[#FAF5ED]';

          const iconColor =
            id === 'easy'
              ? 'text-[#365B40]'
              : id === 'medium'
                ? 'text-[#B57200]'
                : 'text-[#D95732]';

          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-pressed={active}
              className={`rounded-2xl text-left transition-all cursor-pointer border ${
                compact ? 'p-3' : 'p-3.5'
              } ${
                active
                  ? activeRing
                  : 'bg-[#EFE6D8] border-[#D8CBB8] hover:bg-[#FAF5ED] hover:border-[#C7B8A1]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-bold text-sm text-[#261E18]">
                  <Icon className={`w-4 h-4 shrink-0 ${iconColor}`} />
                  <span>{meta.label}</span>
                </div>
                <span className="text-[11px] font-semibold text-[#6E6052]">{meta.subtitle}</span>
              </div>

              <div className="mt-1.5 space-y-0.5 text-[11px] text-[#5C4E41] leading-snug">
                <p>{meta.assistSummary}</p>
                <p className="text-[#7A6B5C]">{meta.botSummary}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
