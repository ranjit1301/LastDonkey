import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bot, WifiOff } from 'lucide-react';
import {
  isRedSuit,
  SUIT_SYMBOLS,
  type DifficultyMode,
  type Suit,
  type TrickPlay,
} from '../engine';
import { assignOvalOpponentSeats } from '../lib/tableSeatLayout';
import { PlayingCard } from './PlayingCard';

export interface TableOpponentSeatInfo {
  id: string;
  name: string;
  type: 'human' | 'bot';
  cardCount: number;
  finished: boolean;
  finishOrder: number | null;
  removed: boolean;
  connected: boolean;
  consecutiveMissedTurns: number;
  avatarColor: string;
}

interface OvalTableArenaProps {
  opponents: readonly TableOpponentSeatInfo[];
  allPlayers: readonly { id: string; name: string }[];
  phase: 'playing' | 'trick_result' | 'finished';
  currentTurnPlayerId: string | null;
  activeTurnPlayerName: string | null;
  difficulty: DifficultyMode;
  isFirstTurnOfGame: boolean;
  trickNumber: number;
  ledSuit: Suit | null;
  currentTrickPlays: readonly TrickPlay[];
  highestLedPlayCardId: string | null;
  /** Optional center-bottom status slot (TrickOutcomeNotification or YOUR TURN / other-turn banner) */
  statusSlot: React.ReactNode;
}

interface SeatPodProps {
  opp: TableOpponentSeatInfo;
  isTurn: boolean;
  playedThisTrick: boolean;
  compact?: boolean;
  align?: 'left' | 'right' | 'center';
}

const OpponentSeatPod: React.FC<SeatPodProps> = ({
  opp,
  isTurn,
  playedThisTrick,
  compact = false,
  align = 'left',
}) => {
  const isRightAligned = align === 'right';

  return (
    <div
      data-opponent-seat={opp.id}
      data-active-turn={isTurn ? 'true' : 'false'}
      className={`min-w-0 h-full rounded-2xl transition-all duration-150 border flex items-center gap-1.5 sm:gap-2 ${
        compact ? 'px-1.5 py-1 sm:px-2.5 sm:py-1.5' : 'px-2 py-1.5 sm:px-3 sm:py-1.5'
      } ${isRightAligned ? 'flex-row-reverse text-right' : 'flex-row text-left'} ${
        opp.removed
          ? 'bg-[#102919]/60 border-white/10 opacity-55'
          : opp.finished
            ? 'bg-[#133C23]/82 border-[#86EFAC]/45 opacity-90'
            : isTurn
              ? 'bg-[#24663B] border-[#F0B429] ring-1 ring-[#F5C954]/70 shadow-[0_0_18px_rgba(240,180,41,0.36)]'
              : 'bg-[#133A22]/90 border-white/14 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.38)]'
      }`}
    >
      {/* Compact Avatar + Connection/Turn Indicator */}
      <div className="relative shrink-0">
        <div
          className={`${
            compact
              ? 'w-6 h-6 min-[400px]:w-7 min-[400px]:h-7 sm:w-8 sm:h-8 text-[10px] min-[400px]:text-[11px] sm:text-xs'
              : 'w-7 h-7 sm:w-8 sm:h-8 text-xs'
          } rounded-full flex items-center justify-center font-display font-bold border-2 ${
            isTurn
              ? 'border-[#F5C954]'
              : !opp.connected && !opp.finished && !opp.removed
                ? 'border-[#F59E0B]/75 opacity-75'
                : 'border-white/25'
          }`}
          style={{
            backgroundColor: opp.type === 'bot' ? '#244E32' : opp.avatarColor,
            color: opp.type === 'bot' ? '#FFFFFF' : '#1E170F',
          }}
        >
          {opp.type === 'bot' ? (
            <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
          ) : (
            opp.name.slice(0, 1).toUpperCase()
          )}
        </div>

        {isTurn && (
          <span
            aria-hidden="true"
            className="turn-dot-pulse absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#F5C954] ring-2 ring-[#24663B]"
          />
        )}

        {!opp.connected && !opp.finished && !opp.removed && (
          <span
            aria-label="Disconnected"
            title="Disconnected"
            className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#78350F] border border-[#FCD34D] text-[#FDE68A] flex items-center justify-center"
          >
            <WifiOff className="w-2 h-2" aria-hidden="true" />
          </span>
        )}
      </div>

      {/* Name, Card Count & Live Turn/Connection Metadata */}
      <div className="min-w-0 flex-1">
        <div
          className={`${
            compact ? 'text-[11px] sm:text-xs' : 'text-xs sm:text-[13px]'
          } font-bold text-white truncate leading-tight`}
          title={opp.name}
        >
          {opp.name}
        </div>

        <div
          className={`mt-0.5 text-[10px] sm:text-[11px] font-medium text-[#CFE2D5] tabular-nums flex items-center gap-1 flex-wrap leading-tight ${
            isRightAligned ? 'justify-end' : 'justify-start'
          }`}
        >
          {opp.removed ? (
            <span className="text-[#FCA5A5]">Removed</span>
          ) : opp.finished ? (
            <span className="text-[#86EFAC] font-semibold whitespace-nowrap">
              Safe #{opp.finishOrder}
            </span>
          ) : (
            <span className="whitespace-nowrap">
              {opp.cardCount} {opp.cardCount === 1 ? 'card' : 'cards'}
            </span>
          )}

          {!opp.finished && !opp.removed && isTurn && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#F5C954] text-[#1A1205] text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wide leading-none">
              Turn
            </span>
          )}

          {!opp.finished && !opp.removed && playedThisTrick && !isTurn && (
            <span className="inline-flex items-center px-1 py-0.5 rounded bg-[#0E2F1B]/80 text-[#86EFAC] text-[9px] sm:text-[10px] font-semibold leading-none whitespace-nowrap">
              Played
            </span>
          )}
        </div>

        {!opp.finished &&
          !opp.removed &&
          (!opp.connected || opp.consecutiveMissedTurns > 0) && (
            <div className="mt-0.5 text-[9px] sm:text-[10px] font-semibold text-[#FDE68A] leading-tight truncate">
              {!opp.connected ? 'Offline' : `Miss ${opp.consecutiveMissedTurns}/3`}
            </div>
          )}
      </div>
    </div>
  );
};

export const OvalTableArena: React.FC<OvalTableArenaProps> = ({
  opponents,
  allPlayers,
  phase,
  currentTurnPlayerId,
  activeTurnPlayerName,
  difficulty,
  isFirstTurnOfGame,
  trickNumber,
  ledSuit,
  currentTrickPlays,
  highestLedPlayCardId,
  statusSlot,
}) => {
  const seatMap = useMemo(() => assignOvalOpponentSeats(opponents), [opponents]);

  const playedPlayerIds = useMemo(
    () => new Set(currentTrickPlays.map((tp) => tp.playerId)),
    [currentTrickPlays]
  );

  const renderSeat = (
    opp: TableOpponentSeatInfo,
    opts: { compact?: boolean; align?: 'left' | 'right' | 'center' } = {}
  ) => (
    <OpponentSeatPod
      key={opp.id}
      opp={opp}
      isTurn={phase === 'playing' && currentTurnPlayerId === opp.id}
      playedThisTrick={playedPlayerIds.has(opp.id)}
      compact={opts.compact}
      align={opts.align}
    />
  );

  const suitBadge = (
    <div
      data-testid="table-suit-indicator"
      className="px-3 py-0.5 rounded-full bg-white text-[#1B1815] shadow-md text-[11px] sm:text-xs font-bold inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
    >
      {ledSuit ? (
        <>
          <span>Suit:</span>
          <span
            className={`text-sm sm:text-base leading-none ${
              isRedSuit(ledSuit) ? 'text-[#C81E1E]' : 'text-[#141A21]'
            }`}
          >
            {SUIT_SYMBOLS[ledSuit]}
          </span>
        </>
      ) : (
        <span>Trick {trickNumber} · Lead</span>
      )}
    </div>
  );

  const hasSideSeats = Boolean(seatMap.leftSeat || seatMap.rightSeat);
  const isSixPlayerTop = seatMap.topRow.length === 3;
  const isCrowdedTrick = currentTrickPlays.length >= 5;

  // Responsive card sizing & non-overlapping spacing inside the oval so 1-6 played cards + player labels never collide even at 360px
  const trickCardSize: 'xs' | 'sm' | 'md' = isCrowdedTrick
    ? 'xs'
    : currentTrickPlays.length >= 4
      ? 'sm'
      : 'md';
  const trickRowSpacing = isCrowdedTrick
    ? 'gap-1.5 min-[400px]:gap-2 sm:gap-2.5'
    : currentTrickPlays.length === 4
      ? 'gap-2 sm:gap-3'
      : 'gap-2.5 sm:gap-3.5';
  const trickLabelMaxW = isCrowdedTrick
    ? 'max-w-[46px] min-[400px]:max-w-[50px] sm:max-w-[66px]'
    : 'max-w-[62px] sm:max-w-[82px]';

  return (
    <div
      data-table-arrangement={seatMap.mode}
      className="relative z-10 grow shrink-0 basis-auto w-full max-w-4xl mx-auto flex flex-col justify-between gap-2 sm:gap-2.5 [@media(max-height:500px)]:gap-1.5"
    >
      {/* Cohesive Oval Table Cluster: Opponents stay seated snugly around the oval felt (no detached vertical void) */}
      <div className="grow shrink-0 basis-auto flex flex-col justify-center gap-2 sm:gap-2.5 [@media(max-height:500px)]:gap-1.5">
        {/* ZONE A (TOP ARC): Top Opponents arranged around the upper curve of the oval table */}
        {seatMap.topRow.length > 0 && (
          <section aria-label="Opponents" className="shrink-0 w-full">
            {seatMap.mode === '2p' || seatMap.mode === '4p' ? (
              <div className="flex justify-center">
                <div className="w-full max-w-[208px] sm:max-w-[224px]">
                  {renderSeat(seatMap.topRow[0].opponent)}
                </div>
              </div>
            ) : seatMap.mode === '3p' || seatMap.mode === '5p' ? (
              <div className="grid grid-cols-2 max-w-[440px] sm:max-w-[480px] mx-auto gap-2 sm:gap-6 items-stretch">
                <div className="min-w-0">
                  {renderSeat(seatMap.topRow[0].opponent, { align: 'left' })}
                </div>
                <div className="min-w-0">
                  {renderSeat(seatMap.topRow[1].opponent, { align: 'right' })}
                </div>
              </div>
            ) : (
              /* 6 Players: 3 seats gently arched along the top rim (center raised slightly) */
              <div className="grid grid-cols-3 max-w-[600px] mx-auto gap-1.5 sm:gap-3 items-stretch">
                <div className="min-w-0 sm:translate-y-1">
                  {renderSeat(seatMap.topRow[0].opponent, {
                    compact: isSixPlayerTop,
                    align: 'left',
                  })}
                </div>
                <div className="min-w-0 -translate-y-0.5 sm:-translate-y-1">
                  {renderSeat(seatMap.topRow[1].opponent, { compact: isSixPlayerTop })}
                </div>
                <div className="min-w-0 sm:translate-y-1">
                  {renderSeat(seatMap.topRow[2].opponent, {
                    compact: isSixPlayerTop,
                    align: 'right',
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* MOBILE SHOULDER ROW (<640px ONLY for 4-6 players): Left & Right seats flank the Suit Badge above the oval felt so played cards keep full screen width */}
        {hasSideSeats && (
          <div
            aria-label="Side opponents"
            className="flex sm:hidden items-stretch justify-between gap-1.5 shrink-0"
          >
            <div className="min-w-0 flex-1 max-w-[138px]">
              {seatMap.leftSeat &&
                renderSeat(seatMap.leftSeat.opponent, { compact: true, align: 'left' })}
            </div>
            <div className="shrink-0 flex items-center">{suitBadge}</div>
            <div className="min-w-0 flex-1 max-w-[138px]">
              {seatMap.rightSeat &&
                renderSeat(seatMap.rightSeat.opponent, { compact: true, align: 'right' })}
            </div>
          </div>
        )}

        {/* ZONE B: OVAL-INSPIRED PLAYING AREA + DESKTOP/TABLET SIDE FLANK SEATS */}
        <div
          className={
            hasSideSeats
              ? 'shrink-0 flex items-center justify-center sm:grid sm:grid-cols-[minmax(126px,158px)_1fr_minmax(126px,158px)] sm:items-center sm:gap-2.5'
              : 'shrink-0 flex items-center justify-center'
          }
        >
          {/* Desktop/Tablet Left Flank Seat (9 o'clock) */}
          {hasSideSeats && (
            <div className="hidden sm:block min-w-0">
              {seatMap.leftSeat && renderSeat(seatMap.leftSeat.opponent, { align: 'left' })}
            </div>
          )}

          {/* Central Oval Felt Surface */}
          <section
            aria-label="Current trick"
            className="table-oval-felt relative w-full max-w-[580px] mx-auto px-2.5 sm:px-6 py-2.5 sm:py-3.5 [@media(max-height:500px)]:py-1.5 flex flex-col items-center justify-center gap-2 [@media(max-height:500px)]:gap-1 min-h-[116px] sm:min-h-[144px] [@media(max-height:500px)]:min-h-[96px]"
          >
            {/* Suit Badge inside oval (always shown for 2-3p; shown on sm+ for 4-6p since mobile puts it between shoulders) */}
            <div className={hasSideSeats ? 'hidden sm:flex justify-center' : 'flex justify-center'}>
              {suitBadge}
            </div>

            {/* Center Played Cards (top-aligned so an off-suit Cut! tag never shifts a card upward) */}
            <div
              className={`w-full flex flex-wrap items-start justify-center ${trickRowSpacing} min-h-[84px] sm:min-h-[104px] [@media(max-height:500px)]:min-h-[76px]`}
            >
              {currentTrickPlays.length === 0 ? (
                <div className="self-center rounded-2xl border border-dashed border-white/22 bg-black/15 px-4 py-3 text-center text-xs sm:text-sm text-[#DCEBE0]">
                  {isFirstTurnOfGame
                    ? 'Ace of Spades (A♠) leads Trick 1'
                    : `${activeTurnPlayerName ?? 'Leader'} starts Trick ${trickNumber}`}
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {currentTrickPlays.map((tp) => {
                    const owner = allPlayers.find((p) => p.id === tp.playerId);
                    const isHighest = highestLedPlayCardId === tp.card.id;
                    const isOffSuit = ledSuit !== null && tp.card.suit !== ledSuit;

                    return (
                      <motion.div
                        key={tp.card.id}
                        initial={{ opacity: 0, y: 12, scale: 0.92 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        className="flex flex-col items-center gap-0.5 sm:gap-1"
                      >
                        <PlayingCard
                          card={tp.card}
                          size={trickCardSize}
                          highlighted={difficulty !== 'hard' && isHighest}
                          className={isCrowdedTrick ? 'sm:w-14 sm:h-20' : ''}
                        />
                        <span
                          className={`text-[10px] sm:text-[11px] font-semibold text-white/95 ${trickLabelMaxW} truncate text-center leading-tight`}
                          title={owner?.name ?? 'Player'}
                        >
                          {owner?.name ?? 'Player'}
                        </span>
                        {isOffSuit && (
                          <span className="text-[9px] sm:text-[10px] font-bold text-[#FCA5A5] leading-none">
                            Cut!
                          </span>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </section>

          {/* Desktop/Tablet Right Flank Seat (3 o'clock) */}
          {hasSideSeats && (
            <div className="hidden sm:block min-w-0">
              {seatMap.rightSeat && renderSeat(seatMap.rightSeat.opponent, { align: 'right' })}
            </div>
          )}
        </div>
      </div>

      {/* Inline Status / Turn Banner Slot (below the oval table, right above the local player's hand) */}
      <div className="shrink-0 w-full flex justify-center">{statusSlot}</div>
    </div>
  );
};
