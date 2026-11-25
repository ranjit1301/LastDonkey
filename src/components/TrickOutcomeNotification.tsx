import React from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import { formatCard, SUIT_SYMBOLS, type TrickOutcome } from '../engine';

interface TrickOutcomeNotificationProps {
  outcome: TrickOutcome;
  players: Array<{ id: string; name: string }>;
  autoAdvance: boolean;
  durationMs: number;
  onContinue: () => void;
}

/**
 * Compact, non-blocking trick outcome banner floating cleanly at top of the table.
 * Auto-advances smoothly with a progress bar (or offers Continue in Manual mode).
 */
export const TrickOutcomeNotification: React.FC<TrickOutcomeNotificationProps> = ({
  outcome,
  players,
  autoAdvance,
  durationMs,
  onContinue,
}) => {
  const getName = (id: string | null) => {
    if (!id) return 'Unknown';
    return players.find((p) => p.id === id)?.name ?? 'Player';
  };

  const isSuccess = outcome.type === 'success';
  const nextLeaderName = getName(outcome.nextLeaderId);
  const finishedNames = outcome.newlyFinishedIds.map((id) => getName(id));

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-16 sm:top-20 z-40 flex justify-center px-3 sm:px-4"
      role="status"
      aria-live="polite"
    >
      <motion.div
        initial={{ opacity: 0, y: -14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.97 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onClick={autoAdvance ? onContinue : undefined}
        title={autoAdvance ? 'Tap to continue immediately' : undefined}
        className={`pointer-events-auto relative overflow-hidden w-full max-w-lg rounded-2xl px-4 py-3.5 sm:px-5 sm:py-4 shadow-[0_18px_40px_-10px_rgba(0,0,0,0.65)] border ${
          autoAdvance ? 'cursor-pointer' : ''
        } ${
          isSuccess
            ? 'bg-[#123820]/96 border-[#F0B429]/65'
            : 'bg-[#361414]/96 border-[#E05252]/70'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
              isSuccess ? 'bg-[#1F5631] text-[#F5C954]' : 'bg-[#571C1C] text-[#FCA5A5]'
            }`}
          >
            {isSuccess ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base sm:text-lg font-bold text-[#FDFBF7]">
                {isSuccess ? 'Successful Trick' : 'Failed Trick (Rang Vapas!)'}
              </h2>
              <span className="text-[11px] font-mono text-[#D6E6DB] tabular-nums shrink-0">
                Trick {outcome.trickNumber} · {SUIT_SYMBOLS[outcome.ledSuit]}
              </span>
            </div>

            <p className="mt-1 text-xs sm:text-sm text-[#EDF5F0] leading-snug">
              {isSuccess ? (
                <>
                  <strong className="text-[#F5C954] tabular-nums">
                    {outcome.removedCards.length} cards
                  </strong>{' '}
                  removed.{' '}
                  {outcome.nextLeaderId && (
                    <>
                      <strong className="text-white">{nextLeaderName}</strong> leads next.
                    </>
                  )}
                </>
              ) : (
                <>
                  <strong className="text-[#FCA5A5]">
                    {getName(outcome.offSuitPlay.playerId)}
                  </strong>{' '}
                  cut with{' '}
                  <strong className="text-white">{formatCard(outcome.offSuitPlay.card)}</strong>.{' '}
                  <strong className="text-[#F5C954]">{getName(outcome.collectorId)}</strong>{' '}
                  collects{' '}
                  <strong className="tabular-nums">{outcome.collectedCards.length} cards</strong>{' '}
                  and leads next.
                </>
              )}
            </p>

            {finishedNames.length > 0 && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#86EFAC]">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {finishedNames.length > 1
                    ? `${finishedNames.join(' & ')} finished simultaneously!`
                    : `${finishedNames[0]} finished and left the table!`}
                </span>
              </div>
            )}
          </div>

          {!autoAdvance && (
            <button
              type="button"
              onClick={onContinue}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg font-bold text-xs transition-colors cursor-pointer whitespace-nowrap shrink-0 self-center ${
                isSuccess
                  ? 'bg-[#F0B429] text-[#1A140B] hover:bg-[#F7C64C]'
                  : 'bg-[#FAF5ED] text-[#361414] hover:bg-white'
              }`}
            >
              Continue
            </button>
          )}
        </div>

        {autoAdvance && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
            <motion.div
              key={`${outcome.trickNumber}-${outcome.type}`}
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: durationMs / 1000, ease: 'linear' }}
              style={{ transformOrigin: 'left center' }}
              className={`h-full w-full ${isSuccess ? 'bg-[#F0B429]' : 'bg-[#F87171]'}`}
            />
          </div>
        )}
      </motion.div>
    </div>
  );
};
