import React, { useId } from 'react';
import { motion } from 'motion/react';
import sheet1Url from '../assets/images/avatars_sheet_1_1795809716360.jpg';
import sheet2Url from '../assets/images/avatars_sheet_2_1795809718411.jpg';
import sheet3Url from '../assets/images/avatars_sheet_3_1795809721219.jpg';
import bablooBaseExprUrl from '../assets/images/babloo_expressions_base_1795814140529.jpg';
import bablooIntenseExprUrl from '../assets/images/babloo_expressions_intense_1795814141230.jpg';
import bablooReliefUrl from '../assets/images/babloo_relief_sheet_1795815648884.jpg';
import suriliReliefUrl from '../assets/images/surili_relief_sheet_1795815651015.jpg';
import rockyReliefUrl from '../assets/images/rocky_relief_sheet_1795815649560.jpg';
import chotuReliefUrl from '../assets/images/chotu_relief_sheet_1795817760389.jpg';
import gappuReliefUrl from '../assets/images/gappu_relief_sheet_1795817762434.jpg';
import pappuReliefUrl from '../assets/images/pappu_relief_sheet_1795817763274.jpg';
import selfieSonaReliefUrl from '../assets/images/selfie_sona_relief_sheet_1795817790925.jpg';
import wifiBabaReliefUrl from '../assets/images/wifi_baba_relief_sheet_1795817792210.jpg';
import kalluKakaReliefUrl from '../assets/images/kallu_kaka_relief_sheet_1795817794689.jpg';
import mishraJiReliefUrl from '../assets/images/mishra_ji_relief_sheet_v2_1795817854439.jpg';
import dhamakaDonReliefUrl from '../assets/images/dhamaka_don_relief_sheet_1795817829226.jpg';
import hasmukhDidiReliefUrl from '../assets/images/hasmukh_didi_relief_sheet_1795817827967.jpg';
import { resolveCharacterAvatar, type BotAvatarProfile } from '../lib/botAvatars';
import {
  getBotReliefMotionStyle,
  HUMAN_PERSONA_META,
  resolveHumanAvatarPersona,
  type ExpressionIntensity,
  type FacialExpression,
  type HumanAvatarPersona,
  type PenaltyExpression,
  type ReliefMotionStyle,
} from '../lib/facialExpressions';
import type { ReliefAnimationFrame } from '../lib/gameAnimations';

export type AvatarExpression = FacialExpression | 'dizzy';
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SHEET_URLS: Record<1 | 2 | 3, string> = {
  1: sheet1Url,
  2: sheet2Url,
  3: sheet3Url,
};

interface BotExpressionSheetSet {
  base: string;
  intense: string;
}

/**
 * Per-bot penalty facial expression sprite-sheet registry (2x2 seamless quadrant grid):
 * - (col: 0, row: 0) -> annoyed (1 penalty card)
 * - (col: 1, row: 0) -> shocked (2 penalty cards)
 * - (col: 0, row: 1) -> sad (3 penalty cards)
 * - (col: 1, row: 1) -> crying (4+ penalty cards)
 */
const BOT_EXPRESSION_SHEETS: Readonly<Record<string, BotExpressionSheetSet>> = {
  'babloo-uncle': {
    base: bablooBaseExprUrl,
    intense: bablooIntenseExprUrl,
  },
};

/**
 * Per-bot 4-frame Sigh of Relief sprite-sheet registry (2x2 seamless sequential animation grid):
 * - (col: 0, row: 0) -> hold (anticipation)
 * - (col: 1, row: 0) -> exhale (peak personalised sigh)
 * - (col: 0, row: 1) -> smile (warm relieved smile)
 * - (col: 1, row: 1) -> settle (composed smooth return to normal)
 */
const BOT_RELIEF_SHEETS: Readonly<Record<string, string>> = {
  'chotu-chaiwala': chotuReliefUrl,
  surili: suriliReliefUrl,
  'babloo-uncle': bablooReliefUrl,
  'rocky-raja': rockyReliefUrl,
  gappu: gappuReliefUrl,
  'pappu-viral': pappuReliefUrl,
  'selfie-sona': selfieSonaReliefUrl,
  'wifi-baba': wifiBabaReliefUrl,
  'kallu-kaka': kalluKakaReliefUrl,
  'mishra-ji': mishraJiReliefUrl,
  'dhamaka-don': dhamakaDonReliefUrl,
  'hasmukh-didi': hasmukhDidiReliefUrl,
};

const EXPRESSION_QUADRANT: Record<PenaltyExpression, { col: 0 | 1; row: 0 | 1 }> = {
  annoyed: { col: 0, row: 0 },
  shocked: { col: 1, row: 0 },
  sad: { col: 0, row: 1 },
  crying: { col: 1, row: 1 },
};

const RELIEF_QUADRANT: Record<
  Exclude<ReliefAnimationFrame, 'idle'>,
  { col: 0 | 1; row: 0 | 1 }
> = {
  hold: { col: 0, row: 0 },
  exhale: { col: 1, row: 0 },
  smile: { col: 0, row: 1 },
  settle: { col: 1, row: 1 },
};

const RELIEF_MOTION_CLASS: Record<ReliefMotionStyle, string> = {
  dramatic: 'avatar-relief-dramatic',
  graceful: 'avatar-relief-graceful',
  swagger: 'avatar-relief-swagger',
  calm: 'avatar-relief-calm',
};

const SIZE_CLASSES: Record<
  AvatarSize,
  { box: string; text: string; earW: string; badge: string; streak: string }
> = {
  xs: {
    box: 'w-7 h-7',
    text: 'text-xs',
    earW: 'w-8 -top-3',
    badge: 'text-[9px] px-1 py-0.5',
    streak: 'text-[8px] px-1 py-0 -bottom-1 -right-1',
  },
  sm: {
    box: 'w-9 h-9 sm:w-10 sm:h-10',
    text: 'text-sm',
    earW: 'w-11 -top-4',
    badge: 'text-[10px] px-1.5 py-0.5',
    streak: 'text-[9px] px-1 py-0.5 -bottom-1 -right-1.5',
  },
  md: {
    box: 'w-11 h-11 sm:w-12 sm:h-12',
    text: 'text-base',
    earW: 'w-12 -top-4',
    badge: 'text-[10px] px-1.5 py-0.5',
    streak: 'text-[10px] px-1.5 py-0.5 -bottom-1 -right-1.5',
  },
  lg: {
    box: 'w-14 h-14',
    text: 'text-xl',
    earW: 'w-16 -top-5',
    badge: 'text-[11px] px-2 py-0.5',
    streak: 'text-[10px] px-1.5 py-0.5 -bottom-1 -right-1.5',
  },
  xl: {
    box: 'w-20 h-20 sm:w-24 sm:h-24',
    text: 'text-3xl',
    earW: 'w-24 sm:w-28 -top-7 sm:-top-8',
    badge: 'text-xs px-2.5 py-0.5',
    streak: 'text-[11px] px-2 py-0.5 -bottom-1 -right-1.5',
  },
  '2xl': {
    box: 'w-28 h-28 sm:w-32 sm:h-32',
    text: 'text-4xl',
    earW: 'w-32 sm:w-36 -top-9',
    badge: 'text-xs px-2.5 py-1',
    streak: 'text-xs px-2 py-0.5 -bottom-1 -right-1.5',
  },
};

function isPenaltyExpression(expr: AvatarExpression): expr is PenaltyExpression {
  return (
    expr === 'annoyed' ||
    expr === 'shocked' ||
    expr === 'sad' ||
    expr === 'crying'
  );
}

interface CharacterFaceAnchor {
  skin: string;
  mouthPatchColor?: string;
  browColor: string;
  browY: number;
  eyeY: number;
  lx: number;
  rx: number;
  mx: number;
  my: number;
  mouthRx: number;
  mouthRy: number;
  hasShades?: boolean;
  hasGlasses?: boolean;
  hasMustache?: boolean;
}

/**
 * Calibrated facial-landmark coordinates (0..100 normalized quadrant space) for the 11 approved
 * characters that reuse their base illustration portraits for penalty & streak expressions
 * (Babloo Uncle uses dedicated 2x2 base/intense penalty sprite sheets).
 */
export const CHARACTER_FACE_ANCHORS: Readonly<Record<string, CharacterFaceAnchor>> = {
  'chotu-chaiwala': {
    skin: '#E69A64',
    browColor: '#1E1612',
    browY: 39,
    eyeY: 49,
    lx: 48,
    rx: 65,
    mx: 55,
    my: 63,
    mouthRx: 9.5,
    mouthRy: 6.5,
    hasShades: true,
  },
  surili: {
    skin: '#F2B593',
    browColor: '#2B1B17',
    browY: 35,
    eyeY: 43,
    lx: 45,
    rx: 65,
    mx: 57,
    my: 61,
    mouthRx: 8.5,
    mouthRy: 7.5,
  },
  'rocky-raja': {
    skin: '#E69E6C',
    browColor: '#181414',
    browY: 39,
    eyeY: 49,
    lx: 50,
    rx: 68,
    mx: 58,
    my: 64,
    mouthRx: 10,
    mouthRy: 6,
    hasShades: true,
  },
  gappu: {
    skin: '#F1AF85',
    browColor: '#221712',
    browY: 32,
    eyeY: 40,
    lx: 41,
    rx: 59,
    mx: 50,
    my: 56,
    mouthRx: 12,
    mouthRy: 7.5,
  },
  'pappu-viral': {
    skin: '#ECA579',
    browColor: '#2A1B14',
    browY: 36,
    eyeY: 46,
    lx: 40,
    rx: 60,
    mx: 51,
    my: 63,
    mouthRx: 11.5,
    mouthRy: 6.5,
    hasGlasses: true,
  },
  'selfie-sona': {
    skin: '#F2B48D',
    browColor: '#281914',
    browY: 36,
    eyeY: 47,
    lx: 41,
    rx: 60,
    mx: 50,
    my: 63,
    mouthRx: 9.5,
    mouthRy: 6,
    hasShades: true,
  },
  'wifi-baba': {
    skin: '#F1AD82',
    mouthPatchColor: '#F3EFE6',
    browColor: '#F4F1EA',
    browY: 43,
    eyeY: 50,
    lx: 42,
    rx: 58,
    mx: 50,
    my: 66,
    mouthRx: 8.5,
    mouthRy: 5.5,
    hasMustache: true,
  },
  'kallu-kaka': {
    skin: '#EEA678',
    browColor: '#F3F1EC',
    browY: 37,
    eyeY: 45,
    lx: 45,
    rx: 62,
    mx: 55,
    my: 64,
    mouthRx: 9.5,
    mouthRy: 5.5,
    hasMustache: true,
  },
  'mishra-ji': {
    skin: '#E6A174',
    browColor: '#221814',
    browY: 32,
    eyeY: 43,
    lx: 38,
    rx: 56,
    mx: 48,
    my: 60,
    mouthRx: 9,
    mouthRy: 5.5,
    hasGlasses: true,
  },
  'dhamaka-don': {
    skin: '#DE9568',
    browColor: '#1B1414',
    browY: 35,
    eyeY: 46,
    lx: 48,
    rx: 66,
    mx: 57,
    my: 63,
    mouthRx: 9.5,
    mouthRy: 6,
    hasShades: true,
  },
  'hasmukh-didi': {
    skin: '#EDA374',
    browColor: '#231713',
    browY: 34,
    eyeY: 42,
    lx: 38,
    rx: 56,
    mx: 47,
    my: 61,
    mouthRx: 12,
    mouthRy: 8,
  },
};

/**
 * Calibrated facial-expression overlay applied directly onto the approved character portraits
 * for characters without separate penalty sprite sheets. Modifies actual eyebrows, eyes/eyelids,
 * cheek flush, tears, and mouth for all 4 penalty tiers (1, 2, 3, 4+ cards) and escalating
 * consecutive-failure streaks (intensity 1 -> 2 -> 3).
 */
const CharacterPenaltyFaceOverlay: React.FC<{
  characterId: string;
  expression: PenaltyExpression;
  intensity: ExpressionIntensity;
}> = ({ characterId, expression, intensity }) => {
  const uid = useId();
  const anchor = CHARACTER_FACE_ANCHORS[characterId];
  if (!anchor) return null;

  const intense = intensity >= 2;
  const meltdown = intensity >= 3;
  const {
    skin,
    mouthPatchColor = skin,
    browColor,
    browY,
    eyeY,
    lx,
    rx,
    mx,
    my,
    mouthRx,
    mouthRy,
    hasShades = false,
  } = anchor;

  const eyeSpan = Math.max(12, rx - lx);
  const eyeRadius = Math.max(4.4, Math.min(6.4, eyeSpan * 0.3));
  const cheekY = (eyeY + my) / 2 + 2;
  const skinGradId = `skin-${uid}`;
  const mouthGradId = `mouth-${uid}`;
  const browStroke = browColor === '#F4F1EA' || browColor === '#F3F1EC' ? '#261E18' : 'none';

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      data-character-penalty-overlay={expression}
      data-character-penalty-id={characterId}
      data-character-penalty-intensity={intensity}
      className="pointer-events-none absolute inset-0 w-full h-full select-none z-10"
    >
      <defs>
        <radialGradient id={skinGradId} cx="50%" cy="50%" r="50%">
          <stop offset="68%" stopColor={skin} stopOpacity="0.98" />
          <stop offset="100%" stopColor={skin} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={mouthGradId} cx="50%" cy="50%" r="50%">
          <stop offset="68%" stopColor={mouthPatchColor} stopOpacity="0.98" />
          <stop offset="100%" stopColor={mouthPatchColor} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Soft mood cheek flush on elevated / upset / crying expressions */}
      {(intense || expression === 'crying' || expression === 'annoyed') && (
        <>
          <ellipse
            cx={lx - 4}
            cy={cheekY}
            rx={meltdown ? 8.5 : 6.5}
            ry={meltdown ? 5.2 : 3.8}
            fill={expression === 'sad' ? '#60A5FA' : '#E24A3B'}
            opacity={
              expression === 'annoyed'
                ? intense
                  ? 0.48
                  : 0.22
                : meltdown
                  ? 0.52
                  : 0.36
            }
          />
          <ellipse
            cx={rx + 4}
            cy={cheekY}
            rx={meltdown ? 8.5 : 6.5}
            ry={meltdown ? 5.2 : 3.8}
            fill={expression === 'sad' ? '#60A5FA' : '#E24A3B'}
            opacity={
              expression === 'annoyed'
                ? intense
                  ? 0.48
                  : 0.22
                : meltdown
                  ? 0.52
                  : 0.36
            }
          />
        </>
      )}

      {/* Feathered skin mask over static smile mouth so new expression mouth reads cleanly */}
      <ellipse
        cx={mx}
        cy={my}
        rx={mouthRx * 1.28}
        ry={mouthRy * 1.24}
        fill={`url(#${mouthGradId})`}
      />

      {/* Feathered skin mask over original calm eyes for non-shades characters */}
      {!hasShades && (
        <>
          <ellipse
            cx={lx}
            cy={eyeY}
            rx={eyeRadius * 1.48}
            ry={eyeRadius * 1.32}
            fill={`url(#${skinGradId})`}
          />
          <ellipse
            cx={rx}
            cy={eyeY}
            rx={eyeRadius * 1.48}
            ry={eyeRadius * 1.32}
            fill={`url(#${skinGradId})`}
          />
          {/* Soft brow region blend so repositioned brows don't double-up */}
          <ellipse
            cx={lx}
            cy={browY}
            rx={eyeRadius * 1.45}
            ry={4.6}
            fill={`url(#${skinGradId})`}
          />
          <ellipse
            cx={rx}
            cy={browY}
            rx={eyeRadius * 1.45}
            ry={4.6}
            fill={`url(#${skinGradId})`}
          />
        </>
      )}

      {/* Soft brow region blend for shades characters (keeps sunglasses 100% untouched) */}
      {hasShades && (
        <>
          <ellipse
            cx={lx}
            cy={browY}
            rx={eyeRadius * 1.35}
            ry={4.2}
            fill={`url(#${skinGradId})`}
          />
          <ellipse
            cx={rx}
            cy={browY}
            rx={eyeRadius * 1.35}
            ry={4.2}
            fill={`url(#${skinGradId})`}
          />
        </>
      )}

      {/* ================================================================= */}
      {/* LEVEL 1: ANNOYED (1 card) / FUMING ANNOYED (Streak x2)            */}
      {/* ================================================================= */}
      {expression === 'annoyed' && (
        <>
          {/* Furrowed downward V-brows */}
          <path
            d={`M${lx - 6.5} ${browY - (intense ? 3 : 1.5)} L${lx + 5.5} ${browY + (intense ? 3.4 : 2)}`}
            fill="none"
            stroke={browColor}
            strokeWidth={intense ? '4.2' : '3.4'}
            strokeLinecap="round"
          />
          <path
            d={`M${rx + 6.5} ${browY - (intense ? 3 : 1.5)} L${rx - 5.5} ${browY + (intense ? 3.4 : 2)}`}
            fill="none"
            stroke={browColor}
            strokeWidth={intense ? '4.2' : '3.4'}
            strokeLinecap="round"
          />
          {browStroke !== 'none' && (
            <>
              <path
                d={`M${lx - 6.5} ${browY - (intense ? 3 : 1.5)} L${lx + 5.5} ${browY + (intense ? 3.4 : 2)}`}
                fill="none"
                stroke={browStroke}
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <path
                d={`M${rx + 6.5} ${browY - (intense ? 3 : 1.5)} L${rx - 5.5} ${browY + (intense ? 3.4 : 2)}`}
                fill="none"
                stroke={browStroke}
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </>
          )}

          {/* Narrowed half-lidded side-glancing annoyed eyes */}
          {!hasShades && (
            <>
              <ellipse
                cx={lx}
                cy={eyeY + 0.5}
                rx={eyeRadius * 0.95}
                ry={intense ? eyeRadius * 0.46 : eyeRadius * 0.58}
                fill="#FFFFFF"
                stroke="#261E18"
                strokeWidth="2.1"
              />
              <ellipse
                cx={rx}
                cy={eyeY + 0.5}
                rx={eyeRadius * 0.95}
                ry={intense ? eyeRadius * 0.46 : eyeRadius * 0.58}
                fill="#FFFFFF"
                stroke="#261E18"
                strokeWidth="2.1"
              />
              <circle cx={lx + (intense ? 0.5 : 1.3)} cy={eyeY + 0.8} r="2" fill="#261E18" />
              <circle cx={rx + (intense ? -0.5 : 1.3)} cy={eyeY + 0.8} r="2" fill="#261E18" />
              {/* Heavy flat upper eyelids */}
              <path
                d={`M${lx - eyeRadius} ${eyeY - 1.5} L${lx + eyeRadius} ${eyeY - 0.5}`}
                stroke="#261E18"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                d={`M${rx - eyeRadius} ${eyeY - 0.5} L${rx + eyeRadius} ${eyeY - 1.5}`}
                stroke="#261E18"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </>
          )}

          {/* Subtle forehead anger crease at streak x2+ */}
          {intense && (
            <path
              d={`M${(lx + rx) / 2 - 2.2} ${browY - 5} L${(lx + rx) / 2} ${browY - 2.5} L${(lx + rx) / 2 + 2.2} ${browY - 5}`}
              fill="none"
              stroke="#B91C1C"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Mouth: grumpy scowl (Lv 1) or clenched gritted teeth (Lv 2+) */}
          {intense ? (
            <>
              <rect
                x={mx - mouthRx * 0.85}
                y={my - 3.6}
                width={mouthRx * 1.7}
                height={7.4}
                rx="3"
                fill="#FFFFFF"
                stroke="#261E18"
                strokeWidth="2.4"
              />
              <line
                x1={mx - mouthRx * 0.72}
                y1={my + 0.1}
                x2={mx + mouthRx * 0.72}
                y2={my + 0.1}
                stroke="#261E18"
                strokeWidth="1.5"
              />
              <line
                x1={mx - mouthRx * 0.25}
                y1={my - 3.4}
                x2={mx - mouthRx * 0.25}
                y2={my + 3.6}
                stroke="#261E18"
                strokeWidth="1.3"
              />
              <line
                x1={mx + mouthRx * 0.25}
                y1={my - 3.4}
                x2={mx + mouthRx * 0.25}
                y2={my + 3.6}
                stroke="#261E18"
                strokeWidth="1.3"
              />
            </>
          ) : (
            <path
              d={`M${mx - mouthRx * 0.78} ${my + 2} Q${mx} ${my - 3.2} ${mx + mouthRx * 0.78} ${my + 2.5}`}
              fill="none"
              stroke="#261E18"
              strokeWidth="3.1"
              strokeLinecap="round"
            />
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* LEVEL 2: SHOCKED (2 cards) / HYPER-SHOCKED (Streak x2/x3)         */}
      {/* ================================================================= */}
      {expression === 'shocked' && (
        <>
          {/* Sky-high arched startled brows */}
          <path
            d={`M${lx - 6} ${browY - 1} Q${lx} ${browY - (intense ? 9.5 : 7)} ${lx + 5.5} ${browY - 1.5}`}
            fill="none"
            stroke={browColor}
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          <path
            d={`M${rx - 5.5} ${browY - 1.5} Q${rx} ${browY - (intense ? 9.5 : 7)} ${rx + 6} ${browY - 1}`}
            fill="none"
            stroke={browColor}
            strokeWidth="3.4"
            strokeLinecap="round"
          />

          {/* Wide-open stunned eyes (or startled lens glint for shades characters) */}
          {!hasShades ? (
            <>
              <circle
                cx={lx}
                cy={eyeY}
                r={intense ? eyeRadius * 1.15 : eyeRadius * 1.02}
                fill="#FFFFFF"
                stroke="#261E18"
                strokeWidth="2.4"
              />
              <circle
                cx={rx}
                cy={eyeY}
                r={intense ? eyeRadius * 1.15 : eyeRadius * 1.02}
                fill="#FFFFFF"
                stroke="#261E18"
                strokeWidth="2.4"
              />
              <circle cx={lx} cy={eyeY} r={intense ? 1.8 : 2.3} fill="#261E18" />
              <circle cx={rx} cy={eyeY} r={intense ? 1.8 : 2.3} fill="#261E18" />
            </>
          ) : (
            <>
              <circle cx={lx - 1} cy={eyeY - 1} r="2.2" fill="#FFFFFF" opacity="0.85" />
              <circle cx={rx - 1} cy={eyeY - 1} r="2.2" fill="#FFFFFF" opacity="0.85" />
            </>
          )}

          {/* Small comic cold-sweat drop on temple at Lv 2+ */}
          {intense && (
            <path
              d={`M${rx + 8.5} ${browY - 3} C${rx + 11.5} ${browY + 1.5} ${rx + 11.5} ${browY + 5} ${rx + 8.5} ${browY + 5} C${rx + 5.5} ${browY + 5} ${rx + 5.5} ${browY + 1.5} ${rx + 8.5} ${browY - 3} Z`}
              fill="#93C5FD"
              stroke="#1D4ED8"
              strokeWidth="1.2"
            />
          )}

          {/* Open stunned gasp O-mouth */}
          <ellipse
            cx={mx}
            cy={my + 1}
            rx={intense ? mouthRx * 0.88 : mouthRx * 0.68}
            ry={intense ? mouthRy * 1.18 : mouthRy * 0.92}
            fill="#6B1D1D"
            stroke="#261E18"
            strokeWidth="2.7"
          />
          <rect
            x={mx - mouthRx * 0.42}
            y={my - (intense ? mouthRy * 0.92 : mouthRy * 0.7)}
            width={mouthRx * 0.84}
            height="2.6"
            rx="1.2"
            fill="#FFFFFF"
          />
          {intense && (
            <ellipse
              cx={mx}
              cy={my + mouthRy * 0.72}
              rx={mouthRx * 0.48}
              ry="2.6"
              fill="#E06D7A"
            />
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* LEVEL 3: SAD / DISAPPOINTED (3 cards) / HEARTBROKEN (Streak x2)   */}
      {/* ================================================================= */}
      {expression === 'sad' && (
        <>
          {/* Drooping upturned-inner sad brows */}
          <path
            d={`M${lx - 6.5} ${browY + 2} Q${lx} ${browY - 1.5} ${lx + 5.5} ${browY - 4}`}
            fill="none"
            stroke={browColor}
            strokeWidth="3.3"
            strokeLinecap="round"
          />
          <path
            d={`M${rx + 6.5} ${browY + 2} Q${rx} ${browY - 1.5} ${rx - 5.5} ${browY - 4}`}
            fill="none"
            stroke={browColor}
            strokeWidth="3.3"
            strokeLinecap="round"
          />

          {/* Glossy watery sad eyes + lower-lid teardrops */}
          {!hasShades ? (
            <>
              <ellipse
                cx={lx}
                cy={eyeY + 0.5}
                rx={eyeRadius * 0.95}
                ry={eyeRadius * 0.88}
                fill="#FFFFFF"
                stroke="#261E18"
                strokeWidth="2.2"
              />
              <ellipse
                cx={rx}
                cy={eyeY + 0.5}
                rx={eyeRadius * 0.95}
                ry={eyeRadius * 0.88}
                fill="#FFFFFF"
                stroke="#261E18"
                strokeWidth="2.2"
              />
              <circle cx={lx} cy={eyeY + 1.2} r="2.4" fill="#261E18" />
              <circle cx={rx} cy={eyeY + 1.2} r="2.4" fill="#261E18" />
              {/* Glistening tear pool along bottom rim */}
              <path
                d={`M${lx - eyeRadius * 0.72} ${eyeY + eyeRadius * 0.42} Q${lx} ${eyeY + eyeRadius * 0.95} ${lx + eyeRadius * 0.72} ${eyeY + eyeRadius * 0.42}`}
                fill="#93C5FD"
                opacity="0.92"
              />
              <path
                d={`M${rx - eyeRadius * 0.72} ${eyeY + eyeRadius * 0.42} Q${rx} ${eyeY + eyeRadius * 0.95} ${rx + eyeRadius * 0.72} ${eyeY + eyeRadius * 0.42}`}
                fill="#93C5FD"
                opacity="0.92"
              />
              <circle cx={lx - 1.2} cy={eyeY - 0.5} r="1.4" fill="#DBEAFE" />
              <circle cx={rx - 1.2} cy={eyeY - 0.5} r="1.4" fill="#DBEAFE" />
            </>
          ) : null}

          {/* Rolling teardrops below eyes / below sunglasses rims */}
          <path
            d={`M${lx - 2} ${eyeY + eyeRadius + 0.5} C${lx - 4.5} ${eyeY + eyeRadius + 5.5} ${lx - 4.5} ${eyeY + eyeRadius + 9} ${lx - 1.5} ${eyeY + eyeRadius + 9} C${lx + 1.2} ${eyeY + eyeRadius + 9} ${lx + 1.2} ${eyeY + eyeRadius + 5.5} ${lx - 2} ${eyeY + eyeRadius + 0.5} Z`}
            fill="#60A5FA"
            stroke="#1D4ED8"
            strokeWidth="1.2"
          />
          {intense && (
            <path
              d={`M${rx + 2} ${eyeY + eyeRadius + 0.5} C${rx + 4.5} ${eyeY + eyeRadius + 5.5} ${rx + 4.5} ${eyeY + eyeRadius + 9.5} ${rx + 1.5} ${eyeY + eyeRadius + 9.5} C${rx - 1.2} ${eyeY + eyeRadius + 9.5} ${rx - 1.2} ${eyeY + eyeRadius + 5.5} ${rx + 2} ${eyeY + eyeRadius + 0.5} Z`}
              fill="#60A5FA"
              stroke="#1D4ED8"
              strokeWidth="1.2"
            />
          )}

          {/* Downturned trembling sad frown */}
          <path
            d={`M${mx - mouthRx * 0.85} ${my + (intense ? 4.2 : 3)} Q${mx} ${my - (intense ? 5.5 : 3.5)} ${mx + mouthRx * 0.85} ${my + (intense ? 4.2 : 3)}`}
            fill="none"
            stroke="#261E18"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </>
      )}

      {/* ================================================================= */}
      {/* LEVEL 4+: CRYING / DEVASTATED (4+ cards) & TOTAL MELTDOWN (x3)    */}
      {/* ================================================================= */}
      {expression === 'crying' && (
        <>
          {/* Deeply anguished eyebrows */}
          <path
            d={`M${lx - 7} ${browY + 1.5} Q${lx} ${browY - 2.5} ${lx + 6} ${browY - 5.5}`}
            fill="none"
            stroke={browColor}
            strokeWidth="3.6"
            strokeLinecap="round"
          />
          <path
            d={`M${rx + 7} ${browY + 1.5} Q${rx} ${browY - 2.5} ${rx - 6} ${browY - 5.5}`}
            fill="none"
            stroke={browColor}
            strokeWidth="3.6"
            strokeLinecap="round"
          />

          {/* Twin cartoon waterfall tear streams pouring down cheeks */}
          <path
            d={
              intense
                ? `M${lx - 4} ${eyeY + 3} C${lx - 7} ${eyeY + 16} ${lx - 6.5} ${eyeY + 29} ${lx - 1.5} ${eyeY + 34} C${lx + 3} ${eyeY + 29} ${lx + 4.5} ${eyeY + 16} ${lx + 2.5} ${eyeY + 3} Z`
                : `M${lx - 3} ${eyeY + 3} C${lx - 5.5} ${eyeY + 13} ${lx - 5} ${eyeY + 22} ${lx - 1} ${eyeY + 25} C${lx + 2.5} ${eyeY + 22} ${lx + 3.5} ${eyeY + 13} ${lx + 2} ${eyeY + 3} Z`
            }
            fill="#60A5FA"
            stroke="#1D4ED8"
            strokeWidth="1.4"
            opacity="0.94"
          />
          <path
            d={
              intense
                ? `M${rx + 4} ${eyeY + 3} C${rx + 7} ${eyeY + 16} ${rx + 6.5} ${eyeY + 29} ${rx + 1.5} ${eyeY + 34} C${rx - 3} ${eyeY + 29} ${rx - 4.5} ${eyeY + 16} ${rx - 2.5} ${eyeY + 3} Z`
                : `M${rx + 3} ${eyeY + 3} C${rx + 5.5} ${eyeY + 13} ${rx + 5} ${eyeY + 22} ${rx + 1} ${eyeY + 25} C${rx - 2.5} ${eyeY + 22} ${rx - 3.5} ${eyeY + 13} ${rx - 2} ${eyeY + 3} Z`
            }
            fill="#60A5FA"
            stroke="#1D4ED8"
            strokeWidth="1.4"
            opacity="0.94"
          />

          {/* Tightly squeezed-shut "> <" crying eyes (for non-shades characters) */}
          {!hasShades && (
            <>
              <path
                d={`M${lx - 5.2} ${eyeY - 3.5} L${lx + 4.2} ${eyeY + 0.2} L${lx - 5.2} ${eyeY + 3.8}`}
                fill="none"
                stroke="#261E18"
                strokeWidth="3.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={`M${rx + 5.2} ${eyeY - 3.5} L${rx - 4.2} ${eyeY + 0.2} L${rx + 5.2} ${eyeY + 3.8}`}
                fill="none"
                stroke="#261E18"
                strokeWidth="3.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {/* Wide open sobbing / wailing mouth */}
          <path
            d={
              intense
                ? `M${mx - mouthRx * 1.05} ${my + 4.5} C${mx - mouthRx * 0.8} ${my - 8.5} ${mx + mouthRx * 0.8} ${my - 8.5} ${mx + mouthRx * 1.05} ${my + 4.5} C${mx + mouthRx * 0.6} ${my + 8.5} ${mx - mouthRx * 0.6} ${my + 8.5} ${mx - mouthRx * 1.05} ${my + 4.5} Z`
                : `M${mx - mouthRx * 0.88} ${my + 3.5} C${mx - mouthRx * 0.65} ${my - 6.5} ${mx + mouthRx * 0.65} ${my - 6.5} ${mx + mouthRx * 0.88} ${my + 3.5} C${mx + mouthRx * 0.5} ${my + 6.5} ${mx - mouthRx * 0.5} ${my + 6.5} ${mx - mouthRx * 0.88} ${my + 3.5} Z`
            }
            fill="#6B1D1D"
            stroke="#261E18"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
          <ellipse
            cx={mx}
            cy={my + (intense ? 4.2 : 3.2)}
            rx={intense ? mouthRx * 0.56 : mouthRx * 0.44}
            ry={intense ? 2.8 : 2.3}
            fill="#E06D7A"
          />
        </>
      )}
    </svg>
  );
};

/**
 * Illustrated caricature facial expression for human player avatars.
 * Directly animates eyes, eyelids, eyebrows, cheeks, shades (for Cool persona),
 * mouth, and breath puff across both failed-trick penalty tiers AND personalised
 * 4-frame Sigh of Relief sequences (hold -> exhale -> smile -> settle).
 */
const HumanExpressionFace: React.FC<{
  expression: AvatarExpression;
  intensity: ExpressionIntensity;
  reliefFrame: ReliefAnimationFrame;
  persona: HumanAvatarPersona;
}> = ({ expression, intensity, reliefFrame, persona }) => {
  const intense = intensity >= 2;
  const meltdown = intensity >= 3;
  const normalizedExpr: FacialExpression =
    expression === 'dizzy' ? 'crying' : expression;

  const isReliefActive =
    reliefFrame !== 'idle' &&
    normalizedExpr !== 'donkey' &&
    normalizedExpr !== 'happy';

  const skinFill =
    !isReliefActive && normalizedExpr === 'annoyed' && intense
      ? '#F4B699'
      : !isReliefActive && normalizedExpr === 'crying' && intense
        ? '#F6C2A8'
        : '#F7CAA8';

  const hairFill =
    persona === 'zen'
      ? '#3B2838'
      : persona === 'cool'
        ? '#1A1F28'
        : '#261E18';

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      data-human-expression-face={isReliefActive ? `relief-${reliefFrame}` : normalizedExpr}
      data-human-persona={persona}
      data-human-expression-intensity={intensity}
      className="w-full h-full select-none pointer-events-none"
    >
      {/* Shoulders / collar */}
      <path
        d="M18 102 C22 82 35 76 50 76 C65 76 78 82 82 102 Z"
        fill={persona === 'cool' ? '#1E293B' : persona === 'zen' ? '#4C2E4F' : '#261E18'}
        opacity="0.9"
      />
      {/* Ears */}
      <circle cx="21" cy="54" r="7.5" fill={skinFill} stroke="#261E18" strokeWidth="3" />
      <circle cx="79" cy="54" r="7.5" fill={skinFill} stroke="#261E18" strokeWidth="3" />
      {/* Head */}
      <ellipse
        cx="50"
        cy="51"
        rx="28"
        ry="30"
        fill={skinFill}
        stroke="#261E18"
        strokeWidth="3.4"
      />
      {/* Persona-distinct Hair Silhouette */}
      {persona === 'cool' ? (
        <path
          d="M21 44 C20 20 38 11 56 14 C72 17 80 26 78 44 C72 31 61 27 48 28 C37 29 29 34 21 44 Z"
          fill={hairFill}
        />
      ) : persona === 'zen' ? (
        <>
          <circle cx="50" cy="17" r="9" fill={hairFill} />
          <path
            d="M22 45 C22 23 36 17 50 17 C64 17 78 23 78 45 C71 33 61 30 50 30 C39 30 29 33 22 45 Z"
            fill={hairFill}
          />
          {/* Subtle meditative bindi dot */}
          <circle cx="50" cy="37" r="2.2" fill="#C93B5B" />
        </>
      ) : (
        <path
          d="M22 44 C22 22 36 16 50 16 C64 16 78 22 78 44 C73 33 65 29 56 29 C46 29 38 33 22 44 Z"
          fill={hairFill}
        />
      )}

      {/* Warm rosy glow during relief exhale/smile */}
      {isReliefActive && (reliefFrame === 'exhale' || reliefFrame === 'smile') && (
        <>
          <ellipse cx="31" cy="59" rx="5.5" ry="3.2" fill="#F08080" opacity="0.34" />
          <ellipse cx="69" cy="59" rx="5.5" ry="3.2" fill="#F08080" opacity="0.34" />
        </>
      )}

      {/* Cheek flush on intense / upset / crying expressions */}
      {!isReliefActive && (intense || normalizedExpr === 'crying' || normalizedExpr === 'donkey') && (
        <>
          <ellipse
            cx="32"
            cy="61"
            rx={meltdown ? 7 : 5.5}
            ry={meltdown ? 4.5 : 3.5}
            fill="#E24A3B"
            opacity={meltdown ? 0.55 : 0.38}
          />
          <ellipse
            cx="68"
            cy="61"
            rx={meltdown ? 7 : 5.5}
            ry={meltdown ? 4.5 : 3.5}
            fill="#E24A3B"
            opacity={meltdown ? 0.55 : 0.38}
          />
        </>
      )}

      {/* PERSONALISED 4-FRAME SIGH OF RELIEF ANIMATION */}
      {isReliefActive ? (
        <>
          {/* FRAME 1: HOLD / ANTICIPATION */}
          {reliefFrame === 'hold' && (
            <>
              <path
                d={persona === 'dramatic' ? 'M29 37 L44 42' : 'M30 40 Q38 36 45 39'}
                fill="none"
                stroke="#261E18"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
              <path
                d={persona === 'dramatic' ? 'M71 37 L56 42' : 'M55 39 Q62 36 70 40'}
                fill="none"
                stroke="#261E18"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
              {persona === 'dramatic' ? (
                <>
                  <path d="M31 46 L43 50 L31 53" fill="none" stroke="#261E18" strokeWidth="3.3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M69 46 L57 50 L69 53" fill="none" stroke="#261E18" strokeWidth="3.3" strokeLinecap="round" strokeLinejoin="round" />
                </>
              ) : (
                <>
                  <path d="M32 50 Q38 48 44 50" fill="none" stroke="#261E18" strokeWidth="3.2" strokeLinecap="round" />
                  <path d="M56 50 Q62 48 68 50" fill="none" stroke="#261E18" strokeWidth="3.2" strokeLinecap="round" />
                </>
              )}
              <path d="M43 66 Q50 64 57 66" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
            </>
          )}

          {/* FRAME 2: PEAK SIGH EXHALE (Persona-specific!) */}
          {reliefFrame === 'exhale' && (
            <>
              {persona === 'dramatic' ? (
                <>
                  {/* High lifted relieved eyebrows */}
                  <path d="M29 36 Q37 29 45 35" fill="none" stroke="#261E18" strokeWidth="3.4" strokeLinecap="round" />
                  <path d="M55 35 Q63 29 71 36" fill="none" stroke="#261E18" strokeWidth="3.4" strokeLinecap="round" />
                  {/* Tight blissful relieved shut crescents */}
                  <path d="M31 51 Q38 43 45 51" fill="none" stroke="#261E18" strokeWidth="3.5" strokeLinecap="round" />
                  <path d="M55 51 Q62 43 69 51" fill="none" stroke="#261E18" strokeWidth="3.5" strokeLinecap="round" />
                  {/* Big round PHEW exhale O-mouth + breath puff */}
                  <ellipse cx="50" cy="67" rx="5.5" ry="6.5" fill="#7A2626" stroke="#261E18" strokeWidth="2.8" />
                  <path
                    d="M59 66 Q67 65 73 61 C77 58 82 62 79 66 C82 69 76 73 72 69 Q67 67 59 67 Z"
                    fill="#FFFFFF"
                    fillOpacity="0.88"
                    stroke="#94A3B8"
                    strokeWidth="1.2"
                  />
                </>
              ) : persona === 'cool' ? (
                <>
                  {/* One eyebrow cocked smoothly up */}
                  <path d="M30 39 Q38 36 45 39" fill="none" stroke="#261E18" strokeWidth="3.3" strokeLinecap="round" />
                  <path d="M55 37 Q63 31 71 36" fill="none" stroke="#261E18" strokeWidth="3.4" strokeLinecap="round" />
                  {/* Relaxed half-lidded eyes peeking over dipped shades */}
                  <path d="M33 46 L43 46" stroke="#261E18" strokeWidth="2.6" strokeLinecap="round" />
                  <path d="M57 46 L67 46" stroke="#261E18" strokeWidth="2.6" strokeLinecap="round" />
                  <circle cx="38" cy="48.5" r="2.1" fill="#261E18" />
                  <circle cx="62" cy="48.5" r="2.1" fill="#261E18" />
                  {/* Dipped cool shades */}
                  <rect x="28" y="49" width="19" height="9" rx="4" fill="#1E293B" fillOpacity="0.88" stroke="#EAB308" strokeWidth="1.7" />
                  <rect x="53" y="49" width="19" height="9" rx="4" fill="#1E293B" fillOpacity="0.88" stroke="#EAB308" strokeWidth="1.7" />
                  <line x1="47" y1="52" x2="53" y2="52" stroke="#EAB308" strokeWidth="1.7" />
                  {/* Sideways smooth cool whistle-exhale + wisp */}
                  <ellipse cx="52" cy="68" rx="4.2" ry="4.5" fill="#7A2626" stroke="#261E18" strokeWidth="2.6" />
                  <path d="M59 68 Q68 68 74 64" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
                  <path d="M61 71 Q69 72 75 69" fill="none" stroke="#E2E8F0" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
                </>
              ) : persona === 'zen' ? (
                <>
                  {/* Tender serenely arched eyebrows */}
                  <path d="M29 42 Q37 36 45 40" fill="none" stroke="#261E18" strokeWidth="2.8" strokeLinecap="round" />
                  <path d="M55 40 Q63 36 71 42" fill="none" stroke="#261E18" strokeWidth="2.8" strokeLinecap="round" />
                  {/* Peaceful curved downward closed eyelashes */}
                  <path d="M31 50 Q38 56 45 50" fill="none" stroke="#261E18" strokeWidth="3.2" strokeLinecap="round" />
                  <path d="M55 50 Q62 56 69 50" fill="none" stroke="#261E18" strokeWidth="3.2" strokeLinecap="round" />
                  {/* Soft parted sighing mouth + delicate breath wisp */}
                  <ellipse cx="50" cy="66" rx="4.6" ry="3.8" fill="#A64452" stroke="#261E18" strokeWidth="2.4" />
                  <path d="M58 66 Q66 64 72 60" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.82" />
                </>
              ) : (
                <>
                  {/* Classic cheerful exhale: high soft brows, happy closed arcs, gentle O-exhale */}
                  <path d="M30 37 Q38 32 45 37" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
                  <path d="M55 37 Q62 32 70 37" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
                  <path d="M32 50 Q38 44 44 50" fill="none" stroke="#261E18" strokeWidth="3.4" strokeLinecap="round" />
                  <path d="M56 50 Q62 44 68 50" fill="none" stroke="#261E18" strokeWidth="3.4" strokeLinecap="round" />
                  <ellipse cx="50" cy="66" rx="4.8" ry="5" fill="#7A2626" stroke="#261E18" strokeWidth="2.6" />
                  <path d="M58 66 Q66 65 72 62" fill="none" stroke="#FFFFFF" strokeWidth="2.1" strokeLinecap="round" opacity="0.85" />
                </>
              )}
            </>
          )}

          {/* FRAME 3: WARM RELIEVED SMILE */}
          {reliefFrame === 'smile' && (
            <>
              <path d="M30 38 Q38 33 45 38" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
              <path d="M55 38 Q62 33 70 38" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
              {persona === 'cool' ? (
                <>
                  <rect x="28" y="45" width="19" height="9" rx="4" fill="#1E293B" stroke="#EAB308" strokeWidth="1.7" />
                  <rect x="53" y="45" width="19" height="9" rx="4" fill="#1E293B" stroke="#EAB308" strokeWidth="1.7" />
                  <line x1="47" y1="48.5" x2="53" y2="48.5" stroke="#EAB308" strokeWidth="1.7" />
                  <path d="M39 64 Q51 73 63 62" fill="none" stroke="#261E18" strokeWidth="3.4" strokeLinecap="round" />
                </>
              ) : (
                <>
                  <path d="M32 50 Q38 44 44 50" fill="none" stroke="#261E18" strokeWidth="3.4" strokeLinecap="round" />
                  <path d="M56 50 Q62 44 68 50" fill="none" stroke="#261E18" strokeWidth="3.4" strokeLinecap="round" />
                  <path
                    d="M38 62 Q50 74 62 62 Z"
                    fill="#FFFFFF"
                    stroke="#261E18"
                    strokeWidth="2.8"
                    strokeLinejoin="round"
                  />
                </>
              )}
            </>
          )}

          {/* FRAME 4: GENTLE SETTLE BACK TO NORMAL */}
          {reliefFrame === 'settle' && (
            <>
              <path d="M31 40 Q38 36 44 39" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
              <path d="M56 39 Q62 36 69 40" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
              {persona === 'cool' ? (
                <>
                  <rect x="28" y="45" width="19" height="9" rx="4" fill="#1E293B" stroke="#EAB308" strokeWidth="1.7" />
                  <rect x="53" y="45" width="19" height="9" rx="4" fill="#1E293B" stroke="#EAB308" strokeWidth="1.7" />
                  <line x1="47" y1="48.5" x2="53" y2="48.5" stroke="#EAB308" strokeWidth="1.7" />
                  <path d="M41 65 Q51 70 60 63" fill="none" stroke="#261E18" strokeWidth="3.1" strokeLinecap="round" />
                </>
              ) : (
                <>
                  <circle cx="38" cy="49" r="3.6" fill="#261E18" />
                  <circle cx="62" cy="49" r="3.6" fill="#261E18" />
                  <circle cx="39.2" cy="47.8" r="1.2" fill="#FFFFFF" />
                  <circle cx="63.2" cy="47.8" r="1.2" fill="#FFFFFF" />
                  <path d="M39 63 Q50 72 61 63" fill="none" stroke="#261E18" strokeWidth="3.2" strokeLinecap="round" />
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          {/* NORMAL / CALM FACE */}
          {normalizedExpr === 'normal' && (
            <>
              <path d="M31 41 Q38 37 44 40" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
              <path d="M56 40 Q62 37 69 41" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
              {persona === 'cool' ? (
                <>
                  <rect x="28" y="45" width="19" height="9" rx="4" fill="#1E293B" stroke="#EAB308" strokeWidth="1.7" />
                  <rect x="53" y="45" width="19" height="9" rx="4" fill="#1E293B" stroke="#EAB308" strokeWidth="1.7" />
                  <line x1="47" y1="48.5" x2="53" y2="48.5" stroke="#EAB308" strokeWidth="1.7" />
                  <path d="M40 65 Q51 70 60 63" fill="none" stroke="#261E18" strokeWidth="3.1" strokeLinecap="round" />
                </>
              ) : (
                <>
                  <circle cx="38" cy="49" r="3.6" fill="#261E18" />
                  <circle cx="62" cy="49" r="3.6" fill="#261E18" />
                  <circle cx="39.2" cy="47.8" r="1.2" fill="#FFFFFF" />
                  <circle cx="63.2" cy="47.8" r="1.2" fill="#FFFFFF" />
                  <path d="M40 64 Q50 71 60 64" fill="none" stroke="#261E18" strokeWidth="3.2" strokeLinecap="round" />
                </>
              )}
            </>
          )}

          {/* HAPPY / SAFE FINISH FACE */}
          {normalizedExpr === 'happy' && (
            <>
              <path d="M30 39 Q38 34 44 38" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
              <path d="M56 38 Q62 34 70 39" fill="none" stroke="#261E18" strokeWidth="3" strokeLinecap="round" />
              <path d="M32 50 Q38 43 44 50" fill="none" stroke="#261E18" strokeWidth="3.4" strokeLinecap="round" />
              <path d="M56 50 Q62 43 68 50" fill="none" stroke="#261E18" strokeWidth="3.4" strokeLinecap="round" />
              <path d="M37 61 Q50 75 63 61 Z" fill="#FFFFFF" stroke="#261E18" strokeWidth="2.8" strokeLinejoin="round" />
            </>
          )}

          {/* LEVEL 1: SLIGHTLY ANNOYED / FUMING */}
          {normalizedExpr === 'annoyed' && (
            <>
              <path
                d={intense ? 'M29 37 L45 45' : 'M30 40 L45 44'}
                fill="none"
                stroke="#261E18"
                strokeWidth={intense ? '4' : '3.3'}
                strokeLinecap="round"
              />
              <path
                d={intense ? 'M71 37 L55 45' : 'M70 40 L55 44'}
                fill="none"
                stroke="#261E18"
                strokeWidth={intense ? '4' : '3.3'}
                strokeLinecap="round"
              />
              <ellipse cx="38" cy="50" rx="5.2" ry={intense ? 2.6 : 3.2} fill="#FFFFFF" stroke="#261E18" strokeWidth="2.4" />
              <ellipse cx="62" cy="50" rx="5.2" ry={intense ? 2.6 : 3.2} fill="#FFFFFF" stroke="#261E18" strokeWidth="2.4" />
              <circle cx={intense ? 39 : 40} cy="50.5" r="2.1" fill="#261E18" />
              <circle cx={intense ? 61 : 64} cy="50.5" r="2.1" fill="#261E18" />
              <path d="M32 47 L44 48" stroke="#261E18" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M56 48 L68 47" stroke="#261E18" strokeWidth="2.6" strokeLinecap="round" />
              {intense ? (
                <>
                  <rect x="37" y="62" width="26" height="9" rx="3.5" fill="#FFFFFF" stroke="#261E18" strokeWidth="2.8" />
                  <line x1="39" y1="66.5" x2="61" y2="66.5" stroke="#261E18" strokeWidth="1.8" />
                  <line x1="45" y1="62" x2="45" y2="71" stroke="#261E18" strokeWidth="1.5" />
                  <line x1="55" y1="62" x2="55" y2="71" stroke="#261E18" strokeWidth="1.5" />
                </>
              ) : (
                <path d="M40 66 Q50 62 60 67" fill="none" stroke="#261E18" strokeWidth="3.3" strokeLinecap="round" />
              )}
            </>
          )}

          {/* LEVEL 2: SHOCKED / HYPER-SHOCKED */}
          {normalizedExpr === 'shocked' && (
            <>
              <path
                d={intense ? 'M29 34 Q38 26 45 34' : 'M30 37 Q38 30 45 36'}
                fill="none"
                stroke="#261E18"
                strokeWidth="3.4"
                strokeLinecap="round"
              />
              <path
                d={intense ? 'M55 34 Q62 26 71 34' : 'M55 36 Q62 30 70 37'}
                fill="none"
                stroke="#261E18"
                strokeWidth="3.4"
                strokeLinecap="round"
              />
              <circle cx="38" cy="49" r={intense ? 7.2 : 6.2} fill="#FFFFFF" stroke="#261E18" strokeWidth="2.8" />
              <circle cx="62" cy="49" r={intense ? 7.2 : 6.2} fill="#FFFFFF" stroke="#261E18" strokeWidth="2.8" />
              <circle cx="38" cy="49" r={intense ? 2.1 : 2.5} fill="#261E18" />
              <circle cx="62" cy="49" r={intense ? 2.1 : 2.5} fill="#261E18" />
              <ellipse
                cx="50"
                cy={intense ? 68 : 67}
                rx={intense ? 9.5 : 7}
                ry={intense ? 10 : 7.5}
                fill="#6B1D1D"
                stroke="#261E18"
                strokeWidth="3"
              />
              {intense && <ellipse cx="50" cy="73" rx="5.5" ry="3" fill="#E06D7A" />}
            </>
          )}

          {/* LEVEL 3: SAD / HEARTBROKEN */}
          {normalizedExpr === 'sad' && (
            <>
              <path d="M29 44 Q37 39 45 36" fill="none" stroke="#261E18" strokeWidth="3.2" strokeLinecap="round" />
              <path d="M71 44 Q63 39 55 36" fill="none" stroke="#261E18" strokeWidth="3.2" strokeLinecap="round" />
              <ellipse cx="38" cy="51" rx="5.2" ry="4.8" fill="#FFFFFF" stroke="#261E18" strokeWidth="2.5" />
              <ellipse cx="62" cy="51" rx="5.2" ry="4.8" fill="#FFFFFF" stroke="#261E18" strokeWidth="2.5" />
              <circle cx="38" cy="52" r="2.7" fill="#261E18" />
              <circle cx="62" cy="52" r="2.7" fill="#261E18" />
              <circle cx="36.8" cy="50.5" r="1.4" fill="#93C5FD" />
              <circle cx="60.8" cy="50.5" r="1.4" fill="#93C5FD" />
              {intense && (
                <>
                  <path d="M34 56 C32 61 32 64 35 64 C37 64 37 61 34 56 Z" fill="#60A5FA" stroke="#1D4ED8" strokeWidth="1.2" />
                  <path d="M66 56 C64 61 64 64 67 64 C69 64 69 61 66 56 Z" fill="#60A5FA" stroke="#1D4ED8" strokeWidth="1.2" />
                </>
              )}
              <path
                d={intense ? 'M36 72 Q50 58 64 72' : 'M38 70 Q50 61 62 70'}
                fill="none"
                stroke="#261E18"
                strokeWidth="3.4"
                strokeLinecap="round"
              />
            </>
          )}

          {/* LEVEL 4+: CRYING / DEVASTATED & DONKEY */}
          {(normalizedExpr === 'crying' || normalizedExpr === 'donkey') && (
            <>
              <path d="M28 43 Q37 37 46 34" fill="none" stroke="#261E18" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M72 43 Q63 37 54 34" fill="none" stroke="#261E18" strokeWidth="3.5" strokeLinecap="round" />
              <path
                d={intense ? 'M31 53 C28 66 29 79 34 84 C39 79 41 66 39 53 Z' : 'M33 54 C31 63 32 72 36 75 C39 72 40 63 38 54 Z'}
                fill="#60A5FA"
                stroke="#1D4ED8"
                strokeWidth="1.5"
                opacity="0.92"
              />
              <path
                d={intense ? 'M69 53 C72 66 71 79 66 84 C61 79 59 66 61 53 Z' : 'M67 54 C69 63 68 72 64 75 C61 72 60 63 62 54 Z'}
                fill="#60A5FA"
                stroke="#1D4ED8"
                strokeWidth="1.5"
                opacity="0.92"
              />
              <path d="M31 46 L43 50 L31 54" fill="none" stroke="#261E18" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M69 46 L57 50 L69 54" fill="none" stroke="#261E18" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
              <path
                d={intense ? 'M34 73 C37 59 63 59 66 73 C61 78 39 78 34 73 Z' : 'M37 72 C40 61 60 61 63 72 C58 75 42 75 37 72 Z'}
                fill="#6B1D1D"
                stroke="#261E18"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <ellipse cx="50" cy="72" rx={intense ? 7.5 : 5.5} ry="3" fill="#E06D7A" />
            </>
          )}
        </>
      )}
    </svg>
  );
};

export interface PlayerAvatarProps {
  name: string;
  type: 'human' | 'bot';
  avatarColor: string;
  /** Canonical character avatar ID (supported for both human and bot players) */
  avatarId?: string | null;
  /** Backward-compatible alias for avatarId */
  botAvatarId?: string | null;
  playerId?: string;
  size?: AvatarSize;
  expression?: AvatarExpression;
  /** Streak-driven intensity (0 = calm, 1 = base, 2 = elevated intense, 3 = peak meltdown) */
  expressionIntensity?: ExpressionIntensity;
  /** Consecutive failed-trick streak count (shows compact x2/x3 badge when >= 2) */
  failStreak?: number;
  /** Active 4-frame Sigh of Relief sequence when a trick succeeds */
  reliefFrame?: ReliefAnimationFrame;
  /** Explicit human avatar persona (defaults deterministically from avatarColor / playerId) */
  humanPersona?: HumanAvatarPersona;
  /** Render the expressive cartoon human face even in calm state (used on table & expression demo) */
  showHumanFace?: boolean;
  activeTurn?: boolean;
  disconnected?: boolean;
  penaltyDelta?: number | null;
  animated?: boolean;
  className?: string;
}

/**
 * Renders the circular avatar for bots and human players with real facial-expression updates
 * for both failed-trick penalty levels/streaks AND personalised 4-frame Sigh of Relief animations
 * on successful tricks, while preserving fixed avatar dimensions and clean framing.
 */
export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  name,
  type,
  avatarColor,
  avatarId,
  botAvatarId,
  playerId,
  size = 'md',
  expression = 'normal',
  expressionIntensity = 0,
  failStreak = 0,
  reliefFrame = 'idle',
  humanPersona,
  showHumanFace = false,
  activeTurn = false,
  disconnected = false,
  penaltyDelta = null,
  animated = true,
  className = '',
}) => {
  const dims = SIZE_CLASSES[size];
  const effectiveAvatarId = avatarId ?? botAvatarId;
  const botProfile: BotAvatarProfile | null = resolveCharacterAvatar({
    type,
    avatarId: effectiveAvatarId,
    botAvatarId: effectiveAvatarId,
    name,
    id: playerId,
  });

  const resolvedPersona: HumanAvatarPersona = resolveHumanAvatarPersona({
    preferredPersona: humanPersona,
    avatarColor,
    playerId,
    name,
  });

  const isReliefActive =
    reliefFrame !== 'idle' &&
    expression !== 'donkey' &&
    expression !== 'happy';

  // Resolve active portrait sprite sheet + quadrant for bots (Relief sheet takes priority during active relief)
  const reliefSheetUrl = botProfile ? BOT_RELIEF_SHEETS[botProfile.id] ?? null : null;
  const exprSheets = botProfile ? BOT_EXPRESSION_SHEETS[botProfile.id] ?? null : null;
  const effectivePenaltyExpr: PenaltyExpression | null = isPenaltyExpression(expression)
    ? expression
    : expression === 'donkey' || expression === 'dizzy'
      ? 'crying'
      : null;

  const useIntenseSheet =
    expressionIntensity >= 2 || expression === 'donkey';

  let portraitSrc = botProfile ? SHEET_URLS[botProfile.sheet] : '';
  let portraitCol: 0 | 1 = botProfile ? botProfile.col : 0;
  let portraitRow: 0 | 1 = botProfile ? botProfile.row : 0;
  let artworkMode: 'base' | 'bot-penalty' | 'character-penalty' | 'bot-relief' | 'human-face' =
    'base';

  if (botProfile && isReliefActive && reliefSheetUrl) {
    const rq = RELIEF_QUADRANT[reliefFrame as Exclude<ReliefAnimationFrame, 'idle'>];
    portraitSrc = reliefSheetUrl;
    portraitCol = rq.col;
    portraitRow = rq.row;
    artworkMode = 'bot-relief';
  } else if (botProfile && exprSheets && effectivePenaltyExpr) {
    const q = EXPRESSION_QUADRANT[effectivePenaltyExpr];
    portraitSrc = useIntenseSheet ? exprSheets.intense : exprSheets.base;
    portraitCol = q.col;
    portraitRow = q.row;
    artworkMode = 'bot-penalty';
  } else if (botProfile && effectivePenaltyExpr && CHARACTER_FACE_ANCHORS[botProfile.id]) {
    artworkMode = 'character-penalty';
  }

  const useCharacterPenaltyOverlay = artworkMode === 'character-penalty' && Boolean(effectivePenaltyExpr);

  // Subtle portrait mood grading for character-penalty portraits so expression shifts read instantly at all sizes
  const portraitMoodFilter = useCharacterPenaltyOverlay
    ? effectivePenaltyExpr === 'crying'
      ? expressionIntensity >= 2
        ? 'saturate(0.84) contrast(1.06) brightness(0.94)'
        : 'saturate(0.88) brightness(0.96)'
      : effectivePenaltyExpr === 'sad'
        ? 'saturate(0.82) brightness(0.95)'
        : effectivePenaltyExpr === 'annoyed' && expressionIntensity >= 2
          ? 'saturate(1.16) contrast(1.06)'
          : undefined
    : undefined;

  const reliefMotionStyle: ReliefMotionStyle = botProfile
    ? getBotReliefMotionStyle(botProfile.id)
    : HUMAN_PERSONA_META[resolvedPersona].motion;

  // Clean, non-conflicting frame border so the actual facial expression remains the visual focus
  const ringClass = isReliefActive
    ? 'ring-2 ring-[#6EE7B7]/85 shadow-[0_0_12px_rgba(110,231,183,0.45)]'
    : expression === 'donkey'
      ? 'ring-2 ring-[#F5C954] shadow-[0_8px_20px_rgba(0,0,0,0.45)]'
      : activeTurn
        ? 'ring-2 ring-[#F5C954] shadow-[0_0_14px_rgba(245,201,84,0.62)]'
        : effectivePenaltyExpr && expressionIntensity >= 2
          ? 'ring-2 ring-[#F87171]/60 shadow-xs'
          : 'ring-2 ring-white/25 shadow-xs';

  const motionAnimClass = !animated
    ? ''
    : isReliefActive
      ? RELIEF_MOTION_CLASS[reliefMotionStyle]
      : effectivePenaltyExpr === 'shocked' ||
          (effectivePenaltyExpr === 'annoyed' && expressionIntensity >= 2)
        ? 'avatar-shock-bounce'
        : effectivePenaltyExpr === 'crying' && expressionIntensity >= 2
          ? 'avatar-dizzy-wobble'
          : '';

  const renderHumanFace =
    !botProfile && (showHumanFace || expression !== 'normal' || isReliefActive);

  if (renderHumanFace) {
    artworkMode = 'human-face';
  }

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${motionAnimClass} ${className}`}
      data-avatar-id={botProfile?.id}
      data-bot-avatar-id={botProfile?.id}
      data-avatar-expression={isReliefActive ? `relief-${reliefFrame}` : expression}
      data-penalty-expression={isReliefActive ? 'none' : effectivePenaltyExpr ?? 'none'}
      data-relief-frame={isReliefActive ? reliefFrame : 'idle'}
      data-expression-intensity={expressionIntensity}
      data-fail-streak={failStreak}
      data-expression-artwork={artworkMode}
    >
      {/* Playful Cartoon Donkey Ears Overlay (Results Screen Donkey badge) */}
      {expression === 'donkey' && (
        <svg
          viewBox="0 0 120 56"
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-20 drop-shadow-[0_4px_6px_rgba(0,0,0,0.35)] ${dims.earW}`}
        >
          <path
            d="M36 52 C22 36 12 16 18 5 C24 -2 38 10 47 36 Z"
            fill="#8D6E63"
            stroke="#261E18"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path d="M35 44 C26 32 20 19 23 11 C27 8 36 18 42 35 Z" fill="#F2C6B6" />
          <path
            d="M84 52 C98 36 110 18 104 7 C98 -1 84 11 73 36 Z"
            fill="#8D6E63"
            stroke="#261E18"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path d="M85 44 C94 32 101 20 98 12 C94 9 85 18 78 35 Z" fill="#F2C6B6" />
        </svg>
      )}

      {/* Main Circular Avatar Frame (Fixed dimensions — only face artwork animates inside) */}
      <div
        className={`relative ${dims.box} rounded-full overflow-hidden flex items-center justify-center transition-shadow ${ringClass} ${
          disconnected ? 'grayscale opacity-75' : ''
        }`}
        style={{
          backgroundColor: botProfile ? botProfile.bgColor : avatarColor,
        }}
        title={botProfile ? `${botProfile.name} — ${botProfile.personality}` : name}
      >
        {botProfile ? (
          <>
            <img
              src={portraitSrc}
              alt={
                isReliefActive
                  ? `${botProfile.name} sigh of relief (${reliefFrame})`
                  : `${botProfile.name} (${expression})`
              }
              referrerPolicy="no-referrer"
              draggable={false}
              className="pointer-events-none absolute max-w-none w-[204%] h-[204%]"
              style={{
                left: portraitCol === 0 ? '-1%' : '-103%',
                top: portraitRow === 0 ? '-1%' : '-103%',
                ...(portraitMoodFilter ? { filter: portraitMoodFilter } : {}),
              }}
            />
            {useCharacterPenaltyOverlay && effectivePenaltyExpr && (
              <CharacterPenaltyFaceOverlay
                characterId={botProfile.id}
                expression={effectivePenaltyExpr}
                intensity={useIntenseSheet ? (Math.max(2, expressionIntensity) as ExpressionIntensity) : expressionIntensity}
              />
            )}
          </>
        ) : renderHumanFace ? (
          <HumanExpressionFace
            expression={expression}
            intensity={expressionIntensity}
            reliefFrame={isReliefActive ? reliefFrame : 'idle'}
            persona={resolvedPersona}
          />
        ) : (
          <span
            className={`font-display font-bold text-[#261E18] leading-none ${dims.text}`}
            aria-hidden="true"
          >
            {name.trim().slice(0, 1).toUpperCase() || 'P'}
          </span>
        )}
      </div>

      {/* Happy Sparkle Accent */}
      {expression === 'happy' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-1.5 -right-1.5 z-30 w-4 h-4 rounded-full bg-[#F5C954] text-[#1A1205] text-[10px] font-black flex items-center justify-center shadow-sm"
        >
          ★
        </span>
      )}

      {/* Consecutive Failed-Trick Streak Pill (hidden during relief or active +N delta) */}
      {!isReliefActive &&
        failStreak >= 2 &&
        !(penaltyDelta !== null && penaltyDelta > 0) &&
        expression !== 'donkey' && (
          <span
            aria-label={`Consecutive penalty streak ${failStreak}`}
            data-testid="fail-streak-badge"
            className={`pointer-events-none absolute z-30 rounded-full font-mono font-black leading-none shadow-md border tabular-nums ${
              failStreak >= 3
                ? 'bg-[#B91C1C] border-[#FECACA] text-white'
                : 'bg-[#EA580C] border-[#FED7AA] text-white'
            } ${dims.streak}`}
          >
            ×{failStreak}
          </span>
        )}

      {/* Preserved Stage 4 Floating "+N Cards" Penalty Badge */}
      {!isReliefActive && penaltyDelta !== null && penaltyDelta > 0 && (
        <motion.div
          role="status"
          aria-live="polite"
          data-testid="penalty-cards-delta"
          initial={animated ? { opacity: 0, y: 8, scale: 0.72 } : false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={animated ? { opacity: 0, y: -8, scale: 0.9 } : undefined}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className={`pointer-events-none absolute -bottom-2.5 left-1/2 -translate-x-1/2 z-30 whitespace-nowrap rounded-full bg-[#DC2626] border border-[#FECACA] text-white font-mono font-extrabold shadow-[0_4px_12px_rgba(220,38,38,0.55)] tabular-nums ${dims.badge}`}
        >
          +{penaltyDelta} {penaltyDelta === 1 ? 'Card' : 'Cards'}
        </motion.div>
      )}
    </div>
  );
};
