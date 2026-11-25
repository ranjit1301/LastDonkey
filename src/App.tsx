/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  chooseRandomLegalCard,
  continueAfterTrick,
  createInitialGameState,
  formatCard,
  handleMissedTurn,
  playCard,
  removePlayerAndRedistribute,
  type GameState,
} from './engine';
import {
  playCardSound,
  playDealSound,
  playGameOverSound,
  playTrickFailedSound,
  playTrickSuccessSound,
} from './lib/audio';
import { MultiplayerClient } from './lib/multiplayerClient';
import {
  buildDefaultPlayers,
  generateRoomCode,
  getBotDelayMs,
  getTrickAutoAdvanceMs,
  loadSettings,
  saveSettings,
  type AppSettings,
  type LocalLobbyConfig,
} from './lib/settings';
import type { ClientRoomState, RoomNotification } from './server/roomTypes';
import { CardTableScreen } from './screens/CardTableScreen';
import { CreateGameScreen, type CreateRoomMode } from './screens/CreateGameScreen';
import { GameLobbyScreen } from './screens/GameLobbyScreen';
import { GameResultsScreen } from './screens/GameResultsScreen';
import { HowToPlayScreen } from './screens/HowToPlayScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { OfflineIndicator } from './components/OfflineIndicator';
import { WelcomeScreen } from './screens/WelcomeScreen';

type AppScreen = 'welcome' | 'create' | 'lobby' | 'table' | 'results' | 'rules' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('welcome');
  const [returnScreen, setReturnScreen] = useState<AppScreen>('welcome');
  const [createInitialMode, setCreateInitialMode] = useState<CreateRoomMode>('online');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Incoming URL invitation params (?room=XXXXXX&invite=TOKEN)
  const [incomingInvite, setIncomingInvite] = useState<{
    roomCode: string;
    inviteToken?: string;
  } | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    const invite = params.get('invite') ?? undefined;
    if (room && room.trim().length > 0) {
      return { roomCode: room.trim().toUpperCase(), inviteToken: invite };
    }
    return null;
  });

  // Local offline Practice / Pass-and-Play state
  const [localLobby, setLocalLobby] = useState<LocalLobbyConfig>(() => ({
    roomCode: generateRoomCode(),
    tableName: 'Practice Table',
    mode: 'bots',
    visibility: 'private',
    capacity: 4,
    players: buildDefaultPlayers(4, 'You', 'bots'),
  }));
  const [localGame, setLocalGame] = useState<GameState | null>(null);

  // Authoritative Online Multiplayer state
  const [onlineRoom, setOnlineRoom] = useState<ClientRoomState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'reconnecting' | 'disconnected'
  >('disconnected');
  const [toasts, setToasts] = useState<RoomNotification[]>([]);
  const [homeError, setHomeError] = useState<string | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const prevOnlinePhaseRef = useRef<string | null>(null);
  const prevOnlinePlaysRef = useRef<number>(0);

  const pushToast = useCallback(
    (kind: RoomNotification['kind'], message: string) => {
      const note: RoomNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        message,
        timestamp: Date.now(),
      };
      setToasts((prev) => [...prev.slice(-2), note]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== note.id));
      }, 3600);
    },
    []
  );

  // Persistent WebSocket client instance
  const mpClientRef = useRef<MultiplayerClient | null>(null);
  useEffect(() => {
    const client = new MultiplayerClient({
      onRoomState: (room) => {
        setHomeError(null);
        setOnlineRoom(room);

        // Trigger subtle audio cues on authoritative state transitions
        const soundOn = settingsRef.current.soundEnabled;
        const phase = room.gameState?.phase ?? null;
        const playsCount = room.gameState?.currentTrick.plays.length ?? 0;

        if (phase === 'finished' && prevOnlinePhaseRef.current !== 'finished') {
          playGameOverSound(soundOn);
        } else if (phase === 'trick_result' && prevOnlinePhaseRef.current !== 'trick_result') {
          if (room.gameState?.lastOutcome?.type === 'failed') {
            playTrickFailedSound(soundOn);
          } else {
            playTrickSuccessSound(soundOn);
          }
        } else if (phase === 'playing' && playsCount > prevOnlinePlaysRef.current) {
          playCardSound(soundOn);
        } else if (
          room.status === 'playing' &&
          prevOnlinePhaseRef.current === null
        ) {
          playDealSound(soundOn);
        }

        prevOnlinePhaseRef.current = phase;
        prevOnlinePlaysRef.current = playsCount;

        setScreen((curr) => {
          if (curr === 'rules' || curr === 'settings') return curr;
          if (room.status === 'waiting') return 'lobby';
          if (room.status === 'playing') return 'table';
          if (room.status === 'finished') return 'results';
          return 'welcome';
        });
      },
      onNotification: (note) => {
        pushToast(note.kind, note.message);
      },
      onError: (msg) => {
        pushToast('error', msg);
        setHomeError(msg);
      },
      onRoomClosed: (reason) => {
        setOnlineRoom(null);
        prevOnlinePhaseRef.current = null;
        prevOnlinePlaysRef.current = 0;
        setHomeError(reason);
        pushToast('warning', reason);
        setScreen('welcome');
      },
      onConnectionChange: (status) => {
        setConnectionStatus(status);
      },
    });

    mpClientRef.current = client;
    return () => {
      client.disconnect();
    };
  }, [pushToast]);

  const updateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const openRulesFrom = (from: AppScreen) => {
    setReturnScreen(from);
    setScreen('rules');
  };

  const openSettingsFrom = (from: AppScreen) => {
    setReturnScreen(from);
    setScreen('settings');
  };

  // =========================================================================
  // LOCAL OFFLINE PRACTICE / PASS-AND-PLAY ACTIONS
  // =========================================================================
  const startLocalMatch = useCallback((config: LocalLobbyConfig) => {
    setOnlineRoom(null);
    setLocalLobby(config);
    const fresh = createInitialGameState(config.players);
    setLocalGame(fresh);
    setScreen('table');
    playDealSound(settingsRef.current.soundEnabled);
  }, []);

  const handleLocalPlayCard = useCallback((playerId: string, cardId: string) => {
    setLocalGame((prev) => {
      if (!prev || prev.phase !== 'playing') return prev;
      const res = playCard(prev, playerId, cardId, { isAutoPlay: false });
      if (!res.ok) return prev;
      const soundOn = settingsRef.current.soundEnabled;
      const next = res.state;
      if (next.phase === 'finished') playGameOverSound(soundOn);
      else if (next.phase === 'trick_result' && next.lastOutcome) {
        if (next.lastOutcome.type === 'success') playTrickSuccessSound(soundOn);
        else playTrickFailedSound(soundOn);
      } else {
        playCardSound(soundOn);
      }
      return next;
    });
  }, []);

  const handleLocalMissedTurn = useCallback(
    (playerId: string) => {
      setLocalGame((prev) => {
        if (!prev || prev.phase !== 'playing') return prev;
        const player = prev.players.find((p) => p.id === playerId);
        const res = handleMissedTurn(prev, playerId);
        if (!res.ok) return prev;

        const soundOn = settingsRef.current.soundEnabled;
        if (res.action === 'auto_played' && res.autoPlayedCard) {
          pushToast(
            'warning',
            `Time’s up (${res.missedCount}/3) — auto-played ${formatCard(res.autoPlayedCard)} for ${player?.name ?? 'Player'}.`
          );
        } else if (res.action === 'removed_and_redistributed') {
          pushToast(
            'error',
            `${player?.name ?? 'Player'} was removed after 3 missed turns. Cards redistributed clockwise.`
          );
        }

        const next = res.state;
        if (next.phase === 'finished') playGameOverSound(soundOn);
        else if (next.phase === 'trick_result' && next.lastOutcome) {
          if (next.lastOutcome.type === 'success') playTrickSuccessSound(soundOn);
          else playTrickFailedSound(soundOn);
        } else {
          playCardSound(soundOn);
        }
        return next;
      });
    },
    [pushToast]
  );

  const handleLocalVoluntaryExit = useCallback(() => {
    if (!localGame) {
      setScreen('lobby');
      return;
    }
    const humanSeat = localGame.players.find((p) => p.type === 'human' && !p.removed && !p.finished);
    if (!humanSeat) {
      setLocalGame(null);
      setScreen('lobby');
      return;
    }
    const res = removePlayerAndRedistribute(localGame, humanSeat.id, 'voluntary_exit');
    if (!res.ok) {
      pushToast('warning', res.error);
      return;
    }
    pushToast(
      'info',
      `Exited between tricks. ${res.state.lastRedistribution?.cardsDistributedCount ?? 0} cards redistributed.`
    );
    setLocalGame(null);
    setScreen('lobby');
  }, [localGame, pushToast]);

  const handleLocalContinueTrick = useCallback(() => {
    setLocalGame((prev) => {
      if (!prev || prev.phase !== 'trick_result') return prev;
      return continueAfterTrick(prev);
    });
  }, []);

  // Local random-play bots automation
  useEffect(() => {
    if (onlineRoom || screen !== 'table' || !localGame || localGame.phase !== 'playing') return;
    const turnId = localGame.currentTurnPlayerId;
    if (!turnId) return;
    const current = localGame.players.find((p) => p.id === turnId);
    if (!current || current.type !== 'bot') return;

    const timer = window.setTimeout(() => {
      const card = chooseRandomLegalCard(localGame, current.id);
      if (card) {
        setLocalGame((prev) => {
          if (!prev || prev.phase !== 'playing' || prev.currentTurnPlayerId !== current.id) {
            return prev;
          }
          const res = playCard(prev, current.id, card.id, { isAutoPlay: true });
          if (!res.ok) return prev;
          const soundOn = settingsRef.current.soundEnabled;
          const next = res.state;
          if (next.phase === 'finished') playGameOverSound(soundOn);
          else if (next.phase === 'trick_result' && next.lastOutcome) {
            if (next.lastOutcome.type === 'success') playTrickSuccessSound(soundOn);
            else playTrickFailedSound(soundOn);
          } else {
            playCardSound(soundOn);
          }
          return next;
        });
      }
    }, getBotDelayMs(settings.gameSpeed));

    return () => window.clearTimeout(timer);
  }, [onlineRoom, screen, localGame, settings.gameSpeed]);

  // Local auto-advance after trick banner
  const localTrickDurationMs = getTrickAutoAdvanceMs(
    settings.gameSpeed,
    localGame?.lastOutcome?.type === 'failed'
  );

  useEffect(() => {
    if (
      onlineRoom ||
      screen !== 'table' ||
      !localGame ||
      localGame.phase !== 'trick_result' ||
      !settings.autoAdvanceTricks
    ) {
      return;
    }
    const timer = window.setTimeout(handleLocalContinueTrick, localTrickDurationMs);
    return () => window.clearTimeout(timer);
  }, [
    onlineRoom,
    screen,
    localGame,
    settings.autoAdvanceTricks,
    localTrickDurationMs,
    handleLocalContinueTrick,
  ]);

  // Local transition to results screen
  useEffect(() => {
    if (onlineRoom || screen !== 'table' || !localGame || localGame.phase !== 'finished') return;
    const timer = window.setTimeout(() => setScreen('results'), 650);
    return () => window.clearTimeout(timer);
  }, [onlineRoom, screen, localGame]);

  // =========================================================================
  // ONLINE MULTIPLAYER ACTIONS
  // =========================================================================
  const leaveOnlineCompletely = () => {
    mpClientRef.current?.send({ type: 'leave_room' });
    mpClientRef.current?.disconnect();
    setOnlineRoom(null);
    prevOnlinePhaseRef.current = null;
    prevOnlinePlaysRef.current = 0;
    setScreen('welcome');
  };

  // Clear invite URL params once used
  const clearInviteParams = () => {
    setIncomingInvite(null);
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  // Global compact toast notifications (Section 22) + PWA Offline Indicator
  const toastOverlay = (
    <>
      <OfflineIndicator />
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-20 sm:bottom-6 z-50 flex flex-col items-center gap-2 px-4"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`max-w-md rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-semibold shadow-lg border ${
                t.kind === 'error'
                  ? 'bg-[#3A1414] text-[#FDE8E8] border-[#E05252]/60'
                  : t.kind === 'warning'
                    ? 'bg-[#3D2B08] text-[#FEF3C7] border-[#F0B429]/60'
                    : t.kind === 'success'
                      ? 'bg-[#143D24] text-[#ECFDF3] border-[#6EE7B7]/45'
                      : 'bg-[#261E18] text-[#FAF5ED] border-white/15'
              }`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </>
  );

  // =========================================================================
  // SCREEN ROUTING
  // =========================================================================
  if (screen === 'welcome') {
    return (
      <>
        <WelcomeScreen
          initialPlayerName={settings.playerName}
          incomingInvite={incomingInvite}
          onClearIncomingInvite={clearInviteParams}
          onSavePlayerName={(playerName) => updateSettings({ ...settings, playerName })}
          onOpenCreateRoom={(playerName) => {
            updateSettings({ ...settings, playerName });
            setCreateInitialMode('online');
            setScreen('create');
          }}
          onOpenPractice={(playerName) => {
            updateSettings({ ...settings, playerName });
            const cfg: LocalLobbyConfig = {
              roomCode: generateRoomCode(),
              tableName: 'Practice vs Bots',
              mode: 'bots',
              visibility: 'private',
              capacity: 4,
              players: buildDefaultPlayers(4, playerName, 'bots'),
            };
            setOnlineRoom(null);
            setLocalLobby(cfg);
            setScreen('lobby');
          }}
          onOpenPassAndPlay={(playerName) => {
            updateSettings({ ...settings, playerName });
            setCreateInitialMode('pass-and-play');
            setScreen('create');
          }}
          onJoinOnlineRoom={({ roomCode, playerName, inviteToken }) => {
            updateSettings({ ...settings, playerName });
            setLocalGame(null);
            mpClientRef.current?.send({
              type: 'join_room',
              roomCode,
              playerName,
              inviteToken,
            });
          }}
          onHowToPlay={() => openRulesFrom('welcome')}
          onSettings={() => openSettingsFrom('welcome')}
          externalError={homeError}
          onDismissError={() => setHomeError(null)}
        />
        {toastOverlay}
      </>
    );
  }

  if (screen === 'create') {
    return (
      <>
        <CreateGameScreen
          initialMode={createInitialMode}
          initialPlayerName={settings.playerName}
          defaultTurnTimer={settings.turnTimerSeconds}
          onBack={() => setScreen('welcome')}
          onCreateOnlineRoom={(params) => {
            updateSettings({ ...settings, playerName: params.playerName });
            setLocalGame(null);
            mpClientRef.current?.send({
              type: 'create_room',
              playerName: params.playerName,
              tableName: params.tableName,
              capacity: params.capacity,
              visibility: params.visibility,
              turnTimerSeconds: params.turnTimerSeconds,
            });
          }}
          onCreateLocalLobby={(cfg) => {
            setOnlineRoom(null);
            setLocalLobby(cfg);
            setScreen('lobby');
          }}
        />
        {toastOverlay}
      </>
    );
  }

  if (screen === 'lobby') {
    return (
      <>
        <GameLobbyScreen
          onlineRoom={onlineRoom}
          localConfig={onlineRoom ? null : localLobby}
          onUpdateLocalConfig={setLocalLobby}
          onStartLocalGame={startLocalMatch}
          onLeave={() => {
            if (onlineRoom) {
              leaveOnlineCompletely();
            } else {
              setScreen('welcome');
            }
          }}
          onOnlineAddBot={() => mpClientRef.current?.send({ type: 'add_bot' })}
          onOnlineRemoveSeat={(targetPlayerId) =>
            mpClientRef.current?.send({ type: 'remove_seat', targetPlayerId })
          }
          onOnlineStartGame={() => mpClientRef.current?.send({ type: 'start_game' })}
          onOnlineCancelRoom={() => mpClientRef.current?.send({ type: 'cancel_room' })}
          onOnlineRevokeInvite={() => mpClientRef.current?.send({ type: 'revoke_invite' })}
          onOnlineRegenerateCode={() => mpClientRef.current?.send({ type: 'regenerate_code' })}
          onOnlineRequestHostTransfer={(targetPlayerId) =>
            mpClientRef.current?.send({ type: 'transfer_host_request', targetPlayerId })
          }
          onOnlineRespondHostTransfer={(accept) =>
            mpClientRef.current?.send({ type: 'transfer_host_respond', accept })
          }
        />
        {toastOverlay}
      </>
    );
  }

  if (screen === 'table') {
    const activeGameState = onlineRoom?.gameState ?? localGame;
    if (activeGameState) {
      return (
        <>
          <CardTableScreen
            gameState={activeGameState}
            settings={settings}
            roomCode={onlineRoom ? onlineRoom.roomCode : localLobby.roomCode}
            isOnline={Boolean(onlineRoom)}
            onlineRoom={onlineRoom}
            connectionStatus={connectionStatus}
            trickNotificationDurationMs={
              onlineRoom
                ? activeGameState.lastOutcome?.type === 'failed'
                  ? 2100
                  : 1500
                : localTrickDurationMs
            }
            onPlayCard={(playerId, cardId) => {
              if (onlineRoom) {
                mpClientRef.current?.send({ type: 'play_card', cardId });
              } else {
                handleLocalPlayCard(playerId, cardId);
              }
            }}
            onLocalMissedTurn={handleLocalMissedTurn}
            onContinueTrick={handleLocalContinueTrick}
            onToggleSound={() =>
              updateSettings({ ...settings, soundEnabled: !settings.soundEnabled })
            }
            onToggleOpenHands={() =>
              updateSettings({ ...settings, openHandsTesting: !settings.openHandsTesting })
            }
            onOpenRules={() => openRulesFrom('table')}
            onOpenSettings={() => openSettingsFrom('table')}
            onVoluntaryExit={() => {
              if (onlineRoom) {
                mpClientRef.current?.send({ type: 'voluntary_exit' });
                mpClientRef.current?.disconnect();
                setOnlineRoom(null);
                setScreen('welcome');
              } else {
                handleLocalVoluntaryExit();
              }
            }}
            onOnlineRespondHostTransfer={(accept) =>
              mpClientRef.current?.send({ type: 'transfer_host_respond', accept })
            }
          />
          {toastOverlay}
        </>
      );
    }
  }

  if (screen === 'results') {
    const activeGameState = onlineRoom?.gameState ?? localGame;
    if (activeGameState) {
      return (
        <>
          <GameResultsScreen
            gameState={activeGameState}
            onlineRoom={onlineRoom}
            onLocalPlayAgain={() => startLocalMatch(localLobby)}
            onBackToLobby={() => {
              setLocalGame(null);
              setScreen('lobby');
            }}
            onMainMenu={() => {
              if (onlineRoom) {
                leaveOnlineCompletely();
              } else {
                setLocalGame(null);
                setScreen('welcome');
              }
            }}
            onOnlineRequestRematch={() => mpClientRef.current?.send({ type: 'rematch_request' })}
            onOnlineRespondRematch={(accept) =>
              mpClientRef.current?.send({ type: 'rematch_respond', accept })
            }
            onOnlineStartRematch={() => mpClientRef.current?.send({ type: 'rematch_start' })}
          />
          {toastOverlay}
        </>
      );
    }
  }

  if (screen === 'rules') {
    return (
      <>
        <HowToPlayScreen
          onBack={() => setScreen(returnScreen)}
          backLabel={returnScreen === 'table' ? 'Return to Table' : 'Back'}
        />
        {toastOverlay}
      </>
    );
  }

  return (
    <>
      <SettingsScreen
        settings={settings}
        onUpdate={updateSettings}
        onBack={() => setScreen(returnScreen)}
        backLabel={returnScreen === 'table' ? 'Return to Table' : 'Back'}
      />
      {toastOverlay}
    </>
  );
}
