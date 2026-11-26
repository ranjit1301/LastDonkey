import React from 'react';
import { formatRank, isRedSuit, SUIT_NAMES, SUIT_SYMBOLS, type Card } from '../engine';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

interface PlayingCardProps {
  card: Card;
  size?: CardSize;
  playable?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
  className?: string;
}

const SIZE_CLASSES: Record<
  CardSize,
  {
    wrapper: string;
    rank: string;
    cornerSuit: string;
    centerSuit: string;
    padding: string;
  }
> = {
  xs: {
    wrapper: 'w-11 h-16 rounded-md',
    rank: 'text-[11px] leading-none font-bold',
    cornerSuit: 'text-[10px] leading-none',
    centerSuit: 'text-lg leading-none',
    padding: 'p-1',
  },
  sm: {
    wrapper: 'w-14 h-20 sm:w-16 sm:h-24 rounded-lg',
    rank: 'text-xs sm:text-sm leading-none font-bold',
    cornerSuit: 'text-[11px] sm:text-xs leading-none',
    centerSuit: 'text-2xl sm:text-3xl leading-none',
    padding: 'p-1.5',
  },
  md: {
    wrapper: 'w-[68px] h-[98px] sm:w-[82px] sm:h-[118px] rounded-[10px]',
    rank: 'text-sm sm:text-base leading-none font-bold',
    cornerSuit: 'text-xs sm:text-sm leading-none',
    centerSuit: 'text-3xl sm:text-4xl leading-none',
    padding: 'p-1.5 sm:p-2',
  },
  lg: {
    wrapper: 'w-[78px] h-[112px] sm:w-[92px] sm:h-[132px] rounded-xl',
    rank: 'text-base sm:text-lg leading-none font-bold',
    cornerSuit: 'text-sm sm:text-base leading-none',
    centerSuit: 'text-4xl sm:text-5xl leading-none',
    padding: 'p-2',
  },
};

export const PlayingCard: React.FC<PlayingCardProps> = ({
  card,
  size = 'md',
  playable = false,
  selected = false,
  dimmed = false,
  highlighted = false,
  onClick,
  className = '',
}) => {
  const red = isRedSuit(card.suit);
  const rankLabel = formatRank(card.rank);
  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const cfg = SIZE_CLASSES[size];
  const isAceOfSpades = card.suit === 'spades' && card.rank === 14;
  const isCourt = card.rank >= 11 && card.rank <= 13;

  const interactiveClasses = onClick
    ? playable
      ? 'cursor-pointer hover:-translate-y-2.5 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0CB6B]'
      : 'cursor-not-allowed'
    : '';

  const stateClasses = selected
    ? '-translate-y-4 sm:-translate-y-5 ring-2 ring-[#F0CB6B] shadow-[0_14px_28px_-6px_rgba(240,203,107,0.45)]'
    : highlighted
      ? 'ring-2 ring-[#F0CB6B] shadow-[0_0_24px_rgba(240,203,107,0.35)]'
      : '';

  const dimClasses = dimmed ? 'opacity-45 saturate-50 brightness-90' : '';
  const colorClass = red ? 'text-[#C81E1E]' : 'text-[#141A21]';

  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      disabled={onClick ? !playable : undefined}
      aria-label={`${rankLabel} of ${SUIT_NAMES[card.suit]}${selected ? ', selected' : ''}${playable ? ', playable' : ''}`}
      aria-pressed={onClick ? selected : undefined}
      className={[
        'relative select-none card-ivory border border-[#DFD6C3] flex flex-col justify-between transition-transform duration-150 ease-out will-change-transform',
        cfg.wrapper,
        cfg.padding,
        colorClass,
        interactiveClasses,
        stateClasses,
        dimClasses,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Subtle inner engraved frame for authentic parlor playing card look */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[3px] rounded-[7px] border border-[#E5DEC9]/75"
      />

      {/* Top-left rank & suit index */}
      <div className="relative z-10 flex flex-col items-center self-start">
        <span className={`${cfg.rank} tracking-tight font-sans`}>{rankLabel}</span>
        <span className={`${cfg.cornerSuit} mt-0.5`}>{suitSymbol}</span>
      </div>

      {/* Center face artwork */}
      <div className="relative z-10 flex-1 flex items-center justify-center pointer-events-none">
        {isAceOfSpades ? (
          <div className="relative flex items-center justify-center">
            <span className={`${cfg.centerSuit} drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)]`}>♠</span>
            <span
              className="absolute text-[9px] sm:text-[10px] font-display font-bold text-[#D4A843] translate-y-[1px]"
              aria-hidden="true"
            >
              LD
            </span>
          </div>
        ) : isCourt ? (
          <div className="flex flex-col items-center justify-center">
            <span
              className="text-[9px] sm:text-[10px] font-display font-bold tracking-wider uppercase opacity-70"
              aria-hidden="true"
            >
              {card.rank === 13 ? 'King' : card.rank === 12 ? 'Queen' : 'Jack'}
            </span>
            <span className={`${cfg.centerSuit} -mt-0.5`}>{suitSymbol}</span>
          </div>
        ) : (
          <span className={cfg.centerSuit}>{suitSymbol}</span>
        )}
      </div>

      {/* Bottom-right mirrored index */}
      <div className="relative z-10 flex flex-col items-center self-end rotate-180">
        <span className={`${cfg.rank} tracking-tight font-sans`}>{rankLabel}</span>
        <span className={`${cfg.cornerSuit} mt-0.5`}>{suitSymbol}</span>
      </div>
    </Tag>
  );
};

interface CardBackProps {
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const BACK_SIZE: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'w-7 h-10 rounded',
  sm: 'w-10 h-14 rounded-md',
  md: 'w-14 h-20 rounded-lg',
};

/**
 * Vintage symmetrical emerald-and-gold filigree playing card back.
 */
export const CardBack: React.FC<CardBackProps> = ({ size = 'sm', className = '' }) => {
  return (
    <div
      aria-hidden="true"
      className={[
        'relative overflow-hidden bg-[#F7F1E3] p-[2px] shadow-[0_3px_8px_rgba(0,0,0,0.38)] border border-[#E0D4B7]',
        BACK_SIZE[size],
        className,
      ].join(' ')}
    >
      <div className="w-full h-full rounded-[3px] bg-[#0B3B28] border border-[#D4A843]/70 flex items-center justify-center overflow-hidden relative">
        <svg viewBox="0 0 40 58" className="w-full h-full opacity-90" fill="none">
          <rect x="2" y="2" width="36" height="54" rx="2" stroke="#D4A843" strokeWidth="0.9" />
          <path d="M20 6L33 29L20 52L7 29L20 6Z" stroke="#D4A843" strokeWidth="0.8" fill="#0F4D34" />
          <path d="M20 13L28 29L20 45L12 29L20 13Z" stroke="#EBC96E" strokeWidth="0.7" />
          <circle cx="20" cy="29" r="3.5" fill="#D4A843" />
        </svg>
      </div>
    </div>
  );
};
