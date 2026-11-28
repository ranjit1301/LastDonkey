export type TableArrangementMode = '2p' | '3p' | '4p' | '5p' | '6p';

export type OpponentSeatSlot =
  | 'top-center'
  | 'upper-left'
  | 'upper-right'
  | 'top-left'
  | 'top-right'
  | 'left'
  | 'right';

export interface PositionedOpponent<T> {
  opponent: T;
  slot: OpponentSeatSlot;
}

export interface OvalSeatArrangement<T> {
  mode: TableArrangementMode;
  totalPlayers: number;
  /** Opponents placed along the top arc of the oval table (0 to 3 seats) */
  topRow: PositionedOpponent<T>[];
  /** Opponent placed at the left flank / upper-left shoulder (clockwise #1 for 4-6p) */
  leftSeat: PositionedOpponent<T> | null;
  /** Opponent placed at the right flank / upper-right shoulder (last clockwise for 4-6p) */
  rightSeat: PositionedOpponent<T> | null;
}

/**
 * Maps clockwise opponents (starting after the local player seated at Bottom / 6 o'clock)
 * onto an oval-inspired card table layout for 2 to 6 players:
 * - 2 players (1 opp):  Top Center
 * - 3 players (2 opps): Upper-Left, Upper-Right
 * - 4 players (3 opps): Left (clockwise #1), Top Center (#2), Right (#3)
 * - 5 players (4 opps): Left (#1), Top-Left (#2), Top-Right (#3), Right (#4)
 * - 6 players (5 opps): Left (#1), Top-Left (#2), Top Center (#3), Top-Right (#4), Right (#5)
 */
export function assignOvalOpponentSeats<T>(
  clockwiseOpponents: readonly T[]
): OvalSeatArrangement<T> {
  const count = clockwiseOpponents.length;

  if (count <= 1) {
    return {
      mode: '2p',
      totalPlayers: count + 1,
      topRow: clockwiseOpponents[0]
        ? [{ opponent: clockwiseOpponents[0], slot: 'top-center' }]
        : [],
      leftSeat: null,
      rightSeat: null,
    };
  }

  if (count === 2) {
    return {
      mode: '3p',
      totalPlayers: 3,
      topRow: [
        { opponent: clockwiseOpponents[0], slot: 'upper-left' },
        { opponent: clockwiseOpponents[1], slot: 'upper-right' },
      ],
      leftSeat: null,
      rightSeat: null,
    };
  }

  if (count === 3) {
    return {
      mode: '4p',
      totalPlayers: 4,
      topRow: [{ opponent: clockwiseOpponents[1], slot: 'top-center' }],
      leftSeat: { opponent: clockwiseOpponents[0], slot: 'left' },
      rightSeat: { opponent: clockwiseOpponents[2], slot: 'right' },
    };
  }

  if (count === 4) {
    return {
      mode: '5p',
      totalPlayers: 5,
      topRow: [
        { opponent: clockwiseOpponents[1], slot: 'top-left' },
        { opponent: clockwiseOpponents[2], slot: 'top-right' },
      ],
      leftSeat: { opponent: clockwiseOpponents[0], slot: 'left' },
      rightSeat: { opponent: clockwiseOpponents[3], slot: 'right' },
    };
  }

  // 6 players (5 opponents) — gracefully caps any extra entries if ever passed
  return {
    mode: '6p',
    totalPlayers: count + 1,
    topRow: [
      { opponent: clockwiseOpponents[1], slot: 'top-left' },
      { opponent: clockwiseOpponents[2], slot: 'top-center' },
      { opponent: clockwiseOpponents[3], slot: 'top-right' },
    ],
    leftSeat: { opponent: clockwiseOpponents[0], slot: 'left' },
    rightSeat: { opponent: clockwiseOpponents[4], slot: 'right' },
  };
}

export interface ViewportBudgetInput {
  widthPx: number;
  heightPx: number;
  totalPlayers: number;
  handSize: number;
  hasMediumAssist?: boolean;
}

export interface ViewportBudgetEstimate {
  usableWidthPx: number;
  topSeatMinWidthPx: number;
  shoulderRowTotalWidthPx: number;
  ovalCenterWidthPx: number;
  estimatedTotalHeightPx: number;
  fitsWithoutPortraitScroll: boolean;
  hasHorizontalOverflow: boolean;
}

/**
 * Estimates exact pixel geometry for the oval table layout at a given viewport
 * so automated tests can guard against horizontal overflow, overlapping seats,
 * or portrait vertical scroll regressions across mobile & landscape viewports.
 */
export function estimateOvalViewportBudget(
  input: ViewportBudgetInput
): ViewportBudgetEstimate {
  const { widthPx, heightPx, totalPlayers, handSize, hasMediumAssist = false } = input;
  const isSmOrWider = widthPx >= 640;
  const horizontalPadding = isSmOrWider ? 48 : 20;
  const usableWidthPx = Math.min(isSmOrWider ? 896 : widthPx, widthPx - horizontalPadding);

  const oppCount = Math.max(1, Math.min(5, totalPlayers - 1));
  const hasSides = oppCount >= 3;
  const topCount = oppCount === 1 || oppCount === 3 ? 1 : oppCount === 2 || oppCount === 4 ? 2 : 3;

  // Top row seat widths
  const topGap = 6;
  const topSeatMinWidthPx =
    topCount === 1
      ? Math.min(200, usableWidthPx)
      : Math.floor((usableWidthPx - (topCount - 1) * topGap) / topCount);

  // Mobile (<640px): left & right shoulders flank the compact suit pill (~76px) above played cards,
  // giving the played cards full inner oval width.
  // Desktop/Landscape (>=640px): left & right seats flank the oval felt directly (~136px each).
  const shoulderRowTotalWidthPx = hasSides
    ? isSmOrWider
      ? Math.min(usableWidthPx, 136 * 2 + 24 + 340)
      : usableWidthPx
    : usableWidthPx;

  const ovalCenterWidthPx =
    hasSides && isSmOrWider
      ? Math.max(240, usableWidthPx - 136 * 2 - 20)
      : Math.max(240, usableWidthPx - 16);

  // Vertical budget breakdown (px)
  const headerH = 48;
  const mediumBarH = hasMediumAssist ? 38 : 0;
  const topRowH = 44;
  const mobileShouldersH = hasSides && !isSmOrWider ? 44 : 0;
  const ovalFeltH = isSmOrWider ? 136 : 122;
  const turnBannerH = isSmOrWider ? 42 : 56;
  const handCardH = handSize <= 18 ? 100 : handSize <= 28 ? 90 : 80;
  const handUtilityH = handSize >= 13 ? 36 : 0;
  const handZoneH = handUtilityH + (isSmOrWider ? 40 : 36) + handCardH + 66;
  const gapsH = isSmOrWider ? 28 : 24;

  const estimatedTotalHeightPx =
    headerH + mediumBarH + topRowH + mobileShouldersH + ovalFeltH + turnBannerH + handZoneH + gapsH;

  const minReadableSeatWidth = topCount === 3 ? 96 : 112;
  const hasHorizontalOverflow =
    topSeatMinWidthPx < minReadableSeatWidth || ovalCenterWidthPx < 240;

  return {
    usableWidthPx,
    topSeatMinWidthPx,
    shoulderRowTotalWidthPx,
    ovalCenterWidthPx,
    estimatedTotalHeightPx,
    fitsWithoutPortraitScroll: estimatedTotalHeightPx <= heightPx,
    hasHorizontalOverflow,
  };
}
