import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import type { Card, FailedTrickOutcome } from '../engine';
import type { FailedTrickStage } from '../lib/gameAnimations';
import { PlayingCard } from './PlayingCard';

export interface FlyingCardTrajectory {
  card: Card;
  startX: number;
  startY: number;
  midX: number;
  midY: number;
  endX: number;
  endY: number;
  rotateMid: number;
  rotateEnd: number;
  delaySec: number;
}

interface FailedTrickAnimationOverlayProps {
  outcome: FailedTrickOutcome | null;
  stage: FailedTrickStage;
  collectorName: string;
  trajectories: readonly FlyingCardTrajectory[];
}

/**
 * Purely visual, non-blocking overlay for the 4-stage Failed Trick animation:
 * - Stage 1 ('banner'): Prominent compact "FAILED TRICK!" stamp with subtle shake/flash.
 * - Stage 2 ('reaction'): Keeps banner visible while recipient avatar displays shocked reaction.
 * - Stage 3 ('flying'): Smooth curved flight + rotation of penalty cards from center table
 *   into the penalized player's seat/hand without altering table layout.
 * - Stage 4 ('finishing'): Handled on recipient's avatar (+N Cards + dizzy reaction).
 */
export const FailedTrickAnimationOverlay: React.FC<FailedTrickAnimationOverlayProps> = ({
  outcome,
  stage,
  collectorName,
  trajectories,
}) => {
  if (!outcome || stage === 'idle') return null;

  const showStamp = stage === 'banner' || stage === 'reaction';
  const showFlyingCards = stage === 'flying' && trajectories.length > 0;

  return (
    <div
      aria-hidden="true"
      data-testid="failed-trick-animation-overlay"
      data-animation-stage={stage}
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
    >
      {/* Subtle non-shifting crimson vignette flash on Stage 1 only */}
      <AnimatePresence>
        {stage === 'banner' && (
          <motion.div
            key="fail-flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.28, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.34, ease: 'easeOut' }}
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(220,38,38,0.55)_100%)]"
          />
        )}
      </AnimatePresence>

      {/* Stage 1–2: Compact "FAILED TRICK!" comic stamp centered gently over table without resizing anything */}
      <AnimatePresence>
        {showStamp && (
          <motion.div
            key="failed-trick-stamp"
            initial={{ opacity: 0, scale: 0.72, y: -6 }}
            animate={{
              opacity: 1,
              scale: [0.72, 1.06, 1],
              x: [0, -5, 5, -3, 2, 0],
              y: 0,
            }}
            exit={{ opacity: 0, scale: 0.9, y: -10 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-1/2 top-[25%] sm:top-[24%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
          >
            <div className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#991B1B] via-[#DC2626] to-[#B91C1C] border-2 border-[#FEE2E2] px-4 py-1.5 sm:px-5 sm:py-2 shadow-[0_12px_32px_rgba(153,27,27,0.65)]">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-[#FDE047] shrink-0" />
              <span className="font-display font-black tracking-wider text-sm sm:text-lg text-white uppercase drop-shadow-xs whitespace-nowrap">
                FAILED TRICK!
              </span>
            </div>
            <span className="rounded-full bg-[#1C0A0A]/85 border border-[#FCA5A5]/45 px-3 py-0.5 text-[11px] sm:text-xs font-bold text-[#FEF2F2] shadow-md whitespace-nowrap">
              {collectorName} takes +{outcome.collectedCards.length}{' '}
              {outcome.collectedCards.length === 1 ? 'card' : 'cards'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stage 3: Curved flight + slight rotation of penalty cards into penalized player's seat/hand */}
      {showFlyingCards &&
        trajectories.map((traj) => (
          <motion.div
            key={`fly-${outcome.trickNumber}-${traj.card.id}`}
            data-testid="flying-penalty-card"
            initial={{
              x: traj.startX,
              y: traj.startY,
              scale: 1,
              rotate: 0,
              opacity: 1,
            }}
            animate={{
              x: [traj.startX, traj.midX, traj.endX],
              y: [traj.startY, traj.midY, traj.endY],
              scale: [1, 0.88, 0.48],
              rotate: [0, traj.rotateMid, traj.rotateEnd],
              opacity: [1, 1, 0.25],
            }}
            transition={{
              duration: 0.42,
              delay: traj.delaySec,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{ position: 'fixed', left: 0, top: 0, marginLeft: -28, marginTop: -40 }}
          >
            <div className="rounded-xl ring-2 ring-[#F87171]/85 shadow-[0_10px_22px_rgba(0,0,0,0.45)]">
              <PlayingCard card={traj.card} size="sm" />
            </div>
          </motion.div>
        ))}
    </div>
  );
};
