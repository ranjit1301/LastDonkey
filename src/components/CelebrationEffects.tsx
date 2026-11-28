import React from 'react';
import { motion } from 'motion/react';

const CONFETTI_PIECES = [
  { left: '8%', color: '#F5C954', delay: 0, rot: 22, drift: -18 },
  { left: '15%', color: '#D95732', delay: 0.06, rot: -34, drift: 14 },
  { left: '22%', color: '#6EE7B7', delay: 0.12, rot: 45, drift: -10 },
  { left: '30%', color: '#FDE047', delay: 0.03, rot: -18, drift: 20 },
  { left: '38%', color: '#F472B6', delay: 0.09, rot: 30, drift: -14 },
  { left: '46%', color: '#38BDF8', delay: 0.02, rot: -40, drift: 12 },
  { left: '54%', color: '#F5C954', delay: 0.07, rot: 16, drift: -16 },
  { left: '62%', color: '#4ADE80', delay: 0.14, rot: -26, drift: 18 },
  { left: '70%', color: '#FB923C', delay: 0.04, rot: 38, drift: -12 },
  { left: '78%', color: '#C084FC', delay: 0.1, rot: -32, drift: 10 },
  { left: '85%', color: '#F5C954', delay: 0.05, rot: 24, drift: -18 },
  { left: '92%', color: '#F87171', delay: 0.11, rot: -20, drift: 15 },
];

interface ConfettiBurstProps {
  active: boolean;
  label?: string | null;
}

/**
 * Lightweight, non-blocking confetti celebration burst when a player finishes safe or wins.
 */
export const ConfettiBurst: React.FC<ConfettiBurstProps> = ({ active, label }) => {
  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="celebration-confetti"
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
    >
      {CONFETTI_PIECES.map((piece, idx) => (
        <motion.span
          key={idx}
          initial={{ y: -20, x: 0, opacity: 1, rotate: 0, scale: 0.9 }}
          animate={{
            y: ['0vh', '42vh', '78vh'],
            x: [0, piece.drift, piece.drift * 1.4],
            opacity: [1, 1, 0],
            rotate: [0, piece.rot * 3, piece.rot * 6],
          }}
          transition={{
            duration: 1.25,
            delay: piece.delay,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={{ left: piece.left, backgroundColor: piece.color }}
          className="absolute top-0 w-2.5 h-3.5 rounded-[2px] shadow-xs"
        />
      ))}

      {label && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 12 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.8, 1.04, 1, 0.96], y: [12, 0, -4, -12] }}
          transition={{ duration: 1.35, ease: 'easeOut' }}
          className="absolute left-1/2 top-[28%] -translate-x-1/2 rounded-full bg-gradient-to-r from-[#14532D] via-[#1E6B3C] to-[#14532D] border-2 border-[#F5C954] px-5 py-2 shadow-xl text-xs sm:text-sm font-display font-extrabold text-[#FEF9C3] whitespace-nowrap"
        >
          {label}
        </motion.div>
      )}
    </div>
  );
};
