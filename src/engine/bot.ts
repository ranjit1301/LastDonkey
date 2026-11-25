import { getLegalCards } from './rules';
import type { Card, GameState } from './types';

/**
 * Random legal card selection for bots and timeout auto-play (Sections 11 & 12).
 * - Never inspects hidden hands belonging to other players.
 * - Does not predict winners or track opponent cards.
 * - Always strictly obeys legal game rules:
 *   - Must play A♠ on Turn 1.
 *   - Must choose randomly from cards matching led suit if held.
 *   - Otherwise chooses randomly from the entire hand.
 */
export function chooseRandomLegalCard(
  state: GameState,
  playerId: string,
  rng: () => number = Math.random
): Card | null {
  const legal = getLegalCards(state, playerId);
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0];
  const idx = Math.floor(rng() * legal.length);
  return legal[Math.min(idx, legal.length - 1)];
}

/**
 * Alias preserved for compatibility with existing callers.
 */
export function chooseBotCard(
  state: GameState,
  botId: string,
  _difficulty?: string,
  rng: () => number = Math.random
): Card | null {
  return chooseRandomLegalCard(state, botId, rng);
}
