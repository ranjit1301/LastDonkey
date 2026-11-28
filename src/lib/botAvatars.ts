/**
 * Authoritative catalog of 12 original fictional Indian-inspired caricature bot avatars.
 * Pure TypeScript (zero React/DOM/image imports) so both Node server (roomManager.ts)
 * and browser UI components can share identical IDs, names, personalities, and colors.
 */

export interface BotAvatarProfile {
  readonly id: string;
  readonly name: string;
  readonly personality: string;
  readonly sheet: 1 | 2 | 3;
  readonly col: 0 | 1;
  readonly row: 0 | 1;
  readonly accentColor: string;
  readonly bgColor: string;
}

export const BOT_AVATAR_PROFILES: readonly BotAvatarProfile[] = [
  {
    id: 'chotu-chaiwala',
    name: 'Chotu Chaiwala',
    personality: 'Stylish and witty',
    sheet: 1,
    col: 0,
    row: 0,
    accentColor: '#D98E1F',
    bgColor: '#D9A024',
  },
  {
    id: 'surili',
    name: 'Surili',
    personality: 'Dramatic singer',
    sheet: 1,
    col: 1,
    row: 0,
    accentColor: '#D63B6B',
    bgColor: '#D93B6B',
  },
  {
    id: 'babloo-uncle',
    name: 'Babloo Uncle',
    personality: 'Overreacts to everything',
    sheet: 1,
    col: 0,
    row: 1,
    accentColor: '#E5B22B',
    bgColor: '#E7B429',
  },
  {
    id: 'rocky-raja',
    name: 'Rocky Raja',
    personality: 'Overconfident superstar',
    sheet: 1,
    col: 1,
    row: 1,
    accentColor: '#1B6685',
    bgColor: '#186382',
  },
  {
    id: 'gappu',
    name: 'Gappu',
    personality: 'Food-loving character',
    sheet: 2,
    col: 0,
    row: 0,
    accentColor: '#F39C2A',
    bgColor: '#F4A333',
  },
  {
    id: 'pappu-viral',
    name: 'Pappu Viral',
    personality: 'Funny and unpredictable',
    sheet: 2,
    col: 1,
    row: 0,
    accentColor: '#2CB5C9',
    bgColor: '#36B8C9',
  },
  {
    id: 'selfie-sona',
    name: 'Selfie Sona',
    personality: 'Loves attention',
    sheet: 2,
    col: 0,
    row: 1,
    accentColor: '#F48C72',
    bgColor: '#F5937A',
  },
  {
    id: 'wifi-baba',
    name: 'WiFi Baba',
    personality: 'Wise but quirky',
    sheet: 2,
    col: 1,
    row: 1,
    accentColor: '#946AD9',
    bgColor: '#9872DA',
  },
  {
    id: 'kallu-kaka',
    name: 'Kallu Kaka',
    personality: 'Friendly and cheerful',
    sheet: 3,
    col: 0,
    row: 0,
    accentColor: '#3BA366',
    bgColor: '#48B173',
  },
  {
    id: 'mishra-ji',
    name: 'Mishra Ji',
    personality: 'Knows everything',
    sheet: 3,
    col: 1,
    row: 0,
    accentColor: '#D7A561',
    bgColor: '#E3B474',
  },
  {
    id: 'dhamaka-don',
    name: 'Dhamaka Don',
    personality: 'Overconfident entertainer',
    sheet: 3,
    col: 0,
    row: 1,
    accentColor: '#8B2349',
    bgColor: '#8A2347',
  },
  {
    id: 'hasmukh-didi',
    name: 'Hasmukh Didi',
    personality: 'Laughs at everything',
    sheet: 3,
    col: 1,
    row: 1,
    accentColor: '#EE9B12',
    bgColor: '#EE9A11',
  },
] as const;

export const BOT_AVATAR_NAMES: readonly string[] = BOT_AVATAR_PROFILES.map((p) => p.name);

const PROFILE_BY_ID = new Map<string, BotAvatarProfile>(
  BOT_AVATAR_PROFILES.map((p) => [p.id, p])
);

const PROFILE_BY_NAME_LOWER = new Map<string, BotAvatarProfile>(
  BOT_AVATAR_PROFILES.map((p) => [p.name.toLowerCase(), p])
);

export function getBotAvatarById(id?: string | null): BotAvatarProfile | null {
  if (!id) return null;
  return PROFILE_BY_ID.get(id) ?? null;
}

export function getBotAvatarByName(name?: string | null): BotAvatarProfile | null {
  if (!name) return null;
  return PROFILE_BY_NAME_LOWER.get(name.trim().toLowerCase()) ?? null;
}

export function isBotAvatarName(name?: string | null): boolean {
  return getBotAvatarByName(name) !== null;
}

export function isValidCharacterAvatarId(id?: string | null): boolean {
  return getBotAvatarById(id) !== null;
}

/**
 * Resolves the character avatar profile for any player or seat (both human and bot):
 * - Explicit `avatarId` / `botAvatarId` works for BOTH human and bot players.
 * - Name-based and deterministic hash fallbacks apply strictly to bots so a human
 *   without an assigned character never accidentally matches a bot by display name.
 */
export function resolveCharacterAvatar(player: {
  type?: 'human' | 'bot';
  avatarId?: string | null;
  botAvatarId?: string | null;
  name?: string | null;
  id?: string | null;
}): BotAvatarProfile | null {
  const explicitId = player.avatarId ?? player.botAvatarId;
  const byId = getBotAvatarById(explicitId);
  if (byId) return byId;

  if (player.type === 'human') {
    return null;
  }

  const byName = getBotAvatarByName(player.name);
  if (byName) return byName;

  // Deterministic fallback for legacy/custom-named bots so they still show a stable caricature
  const seed = (player.id || player.name || 'bot').trim();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return BOT_AVATAR_PROFILES[hash % BOT_AVATAR_PROFILES.length];
}

/**
 * Backward-compatible alias for resolving character avatars.
 * Matches explicit avatarId/botAvatarId for both humans and bots; falls back by name/hash only for bots.
 */
export function resolveBotAvatar(player: {
  type?: 'human' | 'bot';
  avatarId?: string | null;
  botAvatarId?: string | null;
  name?: string | null;
  id?: string | null;
}): BotAvatarProfile | null {
  return resolveCharacterAvatar(player);
}

export interface PickBotAvatarOptions {
  usedAvatarIds?: Iterable<string | null | undefined>;
  usedNames?: Iterable<string | null | undefined>;
  rng?: () => number;
}

export interface PickCharacterAvatarOptions extends PickBotAvatarOptions {
  /** Saved avatar ID from a future registered player profile (highest precedence when valid & unused) */
  savedAvatarId?: string | null;
  /** Guest-chosen avatar ID from pre-join selection or localStorage */
  preferredAvatarId?: string | null;
}

export interface PickCharacterAvatarResult {
  profile: BotAvatarProfile;
  /** True when the player explicitly requested an avatar that was already taken in the room */
  wasReassigned: boolean;
}

/**
 * Picks a random unique bot avatar profile not currently in use in the room/lobby.
 * Avoids both duplicate avatar IDs and case-insensitive collisions with existing player names.
 */
export function pickUniqueBotAvatar(options: PickBotAvatarOptions = {}): BotAvatarProfile {
  const rng = options.rng ?? Math.random;
  const usedIds = new Set<string>();
  if (options.usedAvatarIds) {
    for (const id of options.usedAvatarIds) {
      if (id) usedIds.add(id);
    }
  }

  const usedNamesLower = new Set<string>();
  if (options.usedNames) {
    for (const name of options.usedNames) {
      if (name && name.trim()) {
        usedNamesLower.add(name.trim().toLowerCase());
      }
    }
  }

  const strictCandidates = BOT_AVATAR_PROFILES.filter(
    (p) => !usedIds.has(p.id) && !usedNamesLower.has(p.name.toLowerCase())
  );
  if (strictCandidates.length > 0) {
    const idx = Math.floor(rng() * strictCandidates.length) % strictCandidates.length;
    return strictCandidates[idx];
  }

  const idCandidates = BOT_AVATAR_PROFILES.filter((p) => !usedIds.has(p.id));
  if (idCandidates.length > 0) {
    const idx = Math.floor(rng() * idCandidates.length) % idCandidates.length;
    return idCandidates[idx];
  }

  const fallbackIdx = Math.floor(rng() * BOT_AVATAR_PROFILES.length) % BOT_AVATAR_PROFILES.length;
  return BOT_AVATAR_PROFILES[fallbackIdx];
}

/**
 * Resolves a unique character avatar for a human or bot seat:
 * 1. Honors registered `savedAvatarId` (future account integration) if valid and unused in the room.
 * 2. Honors guest `preferredAvatarId` if valid and unused in the room.
 * 3. Otherwise automatically assigns an unused character from the 12-avatar pool.
 */
export function pickUniqueCharacterAvatar(
  options: PickCharacterAvatarOptions = {}
): PickCharacterAvatarResult {
  const usedIds = new Set<string>();
  if (options.usedAvatarIds) {
    for (const id of options.usedAvatarIds) {
      if (id) usedIds.add(id);
    }
  }

  const requestedProfile =
    getBotAvatarById(options.savedAvatarId) ?? getBotAvatarById(options.preferredAvatarId);

  if (requestedProfile && !usedIds.has(requestedProfile.id)) {
    return { profile: requestedProfile, wasReassigned: false };
  }

  const assigned = pickUniqueBotAvatar({
    usedAvatarIds: usedIds,
    usedNames: options.usedNames,
    rng: options.rng,
  });

  return {
    profile: assigned,
    wasReassigned: Boolean(requestedProfile && requestedProfile.id !== assigned.id),
  };
}

/**
 * Picks `count` unique bot avatar profiles in one pass (guarantees zero duplicates up to 12).
 */
export function pickUniqueBotAvatars(
  count: number,
  options: PickBotAvatarOptions = {}
): BotAvatarProfile[] {
  const usedIds = new Set<string>();
  if (options.usedAvatarIds) {
    for (const id of options.usedAvatarIds) {
      if (id) usedIds.add(id);
    }
  }
  const usedNames = new Set<string>();
  if (options.usedNames) {
    for (const name of options.usedNames) {
      if (name && name.trim()) usedNames.add(name.trim().toLowerCase());
    }
  }

  const picked: BotAvatarProfile[] = [];
  for (let i = 0; i < count; i++) {
    const profile = pickUniqueBotAvatar({
      usedAvatarIds: usedIds,
      usedNames,
      rng: options.rng,
    });
    picked.push(profile);
    usedIds.add(profile.id);
    usedNames.add(profile.name.toLowerCase());
  }
  return picked;
}
