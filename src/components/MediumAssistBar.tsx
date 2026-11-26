import React, { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';
import {
  getPublicRemainingSuitCounts,
  isRedSuit,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  TRACKER_SUIT_ORDER,
  type Card,
} from '../engine';

interface MediumAssistBarProps {
  removedCards: readonly Card[];
  hint: string | null;
}

/**
 * Medium Mode ONLY:
 * - Displays exact remaining cards in play per suit calculated strictly from public info.
 * - Never reveals ranks or identities of undiscarded cards.
 * - Displays occasional, short, unobtrusive strategic hints (never prescriptive, never names a card).
 */
export const MediumAssistBar: React.FC<MediumAssistBarProps> = ({ removedCards, hint }) => {
  const counts = useMemo(() => getPublicRemainingSuitCounts(removedCards), [removedCards]);

  return (
    <div
      aria-label="Remaining cards in play by suit"
      className="relative z-10 shrink-0 w-full max-w-2xl mx-auto flex flex-col items-center gap-1.5"
    >
      <div className="inline-flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-2xl bg-[#10301C]/90 border border-white/12 shadow-xs">
        <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#B6D5C0] mr-0.5">
          In Play:
        </span>
        {TRACKER_SUIT_ORDER.map((suit) => {
          const red = isRedSuit(suit);
          const count = counts[suit];
          return (
            <div
              key={suit}
              title={`${SUIT_NAMES[suit]} remaining in play: ${count}`}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#FAF6EC]/95 text-xs font-bold tabular-nums ${
                count === 0 ? 'opacity-45' : ''
              }`}
            >
              <span className={red ? 'text-[#C81E1E]' : 'text-[#141A21]'}>
                {SUIT_SYMBOLS[suit]}
              </span>
              <span className="font-mono text-[#1B1815]">{count}</span>
            </div>
          );
        })}
      </div>

      {hint && (
        <div
          role="note"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#173E26]/92 border border-[#F0B429]/35 text-[11px] sm:text-xs text-[#F9E7B6] max-w-md text-center"
        >
          <Lightbulb className="w-3.5 h-3.5 text-[#F0B429] shrink-0" />
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
};
