import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  History,
  Sparkles,
} from 'lucide-react';
import { isRedSuit, type TrickOutcome } from '../engine';
import {
  buildTrickHistoryView,
  type TrickHistoryEntry,
  type TrickHistoryPlayerLookup,
} from '../lib/trickHistory';
import { PlayingCard } from './PlayingCard';

type TrickFilter = 'all' | 'success' | 'failed';

interface TrickHistorySectionProps {
  trickHistory: readonly TrickOutcome[];
  players: readonly TrickHistoryPlayerLookup[];
  fallbackSeats?: readonly { playerId: string; name: string }[];
}

export const TrickHistorySection: React.FC<TrickHistorySectionProps> = ({
  trickHistory,
  players,
  fallbackSeats = [],
}) => {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<TrickFilter>('all');

  const historyView = useMemo(
    () => buildTrickHistoryView(trickHistory, players, fallbackSeats),
    [trickHistory, players, fallbackSeats]
  );

  const filteredEntries = useMemo(() => {
    if (filter === 'all') return historyView.entries;
    return historyView.entries.filter((entry) => entry.type === filter);
  }, [historyView.entries, filter]);

  const { totalTricks, successfulTricks, failedTricks } = historyView.summary;

  return (
    <section
      aria-label="Trick History"
      className="rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] overflow-hidden"
    >
      {/* Collapsible Header Bar with Summary Counts */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls="trick-history-panel"
        className="w-full px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left hover:bg-[#EDE3D3]/60 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-2xl bg-[#E7DAC6] text-[#365B40] flex items-center justify-center shrink-0">
            <History className="w-4 h-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-[#261E18] leading-tight">
              Trick History
            </h2>
            <p className="text-xs text-[#6E6052] mt-0.5">
              {totalTricks === 0
                ? 'No completed tricks recorded'
                : expanded
                  ? 'Chronological breakdown of every trick played'
                  : 'Tap to review every card played in this match'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap tabular-nums">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#E3F3E8] border border-[#A8D8B7] text-[#1D5631] text-xs font-bold">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {successfulTricks} Successful
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FCE9E6] border border-[#EAB4AC] text-[#A92B20] text-xs font-bold">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {failedTricks} Failed
            </span>
          </div>

          <span className="inline-flex items-center gap-1 text-xs font-bold text-[#5A4B3E] pl-1 shrink-0">
            <span>{expanded ? 'Hide' : 'Review'}</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-150 ${
                expanded ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </span>
        </div>
      </button>

      {/* Expandable Chronological Trick List */}
      {expanded && (
        <div
          id="trick-history-panel"
          className="border-t border-[#DFD3C1] px-4 sm:px-5 py-4 space-y-3.5 bg-[#FAF5ED]/75"
        >
          {totalTricks === 0 ? (
            <p className="text-sm text-[#6E6052] text-center py-4">
              No completed tricks were recorded in this match.
            </p>
          ) : (
            <>
              {/* Filter Controls + Summary Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="group"
                  aria-label="Filter trick history"
                  className="inline-flex items-center gap-1.5 flex-wrap"
                >
                  {(
                    [
                      { id: 'all', label: `All (${totalTricks})` },
                      { id: 'success', label: `Successful (${successfulTricks})` },
                      { id: 'failed', label: `Failed (${failedTricks})` },
                    ] as const
                  ).map((tab) => {
                    const active = filter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setFilter(tab.id)}
                        aria-pressed={active}
                        className={`min-h-[34px] px-3 py-1 rounded-full text-xs font-bold transition-colors cursor-pointer tabular-nums ${
                          active
                            ? tab.id === 'success'
                              ? 'bg-[#2E6340] text-white'
                              : tab.id === 'failed'
                                ? 'bg-[#C8372D] text-white'
                                : 'bg-[#261E18] text-[#FAF5ED]'
                            : 'bg-[#EFE6D8] text-[#5C4E41] hover:bg-[#E5D8C5]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] font-medium text-[#736456]">
                  Shown in play order (Trick 1 → {totalTricks})
                </span>
              </div>

              {filteredEntries.length === 0 ? (
                <p className="text-sm text-[#6E6052] text-center py-4">
                  No {filter === 'success' ? 'successful' : 'failed'} tricks in this match.
                </p>
              ) : (
                <ol className="space-y-3 max-h-[60vh] overflow-y-auto pr-0.5">
                  {filteredEntries.map((entry) => (
                    <TrickHistoryCard key={entry.trickNumber} entry={entry} />
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
};

const TrickHistoryCard: React.FC<{ entry: TrickHistoryEntry }> = ({ entry }) => {
  const isSuccess = entry.type === 'success';
  const redSuit = isRedSuit(entry.ledSuit);

  return (
    <li
      className={`rounded-2xl border border-l-4 p-3.5 sm:p-4 space-y-3 ${
        isSuccess
          ? 'bg-[#EEF8F1] border-[#B6DFC3] border-l-[#2E6340]'
          : 'bg-[#FDF1EF] border-[#EFC0B9] border-l-[#C8372D]'
      }`}
    >
      {/* Top Row: Trick Number, Led Suit & Outcome Badge */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-xs sm:text-sm text-[#261E18] tabular-nums">
            Trick #{entry.trickNumber}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/90 border border-[#DFD3C1] text-[11px] font-semibold text-[#3B3027]">
            <span>Led:</span>
            <span className={redSuit ? 'text-[#C81E1E]' : 'text-[#141A21]'}>
              {entry.ledSuitSymbol}
            </span>
            <span>{entry.ledSuitLabel}</span>
          </span>
        </div>

        <span
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold tracking-wide uppercase ${
            isSuccess
              ? 'bg-[#2E6340] text-white'
              : 'bg-[#C8372D] text-white'
          }`}
        >
          {isSuccess ? (
            <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
          )}
          {isSuccess ? 'Successful' : 'Failed · Cut'}
        </span>
      </div>

      {/* Cards Played in Exact Chronological Play Order */}
      <div className="flex flex-wrap items-end gap-2 sm:gap-2.5">
        {entry.plays.map((play, idx) => (
          <div
            key={`${entry.trickNumber}-${play.order}-${play.card.id}`}
            className={`flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 border ${
              play.isOffSuitCut
                ? 'bg-[#FDE2DE] border-[#DF8B81]'
                : play.isHighestLed
                  ? isSuccess
                    ? 'bg-[#DCF2E3] border-[#7DC496]'
                    : 'bg-[#FFF3DC] border-[#E4BE67]'
                  : 'bg-white/75 border-[#E5DAC8]'
            }`}
          >
            <div className="flex items-center gap-1 text-[10px] font-bold leading-none">
              <span className="font-mono text-[#736456] tabular-nums">#{idx + 1}</span>
              {play.isOffSuitCut ? (
                <span className="text-[#B42318] uppercase">Cut</span>
              ) : play.isHighestLed ? (
                <span className={isSuccess ? 'text-[#1D5631]' : 'text-[#9A5B00]'}>
                  {isSuccess ? 'High' : 'Collects'}
                </span>
              ) : play.isLead ? (
                <span className="text-[#4F4338]">Lead</span>
              ) : null}
            </div>

            <PlayingCard
              card={play.card}
              size="xs"
              highlighted={play.isHighestLed && isSuccess}
            />

            <span
              className="text-[11px] font-semibold text-[#261E18] max-w-[68px] truncate text-center leading-tight"
              title={play.playerName}
            >
              {play.playerName}
            </span>
          </div>
        ))}
      </div>

      {/* Outcome & Failure Details */}
      <div className="space-y-1 text-xs leading-snug">
        {entry.failureReason && (
          <p className="font-semibold text-[#9F241B]">
            <span className="font-bold">Reason:</span> {entry.failureReason}
          </p>
        )}
        <p className={isSuccess ? 'text-[#1D4B2B] font-medium' : 'text-[#5C2B25] font-medium'}>
          {entry.outcomeText}
        </p>
        {entry.newlyFinishedNames.length > 0 && (
          <p className="inline-flex items-center gap-1 text-[#1D5631] font-semibold pt-0.5">
            <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {entry.newlyFinishedNames.length > 1
                ? `${entry.newlyFinishedNames.join(' & ')} finished safe on this trick`
                : `${entry.newlyFinishedNames[0]} finished safe on this trick`}
            </span>
          </p>
        )}
      </div>
    </li>
  );
};
