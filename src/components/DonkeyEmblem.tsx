import React from 'react';

interface DonkeyEmblemProps {
  className?: string;
  size?: number;
}

/**
 * Official Last Donkey (Rang Vapas) logo badge.
 */
export const DonkeyEmblem: React.FC<DonkeyEmblemProps> = ({ className = '', size = 96 }) => {
  return (
    <img
      src="/logo.png"
      alt="Last Donkey — Rang Vapas logo"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`rounded-[22%] object-cover select-none ${className}`}
      draggable={false}
    />
  );
};
