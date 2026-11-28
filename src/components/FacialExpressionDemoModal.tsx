import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Flame, Play, RotateCcw, Sparkles, X } from 'lucide-react';
import { PlayerAvatar } from './BotAvatar';
import {
  computePenaltyExpression,
  derivePlayerExpressionStates,
  HUMAN_PERSONA_META,
  type HumanAvatarPersona,
} from '../lib/facialExpressions';
import {
  RELIEF_ANIMATION_TIMING_MS,
  type ReliefAnimationFrame,
} from '../lib/gameAnimations';
import type { Card, FailedTrickOutcome, SuccessfulTrickOutcome, TrickOutcome } from '../engine/types';

export type ExpressionDemoTab = 'relief' | 'failed';

interface FacialExpressionDemoModalProps {
  open: boolean;
  initialTab?: ExpressionDemoTab;
  onClose: () => void;
}

const DEMO_BOT_ID = 'demo-babloo';
const DEMO_HUMAN_ID = 'demo-human';
const DEMO_PLAYER_IDS = [DEMO_BOT_ID, DEMO_HUMAN_ID] as const;

function makeSimCards(count: number, trickNumber: number): Card[] {
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
  return Array.from({ length: count }, (_, idx) => ({
    id: `demo-t${trickNumber}-c${idx}`,
    suit: suits[idx % 4],
    rank: ((idx % 13) + 2) as Card['rank'],
  }));
}

function makeSimFailedTrick(
  trickNumber: number,
  collectorId: string,
  penaltyCardsCount: number
): FailedTrickOutcome {
  const cards = makeSimCards(penaltyCardsCount, trickNumber);
  const plays = cards.map((card, i) => ({
    playerId: i === 0 ? collectorId : DEMO_HUMAN_ID,
    card,
    order: i,
  }));
  return {
    type: 'failed',
    trickNumber,
    ledSuit: 'spades',
    plays,
    offSuitPlay: plays[plays.length - 1],
    collectorId,
    collectedCards: cards,
    nextLeaderId: collectorId,
    newlyFinishedIds: [],
  };
}

function makeSimCleanTrick(trickNumber: number): SuccessfulTrickOutcome {
  const cards = makeSimCards(2, trickNumber);
  const plays = [
    { playerId: DEMO_BOT_ID, card: cards[0], order: 0 },
    { playerId: DEMO_HUMAN_ID, card: cards[1], order: 1 },
  ];
  return {
    type: 'success',
    trickNumber,
    ledSuit: 'hearts',
    plays,
    highestPlay: plays[0],
    nextLeaderId: DEMO_BOT_ID,
    newlyFinishedIds: [],
    removedCards: cards,
  };
}

const BASE_LEVEL_SPECS = [
  { key: 'normal', cards: 0, streak: 0, title: 'Normal (0)', subtitle: 'Calm baseline' },
  { key: 'annoyed', cards: 1, streak: 1, title: '1 Penalty Card', subtitle: 'Slightly Annoyed' },
  { key: 'shocked', cards: 2, streak: 1, title: '2 Penalty Cards', subtitle: 'Shocked' },
  { key: 'sad', cards: 3, streak: 1, title: '3 Penalty Cards', subtitle: 'Sad / Disappointed' },
  { key: 'crying', cards: 4, streak: 1, title: '4+ Penalty Cards', subtitle: 'Crying / Devastated' },
] as const;

const INTENSE_STREAK_SPECS = [
  { key: 's2-1', cards: 1, streak: 2, title: '1 Card · Streak ×2', subtitle: 'Fuming Annoyed (Lv 2)' },
  { key: 's2-2', cards: 2, streak: 2, title: '2 Cards · Streak ×2', subtitle: 'Hyper-Shocked (Lv 2)' },
  { key: 's2-3', cards: 3, streak: 2, title: '3 Cards · Streak ×2', subtitle: 'Heartbroken (Lv 2)' },
  { key: 's3-4', cards: 4, streak: 3, title: '4+ Cards · Streak ×3', subtitle: 'Total Meltdown (Lv 3)' },
] as const;

const RELIEF_DEMO_BOTS = [
  {
    id: 'babloo-uncle',
    name: 'Babloo Uncle',
    bgColor: '#E7B429',
    role: 'Overreacts to everything',
    reaction: 'Dramatic "Phew!" puffed-cheek exhale & beaming relief',
  },
  {
    id: 'surili',
    name: 'Surili',
    bgColor: '#D93B6B',
    role: 'Dramatic singer',
    reaction: 'Graceful operatic flutter-closed eyes & serene diva sigh',
  },
  {
    id: 'rocky-raja',
    name: 'Rocky Raja',
    bgColor: '#186382',
    role: 'Overconfident superstar',
    reaction: 'Dips aviators for a cool suave whistle exhale & smirk',
  },
  {
    id: 'chotu-chaiwala',
    name: 'Chotu Chaiwala',
    bgColor: '#D9A024',
    role: 'Stylish and witty',
    reaction: 'Tilts shades for a cheeky whistle sigh into his chai steam',
  },
  {
    id: 'gappu',
    name: 'Gappu',
    bgColor: '#F4A333',
    role: 'Food-loving character',
    reaction: 'Rosy puffed-cheek foodie exhale & huge delighted grin',
  },
  {
    id: 'pappu-viral',
    name: 'Pappu Viral',
    bgColor: '#36B8C9',
    role: 'Funny and unpredictable',
    reaction: 'Lopsided-brow goofy sideways whistle sigh & cheeky grin',
  },
  {
    id: 'selfie-sona',
    name: 'Selfie Sona',
    bgColor: '#F5937A',
    role: 'Loves attention',
    reaction: 'Dips pink shades with fluttering lashes & camera-ready smile',
  },
  {
    id: 'wifi-baba',
    name: 'WiFi Baba',
    bgColor: '#9872DA',
    role: 'Wise but quirky',
    reaction: 'Peaceful closed-eye meditative zen exhale & warm twinkle',
  },
  {
    id: 'kallu-kaka',
    name: 'Kallu Kaka',
    bgColor: '#48B173',
    role: 'Friendly and cheerful',
    reaction: 'Hearty rosy-cheeked uncle sigh & warm grandfatherly grin',
  },
  {
    id: 'mishra-ji',
    name: 'Mishra Ji',
    bgColor: '#E3B474',
    role: 'Knows everything',
    reaction: 'Dignified half-closed "I knew it" exhale & smug smile',
  },
  {
    id: 'dhamaka-don',
    name: 'Dhamaka Don',
    bgColor: '#8A2347',
    role: 'Overconfident entertainer',
    reaction: 'Lowers purple shades for a flashy showman whistle exhale',
  },
  {
    id: 'hasmukh-didi',
    name: 'Hasmukh Didi',
    bgColor: '#EE9A11',
    role: 'Laughs at everything',
    reaction: 'Bubbly crescent-eyed giggly sigh & infectious warm laugh',
  },
] as const;

const RELIEF_FRAME_STEPS: readonly {
  frame: ReliefAnimationFrame;
  label: string;
  timing: string;
}[] = [
  { frame: 'idle', label: 'Normal', timing: 'Baseline' },
  { frame: 'hold', label: '1. Inhale', timing: '0–240ms' },
  { frame: 'exhale', label: '2. Peak Sigh', timing: '240–840ms' },
  { frame: 'smile', label: '3. Warm Smile', timing: '840–1360ms' },
  { frame: 'settle', label: '4. Settle', timing: '1360–1680ms' },
];

export const FacialExpressionDemoModal: React.FC<FacialExpressionDemoModalProps> = ({
  open,
  initialTab = 'relief',
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<ExpressionDemoTab>(initialTab);

  // Sigh of Relief interactive state
  const [reliefFrame, setReliefFrame] = useState<ReliefAnimationFrame>('idle');
  const [reliefPlaying, setReliefPlaying] = useState(false);
  const [reliefPlayCount, setReliefPlayCount] = useState(0);
  const [humanPersona, setHumanPersona] = useState<HumanAvatarPersona>('dramatic');
  const reliefTimersRef = useRef<number[]>([]);

  // Failed-Trick interactive state
  const [trickHistory, setTrickHistory] = useState<TrickOutcome[]>([]);
  const [target, setTarget] = useState<'bot' | 'human' | 'both'>('both');
  const [selectedPenaltyBotId, setSelectedPenaltyBotId] = useState<string>('babloo-uncle');
  const [selectedHumanAvatarId, setSelectedHumanAvatarId] = useState<string>('surili');

  const clearReliefTimers = () => {
    for (const id of reliefTimersRef.current) {
      window.clearTimeout(id);
    }
    reliefTimersRef.current = [];
  };

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => () => clearReliefTimers(), []);

  const triggerSimultaneousRelief = () => {
    clearReliefTimers();
    setReliefPlaying(true);
    setReliefPlayCount((c) => c + 1);
    setReliefFrame('hold');

    const t1 = window.setTimeout(() => {
      setReliefFrame('exhale');
    }, RELIEF_ANIMATION_TIMING_MS.frame1ExhaleMs);

    const t2 = window.setTimeout(() => {
      setReliefFrame('smile');
    }, RELIEF_ANIMATION_TIMING_MS.frame2SmileMs);

    const t3 = window.setTimeout(() => {
      setReliefFrame('settle');
    }, RELIEF_ANIMATION_TIMING_MS.frame3SettleMs);

    const t4 = window.setTimeout(() => {
      setReliefFrame('idle');
      setReliefPlaying(false);
      reliefTimersRef.current = [];
    }, RELIEF_ANIMATION_TIMING_MS.totalDurationMs);

    reliefTimersRef.current = [t1, t2, t3, t4];
  };

  const inspectReliefFrame = (frame: ReliefAnimationFrame) => {
    clearReliefTimers();
    setReliefPlaying(false);
    setReliefFrame(frame);
  };

  const states = useMemo(
    () =>
      derivePlayerExpressionStates({
        playerIds: DEMO_PLAYER_IDS,
        trickHistory,
      }),
    [trickHistory]
  );

  const botState = states[DEMO_BOT_ID];
  const humanState =
    target === 'both' ? states[DEMO_BOT_ID] : states[DEMO_HUMAN_ID];

  if (!open) return null;

  const setSinglePenaltyLevel = (cards: number) => {
    if (cards <= 0) {
      setTrickHistory([]);
      return;
    }
    const collectorId = target === 'human' ? DEMO_HUMAN_ID : DEMO_BOT_ID;
    setTrickHistory([makeSimFailedTrick(1, collectorId, cards)]);
  };

  const appendConsecutiveFail = (cards: number) => {
    const collectorId = target === 'human' ? DEMO_HUMAN_ID : DEMO_BOT_ID;
    setTrickHistory((prev) => [
      ...prev,
      makeSimFailedTrick(prev.length + 1, collectorId, cards),
    ]);
  };

  const appendCleanTrick = () => {
    setTrickHistory((prev) => [...prev, makeSimCleanTrick(prev.length + 1)]);
  };

  const selectedPenaltyBot =
    RELIEF_DEMO_BOTS.find((b) => b.id === selectedPenaltyBotId) ?? RELIEF_DEMO_BOTS[0];
  const selectedHumanAvatar =
    RELIEF_DEMO_BOTS.find((b) => b.id === selectedHumanAvatarId) ?? RELIEF_DEMO_BOTS[1];

  const currentFrameMeta =
    RELIEF_FRAME_STEPS.find((s) => s.frame === reliefFrame) ?? RELIEF_FRAME_STEPS[0];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-2.5 sm:p-5 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expr-demo-title"
      data-testid="expression-demo-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl max-h-[94dvh] overflow-y-auto rounded-3xl bg-[#FAF5ED] text-[#261E18] shadow-2xl border border-[#DDD1BE]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="sticky top-0 z-20 px-4 sm:px-6 py-3.5 bg-[#FAF5ED] border-b border-[#E5DAC8] space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="expr-demo-title"
                className="font-display text-lg sm:text-xl font-bold text-[#261E18] leading-tight"
              >
                {activeTab === 'relief'
                  ? 'Sigh of Relief Preview · All 12 Bots & Human Avatars'
                  : 'Failed-Trick Expressions · All 12 Character Avatars'}
              </h2>
              <p className="text-xs text-[#6E6052] mt-0.5">
                {activeTab === 'relief'
                  ? 'Personalised 4-frame facial relief animations (1.68s) played simultaneously on all active players when a trick succeeds'
                  : 'Real face changes (eyes, eyebrows, mouth & tears) driven by penalty cards + consecutive failed-trick streaks'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close expression demo"
              className="w-9 h-9 rounded-full bg-[#EFE6D8] hover:bg-[#E4D7C3] text-[#261E18] flex items-center justify-center shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Clean Segmented Mode Switcher */}
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#EFE6D8] border border-[#DFD3C1]">
            <button
              type="button"
              data-testid="tab-relief-demo"
              onClick={() => setActiveTab('relief')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'relief'
                  ? 'bg-[#261E18] text-[#FAF5ED] shadow-xs'
                  : 'text-[#5C4E41] hover:text-[#261E18]'
              }`}
            >
              Sigh of Relief (Successful Trick)
            </button>
            <button
              type="button"
              data-testid="tab-failed-demo"
              onClick={() => setActiveTab('failed')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'failed'
                  ? 'bg-[#261E18] text-[#FAF5ED] shadow-xs'
                  : 'text-[#5C4E41] hover:text-[#261E18]'
              }`}
            >
              Failed-Trick Penalty Expressions
            </button>
          </div>
        </div>

        {/* ================================================================ */}
        {/* TAB 1: SIGH OF RELIEF DEMONSTRATION                              */}
        {/* ================================================================ */}
        {activeTab === 'relief' && (
          <div className="p-4 sm:p-6 space-y-6">
            {/* Live Simultaneous Card-Table Stage */}
            <section
              data-testid="relief-live-stage"
              className="rounded-3xl felt-surface p-4 sm:p-5 text-white shadow-inner border border-[#3C7B50]/45 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#D6E8DC]">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-[#6EE7B7] shrink-0" />
                  <span>Live Successful-Trick Table Preview</span>
                  <span aria-hidden="true" className="text-white/40">·</span>
                  <span
                    data-testid="relief-stage-status"
                    className="font-mono font-bold text-[#F5C954] tabular-nums"
                  >
                    {currentFrameMeta.label} ({currentFrameMeta.timing})
                  </span>
                </div>
                <span className="text-[11px] text-[#C7DFCE] tabular-nums">
                  Duration: 1.68s · Active players animate simultaneously
                </span>
              </div>

              {/* All 12 Active Bots + 1 Active Human + 1 Finished Safe Seat (Does NOT Animate) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                {RELIEF_DEMO_BOTS.map((bot) => (
                  <div
                    key={bot.id}
                    data-testid={`relief-seat-${bot.id}`}
                    data-relief-seat={bot.id}
                    data-relief-frame={reliefFrame}
                    className={`rounded-2xl p-2.5 flex flex-col items-center text-center border transition-colors ${
                      reliefFrame !== 'idle'
                        ? 'bg-[#19532F]/95 border-[#6EE7B7]/65'
                        : 'bg-[#143D22]/90 border-white/14'
                    }`}
                  >
                    <PlayerAvatar
                      key={`${bot.id}-${reliefPlaying ? reliefPlayCount : 'inspect'}`}
                      name={bot.name}
                      type="bot"
                      avatarColor={bot.bgColor}
                      botAvatarId={bot.id}
                      size="lg"
                      expression="normal"
                      reliefFrame={reliefFrame}
                      animated={reliefPlaying}
                    />
                    <div className="mt-1.5 font-display font-bold text-xs text-white leading-tight">
                      {bot.name}
                    </div>
                    <div className="mt-0.5 text-[10px] text-[#C7DFCE] leading-snug line-clamp-1">
                      {bot.role}
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-[#6EE7B7]">
                      Active
                    </div>
                  </div>
                ))}

                {/* Human Player Seat (Personalised by Selected Avatar Persona) */}
                <div
                  data-testid="relief-seat-human"
                  data-relief-seat="human"
                  data-relief-frame={reliefFrame}
                  className={`rounded-2xl p-2.5 flex flex-col items-center text-center border transition-colors ${
                    reliefFrame !== 'idle'
                      ? 'bg-[#19532F]/95 border-[#6EE7B7]/65'
                      : 'bg-[#143D22]/90 border-white/14'
                  }`}
                >
                  <PlayerAvatar
                    key={`human-${humanPersona}-${reliefPlaying ? reliefPlayCount : 'inspect'}`}
                    name="Aarav"
                    type="human"
                    avatarColor={HUMAN_PERSONA_META[humanPersona].swatch}
                    humanPersona={humanPersona}
                    size="lg"
                    expression="normal"
                    reliefFrame={reliefFrame}
                    showHumanFace
                    animated={reliefPlaying}
                  />
                  <div className="mt-1.5 font-display font-bold text-xs text-white leading-tight">
                    Aarav (You)
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#FDE68A] leading-snug line-clamp-1">
                    {HUMAN_PERSONA_META[humanPersona].label}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold text-[#6EE7B7]">
                    Active
                  </div>
                </div>

                {/* Finished Player Seat — Explicitly Does NOT Animate */}
                <div
                  data-testid="relief-seat-finished"
                  data-relief-seat="finished"
                  data-relief-frame="idle"
                  className="rounded-2xl p-2.5 flex flex-col items-center text-center border bg-[#10301C]/70 border-white/10 opacity-85"
                >
                  <PlayerAvatar
                    name="Babloo Uncle"
                    type="bot"
                    avatarColor="#E7B429"
                    botAvatarId="babloo-uncle"
                    size="lg"
                    expression="happy"
                    reliefFrame="idle"
                    animated={false}
                  />
                  <div className="mt-1.5 font-display font-bold text-xs text-white leading-tight">
                    Finished Safe
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#86EFAC] leading-snug line-clamp-1">
                    Out #1 · Safe
                  </div>
                  <div className="mt-1 text-[10px] font-semibold text-[#C7DFCE]/80">
                    Never animates
                  </div>
                </div>
              </div>

              {/* Action Controls */}
              <div className="pt-3 border-t border-white/12 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="trigger-relief-btn"
                    onClick={triggerSimultaneousRelief}
                    className="min-h-[42px] px-5 py-2 rounded-full btn-orange-3d font-display font-bold text-sm inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Trigger Successful Trick (1.68s)
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {RELIEF_FRAME_STEPS.map((step) => (
                      <button
                        key={step.frame}
                        type="button"
                        data-testid={`inspect-relief-${step.frame}`}
                        onClick={() => inspectReliefFrame(step.frame)}
                        className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                          reliefFrame === step.frame
                            ? 'bg-[#F5C954] text-[#1A1205]'
                            : 'bg-black/25 text-[#E5F2E9] hover:bg-black/40 border border-white/12'
                        }`}
                      >
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Human Avatar Persona Switcher */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold text-[#C7DFCE]">
                    Human avatar:
                  </span>
                  {(Object.keys(HUMAN_PERSONA_META) as HumanAvatarPersona[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      data-testid={`persona-btn-${p}`}
                      onClick={() => setHumanPersona(p)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                        humanPersona === p
                          ? 'bg-[#FAF5ED] text-[#261E18]'
                          : 'bg-black/25 text-[#D6E8DC] hover:text-white border border-white/10'
                      }`}
                    >
                      {HUMAN_PERSONA_META[p].label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Full 4-Frame Visual Filmstrip for All 3 Contrasting Characters + Human */}
            <section data-testid="relief-filmstrip" className="space-y-4">
              <div>
                <h3 className="font-display text-base font-bold text-[#261E18]">
                  Frame-by-Frame Facial Animation Comparison (Normal → Hold → Peak Sigh → Smile → Settle)
                </h3>
                <p className="text-xs text-[#6E6052] mt-0.5">
                  Each character animates actual eyes, eyelids, eyebrows, cheeks, and mouth according to their personality
                </p>
              </div>

              <div className="space-y-3">
                {RELIEF_DEMO_BOTS.map((bot) => (
                  <div
                    key={bot.id}
                    data-testid={`filmstrip-row-${bot.id}`}
                    className="rounded-2xl bg-[#F4ECE0] border border-[#DFD3C1] p-3.5"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2.5">
                      <div className="flex items-baseline gap-2">
                        <span className="font-display font-bold text-sm text-[#261E18]">
                          {bot.name}
                        </span>
                        <span className="text-xs text-[#6E6052]">· {bot.role}</span>
                      </div>
                      <span className="text-xs font-medium text-[#365B40]">
                        {bot.reaction}
                      </span>
                    </div>

                    <div className="grid grid-cols-5 gap-2">
                      {RELIEF_FRAME_STEPS.map((step) => (
                        <button
                          key={step.frame}
                          type="button"
                          onClick={() => inspectReliefFrame(step.frame)}
                          className="rounded-xl bg-[#FAF5ED] hover:bg-white border border-[#E5DAC8] p-2 flex flex-col items-center text-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <PlayerAvatar
                            name={bot.name}
                            type="bot"
                            avatarColor={bot.bgColor}
                            botAvatarId={bot.id}
                            size="lg"
                            expression="normal"
                            reliefFrame={step.frame}
                            animated={false}
                          />
                          <div>
                            <div className="text-[11px] font-bold text-[#261E18] leading-tight">
                              {step.label}
                            </div>
                            <div className="text-[10px] text-[#7A6B5C] tabular-nums">
                              {step.timing}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Human Player Persona Filmstrip */}
                <div
                  data-testid="filmstrip-row-human"
                  className="rounded-2xl bg-[#F4ECE0] border border-[#DFD3C1] p-3.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display font-bold text-sm text-[#261E18]">
                        Human Player ({HUMAN_PERSONA_META[humanPersona].label})
                      </span>
                      <span className="text-xs text-[#6E6052]">· Personalised by avatar</span>
                    </div>
                    <span className="text-xs font-medium text-[#365B40]">
                      {HUMAN_PERSONA_META[humanPersona].reliefSummary}
                    </span>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    {RELIEF_FRAME_STEPS.map((step) => (
                      <button
                        key={step.frame}
                        type="button"
                        onClick={() => inspectReliefFrame(step.frame)}
                        className="rounded-xl bg-[#FAF5ED] hover:bg-white border border-[#E5DAC8] p-2 flex flex-col items-center text-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <PlayerAvatar
                          name="Aarav"
                          type="human"
                          avatarColor={HUMAN_PERSONA_META[humanPersona].swatch}
                          humanPersona={humanPersona}
                          size="lg"
                          expression="normal"
                          reliefFrame={step.frame}
                          showHumanFace
                          animated={false}
                        />
                        <div>
                          <div className="text-[11px] font-bold text-[#261E18] leading-tight">
                            {step.label}
                          </div>
                          <div className="text-[10px] text-[#7A6B5C] tabular-nums">
                            {step.timing}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 2: FAILED-TRICK PENALTY EXPRESSIONS (Preserved)              */}
        {/* ================================================================ */}
        {activeTab === 'failed' && (
          <div className="p-4 sm:p-6 space-y-5">
            <section className="rounded-3xl felt-surface p-4 sm:p-5 text-white shadow-inner border border-[#3C7B50]/45">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#D6E8DC]">
                  <Sparkles className="w-3.5 h-3.5 text-[#F5C954]" />
                  <span>Interactive Live Simulator</span>
                  <span className="text-white/40">·</span>
                  <span className="font-mono tabular-nums text-[#F5C954]">
                    Tricks logged: {trickHistory.length}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex rounded-xl bg-black/25 p-0.5 border border-white/10 text-[11px] font-semibold">
                    {(['both', 'bot', 'human'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setTarget(mode)}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          target === mode
                            ? 'bg-[#F5C954] text-[#1D1508] font-bold'
                            : 'text-[#D6E8DC] hover:text-white'
                        }`}
                      >
                        {mode === 'both' ? 'Both' : mode === 'bot' ? 'Bot Only' : 'Human Only'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Character Selector for All 12 Approved Avatars */}
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-[#C7DFCE] mr-1">
                  Bot avatar:
                </span>
                {RELIEF_DEMO_BOTS.map((char) => (
                  <button
                    key={char.id}
                    type="button"
                    data-testid={`penalty-char-btn-${char.id}`}
                    onClick={() => setSelectedPenaltyBotId(char.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                      selectedPenaltyBot.id === char.id
                        ? 'bg-[#F5C954] text-[#1D1508]'
                        : 'bg-black/25 text-[#D6E8DC] hover:text-white border border-white/10'
                    }`}
                  >
                    {char.name}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div
                  data-testid="demo-live-babloo"
                  className="rounded-2xl bg-[#143D22]/90 border border-white/15 p-4 flex items-center gap-4"
                >
                  <PlayerAvatar
                    name={selectedPenaltyBot.name}
                    type="bot"
                    avatarColor={selectedPenaltyBot.bgColor}
                    avatarId={selectedPenaltyBot.id}
                    botAvatarId={selectedPenaltyBot.id}
                    playerId={DEMO_BOT_ID}
                    size="2xl"
                    expression={botState.expression}
                    expressionIntensity={botState.intensity}
                    failStreak={botState.consecutiveFailStreak}
                    animated
                  />
                  <div className="min-w-0 space-y-1.5">
                    <div className="text-[11px] font-bold text-[#F5C954]">
                      Bot · Penalty Demo
                    </div>
                    <div className="font-display text-xl font-bold text-white leading-tight">
                      {selectedPenaltyBot.name}
                    </div>
                    <div
                      data-testid="demo-babloo-label"
                      className="text-xs font-bold text-[#FEF3C7]"
                    >
                      {botState.label}
                    </div>
                    <div className="text-xs text-[#C7DFCE] tabular-nums space-y-0.5 pt-0.5">
                      <div>
                        Last penalty:{' '}
                        <strong className="text-white">
                          {botState.lastPenaltyCards}{' '}
                          {botState.lastPenaltyCards === 1 ? 'card' : 'cards'}
                        </strong>
                      </div>
                      <div className="flex items-center gap-1">
                        <Flame className="w-3.5 h-3.5 text-[#FB923C]" />
                        <span>
                          Consecutive fails:{' '}
                          <strong className="text-[#FDE68A]">
                            ×{botState.consecutiveFailStreak}
                          </strong>{' '}
                          (Intensity Lv {botState.intensity})
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  data-testid="demo-live-human"
                  className="rounded-2xl bg-[#143D22]/90 border border-white/15 p-4 flex items-center gap-4"
                >
                  <PlayerAvatar
                    name="Aarav"
                    type="human"
                    avatarColor={selectedHumanAvatar.bgColor}
                    avatarId={selectedHumanAvatar.id}
                    playerId={DEMO_HUMAN_ID}
                    size="2xl"
                    expression={humanState.expression}
                    expressionIntensity={humanState.intensity}
                    failStreak={humanState.consecutiveFailStreak}
                    showHumanFace
                    animated
                  />
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold text-[#86EFAC]">
                        Human Player
                      </span>
                      <select
                        aria-label="Select human demo character"
                        data-testid="penalty-human-char-select"
                        value={selectedHumanAvatar.id}
                        onChange={(e) => setSelectedHumanAvatarId(e.target.value)}
                        className="rounded-lg bg-black/30 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white cursor-pointer"
                      >
                        {RELIEF_DEMO_BOTS.map((char) => (
                          <option key={char.id} value={char.id} className="text-[#261E18]">
                            {char.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="font-display text-xl font-bold text-white leading-tight">
                      Aarav (You)
                    </div>
                    <div
                      data-testid="demo-human-label"
                      className="text-xs font-bold text-[#FEF3C7]"
                    >
                      {humanState.label}
                    </div>
                    <div className="text-xs text-[#C7DFCE] tabular-nums space-y-0.5 pt-0.5">
                      <div>
                        Last penalty:{' '}
                        <strong className="text-white">
                          {humanState.lastPenaltyCards}{' '}
                          {humanState.lastPenaltyCards === 1 ? 'card' : 'cards'}
                        </strong>
                      </div>
                      <div className="flex items-center gap-1">
                        <Flame className="w-3.5 h-3.5 text-[#FB923C]" />
                        <span>
                          Consecutive fails:{' '}
                          <strong className="text-[#FDE68A]">
                            ×{humanState.consecutiveFailStreak}
                          </strong>{' '}
                          (Intensity Lv {humanState.intensity})
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-white/12 space-y-3">
                <div>
                  <div className="text-xs font-bold text-[#C7DFCE] mb-1.5">
                    1. Inspect Single Penalty Level (Streak ×1)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { cards: 0, label: 'Calm (0)' },
                      { cards: 1, label: '1 Card · Annoyed' },
                      { cards: 2, label: '2 Cards · Shocked' },
                      { cards: 3, label: '3 Cards · Sad' },
                      { cards: 4, label: '4+ Cards · Crying' },
                    ].map((btn) => (
                      <button
                        key={btn.cards}
                        type="button"
                        data-testid={`demo-set-cards-${btn.cards}`}
                        onClick={() => setSinglePenaltyLevel(btn.cards)}
                        className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#FAF5ED] hover:bg-white text-[#261E18] text-xs font-bold shadow-xs transition-colors cursor-pointer"
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold text-[#FDE68A] mb-1.5">
                    2. Stack Consecutive Failed Tricks (Escalates Intensity ×1 → ×2 → ×3)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4].map((cards) => (
                      <button
                        key={cards}
                        type="button"
                        data-testid={`demo-stack-fail-${cards}`}
                        onClick={() => appendConsecutiveFail(cards)}
                        className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#D95732] hover:bg-[#E56640] text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                      >
                        +1 Fail ({cards === 4 ? '4+' : cards}{' '}
                        {cards === 1 ? 'Card' : 'Cards'})
                      </button>
                    ))}
                    <button
                      type="button"
                      data-testid="demo-clean-trick"
                      onClick={appendCleanTrick}
                      className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#276749] hover:bg-[#2F7A57] border border-[#86EFAC]/45 text-[#ECFDF5] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Clean Trick (Reset Streak)
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section data-testid="demo-strip-base">
              <h3 className="font-display text-base font-bold text-[#261E18] mb-2.5">
                {selectedPenaltyBot.name} · All 4 Penalty Levels (Base · Streak ×1)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {BASE_LEVEL_SPECS.map((spec) => {
                  const st = computePenaltyExpression(spec.cards, spec.streak);
                  return (
                    <button
                      key={spec.key}
                      type="button"
                      onClick={() => setSinglePenaltyLevel(spec.cards)}
                      className="rounded-2xl bg-[#F4ECE0] hover:bg-[#EFE4D3] border border-[#DFD3C1] p-3 flex flex-col items-center text-center gap-2 transition-colors cursor-pointer"
                    >
                      <PlayerAvatar
                        name={selectedPenaltyBot.name}
                        type="bot"
                        avatarColor={selectedPenaltyBot.bgColor}
                        avatarId={selectedPenaltyBot.id}
                        botAvatarId={selectedPenaltyBot.id}
                        size="xl"
                        expression={st.expression}
                        expressionIntensity={st.intensity}
                        failStreak={st.consecutiveFailStreak}
                        animated={false}
                      />
                      <div>
                        <div className="text-xs font-bold text-[#261E18]">{spec.title}</div>
                        <div className="text-[11px] font-medium text-[#6E6052]">
                          {spec.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section data-testid="demo-strip-intense">
              <h3 className="font-display text-base font-bold text-[#261E18] mb-2.5">
                {selectedPenaltyBot.name} · Increasing Consecutive-Failure Intensity (Streak ×2 → ×3)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {INTENSE_STREAK_SPECS.map((spec) => {
                  const st = computePenaltyExpression(spec.cards, spec.streak);
                  return (
                    <button
                      key={spec.key}
                      type="button"
                      onClick={() => {
                        const nextHistory: TrickOutcome[] = [];
                        for (let i = 1; i <= spec.streak; i++) {
                          nextHistory.push(makeSimFailedTrick(i, DEMO_BOT_ID, spec.cards));
                        }
                        setTrickHistory(nextHistory);
                      }}
                      className="rounded-2xl bg-[#FCEFE8] hover:bg-[#F9E4D8] border border-[#E7C2B0] p-3 flex flex-col items-center text-center gap-2 transition-colors cursor-pointer"
                    >
                      <PlayerAvatar
                        name={selectedPenaltyBot.name}
                        type="bot"
                        avatarColor={selectedPenaltyBot.bgColor}
                        avatarId={selectedPenaltyBot.id}
                        botAvatarId={selectedPenaltyBot.id}
                        size="xl"
                        expression={st.expression}
                        expressionIntensity={st.intensity}
                        failStreak={st.consecutiveFailStreak}
                        animated={false}
                      />
                      <div>
                        <div className="text-xs font-bold text-[#7C2D12]">{spec.title}</div>
                        <div className="text-[11px] font-semibold text-[#9A3412]">
                          {st.label}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
