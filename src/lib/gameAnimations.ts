import type { TrickOutcome } from '../engine/types.ts';

export type FailedTrickStage = 'idle' | 'banner' | 'reaction' | 'flying' | 'finishing';

/**
 * 4-frame sequential Sigh of Relief animation phases played when a trick succeeds:
 * - hold: brief breath-hold anticipation
 * - exhale: peak personalised sigh exhale (eyes, eyebrows, cheeks, mouth)
 * - smile: warm relieved smile
 * - settle: gentle return transition back into normal expression
 */
export type ReliefAnimationFrame = 'idle' | 'hold' | 'exhale' | 'smile' | 'settle';

/**
 * Compact 4-stage timeline (~1.45s total) for the Failed Trick penalty sequence.
 * Fits cleanly inside both online server delay (2100ms) and local game auto-advance,
 * and is purely visual / non-blocking.
 */
export const FAILED_TRICK_TIMING_MS = {
  stage1BannerMs: 0,
  stage2ReactionMs: 260,
  stage3FlyingMs: 520,
  stage4FinishingMs: 960,
  totalDurationMs: 1450,
} as const;

/**
 * Smooth 1.68s (~1-2 seconds) Sigh of Relief timeline for successful tricks.
 * Non-blocking: completes gracefully and smoothly returns every active player to normal.
 */
export const RELIEF_ANIMATION_TIMING_MS = {
  frame0HoldMs: 0,
  frame1ExhaleMs: 240,
  frame2SmileMs: 840,
  frame3SettleMs: 1360,
  totalDurationMs: 1680,
} as const;

/**
 * Animations are strictly enabled only when both the user setting is ON
 * and the OS/browser does not request reduced motion.
 */
export function shouldPlayGameAnimations(
  animationsEnabled: boolean,
  prefersReducedMotion: boolean
): boolean {
  return Boolean(animationsEnabled) && !prefersReducedMotion;
}

/**
 * Stable deduplication key for a server-confirmed failed trick outcome.
 * Returns null for non-failed outcomes so failed-trick animations NEVER trigger on successful tricks.
 */
export function buildFailedTrickEventKey(
  outcome: TrickOutcome | null | undefined
): string | null {
  if (!outcome || outcome.type !== 'failed') return null;
  return `failed:${outcome.trickNumber}:${outcome.collectorId}:${outcome.collectedCards.length}`;
}

/**
 * Stable deduplication key for a server-confirmed successful trick outcome.
 */
export function buildSuccessTrickEventKey(
  outcome: TrickOutcome | null | undefined
): string | null {
  if (!outcome || outcome.type !== 'success') return null;
  return `success:${outcome.trickNumber}:${outcome.removedCards.length}`;
}

/**
 * Maps elapsed milliseconds since failed-trick start to the active 4-stage phase.
 */
export function getFailedTrickStageForElapsed(elapsedMs: number): FailedTrickStage {
  if (elapsedMs < 0 || elapsedMs >= FAILED_TRICK_TIMING_MS.totalDurationMs) {
    return 'idle';
  }
  if (elapsedMs < FAILED_TRICK_TIMING_MS.stage2ReactionMs) {
    return 'banner';
  }
  if (elapsedMs < FAILED_TRICK_TIMING_MS.stage3FlyingMs) {
    return 'reaction';
  }
  if (elapsedMs < FAILED_TRICK_TIMING_MS.stage4FinishingMs) {
    return 'flying';
  }
  return 'finishing';
}

/**
 * Maps elapsed milliseconds since successful-trick start to the active 4-frame Sigh of Relief phase.
 */
export function getReliefFrameForElapsed(elapsedMs: number): ReliefAnimationFrame {
  if (elapsedMs < 0 || elapsedMs >= RELIEF_ANIMATION_TIMING_MS.totalDurationMs) {
    return 'idle';
  }
  if (elapsedMs < RELIEF_ANIMATION_TIMING_MS.frame1ExhaleMs) {
    return 'hold';
  }
  if (elapsedMs < RELIEF_ANIMATION_TIMING_MS.frame2SmileMs) {
    return 'exhale';
  }
  if (elapsedMs < RELIEF_ANIMATION_TIMING_MS.frame3SettleMs) {
    return 'smile';
  }
  return 'settle';
}
