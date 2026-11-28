import type { GamePhase, TrickOutcome } from '../engine/types.ts';

/**
 * The four progressive failed-trick penalty facial expressions:
 * - 1 penalty card: slightly annoyed
 * - 2 penalty cards: shocked
 * - 3 penalty cards: sad / disappointed
 * - 4+ penalty cards: crying / devastated
 */
export type PenaltyExpression = 'annoyed' | 'shocked' | 'sad' | 'crying';

export type FacialExpression =
  | 'normal'
  | PenaltyExpression
  | 'happy'
  | 'donkey';

/**
 * Intensity level driven by consecutive failed-trick streaks:
 * - 0: calm / neutral / finished safe
 * - 1: first failed-trick penalty (base facial expression)
 * - 2: 2nd consecutive failed trick (elevated / intense facial artwork)
 * - 3: 3rd+ consecutive failed trick (peak meltdown — escalated tier + intense facial artwork)
 */
export type ExpressionIntensity = 0 | 1 | 2 | 3;

/**
 * Personalised human avatar expression styles so human players also receive
 * distinct Sigh of Relief reactions tailored to their selected avatar.
 */
export type HumanAvatarPersona = 'classic' | 'dramatic' | 'cool' | 'zen';

export type ReliefMotionStyle = 'dramatic' | 'graceful' | 'swagger' | 'calm';

export interface PlayerFacialState {
  expression: FacialExpression;
  /** Unescalated expression matching the latest penalty-card count */
  baseExpression: 'normal' | PenaltyExpression;
  intensity: ExpressionIntensity;
  lastPenaltyCards: number;
  consecutiveFailStreak: number;
  label: string;
}

export const CALM_FACIAL_STATE: PlayerFacialState = {
  expression: 'normal',
  baseExpression: 'normal',
  intensity: 0,
  lastPenaltyCards: 0,
  consecutiveFailStreak: 0,
  label: 'Calm',
};

const PENALTY_TIERS: readonly PenaltyExpression[] = [
  'annoyed',
  'shocked',
  'sad',
  'crying',
];

export const HUMAN_PERSONA_META: Readonly<
  Record<
    HumanAvatarPersona,
    { label: string; reliefSummary: string; motion: ReliefMotionStyle; swatch: string }
  >
> = {
  classic: {
    label: 'Cheerful Classic',
    reliefSummary: 'Warm happy-eyes exhale & bright relieved grin',
    motion: 'calm',
    swatch: '#E59A00',
  },
  dramatic: {
    label: 'Dramatic',
    reliefSummary: 'Big puffed-cheek "Phew!" exhale & beaming relief',
    motion: 'dramatic',
    swatch: '#D95732',
  },
  cool: {
    label: 'Cool Swagger',
    reliefSummary: 'Shades-dip smooth whistle exhale & assured smirk',
    motion: 'swagger',
    swatch: '#3A6B8A',
  },
  zen: {
    label: 'Serene Zen',
    reliefSummary: 'Peaceful flutter-closed eyes & gentle meditative sigh',
    motion: 'graceful',
    swatch: '#8B5E83',
  },
};

const COLOR_TO_PERSONA: Readonly<Record<string, HumanAvatarPersona>> = {
  '#E59A00': 'classic',
  '#E9B872': 'classic',
  '#D95732': 'dramatic',
  '#B57435': 'dramatic',
  '#3A6B8A': 'cool',
  '#2E6340': 'cool',
  '#8B5E83': 'zen',
};

const ALL_PERSONAS: readonly HumanAvatarPersona[] = [
  'classic',
  'dramatic',
  'cool',
  'zen',
];

/**
 * Resolves a human player's personalised facial-expression persona from their selected
 * avatar color / player ID (or explicit preference).
 */
export function resolveHumanAvatarPersona(params: {
  preferredPersona?: HumanAvatarPersona | null;
  avatarColor?: string | null;
  playerId?: string | null;
  name?: string | null;
}): HumanAvatarPersona {
  if (params.preferredPersona && params.preferredPersona in HUMAN_PERSONA_META) {
    return params.preferredPersona;
  }
  const normalizedColor = params.avatarColor?.trim().toUpperCase();
  if (normalizedColor && normalizedColor in COLOR_TO_PERSONA) {
    return COLOR_TO_PERSONA[normalizedColor];
  }
  const seed = (params.playerId || params.name || 'human').trim();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return ALL_PERSONAS[hash % ALL_PERSONAS.length];
}

/**
 * Character-specific motion style for Sigh of Relief reactions matching each bot's personality.
 */
export function getBotReliefMotionStyle(botAvatarId?: string | null): ReliefMotionStyle {
  switch (botAvatarId) {
    case 'babloo-uncle':
    case 'gappu':
    case 'pappu-viral':
      return 'dramatic';
    case 'surili':
    case 'selfie-sona':
    case 'wifi-baba':
    case 'hasmukh-didi':
      return 'graceful';
    case 'rocky-raja':
    case 'chotu-chaiwala':
    case 'dhamaka-don':
      return 'swagger';
    default:
      return 'calm';
  }
}

export interface ReliefEligiblePlayer {
  id: string;
  finished: boolean;
  removed: boolean;
}

/**
 * Determines which players must simultaneously show the Sigh of Relief animation
 * for a server-authoritative successful trick outcome.
 *
 * Rules:
 * - Only triggers on `outcome.type === 'success'`.
 * - Includes EVERY player still active in the round (`!finished && !removed`).
 * - Strictly excludes players who have already finished the round (including anyone
 *   in `outcome.newlyFinishedIds` who just cleared their final card on this trick).
 */
export function getReliefEligiblePlayerIds(
  players: readonly ReliefEligiblePlayer[],
  outcome: TrickOutcome | null | undefined
): string[] {
  if (!outcome || outcome.type !== 'success') {
    return [];
  }
  const newlyFinished = new Set<string>(outcome.newlyFinishedIds);
  return players
    .filter((p) => !p.finished && !p.removed && !newlyFinished.has(p.id))
    .map((p) => p.id);
}

/**
 * Maps a single failed-trick penalty card count to its base facial expression:
 * - 1 card -> slightly annoyed
 * - 2 cards -> shocked
 * - 3 cards -> sad / disappointed
 * - 4+ cards -> crying / devastated
 */
export function getBasePenaltyExpression(
  penaltyCards: number
): 'normal' | PenaltyExpression {
  if (penaltyCards <= 0) return 'normal';
  if (penaltyCards === 1) return 'annoyed';
  if (penaltyCards === 2) return 'shocked';
  if (penaltyCards === 3) return 'sad';
  return 'crying';
}

function getPenaltyTierIndex(penaltyCards: number): number {
  if (penaltyCards <= 0) return -1;
  if (penaltyCards === 1) return 0;
  if (penaltyCards === 2) return 1;
  if (penaltyCards === 3) return 2;
  return 3;
}

export function getExpressionDisplayLabel(
  expression: FacialExpression,
  intensity: ExpressionIntensity
): string {
  if (expression === 'normal') return 'Calm';
  if (expression === 'happy') return 'Finished Safe';
  if (expression === 'donkey') return 'Last Donkey';

  if (expression === 'annoyed') {
    return intensity >= 2 ? 'Fuming Annoyed' : 'Slightly Annoyed';
  }
  if (expression === 'shocked') {
    if (intensity >= 3) return 'Panicked & Shocked';
    return intensity === 2 ? 'Hyper-Shocked' : 'Shocked';
  }
  if (expression === 'sad') {
    return intensity >= 2 ? 'Deeply Heartbroken' : 'Sad / Disappointed';
  }
  // crying
  if (intensity >= 3) return 'Total Meltdown';
  if (intensity === 2) return 'Bawling Devastated';
  return 'Crying / Devastated';
}

/**
 * Combines the latest penalty-card count and the player's consecutive failed-trick streak
 * to determine the resulting facial expression and intensity:
 * - Streak 1 (intensity 1): Base artwork for 1 / 2 / 3 / 4+ penalty cards.
 * - Streak 2 (intensity 2): Intense artwork for the same penalty tier (flushed, wider eyes, heavier tears).
 * - Streak 3+ (intensity 3): Escalates expression by +1 severity tier (capped at 'crying') using intense artwork.
 */
export function computePenaltyExpression(
  penaltyCards: number,
  consecutiveFailStreak: number
): PlayerFacialState {
  const safeCards = Math.max(0, Math.floor(penaltyCards));
  const safeStreak = Math.max(0, Math.floor(consecutiveFailStreak));

  if (safeCards <= 0 || safeStreak <= 0) {
    return { ...CALM_FACIAL_STATE };
  }

  const baseTier = getPenaltyTierIndex(safeCards);
  const baseExpression = PENALTY_TIERS[baseTier];

  const intensity: ExpressionIntensity =
    safeStreak >= 3 ? 3 : safeStreak === 2 ? 2 : 1;

  // At streak 3+, escalate the emotional expression by +1 tier (up to full crying meltdown)
  const effectiveTier =
    safeStreak >= 3 ? Math.min(PENALTY_TIERS.length - 1, baseTier + 1) : baseTier;
  const expression = PENALTY_TIERS[effectiveTier];

  return {
    expression,
    baseExpression,
    intensity,
    lastPenaltyCards: safeCards,
    consecutiveFailStreak: safeStreak,
    label: getExpressionDisplayLabel(expression, intensity),
  };
}

export interface DerivePlayerExpressionsInput {
  playerIds: readonly string[];
  trickHistory: readonly TrickOutcome[];
  lastOutcome?: TrickOutcome | null;
  phase?: GamePhase;
  donkeyPlayerId?: string | null;
  finishedPlayerIds?: Iterable<string>;
}

/**
 * Deterministically derives every player's facial expression and consecutive failed-trick streak
 * from authoritative completed trick outcomes.
 */
export function derivePlayerExpressionStates(
  input: DerivePlayerExpressionsInput
): Record<string, PlayerFacialState> {
  const {
    playerIds,
    trickHistory,
    lastOutcome = null,
    phase,
    donkeyPlayerId = null,
    finishedPlayerIds,
  } = input;

  const finishedSet = new Set<string>(finishedPlayerIds ?? []);

  // Build deduplicated chronological trick timeline (handles trickHistory already containing lastOutcome)
  const timeline: TrickOutcome[] = [...trickHistory];
  if (lastOutcome) {
    const alreadyPresent =
      timeline.length > 0 &&
      timeline[timeline.length - 1].trickNumber === lastOutcome.trickNumber;
    if (!alreadyPresent) {
      timeline.push(lastOutcome);
    }
  }

  const streakByPlayer: Record<string, number> = {};
  const lastPenaltyByPlayer: Record<string, number> = {};
  for (const pid of playerIds) {
    streakByPlayer[pid] = 0;
    lastPenaltyByPlayer[pid] = 0;
  }

  for (const outcome of timeline) {
    const penalizedId = outcome.type === 'failed' ? outcome.collectorId : null;
    const penaltyCount =
      outcome.type === 'failed' ? outcome.collectedCards.length : 0;

    for (const pid of playerIds) {
      if (penalizedId === pid && penaltyCount > 0) {
        streakByPlayer[pid] = (streakByPlayer[pid] ?? 0) + 1;
        lastPenaltyByPlayer[pid] = penaltyCount;
      } else {
        // Any completed trick where this player received no penalty resets their failure streak
        streakByPlayer[pid] = 0;
        lastPenaltyByPlayer[pid] = 0;
      }
    }
  }

  const result: Record<string, PlayerFacialState> = {};
  for (const pid of playerIds) {
    const computed = computePenaltyExpression(
      lastPenaltyByPlayer[pid] ?? 0,
      streakByPlayer[pid] ?? 0
    );

    if (phase === 'finished' && donkeyPlayerId === pid) {
      result[pid] = {
        expression: 'donkey',
        baseExpression: computed.baseExpression,
        intensity: Math.max(2, computed.intensity) as ExpressionIntensity,
        lastPenaltyCards: computed.lastPenaltyCards,
        consecutiveFailStreak: computed.consecutiveFailStreak,
        label: 'Last Donkey',
      };
    } else if (finishedSet.has(pid)) {
      result[pid] = {
        expression: 'happy',
        baseExpression: 'normal',
        intensity: 0,
        lastPenaltyCards: 0,
        consecutiveFailStreak: 0,
        label: 'Finished Safe',
      };
    } else {
      result[pid] = computed;
    }
  }

  return result;
}
