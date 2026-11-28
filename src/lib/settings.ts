import type { DifficultyMode, PlayerConfig } from '../engine/index.ts';
import type { RoomVisibility } from '../server/roomTypes.ts';
import {
  BOT_AVATAR_NAMES,
  getBotAvatarById,
  isBotAvatarName,
  pickUniqueBotAvatar,
  pickUniqueCharacterAvatar,
} from './botAvatars.ts';

export type PlayTapMode = 'confirm' | 'single-tap';
export type GameSpeed = 'relaxed' | 'normal' | 'fast';
export type TurnTimerSeconds = 0 | 10 | 15 | 20 | 30;

export interface AppSettings {
  soundEnabled: boolean;
  animationsEnabled: boolean;
  playTapMode: PlayTapMode;
  sortOrder: 'desc' | 'asc';
  gameSpeed: GameSpeed;
  autoAdvanceTricks: boolean;
  openHandsTesting: boolean;
  turnTimerSeconds: TurnTimerSeconds;
  playerName: string;
  /** Guest-selected character avatar ID persisted in localStorage (empty string = auto-assign unused) */
  selectedAvatarId: string;
  defaultDifficulty: DifficultyMode;
}

export const DEFAULT_SETTINGS: AppSettings = {
  soundEnabled: true,
  animationsEnabled: true,
  playTapMode: 'confirm',
  sortOrder: 'desc',
  gameSpeed: 'normal',
  autoAdvanceTricks: true,
  openHandsTesting: false,
  turnTimerSeconds: 15,
  playerName: '',
  selectedAvatarId: '',
  defaultDifficulty: 'easy',
};

/**
 * Resolves the preferred character avatar ID for a player, keeping registered-profile
 * compatibility ready for future account integration:
 * registered savedAvatarId takes precedence over guest localStorage selectedAvatarId.
 */
export function resolvePreferredAvatarId(options: {
  savedAvatarId?: string | null;
  selectedAvatarId?: string | null;
}): string | undefined {
  const saved = getBotAvatarById(options.savedAvatarId);
  if (saved) return saved.id;
  const guest = getBotAvatarById(options.selectedAvatarId);
  if (guest) return guest.id;
  return undefined;
}

const STORAGE_KEY = 'last_donkey_settings_v2';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const validAvatarId = getBotAvatarById(parsed.selectedAvatarId)?.id ?? '';
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      selectedAvatarId: validAvatarId,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors in restricted webviews
  }
}

export function getBotDelayMs(speed: GameSpeed): number {
  switch (speed) {
    case 'relaxed':
      return 1100;
    case 'fast':
      return 400;
    default:
      return 720;
  }
}

export function getTrickAutoAdvanceMs(speed: GameSpeed, isFailed = false): number {
  switch (speed) {
    case 'relaxed':
      return isFailed ? 2900 : 2100;
    case 'fast':
      return isFailed ? 1250 : 850;
    default:
      return isFailed ? 1950 : 1350;
  }
}

export type LocalMode = 'bots' | 'pass-and-play';

export interface LocalLobbyConfig {
  roomCode: string;
  tableName: string;
  mode: LocalMode;
  visibility: RoomVisibility;
  capacity: number;
  difficulty: DifficultyMode;
  players: PlayerConfig[];
}

export const BOT_NAMES: readonly string[] = BOT_AVATAR_NAMES;
export const AVATAR_COLORS = ['#E59A00', '#2E6340', '#D95732', '#3A6B8A', '#8B5E83', '#B57435'];

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function buildDefaultPlayers(
  count: number,
  hostName: string,
  mode: LocalMode,
  rng: () => number = Math.random,
  hostPreferredAvatarId?: string | null
): PlayerConfig[] {
  const safeHost = hostName.trim() || 'You';
  const clampedCount = Math.max(2, Math.min(6, count));
  const usedAvatarIds = new Set<string>();
  const usedNames = new Set<string>([safeHost.toLowerCase()]);

  const hostPicked = pickUniqueCharacterAvatar({
    preferredAvatarId: hostPreferredAvatarId,
    usedAvatarIds,
    rng,
  }).profile;
  usedAvatarIds.add(hostPicked.id);

  const players: PlayerConfig[] = [
    {
      id: 'p1',
      name: safeHost,
      type: 'human',
      avatarColor: hostPicked.accentColor,
      avatarId: hostPicked.id,
      botAvatarId: hostPicked.id,
    },
  ];

  for (let idx = 1; idx < clampedCount; idx++) {
    const isHuman = mode === 'pass-and-play';
    const picked = pickUniqueBotAvatar({
      usedAvatarIds,
      usedNames: isHuman ? undefined : usedNames,
      rng,
    });
    usedAvatarIds.add(picked.id);

    if (isHuman) {
      const humanName = `Player ${idx + 1}`;
      usedNames.add(humanName.toLowerCase());
      players.push({
        id: `p${idx + 1}`,
        name: humanName,
        type: 'human',
        avatarColor: picked.accentColor,
        avatarId: picked.id,
        botAvatarId: picked.id,
      });
    } else {
      usedNames.add(picked.name.toLowerCase());
      players.push({
        id: `p${idx + 1}`,
        name: picked.name,
        type: 'bot',
        avatarColor: picked.accentColor,
        avatarId: picked.id,
        botAvatarId: picked.id,
      });
    }
  }

  return players;
}

export const MIN_LOCAL_PLAYERS = 2;
export const MAX_LOCAL_PLAYERS = 6;

/**
 * Authoritative local mode derived from seat player types:
 * - 1 human (+ bots) => 'bots' (Practice vs Bots)
 * - 2+ humans (+ optional bots) => 'pass-and-play' (Pass-and-Play)
 */
export function deriveLocalMode(players: readonly PlayerConfig[]): LocalMode {
  const humanCount = players.filter((p) => p.type === 'human').length;
  return humanCount > 1 ? 'pass-and-play' : 'bots';
}

/**
 * Enforces Local Mode invariants on any LocalLobbyConfig:
 * - Seat 0 is ALWAYS a human player (cannot be converted to a bot).
 * - Capacity always matches players.length (clamped to 2–6).
 * - Mode is synchronized with the actual number of human seats.
 */
export function sanitizeLocalLobbyConfig(config: LocalLobbyConfig): LocalLobbyConfig {
  let players = config.players.slice(0, MAX_LOCAL_PLAYERS).map((p, idx) =>
    idx === 0
      ? {
          ...p,
          type: 'human' as const,
        }
      : { ...p }
  );

  if (players.length === 0) {
    players = buildDefaultPlayers(MIN_LOCAL_PLAYERS, 'You', 'bots');
  } else if (players.length < MIN_LOCAL_PLAYERS) {
    const picked = pickUniqueBotAvatar({
      usedAvatarIds: players.map((p) => p.avatarId ?? p.botAvatarId),
      usedNames: players.map((p) => p.name),
    });
    const fallbackBot: PlayerConfig = {
      id: `p${players.length + 1}`,
      name: picked.name,
      type: 'bot',
      avatarColor: picked.accentColor,
      avatarId: picked.id,
      botAvatarId: picked.id,
    };
    players = [...players, fallbackBot];
  }

  // Ensure every seat (human AND bot) has a valid unique character avatar from the 12-avatar pool
  const seenAvatarIds = new Set<string>();
  const allNames = new Set(players.map((p) => p.name.trim().toLowerCase()));
  players = players.map((p) => {
    const existingProfile = getBotAvatarById(p.avatarId ?? p.botAvatarId);
    if (existingProfile && !seenAvatarIds.has(existingProfile.id)) {
      seenAvatarIds.add(existingProfile.id);
      return {
        ...p,
        avatarId: existingProfile.id,
        botAvatarId: existingProfile.id,
        avatarColor: p.avatarColor ?? existingProfile.accentColor,
      };
    }
    const picked = pickUniqueBotAvatar({
      usedAvatarIds: seenAvatarIds,
      usedNames: p.type === 'bot' ? allNames : undefined,
    });
    seenAvatarIds.add(picked.id);
    return {
      ...p,
      avatarId: picked.id,
      botAvatarId: picked.id,
      avatarColor: picked.accentColor,
    };
  });

  return {
    ...config,
    capacity: players.length,
    mode: deriveLocalMode(players),
    players,
  };
}

/**
 * Updates a seat in a local lobby while enforcing the Seat-0 guardrail:
 * - Seat 0 (index 0) cannot be converted into a bot; only name/avatar updates are allowed.
 * - Seats 1..5 may be switched between Human and Bot, keeping `mode` synchronized.
 */
export function updateLocalLobbyPlayer(
  config: LocalLobbyConfig,
  index: number,
  patch: Partial<PlayerConfig>
): LocalLobbyConfig {
  if (index < 0 || index >= config.players.length) {
    return sanitizeLocalLobbyConfig(config);
  }

  const requestedAvatarId = patch.avatarId ?? patch.botAvatarId;
  const requestedProfile = getBotAvatarById(requestedAvatarId);
  const currentSeat = config.players[index];
  const prevSeatAvatarId = currentSeat.avatarId ?? currentSeat.botAvatarId;

  // If explicitly choosing an avatar currently held by another local seat, swap cleanly
  const swapTargetIndex =
    requestedProfile && requestedProfile.id !== prevSeatAvatarId
      ? config.players.findIndex(
          (p, i) => i !== index && (p.avatarId ?? p.botAvatarId) === requestedProfile.id
        )
      : -1;

  const nextPlayers = config.players.map((player, idx) => {
    if (idx === swapTargetIndex && prevSeatAvatarId) {
      const prevProfile = getBotAvatarById(prevSeatAvatarId);
      return {
        ...player,
        avatarId: prevProfile?.id ?? prevSeatAvatarId,
        botAvatarId: prevProfile?.id ?? prevSeatAvatarId,
        avatarColor: prevProfile?.accentColor ?? player.avatarColor,
        name:
          player.type === 'bot' && isBotAvatarName(player.name) && prevProfile
            ? prevProfile.name
            : player.name,
      };
    }

    if (idx !== index) return player;

    if (idx === 0) {
      const resolvedId = requestedProfile?.id ?? player.avatarId ?? player.botAvatarId;
      const resolvedProfile = getBotAvatarById(resolvedId);
      return {
        ...player,
        ...patch,
        type: 'human' as const,
        ...(resolvedProfile
          ? {
              avatarId: resolvedProfile.id,
              botAvatarId: resolvedProfile.id,
              avatarColor: patch.avatarColor ?? resolvedProfile.accentColor,
            }
          : {}),
      };
    }

    const switchingToBot = patch.type === 'bot' && player.type !== 'bot';
    const switchingToHuman = patch.type === 'human' && player.type !== 'human';

    if (switchingToBot) {
      const others = config.players.filter((_, i) => i !== idx);
      const picked =
        requestedProfile ??
        pickUniqueBotAvatar({
          usedAvatarIds: others.map((p) => p.avatarId ?? p.botAvatarId),
          usedNames: others.map((p) => p.name),
        });
      const isDefaultHumanName = /^player\s+\d+$/i.test(player.name.trim());
      return {
        ...player,
        ...patch,
        type: 'bot' as const,
        avatarId: picked.id,
        botAvatarId: picked.id,
        avatarColor: patch.avatarColor ?? picked.accentColor,
        name:
          patch.name !== undefined
            ? patch.name
            : isDefaultHumanName || !player.name.trim()
              ? picked.name
              : player.name,
      };
    }

    if (switchingToHuman) {
      const existingProfile =
        requestedProfile ?? getBotAvatarById(player.avatarId ?? player.botAvatarId);
      const shouldResetBotName = patch.name === undefined && isBotAvatarName(player.name);
      return {
        ...player,
        ...patch,
        type: 'human' as const,
        ...(existingProfile
          ? {
              avatarId: existingProfile.id,
              botAvatarId: existingProfile.id,
              avatarColor: patch.avatarColor ?? existingProfile.accentColor,
            }
          : {
              avatarColor: patch.avatarColor ?? AVATAR_COLORS[idx % AVATAR_COLORS.length],
            }),
        name: shouldResetBotName ? `Player ${idx + 1}` : (patch.name ?? player.name),
      };
    }

    const nextProfile = requestedProfile ?? getBotAvatarById(player.avatarId ?? player.botAvatarId);
    return {
      ...player,
      ...patch,
      ...(nextProfile
        ? {
            avatarId: nextProfile.id,
            botAvatarId: nextProfile.id,
            avatarColor: patch.avatarColor ?? nextProfile.accentColor,
            name:
              patch.name === undefined &&
              player.type === 'bot' &&
              requestedProfile &&
              isBotAvatarName(player.name)
                ? requestedProfile.name
                : (patch.name ?? player.name),
          }
        : {}),
    };
  });

  return sanitizeLocalLobbyConfig({
    ...config,
    players: nextPlayers,
  });
}

/**
 * Adds a new seat to a local lobby (up to 6 players) and synchronizes mode/capacity.
 */
export function addLocalLobbySeat(config: LocalLobbyConfig): LocalLobbyConfig {
  const safe = sanitizeLocalLobbyConfig(config);
  if (safe.players.length >= MAX_LOCAL_PLAYERS) return safe;

  const idx = safe.players.length;
  const isPass = safe.mode === 'pass-and-play';
  const existingNames = new Set(safe.players.map((p) => p.name.trim().toLowerCase()));
  const existingIds = new Set(safe.players.map((p) => p.id));

  let idNum = idx + 1;
  while (existingIds.has(`p${idNum}`)) {
    idNum++;
  }

  const picked = pickUniqueBotAvatar({
    usedAvatarIds: safe.players.map((p) => p.avatarId ?? p.botAvatarId),
    usedNames: isPass ? undefined : existingNames,
  });

  let nextPlayer: PlayerConfig;
  if (isPass) {
    let n = idx + 1;
    while (existingNames.has(`player ${n}`)) n++;
    nextPlayer = {
      id: `p${idNum}`,
      name: `Player ${n}`,
      type: 'human',
      avatarColor: picked.accentColor,
      avatarId: picked.id,
      botAvatarId: picked.id,
    };
  } else {
    nextPlayer = {
      id: `p${idNum}`,
      name: picked.name,
      type: 'bot',
      avatarColor: picked.accentColor,
      avatarId: picked.id,
      botAvatarId: picked.id,
    };
  }

  return sanitizeLocalLobbyConfig({
    ...safe,
    players: [...safe.players, nextPlayer],
  });
}

/**
 * Removes a seat from a local lobby while enforcing guardrails:
 * - Seat 0 (index 0) can NEVER be removed.
 * - Cannot drop below 2 total players.
 * - Automatically recalculates `mode` ('bots' when human count reaches 1, 'pass-and-play' when >= 2)
 *   and updates `capacity`.
 */
export function removeLocalLobbySeat(
  config: LocalLobbyConfig,
  index: number
): LocalLobbyConfig {
  if (index <= 0 || index >= config.players.length || config.players.length <= MIN_LOCAL_PLAYERS) {
    return sanitizeLocalLobbyConfig(config);
  }

  const nextPlayers = config.players.filter((_, idx) => idx !== index);
  return sanitizeLocalLobbyConfig({
    ...config,
    players: nextPlayers,
  });
}

export type LocalLobbyValidationResult =
  | { ok: true; config: LocalLobbyConfig }
  | { ok: false; error: string };

/**
 * Validates a LocalLobbyConfig before starting a local game.
 * Explicitly rejects invalid configurations (e.g., 0 humans, Seat 0 as bot, or invalid player count).
 */
export function validateLocalLobbyConfig(
  config: LocalLobbyConfig | null | undefined
): LocalLobbyValidationResult {
  if (!config || !Array.isArray(config.players)) {
    return { ok: false, error: 'Invalid local lobby configuration.' };
  }

  if (
    config.players.length < MIN_LOCAL_PLAYERS ||
    config.players.length > MAX_LOCAL_PLAYERS
  ) {
    return { ok: false, error: 'Local games require between 2 and 6 players.' };
  }

  const seat0 = config.players[0];
  if (!seat0 || seat0.type !== 'human') {
    return { ok: false, error: 'Seat 1 must remain a human player in Local Mode.' };
  }

  const humanCount = config.players.filter((p) => p.type === 'human').length;
  if (humanCount < 1) {
    return { ok: false, error: 'At least one human player is required to start a local game.' };
  }

  const normalizedPlayers: PlayerConfig[] = config.players.map((p, idx) => {
    const trimmed = p.name.trim();
    const fallbackName =
      idx === 0
        ? 'You'
        : p.type === 'human'
          ? `Player ${idx + 1}`
          : BOT_NAMES[idx - 1] ?? `Bot ${idx}`;
    return {
      ...p,
      name: trimmed || fallbackName,
    };
  });

  return {
    ok: true,
    config: {
      ...config,
      capacity: normalizedPlayers.length,
      mode: deriveLocalMode(normalizedPlayers),
      players: normalizedPlayers,
    },
  };
}

