import React, { useEffect, useMemo } from 'react';
import { Layers, X } from 'lucide-react';
import {
  formatRank,
  getDiscardedCardsBySuit,
  isRedSuit,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  TRACKER_SUIT_ORDER,
  type Card,
} from '../engine';

interface DiscardedCardTrackerProps {
  removedCards: readonly Card[];
  variant: 'sidebar' | 'drawer';
  open?: boolean;
  onClose?: () => void;
}

const TrackerBody: React.FC<{ removedCards: readonly Card[] }> = ({ removedCards }) => {
  const bySuit = useMemo(() => getDiscardedCardsBySuit(removedCards), [removedCards]);

  return (
    <div className="space-y-2.5">
      {TRACKER_SUIT_ORDER.map((suit) => {
        const cards = bySuit[suit];
        const red = isRedSuit(suit);
        return (
          <div
            key={suit}
            className="rounded-xl bg-[#0F311C]/85 border border-white/10 p-2.5"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#F5F2E8]">
                <span
                  className={`text-sm leading-none px-1.5 py-0.5 rounded bg-white/95 ${
                    red ? 'text-[#C81E1E]' : 'text-[#141A21]'
                  }`}
                >
                  {SUIT_SYMBOLS[suit]}
                </span>
                <span>{SUIT_NAMES[suit]}</span>
              </div>
              <span className="text-[11px] font-mono text-[#B7D6C1] tabular-nums">
                {cards.length}/13
              </span>
            </div>

            {cards.length === 0 ? (
              <p className="text-[11px] text-[#8AB098] italic">None discarded yet</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {cards.map((card) => (
                  <span
                    key={card.id}
                    className={`inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded-md bg-[#FAF6EC] border border-[#DED5C0] font-mono text-[11px] font-bold shadow-xs ${
                      red ? 'text-[#C81E1E]' : 'text-[#141A21]'
                    }`}
                  >
                    {formatRank(card.rank)}
                    <span className="ml-0.5 text-[10px]">{SUIT_SYMBOLS[suit]}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Easy Mode ONLY:
 * Permanent discarded-card tracker displaying ONLY permanently discarded cards
 * from successful tricks, grouped into Spades, Hearts, Clubs, and Diamonds.
 * - Desktop: Permanent sidebar beside the game table (`variant="sidebar"`).
 * - Mobile: Collapsible drawer (`variant="drawer"`).
 */
export const DiscardedCardTracker: React.FC<DiscardedCardTrackerProps> = ({
  removedCards,
  variant,
  open = false,
  onClose,
}) => {
  useEffect(() => {
    if (variant !== 'drawer' || !open || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [variant, open, onClose]);

  if (variant === 'sidebar') {
    return (
      <aside
        aria-label="Discarded cards tracker"
        className="hidden lg:flex lg:flex-col w-72 shrink-0 border-l border-white/12 bg-[#0D2B18]/92 backdrop-blur-xs overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#F0B429]" />
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#F5F2E8]">
                Discarded Cards
              </h2>
              <p className="text-[10px] text-[#A8C8B3]">Easy Mode · Successful tricks only</p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-[#F5C954] tabular-nums">
            {removedCards.length}/52
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <TrackerBody removedCards={removedCards} />
        </div>
      </aside>
    );
  }

  // Mobile collapsible drawer
  if (!open) return null;

  return (
    <div
      className="lg:hidden fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discard-drawer-title"
      onClick={onClose}
    >
      <div
        className="w-[86vw] max-w-xs h-full bg-[#0E2E1A] border-l border-white/15 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3.5 border-b border-white/12 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-[#F0B429] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="discard-drawer-title" className="text-sm font-bold text-[#F5F2E8] truncate">
                Discarded Cards ({removedCards.length}/52)
              </h2>
              <p className="text-[11px] text-[#A8C8B3]">
                Successful tricks only · Returned cards stay in play
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close discarded cards drawer"
            className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5">
          <TrackerBody removedCards={removedCards} />
        </div>
      </div>
    </div>
  );
};
