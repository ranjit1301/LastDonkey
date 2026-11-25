import type { PlayerConfig } from '../engine';
import type { RoomVisibility } from '../server/roomTypes';

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
  return Array.from({ length: count }, (_, idx) => {
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
