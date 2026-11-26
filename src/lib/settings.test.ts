import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addLocalLobbySeat,
  buildDefaultPlayers,
  deriveLocalMode,
  removeLocalLobbySeat,
  sanitizeLocalLobbyConfig,
  updateLocalLobbyPlayer,
  validateLocalLobbyConfig,
  type LocalLobbyConfig,
} from './settings';

function makeLocalLobby(mode: 'bots' | 'pass-and-play', count: number): LocalLobbyConfig {
  return sanitizeLocalLobbyConfig({
    roomCode: 'LOCAL1',
    tableName: mode === 'pass-and-play' ? 'Living Room' : 'Practice Table',
    mode,
    visibility: 'private',
    capacity: count,
    difficulty: 'medium',
    players: buildDefaultPlayers(count, 'Ranjit', mode),
  });
}

describe('Local Lobby Seat-0 Guardrail & Mode Synchronization', () => {
  it('Seat 0 cannot be removed in Local Mode', () => {
    const lobby = makeLocalLobby('bots', 4);
    const afterAttempt = removeLocalLobbySeat(lobby, 0);

    assert.equal(afterAttempt.players.length, 4);
    assert.equal(afterAttempt.players[0].id, lobby.players[0].id);
    assert.equal(afterAttempt.players[0].type, 'human');
    assert.equal(afterAttempt.capacity, 4);
  });

  it('Seat 0 cannot be converted into a bot, while its name remains editable', () => {
    const lobby = makeLocalLobby('bots', 4);
    const converted = updateLocalLobbyPlayer(lobby, 0, { type: 'bot' });

    assert.equal(converted.players[0].type, 'human');
    assert.equal(converted.mode, 'bots');

    const renamed = updateLocalLobbyPlayer(lobby, 0, { name: 'Captain', type: 'bot' });
    assert.equal(renamed.players[0].name, 'Captain');
    assert.equal(renamed.players[0].type, 'human');
  });

  it('prevents starting a local game with zero human players or Seat 0 set to bot', () => {
    const zeroHumanConfig: LocalLobbyConfig = {
      roomCode: 'ZERO00',
      tableName: 'Invalid Table',
      mode: 'bots',
      visibility: 'private',
      capacity: 4,
      difficulty: 'easy',
      players: [
        { id: 'p1', name: 'Bot 1', type: 'bot' },
        { id: 'p2', name: 'Bot 2', type: 'bot' },
        { id: 'p3', name: 'Bot 3', type: 'bot' },
        { id: 'p4', name: 'Bot 4', type: 'bot' },
      ],
    };

    const resZero = validateLocalLobbyConfig(zeroHumanConfig);
    assert.equal(resZero.ok, false);

    // Even if another seat is human, Seat 0 as bot must be rejected
    const seat0BotConfig: LocalLobbyConfig = {
      ...zeroHumanConfig,
      players: [
        { id: 'p1', name: 'Bot 1', type: 'bot' },
        { id: 'p2', name: 'Human 2', type: 'human' },
      ],
      capacity: 2,
    };
    const resSeat0Bot = validateLocalLobbyConfig(seat0BotConfig);
    assert.equal(resSeat0Bot.ok, false);

    // Invalid player counts (<2 or >6) are also rejected
    const tooFew: LocalLobbyConfig = {
      ...zeroHumanConfig,
      capacity: 1,
      players: [{ id: 'p1', name: 'You', type: 'human' }],
    };
    assert.equal(validateLocalLobbyConfig(tooFew).ok, false);
  });

  it('removing human seats in Pass-and-Play down to 1 human automatically transitions mode to Practice vs Bots', () => {
    // Start with 3 humans + 1 bot (Pass-and-Play)
    let lobby = makeLocalLobby('pass-and-play', 4);
    lobby = updateLocalLobbyPlayer(lobby, 3, { type: 'bot', name: 'Bot Raju' });
    assert.equal(lobby.mode, 'pass-and-play');
    assert.equal(lobby.players.filter((p) => p.type === 'human').length, 3);

    // Remove one human (Seat 2) -> 2 humans + 1 bot -> still Pass-and-Play
    lobby = removeLocalLobbySeat(lobby, 2);
    assert.equal(lobby.players.length, 3);
    assert.equal(lobby.capacity, 3);
    assert.equal(lobby.mode, 'pass-and-play');

    // Remove the remaining extra human (Seat 1) -> 1 human + 1 bot -> MUST sync to 'bots' (Practice vs Bots)!
    lobby = removeLocalLobbySeat(lobby, 1);
    assert.equal(lobby.players.length, 2);
    assert.equal(lobby.capacity, 2);
    assert.equal(lobby.players[0].type, 'human');
    assert.equal(lobby.players[1].type, 'bot');
    assert.equal(lobby.mode, 'bots');

    const validation = validateLocalLobbyConfig(lobby);
    assert.equal(validation.ok, true);
    if (validation.ok) {
      assert.equal(validation.config.mode, 'bots');
    }
  });

  it('toggling other human seats to bots down to 1 human transitions mode to Practice vs Bots', () => {
    let lobby = makeLocalLobby('pass-and-play', 3);
    assert.equal(lobby.mode, 'pass-and-play');

    lobby = updateLocalLobbyPlayer(lobby, 1, { type: 'bot' });
    assert.equal(lobby.mode, 'pass-and-play');

    lobby = updateLocalLobbyPlayer(lobby, 2, { type: 'bot' });
    assert.equal(lobby.mode, 'bots');
    assert.equal(deriveLocalMode(lobby.players), 'bots');
  });

  it('preserves valid multi-human Pass-and-Play configurations and allows bots in seats 1..5 within 2–6 player limits', () => {
    let lobby = makeLocalLobby('pass-and-play', 2);
    assert.equal(lobby.mode, 'pass-and-play');

    // Add seats up to 6
    lobby = addLocalLobbySeat(lobby); // 3
    lobby = addLocalLobbySeat(lobby); // 4
    lobby = addLocalLobbySeat(lobby); // 5
    lobby = addLocalLobbySeat(lobby); // 6
    assert.equal(lobby.players.length, 6);
    assert.equal(lobby.capacity, 6);
    assert.equal(lobby.mode, 'pass-and-play');

    // Cannot exceed 6 seats
    const capped = addLocalLobbySeat(lobby);
    assert.equal(capped.players.length, 6);

    // Convert seats 2..5 into bots while keeping Seat 0 and Seat 1 human -> still Pass-and-Play!
    lobby = updateLocalLobbyPlayer(lobby, 2, { type: 'bot' });
    lobby = updateLocalLobbyPlayer(lobby, 3, { type: 'bot' });
    lobby = updateLocalLobbyPlayer(lobby, 4, { type: 'bot' });
    lobby = updateLocalLobbyPlayer(lobby, 5, { type: 'bot' });
    assert.equal(lobby.mode, 'pass-and-play');

    const validation = validateLocalLobbyConfig(lobby);
    assert.equal(validation.ok, true);
    if (validation.ok) {
      assert.equal(validation.config.mode, 'pass-and-play');
      assert.equal(validation.config.players.length, 6);
    }

    // Cannot remove below 2 players
    const twoPlayer = makeLocalLobby('bots', 2);
    const stillTwo = removeLocalLobbySeat(twoPlayer, 1);
    assert.equal(stillTwo.players.length, 2);
  });
});
