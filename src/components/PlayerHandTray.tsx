import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  isRedSuit,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  type Card,
  type Suit,
} from '../engine';
import {
  buildSuitJumpGroups,
  computeScrollTargetForRange,
  getAutoScrollPlayableTarget,
  getHandLayoutSpec,
} from '../lib/handLayout';
import type { CardSelectionState } from '../lib/tableTurnState';
import { PlayingCard } from './PlayingCard';

interface PlayerHandTrayProps {
  sortedHand: readonly Card[];
  ledSuit: Suit | null;
  canActNow: boolean;
  isFirstTurnOfGame: boolean;
  turnContextKey: string;
  legalCardIds: ReadonlySet<string>;
  selectedCardId: string | null;
  getCardSelectionState: (cardId: string) => CardSelectionState;
  onCardTap: (card: Card) => void;
}

interface ScrollMetrics {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  hasOverflow: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const PlayerHandTray: React.FC<PlayerHandTrayProps> = ({
  sortedHand,
  ledSuit,
  canActNow,
  isFirstTurnOfGame,
  turnContextKey,
  legalCardIds,
  selectedCardId,
  getCardSelectionState,
  onCardTap,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const cardElMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastAutoScrolledKeyRef = useRef<string | null>(null);

  // Touch drag guard: prevents accidental card taps while swiping on Android Chrome / iOS Safari
  const touchStateRef = useRef<{ active: boolean; startX: number; startY: number }>({
    active: false,
    startX: 0,
    startY: 0,
  });
  const suppressClickUntilRef = useRef<number>(0);

  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics>({
    canScrollLeft: false,
    canScrollRight: false,
    hasOverflow: false,
  });

  const layoutSpec = useMemo(() => getHandLayoutSpec(sortedHand.length), [sortedHand.length]);
  const suitGroups = useMemo(
    () => buildSuitJumpGroups(sortedHand, ledSuit),
    [sortedHand, ledSuit]
  );

  const syncScrollMetrics = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const hasOverflow = maxScroll > 4;
    const canScrollLeft = hasOverflow && el.scrollLeft > 4;
    const canScrollRight = hasOverflow && el.scrollLeft < maxScroll - 4;

    setScrollMetrics((prev) =>
      prev.hasOverflow === hasOverflow &&
      prev.canScrollLeft === canScrollLeft &&
      prev.canScrollRight === canScrollRight
        ? prev
        : { hasOverflow, canScrollLeft, canScrollRight }
    );
  }, []);

  // Recompute overflow state on hand size changes, viewport resizes, or Easy-sidebar toggles
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    syncScrollMetrics();

    const onScroll = () => {
      if (touchStateRef.current.active) {
        suppressClickUntilRef.current = Date.now() + 200;
      }
      syncScrollMetrics();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', syncScrollMetrics, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => syncScrollMetrics());
      ro.observe(el);
      if (stripRef.current) ro.observe(stripRef.current);
    }

    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', syncScrollMetrics);
      ro?.disconnect();
    };
  }, [syncScrollMetrics, sortedHand.length, layoutSpec.tier]);

  // One-shot non-intrusive auto-scroll to bring playable cards into view when led suit / Turn 1 starts
  const autoScrollTarget = useMemo(
    () =>
      getAutoScrollPlayableTarget({
        canActNow,
        isFirstTurnOfGame,
        ledSuit,
        sortedHand,
        legalCardIds,
      }),
    [canActNow, isFirstTurnOfGame, ledSuit, sortedHand, legalCardIds]
  );

  useEffect(() => {
    if (!autoScrollTarget) {
      if (!canActNow) {
        lastAutoScrolledKeyRef.current = null;
      }
      return;
    }

    const contextKey = `${turnContextKey}::${ledSuit ?? 'lead'}::${autoScrollTarget.targetCardId}`;
    if (lastAutoScrolledKeyRef.current === contextKey) return;

    const container = scrollRef.current;
    const firstCardEl = cardElMapRef.current.get(autoScrollTarget.targetCardId);
    const lastCardId = sortedHand[autoScrollTarget.lastIndex]?.id;
    const lastCardEl = lastCardId ? cardElMapRef.current.get(lastCardId) : firstCardEl;
    if (!container || !firstCardEl) return;

    // Wait one paint frame so card layout measurements are final before scrolling
    const rafId = window.requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const firstRect = firstCardEl.getBoundingClientRect();
      const lastRect = (lastCardEl ?? firstCardEl).getBoundingClientRect();

      const rangeStartPx = firstRect.left - containerRect.left + container.scrollLeft;
      const rangeEndPx = lastRect.right - containerRect.left + container.scrollLeft;

      const targetScrollLeft = computeScrollTargetForRange({
        scrollLeft: container.scrollLeft,
        clientWidth: container.clientWidth,
        scrollWidth: container.scrollWidth,
        rangeStartPx,
        rangeEndPx,
      });

      lastAutoScrolledKeyRef.current = contextKey;

      if (targetScrollLeft !== null) {
        container.scrollTo({
          left: targetScrollLeft,
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
      }
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [autoScrollTarget, canActNow, ledSuit, sortedHand, turnContextKey]);

  const scrollByDirection = useCallback((direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.max(180, Math.round(el.clientWidth * 0.72));
    el.scrollBy({
      left: direction * step,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, []);

  const jumpToCardId = useCallback((cardId: string) => {
    const container = scrollRef.current;
    const cardEl = cardElMapRef.current.get(cardId);
    if (!container || !cardEl) return;

    const containerRect = container.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    const cardLeftInStrip = cardRect.left - containerRect.left + container.scrollLeft;
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const desired = Math.max(0, Math.min(maxScroll, cardLeftInStrip - 20));

    container.scrollTo({
      left: desired,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, []);

  // Desktop convenience: vertical mouse wheel over an overflowing hand scrolls it horizontally
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 4) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

    const nextLeft = el.scrollLeft + e.deltaY;
    const movingIntoBounds =
      (e.deltaY > 0 && el.scrollLeft < maxScroll - 1) ||
      (e.deltaY < 0 && el.scrollLeft > 1);
    if (movingIntoBounds) {
      el.scrollLeft = Math.max(0, Math.min(maxScroll, nextLeft));
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      if (!el || !scrollMetrics.hasOverflow) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        el.scrollBy({ left: -120, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        el.scrollBy({ left: 120, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      } else if (e.key === 'Home') {
        e.preventDefault();
        el.scrollTo({ left: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      } else if (e.key === 'End') {
        e.preventDefault();
        el.scrollTo({
          left: el.scrollWidth,
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
      }
    },
    [scrollMetrics.hasOverflow]
  );

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    touchStateRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
    };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (!touch || !touchStateRef.current.active) return;
    const dx = touch.clientX - touchStateRef.current.startX;
    const dy = touch.clientY - touchStateRef.current.startY;
    if (Math.hypot(dx, dy) > 10) {
      suppressClickUntilRef.current = Date.now() + 260;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchStateRef.current.active = false;
  }, []);

  const handleCardClickSafe = useCallback(
    (card: Card) => {
      if (Date.now() < suppressClickUntilRef.current) return;
      onCardTap(card);
    },
    [onCardTap]
  );

  const showUtilityBar =
    (layoutSpec.showSuitJumpBar && suitGroups.length > 1) || scrollMetrics.hasOverflow;

  return (
    <div className="w-full">
      {/* Suit Quick-Jump + Mobile Non-Obstructing Scroll Bar (only shown for large/overflowing hands) */}
      {showUtilityBar && (
        <div
          aria-label="Hand navigation controls"
          className="flex items-center justify-between gap-2 pb-1 px-0.5"
        >
          {/* Suit jump controls (always interactive buttons, single-line) */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0">
            {suitGroups.length > 1 &&
              suitGroups.map((group) => {
                const red = isRedSuit(group.suit);
                const highlightPlayableSuit = canActNow && group.isLedSuit;
                return (
                  <button
                    key={group.suit}
                    type="button"
                    onClick={() => jumpToCardId(group.firstCardId)}
                    aria-label={`Jump to ${SUIT_NAMES[group.suit]} (${group.count} ${
                      group.count === 1 ? 'card' : 'cards'
                    }${highlightPlayableSuit ? ', active suit' : ''})`}
                    className={`min-h-[32px] px-2 sm:px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap shrink-0 tabular-nums transition-colors cursor-pointer ${
                      highlightPlayableSuit
                        ? 'bg-[#F5C954] text-[#1A1205] ring-1 ring-[#FFF3BF] shadow-xs'
                        : 'bg-[#123921]/90 hover:bg-[#1B5130] border border-white/15 text-[#E5F2E9]'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`text-sm leading-none ${
                        highlightPlayableSuit
                          ? red
                            ? 'text-[#B91C1C]'
                            : 'text-[#141A21]'
                          : red
                            ? 'text-[#FCA5A5]'
                            : 'text-white'
                      }`}
                    >
                      {SUIT_SYMBOLS[group.suit]}
                    </span>
                    <span>{group.count}</span>
                  </button>
                );
              })}
          </div>

          {/* Mobile (<sm) scroll buttons sit in the header bar so they NEVER cover cards */}
          {scrollMetrics.hasOverflow && (
            <div className="flex sm:hidden items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={!scrollMetrics.canScrollLeft}
                onClick={() => scrollByDirection(-1)}
                aria-label="Scroll hand left"
                className="w-8 h-8 rounded-lg bg-[#164227] border border-white/20 text-white flex items-center justify-center active:scale-95 transition-opacity disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={!scrollMetrics.canScrollRight}
                onClick={() => scrollByDirection(1)}
                aria-label="Scroll hand right"
                className="w-8 h-8 rounded-lg bg-[#164227] border border-white/20 text-white flex items-center justify-center active:scale-95 transition-opacity disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Card Strip Row: Desktop flanking arrows + Edge Fades + Scrollable Hand Track */}
      <div className="relative flex items-center gap-1.5">
        {/* Desktop/Tablet Left Scroll Button (outside scroll track — never covers cards) */}
        {scrollMetrics.hasOverflow && (
          <button
            type="button"
            disabled={!scrollMetrics.canScrollLeft}
            onClick={() => scrollByDirection(-1)}
            aria-label="Scroll hand left"
            title="Scroll cards left"
            className="hidden sm:flex shrink-0 w-9 h-14 rounded-xl bg-[#143D23]/95 hover:bg-[#1E5934] border border-[#F5C954]/35 text-[#F8F3E6] items-center justify-center shadow-md transition-all disabled:opacity-30 disabled:border-white/10 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" aria-hidden="true" />
          </button>
        )}

        {/* Scroll Viewport with Edge Fade Cues */}
        <div className="relative flex-1 min-w-0">
          {scrollMetrics.canScrollLeft && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-7 sm:w-9 z-30 bg-gradient-to-r from-[#0F311C] via-[#0F311C]/65 to-transparent rounded-l-lg"
            />
          )}
          {scrollMetrics.canScrollRight && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-7 sm:w-9 z-30 bg-gradient-to-l from-[#0F311C] via-[#0F311C]/65 to-transparent rounded-r-lg"
            />
          )}

          {/* Vertical padding pt-6 sm:pt-7 pb-3 guarantees lifted selected cards (-20px + 3px ring) & dimmed cards (+6px) never clip */}
          <div
            ref={scrollRef}
            aria-label="Playable hand cards"
            tabIndex={scrollMetrics.hasOverflow ? 0 : undefined}
            onWheel={handleWheel}
            onKeyDown={handleKeyDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            className="w-full overflow-x-auto touch-pan-x hand-scrollbar pt-6 sm:pt-7 pb-3 px-2 rounded-lg"
          >
            <div
              ref={stripRef}
              data-hand-tier={layoutSpec.tier}
              className={`flex items-end justify-start sm:justify-center min-w-max mx-auto ${layoutSpec.overlapClass}`}
            >
              {sortedHand.map((card) => {
                const cardState = getCardSelectionState(card.id);
                const isSelected = selectedCardId === card.id;

                return (
                  <div
                    key={card.id}
                    ref={(node) => {
                      if (node) {
                        cardElMapRef.current.set(card.id, node);
                      } else {
                        cardElMapRef.current.delete(card.id);
                      }
                    }}
                    className={`transition-all ${
                      isSelected ? 'z-30' : cardState.isSelectable ? 'hover:z-20' : ''
                    }`}
                  >
                    <PlayingCard
                      card={card}
                      size={layoutSpec.cardSize}
                      playable={cardState.isSelectable}
                      selected={isSelected}
                      dimmed={cardState.isVisuallyDisabled}
                      waitingMuted={cardState.isWaitingMuted}
                      highlighted={false}
                      onClick={() => handleCardClickSafe(card)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Desktop/Tablet Right Scroll Button (outside scroll track — never covers cards) */}
        {scrollMetrics.hasOverflow && (
          <button
            type="button"
            disabled={!scrollMetrics.canScrollRight}
            onClick={() => scrollByDirection(1)}
            aria-label="Scroll hand right"
            title="Scroll cards right"
            className="hidden sm:flex shrink-0 w-9 h-14 rounded-xl bg-[#143D23]/95 hover:bg-[#1E5934] border border-[#F5C954]/35 text-[#F8F3E6] items-center justify-center shadow-md transition-all disabled:opacity-30 disabled:border-white/10 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};
