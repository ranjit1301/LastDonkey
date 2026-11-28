import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  HelpCircle,
  Lock,
  Plus,
  RefreshCw,
  Settings,
  Smile,
  User,
  Users,
} from 'lucide-react';
import { AvatarPicker } from '../components/AvatarPicker';
import { PlayerAvatar } from '../components/BotAvatar';
import {
  FacialExpressionDemoModal,
  type ExpressionDemoTab,
} from '../components/FacialExpressionDemoModal';
import { PlayingCard } from '../components/PlayingCard';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { DIFFICULTY_META, makeCard } from '../engine';
import { getBotAvatarById } from '../lib/botAvatars';
import { fetchPublicRoomsResult, validateRoomInvite } from '../lib/multiplayerClient';
import type { PublicRoomSummary } from '../server/roomTypes';

interface WelcomeScreenProps {
  initialPlayerName: string;
  initialAvatarId: string;
  incomingInvite: { roomCode: string; inviteToken?: string } | null;
  onClearIncomingInvite: () => void;
  onSavePlayerName: (name: string) => void;
  onSaveAvatarId: (avatarId: string) => void;
  onOpenCreateRoom: (playerName: string, avatarId?: string) => void;
  onOpenPractice: (playerName: string, avatarId?: string) => void;
  onOpenPassAndPlay: (playerName: string, avatarId?: string) => void;
  onJoinOnlineRoom: (params: {
    roomCode: string;
    playerName: string;
    inviteToken?: string;
    avatarId?: string;
  }) => void;
  onHowToPlay: () => void;
  onSettings: () => void;
  externalError?: string | null;
  onDismissError?: () => void;
}

const HERO_CARDS = [
  makeCard('clubs', 12),
  makeCard('spades', 14),
  makeCard('hearts', 13),
  makeCard('diamonds', 11),
];

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  initialPlayerName,
  initialAvatarId,
  incomingInvite,
  onClearIncomingInvite,
  onSavePlayerName,
  onSaveAvatarId,
  onOpenCreateRoom,
  onOpenPractice,
  onOpenPassAndPlay,
  onJoinOnlineRoom,
  onHowToPlay,
  onSettings,
  externalError,
  onDismissError,
}) => {
  const [name, setName] = useState(initialPlayerName);
  const [selectedAvatarId, setSelectedAvatarId] = useState(initialAvatarId);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [roomCode, setRoomCode] = useState(incomingInvite?.roomCode ?? '');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = useState<string | null>(null);
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [hasLoadedRooms, setHasLoadedRooms] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [publicJoinError, setPublicJoinError] = useState<string | null>(null);
  const [joiningRoomCode, setJoiningRoomCode] = useState<string | null>(null);
  const [capacityFilter, setCapacityFilter] = useState<number | 'all'>('all');
  const [openOnlyFilter, setOpenOnlyFilter] = useState(false);

  const selectedAvatarProfile = getBotAvatarById(selectedAvatarId);
  const chosenAvatarOrUndefined = selectedAvatarProfile?.id;

  useEffect(() => {
    setSelectedAvatarId(initialAvatarId);
  }, [initialAvatarId]);

  const handleSelectAvatar = (nextAvatarId: string) => {
    setSelectedAvatarId(nextAvatarId);
    onSaveAvatarId(nextAvatarId);
  };
  const [expressionDemoOpen, setExpressionDemoOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    const demoParam = new URLSearchParams(window.location.search).get('demo');
    return demoParam === 'expressions' || demoParam === 'relief';
  });
  const [expressionDemoTab, setExpressionDemoTab] = useState<ExpressionDemoTab>(() => {
    if (typeof window === 'undefined') return 'relief';
    const demoParam = new URLSearchParams(window.location.search).get('demo');
    return demoParam === 'expressions' ? 'failed' : 'relief';
  });

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (incomingInvite?.roomCode) {
      setRoomCode(incomingInvite.roomCode);
      validateRoomInvite(incomingInvite.roomCode, incomingInvite.inviteToken).then((res) => {
        if (!mountedRef.current) return;
        if (res.ok) {
          setJoinError(null);
          setInviteInfo(
            `Invited to "${res.room.tableName}" (${res.room.playerCount}/${res.room.capacity} players). Enter your name and tap Join Room.`
          );
        } else {
          setInviteInfo(null);
          setJoinError(res.error);
        }
      });
    }
  }, [incomingInvite]);

  const loadPublic = useCallback(async (options: { force?: boolean } = {}) => {
    if (inFlightRef.current && !options.force) return;
    inFlightRef.current = true;
    setLoadingRooms(true);
    const result = await fetchPublicRoomsResult();
    inFlightRef.current = false;
    if (!mountedRef.current) return;
    setLoadingRooms(false);
    setHasLoadedRooms(true);
    if (result.ok) {
      setPublicRooms(result.rooms);
      setRoomsError(null);
    } else if (result.error) {
      setRoomsError(result.error);
    }
  }, []);

  useEffect(() => {
    loadPublic({ force: true });

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadPublic();
      }
    }, 15_000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadPublic();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadPublic]);

  // Refresh public list when a join error returns the user to the Welcome screen
  useEffect(() => {
    if (externalError) {
      loadPublic();
    }
  }, [externalError, loadPublic]);

  const persistName = (value: string) => {
    setName(value);
    onSavePlayerName(value);
  };

  const safeName = () => name.trim() || 'Player';

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = roomCode.trim().toUpperCase();
    if (cleaned.length !== 6) {
      setJoinError('Enter a 6-character room code (for example SES8YJ).');
      return;
    }
    setJoinError(null);
    setPublicJoinError(null);
    onDismissError?.();

    const tokenToUse =
      incomingInvite && incomingInvite.roomCode === cleaned
        ? incomingInvite.inviteToken
        : undefined;

    const check = await validateRoomInvite(cleaned, tokenToUse);
    if (!check.ok) {
      setJoinError(check.error);
      return;
    }

    onClearIncomingInvite();
    onJoinOnlineRoom({
      roomCode: cleaned,
      playerName: safeName(),
      inviteToken: tokenToUse,
      avatarId: chosenAvatarOrUndefined,
    });
  };

  const handleJoinPublicRoom = async (room: PublicRoomSummary) => {
    if (!room.joinable || joiningRoomCode) return;
    setPublicJoinError(null);
    onDismissError?.();
    setJoiningRoomCode(room.roomCode);

    const check = await validateRoomInvite(room.roomCode);
    if (!mountedRef.current) return;
    setJoiningRoomCode(null);

    if (!check.ok) {
      setPublicJoinError(
        `${room.tableName} (${room.roomCode}) is no longer available: ${check.error}`
      );
      loadPublic({ force: true });
      return;
    }

    onClearIncomingInvite();
    onJoinOnlineRoom({
      roomCode: room.roomCode,
      playerName: safeName(),
      avatarId: chosenAvatarOrUndefined,
    });
  };

  const openJoinableCount = publicRooms.filter((r) => r.joinable).length;
  const filteredPublicRooms = publicRooms.filter((r) => {
    if (capacityFilter !== 'all' && r.capacity !== capacityFilter) return false;
    if (openOnlyFilter && !r.joinable) return false;
    return true;
  });

  return (
    <div className="min-h-screen cream-surface overflow-x-hidden flex flex-col">
      {/* Subtle Top Playing-Card Hero Illustration & Navigation */}
      <div className="relative w-full overflow-hidden">
        {/* Soft decorative fanned card backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-56 sm:h-64 flex items-center justify-center overflow-hidden opacity-45"
        >
          <div className="flex items-end -space-x-6 sm:-space-x-4 translate-y-4">
            {HERO_CARDS.map((card, i) => {
              const tilts = ['-rotate-16', '-rotate-6', 'rotate-6', 'rotate-16'];
              return (
                <div key={card.id} className={`${tilts[i]} scale-95 sm:scale-110`}>
                  <PlayingCard card={card} size="lg" />
                </div>
              );
            })}
          </div>
          {/* Gentle warm cream fade gradient into canvas */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#FAF5ED]/25 via-[#FAF5ED]/65 to-[#FAF5ED]" />
        </div>

        {/* Clean Top Navigation Bar */}
        <header className="relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 pt-4 pb-2 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSettings}
              className="min-h-[42px] px-3.5 sm:px-4 py-2 rounded-full bg-[#FFFDF9]/95 border border-[#E5DAC8] shadow-sm text-xs sm:text-sm font-semibold text-[#2B211A] hover:bg-white transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Settings className="w-4 h-4 text-[#D95732]" />
              Settings
            </button>

            <button
              type="button"
              onClick={onHowToPlay}
              className="min-h-[42px] px-3.5 sm:px-4 py-2 rounded-full bg-[#FFFDF9]/95 border border-[#E5DAC8] shadow-sm text-xs sm:text-sm font-semibold text-[#2B211A] hover:bg-white transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <HelpCircle className="w-4 h-4 text-[#2B211A]" />
              How to Play
            </button>

            <button
              type="button"
              data-testid="open-expression-demo"
              onClick={() => {
                setExpressionDemoTab('relief');
                setExpressionDemoOpen(true);
              }}
              className="min-h-[42px] px-3.5 sm:px-4 py-2 rounded-full bg-[#FFF4DC] border border-[#E7C67A] shadow-sm text-xs sm:text-sm font-bold text-[#5A3604] hover:bg-[#FDECC4] transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Smile className="w-4 h-4 text-[#D95732]" />
              Expression Demo
            </button>
          </div>

          <PWAInstallButton variant="header" />
        </header>

        {/* Brand Heading with Official Logo */}
        <div className="relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-4">
          <div className="max-w-lg mx-auto lg:mx-0 flex items-center gap-4 sm:gap-5">
            <img
              src="/logo.png"
              alt="Last Donkey — Rang Vapas logo"
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-[22px] object-cover shadow-lg ring-2 ring-white/80 shrink-0 select-none"
              draggable={false}
            />
            <div className="min-w-0">
              <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-tight text-[#D95732] leading-[0.98] drop-shadow-[0_1px_0_rgba(255,255,255,0.85)]">
                Last Donkey
              </h1>
              <p className="mt-2 text-sm sm:text-lg font-medium text-[#3A2E25]">
                Rang Vapas · the classic Indian card game
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Responsive Content: Stacks cleanly on Android mobile, balanced 2-column on desktop */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 pb-10 pt-2">
        {(externalError || inviteInfo) && (
          <div className="max-w-lg mx-auto lg:max-w-none mb-5 space-y-2">
            {externalError && (
              <div
                role="alert"
                className="rounded-2xl bg-[#FEECE8] border border-[#E59887] px-4 py-3 text-sm text-[#8F2811] flex items-center justify-between gap-3"
              >
                <span>{externalError}</span>
                {onDismissError && (
                  <button
                    type="button"
                    onClick={onDismissError}
                    className="text-xs font-semibold underline shrink-0 cursor-pointer"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            )}
            {inviteInfo && (
              <div className="rounded-2xl bg-[#EBF5EE] border border-[#9DC6A9] px-4 py-3 text-sm text-[#1E4A2C]">
                {inviteInfo}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Left / Primary Column (Matches Emergent Home Reference) */}
          <div className="lg:col-span-6 w-full max-w-lg mx-auto lg:max-w-none space-y-4">
            {/* Soft Beige Nickname Input + Guest Character Avatar Selector */}
            <div className="space-y-2.5">
              <div>
                <label
                  htmlFor="home-nickname"
                  className="block text-sm font-semibold text-[#3A2E25] mb-1.5"
                >
                  Your name
                </label>
                <div className="flex items-center gap-2.5">
                  {/* Desktop inline avatar trigger (unchanged desktop behavior) */}
                  <button
                    type="button"
                    data-testid="desktop-avatar-trigger"
                    onClick={() => setAvatarPickerOpen((prev) => !prev)}
                    aria-expanded={avatarPickerOpen}
                    aria-label="Choose your character avatar"
                    title={
                      selectedAvatarProfile
                        ? `${selectedAvatarProfile.name} — tap to change avatar`
                        : 'Auto-assign character — tap to choose avatar'
                    }
                    className="hidden sm:flex shrink-0 min-h-[54px] px-2.5 rounded-2xl bg-[#EFE6D8] hover:bg-[#E7DCCB] border border-[#DDD1BE] items-center gap-2 transition-colors cursor-pointer"
                  >
                    {selectedAvatarProfile ? (
                      <PlayerAvatar
                        name={selectedAvatarProfile.name}
                        type="human"
                        avatarColor={selectedAvatarProfile.accentColor}
                        avatarId={selectedAvatarProfile.id}
                        size="sm"
                        animated={false}
                      />
                    ) : (
                      <span className="w-9 h-9 rounded-full bg-[#365B40] text-[#FAF5ED] flex items-center justify-center text-xs font-bold">
                        Auto
                      </span>
                    )}
                    <span className="text-xs font-semibold text-[#3A2E25] max-w-[78px] truncate">
                      {selectedAvatarProfile ? selectedAvatarProfile.name.split(' ')[0] : 'Avatar'}
                    </span>
                  </button>

                  <input
                    id="home-nickname"
                    type="text"
                    maxLength={20}
                    value={name}
                    onChange={(e) => persistName(e.target.value)}
                    placeholder="Enter your nickname"
                    className="flex-1 min-w-0 min-h-[54px] px-4 rounded-2xl bg-[#EFE6D8] border border-[#DDD1BE] text-base font-medium text-[#261E18] placeholder:text-[#8E7F6F] focus:outline-none focus:border-[#D95732] focus:bg-[#F5EEE2] transition-colors"
                  />
                </div>
              </div>

              {/* Mobile clearly labeled Avatar Selector Bar (< 640px) */}
              <div className="sm:hidden">
                <span className="block text-sm font-semibold text-[#3A2E25] mb-1.5">
                  Your avatar
                </span>
                <button
                  type="button"
                  data-testid="mobile-avatar-trigger"
                  onClick={() => setAvatarPickerOpen((prev) => !prev)}
                  aria-expanded={avatarPickerOpen}
                  aria-label="Choose your character avatar"
                  className="w-full min-h-[56px] px-3.5 py-2.5 rounded-2xl bg-[#EFE6D8] hover:bg-[#E7DCCB] border border-[#DDD1BE] flex items-center justify-between gap-2.5 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {selectedAvatarProfile ? (
                      <PlayerAvatar
                        name={selectedAvatarProfile.name}
                        type="human"
                        avatarColor={selectedAvatarProfile.accentColor}
                        avatarId={selectedAvatarProfile.id}
                        size="sm"
                        animated={false}
                      />
                    ) : (
                      <span className="w-9 h-9 rounded-full bg-[#365B40] text-[#FAF5ED] flex items-center justify-center text-xs font-bold shrink-0">
                        Auto
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#261E18] leading-snug">
                        {selectedAvatarProfile ? selectedAvatarProfile.name : 'Auto-Assigned Character'}
                      </div>
                      <div className="text-[11px] text-[#6E6052] leading-snug">
                        {selectedAvatarProfile
                          ? selectedAvatarProfile.personality
                          : 'Tap to choose one of 12 characters'}
                      </div>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#FAF5ED] border border-[#D8CBB8] text-xs font-semibold text-[#3A2E25] shrink-0">
                    {avatarPickerOpen ? 'Done' : selectedAvatarProfile ? 'Change' : 'Choose'}
                    {avatarPickerOpen ? (
                      <ChevronUp className="w-3.5 h-3.5 text-[#D95732]" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-[#D95732]" aria-hidden="true" />
                    )}
                  </span>
                </button>
              </div>

              {avatarPickerOpen && (
                <div className="rounded-2xl bg-[#EFE6D8] border border-[#DFD3C1] p-3.5 shadow-xs">
                  <AvatarPicker
                    selectedAvatarId={selectedAvatarId}
                    onSelect={(id) => {
                      handleSelectAvatar(id);
                      if (id) setAvatarPickerOpen(false);
                    }}
                    allowAuto
                    compact
                  />
                </div>
              )}
            </div>

            {/* Orange Create Room CTA */}
            <button
              type="button"
              onClick={() => onOpenCreateRoom(safeName(), chosenAvatarOrUndefined)}
              className="w-full min-h-[56px] px-6 py-3.5 rounded-full btn-orange-3d font-bold text-lg transition-all flex items-center justify-center gap-2.5 cursor-pointer"
            >
              <span className="w-6 h-6 rounded-full bg-white text-[#D95732] flex items-center justify-center shrink-0">
                <Plus className="w-4 h-4 stroke-[3]" />
              </span>
              Create Room
            </button>

            {/* Dark Green Practice vs Bots CTA */}
            <button
              type="button"
              onClick={() => onOpenPractice(safeName(), chosenAvatarOrUndefined)}
              className="w-full min-h-[56px] px-6 py-3.5 rounded-full btn-forest-3d font-bold text-lg transition-all flex items-center justify-center gap-2.5 cursor-pointer"
            >
              <Bot className="w-5 h-5" />
              Practice vs Bots
            </button>

            {/* Secondary Pass-and-Play Local Mode */}
            <button
              type="button"
              onClick={() => onOpenPassAndPlay(safeName(), chosenAvatarOrUndefined)}
              className="w-full min-h-[48px] px-5 py-2.5 rounded-2xl bg-[#EFE6D8] hover:bg-[#E7DCCB] border border-[#DDD1BE] text-[#3A2E25] font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Users className="w-4 h-4 text-[#365B40]" />
              Pass-and-Play on One Device
            </button>

            {/* Beige Join Room Panel (Private / Code-Only) */}
            <form
              onSubmit={handleJoinSubmit}
              className="rounded-3xl bg-[#EFE6D8] border border-[#DFD3C1] p-5 space-y-3.5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold text-[#261E18] flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-[#D95732] shrink-0" />
                  Join by Code
                </h2>
                <span className="text-xs text-[#6E6052]">Private or 6-char code</span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  maxLength={6}
                  value={roomCode}
                  onChange={(e) => {
                    setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                    if (joinError) setJoinError(null);
                  }}
                  placeholder="SES8YJ"
                  aria-label="6-character room code"
                  className="flex-1 min-h-[48px] px-4 rounded-xl bg-[#FAF5ED] border border-[#D8CBB8] font-mono text-base font-semibold tracking-[0.18em] uppercase text-[#261E18] placeholder:text-[#A19281] focus:outline-none focus:border-[#D95732]"
                />
                <button
                  type="submit"
                  className="min-h-[48px] px-6 py-2.5 rounded-xl bg-[#261E18] text-[#FAF5ED] font-semibold text-sm hover:bg-[#3B2F26] transition-colors cursor-pointer whitespace-nowrap"
                >
                  Join Room
                </button>
              </div>

              {joinError && (
                <p role="alert" className="text-xs font-medium text-[#B92D14]">
                  {joinError}
                </p>
              )}
            </form>
          </div>

          {/* Right / Public Rooms Discovery Column */}
          <section className="lg:col-span-6 w-full max-w-lg mx-auto lg:max-w-none rounded-3xl bg-[#F4ECE0] border border-[#E2D6C4] p-5 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-xl font-bold text-[#261E18] flex items-center gap-2 flex-wrap">
                  <Globe className="w-5 h-5 text-[#365B40] shrink-0" />
                  <span>Public Rooms</span>
                  {hasLoadedRooms && !roomsError && (
                    <span className="text-xs font-sans font-semibold text-[#365B40] tabular-nums">
                      ({openJoinableCount} open)
                    </span>
                  )}
                </h2>
                <p className="text-xs text-[#6E6052] mt-0.5">
                  Open public tables only · Private rooms require a code or invite link
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadPublic({ force: true })}
                disabled={loadingRooms}
                aria-label="Refresh public rooms"
                className="min-h-[40px] min-w-[40px] rounded-xl bg-[#FAF5ED] border border-[#DDD1BE] flex items-center justify-center text-[#3A2E25] hover:border-[#D95732] transition-colors cursor-pointer disabled:opacity-60 shrink-0"
              >
                <RefreshCw className={`w-4 h-4 ${loadingRooms ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Room Capacity & Availability Filter Controls */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {(['all', 2, 3, 4, 5, 6] as const).map((cap) => {
                  const active = capacityFilter === cap;
                  return (
                    <button
                      key={cap}
                      type="button"
                      onClick={() => setCapacityFilter(cap)}
                      className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-[#365B40] text-white'
                          : 'bg-[#FAF5ED] text-[#4E4136] border border-[#DFD3C1] hover:border-[#365B40]'
                      }`}
                    >
                      {cap === 'all' ? 'All Sizes' : `${cap}P`}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setOpenOnlyFilter((prev) => !prev)}
                aria-pressed={openOnlyFilter}
                className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  openOnlyFilter
                    ? 'bg-[#D95732] text-white'
                    : 'bg-[#FAF5ED] text-[#4E4136] border border-[#DFD3C1] hover:border-[#D95732]'
                }`}
              >
                {openOnlyFilter ? 'Open Seats Only' : 'Show All Status'}
              </button>
            </div>

            {/* Graceful Join Error Banner (e.g., room filled, started, or closed before click) */}
            {publicJoinError && (
              <div
                role="alert"
                className="mt-3 rounded-2xl bg-[#FEECE8] border border-[#E59887] px-3.5 py-2.5 text-xs text-[#8F2811] flex items-center justify-between gap-2"
              >
                <span>{publicJoinError}</span>
                <button
                  type="button"
                  onClick={() => setPublicJoinError(null)}
                  className="font-semibold underline shrink-0 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Public Room List (Loading / Error / Empty / Rooms) */}
            <div className="mt-4 space-y-2.5">
              {!hasLoadedRooms && loadingRooms ? (
                <div className="rounded-2xl bg-[#FAF5ED] border border-[#DFD3C1] px-4 py-8 text-center">
                  <RefreshCw className="w-5 h-5 text-[#365B40] animate-spin mx-auto" />
                  <p className="mt-2 text-sm font-semibold text-[#3A2E25]">
                    Loading public rooms...
                  </p>
                </div>
              ) : roomsError ? (
                <div
                  role="alert"
                  className="rounded-2xl bg-[#FEECE8] border border-[#E59887] px-4 py-6 text-center space-y-2.5"
                >
                  <AlertCircle className="w-5 h-5 text-[#B92D14] mx-auto" />
                  <p className="text-sm font-semibold text-[#8F2811]">{roomsError}</p>
                  <button
                    type="button"
                    onClick={() => loadPublic({ force: true })}
                    className="min-h-[38px] px-4 py-1.5 rounded-xl bg-[#261E18] text-[#FAF5ED] text-xs font-semibold hover:bg-[#3B2F26] transition-colors cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
              ) : filteredPublicRooms.length === 0 ? (
                <div className="rounded-2xl bg-[#FAF5ED] border border-dashed border-[#D8CBB8] px-4 py-8 text-center space-y-2">
                  <p className="text-sm font-semibold text-[#3A2E25]">
                    {publicRooms.length === 0
                      ? 'No public rooms right now'
                      : 'No public rooms match this filter'}
                  </p>
                  <p className="text-xs text-[#736456]">
                    {publicRooms.length === 0 ? (
                      <>
                        Tap <strong>Create Room</strong> to host a public or private table for 2–6
                        players, or play <strong>Practice vs Bots</strong>.
                      </>
                    ) : (
                      'Reset your filters to view other public rooms.'
                    )}
                  </p>
                  {publicRooms.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCapacityFilter('all');
                        setOpenOnlyFilter(false);
                      }}
                      className="mt-1 min-h-[36px] px-3.5 py-1 rounded-xl bg-[#EFE6D8] border border-[#D8CBB8] text-xs font-semibold text-[#261E18] hover:border-[#D95732] cursor-pointer"
                    >
                      Show All Public Rooms
                    </button>
                  )}
                </div>
              ) : (
                filteredPublicRooms.map((room) => {
                  const isJoiningThis = joiningRoomCode === room.roomCode;
                  const statusLabel =
                    room.status === 'playing'
                      ? 'In Progress'
                      : room.isFull
                        ? 'Full'
                        : 'Waiting';
                  const statusColorClass =
                    room.status === 'playing'
                      ? 'text-[#9A5B00] bg-[#FFF4DC] border-[#E7C67A]'
                      : room.isFull
                        ? 'text-[#6E6052] bg-[#EFE6D8] border-[#D8CBB8]'
                        : 'text-[#1E4A2C] bg-[#EBF5EE] border-[#B2D3BC]';
                  const timerLabel =
                    room.turnTimerSeconds === 0 ? 'Timer Off' : `${room.turnTimerSeconds}s timer`;

                  return (
                    <div
                      key={room.roomCode}
                      className="rounded-2xl bg-[#FAF5ED] border border-[#DFD3C1] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm sm:text-base text-[#261E18] truncate max-w-full">
                            {room.tableName}
                          </span>
                          <span className="font-mono text-xs text-[#D95732] font-bold shrink-0">
                            {room.roomCode}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold shrink-0 ${statusColorClass}`}
                          >
                            {statusLabel}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#5C4E41] tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            {room.aiHostActive ? (
                              <Bot className="w-3.5 h-3.5 text-[#365B40] shrink-0" />
                            ) : (
                              <User className="w-3.5 h-3.5 text-[#6E6052] shrink-0" />
                            )}
                            <span className="truncate max-w-[140px]">Host: {room.hostName}</span>
                          </span>
                          <span aria-hidden="true" className="text-[#B8A996]">
                            ·
                          </span>
                          <span>
                            {room.playerCount}/{room.capacity} seated
                            {room.joinable
                              ? ` (${room.availableSeats} ${room.availableSeats === 1 ? 'seat' : 'seats'} open)`
                              : ''}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[#6E6052] tabular-nums">
                          <span className="inline-flex items-center gap-1 font-medium">
                            <Clock className="w-3 h-3 text-[#365B40]" />
                            {timerLabel}
                          </span>
                          <span aria-hidden="true" className="text-[#B8A996]">
                            ·
                          </span>
                          <span className="font-medium">
                            {DIFFICULTY_META[room.difficulty ?? 'easy'].shortTag}
                          </span>
                        </div>
                      </div>

                      {room.joinable ? (
                        <button
                          type="button"
                          disabled={Boolean(joiningRoomCode)}
                          onClick={() => handleJoinPublicRoom(room)}
                          className="w-full sm:w-auto min-h-[42px] px-5 py-2 rounded-xl bg-[#D95732] text-white text-xs font-bold hover:bg-[#E3613B] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait whitespace-nowrap shrink-0"
                        >
                          {isJoiningThis ? 'Joining...' : 'Join'}
                        </button>
                      ) : (
                        <span className="inline-flex items-center justify-center px-3.5 py-2 rounded-xl bg-[#EFE6D8] text-[#7D6E5F] text-xs font-semibold whitespace-nowrap shrink-0">
                          {room.status === 'playing' ? 'In Progress' : 'Room Full'}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-[#DFD3C1] flex items-center gap-2 text-xs text-[#6E6052]">
              <Lock className="w-3.5 h-3.5 shrink-0 text-[#365B40]" />
              <span>Private rooms never appear here and can only be joined with a code or link.</span>
            </div>
          </section>
        </div>
      </main>

      <FacialExpressionDemoModal
        open={expressionDemoOpen}
        initialTab={expressionDemoTab}
        onClose={() => setExpressionDemoOpen(false)}
      />
    </div>
  );
};
