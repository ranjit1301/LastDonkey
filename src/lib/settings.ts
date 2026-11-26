import type { DifficultyMode, PlayerConfig } from '../engine/index.ts';
import type { RoomVisibility } from '../server/roomTypes.ts';

export type PlayTapMode = 'confirm' | 'single-tap';
export type GameSpeed = 'relaxed' | 'normal' | 'fast';
export type TurnTimerSeconds = 0 | 10 | 15 | 20 | 30;

export interface AppSettings {
  soundEnabled: boolean;
  playTapMode: PlayTapMode;
  sortOrder: 'desc' | 'asc';
  gameSpeed: GameSpeed;
  autoAdvanceTricks: boolean;
  openHandsTesting: boolean;
  turnTimerSeconds: TurnTimerSeconds;
  playerName: string;
  defaultDifficulty: DifficultyMode;
}

export const DEFAULT_SETTINGS: AppSettings = {
  soundEnabled: true,
  playTapMode: 'confirm',
  sortOrder: 'desc',
  gameSpeed: 'normal',
  autoAdvanceTricks: true,
  openHandsTesting: false,
  turnTimerSeconds: 15,
  playerName: '',
  defaultDifficulty: 'easy',
};

const STORAGE_KEY = 'last_donkey_settings_v2';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
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

export const BOT_NAMES = ['Bot Raju', 'Bot Pinky', 'Bot Golu', 'Bot Meera', 'Bot Kabir', 'Bot Priya'];
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
  mode: LocalMode
): PlayerConfig[] {
  const safeHost = hostName.trim() || 'You';
  const clampedCount = Math.max(2, Math.min(6, count));
  return Array.from({ length: clampedCount }, (_, idx) => {
    if (idx === 0) {
      return {
        id: 'p1',
        name: safeHost,
        type: 'human',
        avatarColor: AVATAR_COLORS[0],
      };
    }
    const isHuman = mode === 'pass-and-play';
    return {
      id: `p${idx + 1}`,
      name: isHuman ? `Player ${idx + 1}` : BOT_NAMES[idx - 1] ?? `Bot ${idx}`,
      type: isHuman ? 'human' : 'bot',
      avatarColor: AVATAR_COLORS[idx % AVATAR_COLORS.length],
    };
  });
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
    const fallbackBot: PlayerConfig = {
      id: `p${players.length + 1}`,
      name: BOT_NAMES[0] ?? 'Bot 1',
      type: 'bot',
      avatarColor: AVATAR_COLORS[players.length % AVATAR_COLORS.length],
    };
    players = [...players, fallbackBot];
  }

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

  const nextPlayers = config.players.map((player, idx) => {
    if (idx !== index) return player;
    if (idx === 0) {
      return {
        ...player,
        ...patch,
        type: 'human' as const,
      };
    }
    return {
      ...player,
      ...patch,
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

  let nextName: string;
  if (isPass) {
    let n = idx + 1;
    while (existingNames.has(`player ${n}`)) n++;
    nextName = `Player ${n}`;
  } else {
    nextName =
      BOT_NAMES.find((name) => !existingNames.has(name.toLowerCase())) ?? `Bot ${idNum}`;
  }

  const nextPlayer: PlayerConfig = {
    id: `p${idNum}`,
    name: nextName,
    type: isPass ? 'human' : 'bot',
    avatarColor: AVATAR_COLORS[idx % AVATAR_COLORS.length],
  };

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

