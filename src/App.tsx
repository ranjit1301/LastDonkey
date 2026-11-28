/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Home, Layers, Loader2, RefreshCw } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import {
  chooseBotCard,
  continueAfterTrick,
  createInitialGameState,
  formatCard,
  handleMissedTurn,
  playCard,
  type GameState,
} from './engine';
import { executeLocalVoluntaryExit } from './lib/localExit';
import { computeOverlayTurnAlert } from './lib/turnTimer';
import {
  playCardSound,
  playDealSound,
  playGameOverSound,
  playTrickFailedSound,
  playTrickSuccessSound,
} from './lib/audio';
import {
  MultiplayerClient,
  type ConnectionStatusInfo,
} from './lib/multiplayerClient';
import { MultiTabSessionCoordinator } from './lib/multiTabSession';
import {
  buildDefaultPlayers,
  generateRoomCode,
  getBotDelayMs,
  getTrickAutoAdvanceMs,
  loadSettings,
  sanitizeLocalLobbyConfig,
  saveSettings,
  validateLocalLobbyConfig,
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

interface MultiTabConflictState {
  mode: 'duplicate_detected' | 'superseded';
  roomCode: string;
  fingerprint: string;
  message: string;
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('welcome');
  const [returnScreen, setReturnScreen] = useState<AppScreen>('welcome');
  const [tableOverlay, setTableOverlay] = useState<'rules' | 'settings' | null>(null);
  const [localTurnDeadlineAt, setLocalTurnDeadlineAt] = useState<number | null>(null);
  const [overlayNowMs, setOverlayNowMs] = useState(() => Date.now());
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
  const [localLobby, setLocalLobby] = useState<LocalLobbyConfig>(() => {
    const initial = loadSettings();
    return {
      roomCode: generateRoomCode(),
      tableName: 'Practice Table',
      mode: 'bots',
      visibility: 'private',
      capacity: 4,
      difficulty: initial.defaultDifficulty,
      players: buildDefaultPlayers(4, 'You', 'bots', Math.random, initial.selectedAvatarId || undefined),
    };
  });
  const [localGame, setLocalGame] = useState<GameState | null>(null);
  const [practiceEndedEarly, setPracticeEndedEarly] = useState(false);

  // Authoritative Online Multiplayer state
  const [onlineRoom, setOnlineRoom] = useState<ClientRoomState | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionStatusInfo>({
    status: 'disconnected',
    attempt: 0,
  });
  const [restoringRoomCode, setRestoringRoomCode] = useState<string | null>(null);
  const [multiTabConflict, setMultiTabConflict] = useState<MultiTabConflictState | null>(null);
  const [toasts, setToasts] = useState<RoomNotification[]>([]);
  const [homeError, setHomeError] = useState<string | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const prevOnlinePhaseRef = useRef<string | null>(null);
  const prevOnlinePlaysRef = useRef<number>(0);
  const onlineRoomRef = useRef<ClientRoomState | null>(null);
  onlineRoomRef.current = onlineRoom;
  const localGameRef = useRef<GameState | null>(null);
  localGameRef.current = localGame;
  const exitPendingRef = useRef<boolean>(false);
  const leaveFallbackTimerRef = useRef<number | null>(null);
  const initialInviteRef = useRef(incomingInvite);
  const lastToastRef = useRef<{ message: string; at: number } | null>(null);

  const pushToast = useCallback(
    (kind: RoomNotification['kind'], message: string) => {
      const now = Date.now();
      const prevToast = lastToastRef.current;
      // Deduplicate identical messages fired in rapid succession (e.g., during reconnect bursts)
      if (prevToast && prevToast.message === message && now - prevToast.at < 2500) {
        return;
      }
      lastToastRef.current = { message, at: now };

      const note: RoomNotification = {
        id: `${now}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        message,
        timestamp: now,
      };
      setToasts((prev) => [...prev.slice(-2), note]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== note.id));
      }, 3600);
    },
    []
  );

  // Persistent WebSocket client & cross-tab session coordinator
  const mpClientRef = useRef<MultiplayerClient | null>(null);
  const tabCoordinatorRef = useRef<MultiTabSessionCoordinator | null>(null);

  useEffect(() => {
    let cancelled = false;
    const clearLeaveFallback = () => {
      if (leaveFallbackTimerRef.current !== null) {
        window.clearTimeout(leaveFallbackTimerRef.current);
        leaveFallbackTimerRef.current = null;
      }
    };

    const coordinator = new MultiTabSessionCoordinator({
      onSuperseded: ({ fingerprint }) => {
        if (cancelled) return;
        const meta = mpClientRef.current?.getStoredSessionMeta();
        const activeCode = onlineRoomRef.current?.roomCode ?? meta?.roomCode ?? '';
        const message = 'This game session was opened in another browser tab.';
        mpClientRef.current?.markSupersededByOtherTab(message);
        setRestoringRoomCode(null);
        setTableOverlay(null);
        setMultiTabConflict({
          mode: 'superseded',
          roomCode: activeCode,
          fingerprint,
          message,
        });
      },
    });
    tabCoordinatorRef.current = coordinator;

    const client = new MultiplayerClient({
      onSessionEstablished: (meta) => {
        coordinator.claimOwnership(meta.fingerprint);
        setMultiTabConflict(null);
        setRestoringRoomCode(null);
      },
      onRoomState: (room) => {
        setHomeError(null);
        setRestoringRoomCode(null);
        setMultiTabConflict(null);
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

        if (room.status !== 'playing') {
          setTableOverlay(null);
        }

        setScreen((curr) => {
          if (curr === 'rules' || curr === 'settings') return curr;
          if (room.status === 'waiting') return 'lobby';
          if (room.status === 'playing') return 'table';
          if (room.status === 'finished') return 'results';
          return 'welcome';
        });
      },
      onReconnected: () => {
        pushToast('success', 'Reconnected! Your seat and game state are synced.');
      },
      onNotification: (note) => {
        pushToast(note.kind, note.message);
      },
      onError: (msg) => {
        exitPendingRef.current = false;
        clearLeaveFallback();
        setRestoringRoomCode(null);
        pushToast('error', msg);
        if (!onlineRoomRef.current) {
          setHomeError(msg);
        }
      },
      onSessionActiveElsewhere: ({ roomCode, message }) => {
        coordinator.releaseOwnership();
        setRestoringRoomCode(null);
        const meta = client.getStoredSessionMeta();
        setMultiTabConflict({
          mode: 'duplicate_detected',
          roomCode: roomCode || meta?.roomCode || '',
          fingerprint: meta?.fingerprint ?? '',
          message:
            message ||
            'This seat is already open in another tab or window. Choose whether to switch control here.',
        });
      },
      onSessionSuperseded: ({ roomCode, message }) => {
        coordinator.releaseOwnership();
        setRestoringRoomCode(null);
        setTableOverlay(null);
        const meta = client.getStoredSessionMeta();
        setMultiTabConflict({
          mode: 'superseded',
          roomCode: roomCode || onlineRoomRef.current?.roomCode || meta?.roomCode || '',
          fingerprint: meta?.fingerprint ?? '',
          message:
            message || 'Your seat was moved to another tab or window.',
        });
      },
      onLeftRoom: (reason, message) => {
        exitPendingRef.current = false;
        clearLeaveFallback();
        coordinator.releaseOwnership();
        setRestoringRoomCode(null);
        setMultiTabConflict(null);
        setTableOverlay(null);
        setOnlineRoom(null);
        prevOnlinePhaseRef.current = null;
        prevOnlinePlaysRef.current = 0;
        if (reason === 'kicked') {
          const kickMsg = message ?? 'You were removed from the lobby by the host.';
          setHomeError(kickMsg);
          pushToast('warning', kickMsg);
        } else if (message) {
          pushToast('info', message);
        }
        setScreen('welcome');
      },
      onSessionExpired: (reason) => {
        exitPendingRef.current = false;
        clearLeaveFallback();
        coordinator.releaseOwnership();
        setRestoringRoomCode(null);
        setMultiTabConflict(null);
        setTableOverlay(null);
        const wasInRoom = onlineRoomRef.current !== null;
        setOnlineRoom(null);
        prevOnlinePhaseRef.current = null;
        prevOnlinePlaysRef.current = 0;
        setHomeError(reason);
        if (wasInRoom) {
          pushToast('warning', reason);
        }
        setScreen('welcome');
      },
      onRoomClosed: (reason) => {
        exitPendingRef.current = false;
        clearLeaveFallback();
        coordinator.releaseOwnership();
        setRestoringRoomCode(null);
        setMultiTabConflict(null);
        setTableOverlay(null);
        setOnlineRoom(null);
        prevOnlinePhaseRef.current = null;
        prevOnlinePlaysRef.current = 0;
        setHomeError(reason);
        pushToast('warning', reason);
        setScreen('welcome');
      },
      onConnectionChange: (status, info) => {
        setConnectionInfo(info ?? { status, attempt: 0 });
      },
    });

    mpClientRef.current = client;

    // Release only this tab's local ownership on refresh/close without revoking another tab's session
    const handleBeforeUnload = () => {
      coordinator.releaseOwnership();
      client.disconnect({ preserveStoredSession: true });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Safe multi-tab auto-restore after a browser refresh (unless opening a fresh invite link)
    const storedMeta = !initialInviteRef.current ? client.getStoredSessionMeta() : null;
    if (storedMeta) {
      setRestoringRoomCode(storedMeta.roomCode);
      coordinator.probeSession(storedMeta.fingerprint, 180).then((probe) => {
        if (cancelled) return;
        if (probe.activeElsewhere) {
          // Do NOT silently overwrite or disconnect the active tab — ask the user cleanly.
          setRestoringRoomCode(null);
          setMultiTabConflict({
            mode: 'duplicate_detected',
            roomCode: storedMeta.roomCode,
            fingerprint: storedMeta.fingerprint,
            message: `Room ${storedMeta.roomCode} is already active in another tab. Switching here will pause the other tab.`,
          });
          return;
        }
        coordinator.claimOwnership(storedMeta.fingerprint);
        client.restoreSession({ rejectIfActive: true });
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearLeaveFallback();
      coordinator.dispose();
      // Preserve sessionStorage on component unmount/page reload so refresh can safely restore the seat
      client.disconnect({ preserveStoredSession: true });
    };
  }, [pushToast]);

  const updateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const openRulesFrom = (from: AppScreen) => {
    if (from === 'table') {
      setOverlayNowMs(Date.now());
      setTableOverlay('rules');
      return;
    }
    setReturnScreen(from);
    setScreen('rules');
  };

  const openSettingsFrom = (from: AppScreen) => {
    if (from === 'table') {
      setOverlayNowMs(Date.now());
      setTableOverlay('settings');
      return;
    }
    setReturnScreen(from);
    setScreen('settings');
  };

  // Live countdown ticker while Rules or Settings overlay is open above an active table
  useEffect(() => {
    if (screen !== 'table' || !tableOverlay) return;
    setOverlayNowMs(Date.now());
    const id = window.setInterval(() => setOverlayNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [screen, tableOverlay]);

  // Escape key closes Rules / Settings overlay above the active table
  useEffect(() => {
    if (screen !== 'table' || !tableOverlay) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTableOverlay(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, tableOverlay]);

  // =========================================================================
  // LOCAL OFFLINE PRACTICE / PASS-AND-PLAY ACTIONS
  // =========================================================================
  const startLocalMatch = useCallback((config: LocalLobbyConfig) => {
    const validation = validateLocalLobbyConfig(config);
    if (!validation.ok) {
      pushToast('error', validation.error);
      return;
    }
    const safeConfig = validation.config;
    setOnlineRoom(null);
    setTableOverlay(null);
    setLocalTurnDeadlineAt(null);
    setPracticeEndedEarly(false);
    setLocalLobby(safeConfig);
    updateSettings({ ...settingsRef.current, defaultDifficulty: safeConfig.difficulty });
    const fresh = createInitialGameState(safeConfig.players, {
      difficulty: safeConfig.difficulty,
    });
    setLocalGame(fresh);
    setScreen('table');
    playDealSound(settingsRef.current.soundEnabled);
  }, [pushToast, updateSettings]);

  const handleFinishPracticeEarly = useCallback(() => {
    if (onlineRoom || localLobby.mode !== 'bots' || !localGame) return;
    if (localGame.phase === 'finished') return;
    const humanSeat = localGame.players.find((p) => p.type === 'human');
    if (!humanSeat || !humanSeat.finished || humanSeat.finishOrder === null || humanSeat.hand.length > 0) {
      return;
    }
    setPracticeEndedEarly(true);
    setScreen('results');
    playTrickSuccessSound(settingsRef.current.soundEnabled);
  }, [onlineRoom, localLobby.mode, localGame]);

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

  const handleLocalVoluntaryExit = useCallback(
    (exitingPlayerId?: string) => {
      const current = localGameRef.current;
      if (!current) {
        setScreen('lobby');
        return;
      }

      const humanCount = current.players.filter((p) => p.type === 'human').length;
      const isPassAndPlay = humanCount > 1;
      const result = executeLocalVoluntaryExit(current, exitingPlayerId, { isPassAndPlay });

      if (!result.ok) {
        pushToast('warning', result.error);
        return;
      }

      // Synchronously update ref so rapid duplicate clicks cannot re-run redistribution
      localGameRef.current = result.nextState;
      setLocalGame(result.nextState);

      if (result.shouldLeaveToLobby) {
        setTableOverlay(null);
        setLocalTurnDeadlineAt(null);
        setScreen('lobby');
      } else if (result.nextState?.phase === 'finished') {
        playGameOverSound(settingsRef.current.soundEnabled);
      }

      if (result.toast) {
        pushToast(result.toast.kind, result.toast.message);
      }
    },
    [pushToast]
  );

  const handleLocalContinueTrick = useCallback(() => {
    setLocalGame((prev) => {
      if (!prev || prev.phase !== 'trick_result') return prev;
      return continueAfterTrick(prev);
    });
  }, []);

  // Local difficulty-aware bots automation (strictly using sanitized BotPublicObservation)
  useEffect(() => {
    if (onlineRoom || screen !== 'table' || !localGame || localGame.phase !== 'playing') return;
    const turnId = localGame.currentTurnPlayerId;
    if (!turnId) return;
    const current = localGame.players.find((p) => p.id === turnId);
    if (!current || current.type !== 'bot') return;

    const timer = window.setTimeout(() => {
      setLocalGame((prev) => {
        if (!prev || prev.phase !== 'playing' || prev.currentTurnPlayerId !== current.id) {
          return prev;
        }
        const card = chooseBotCard(prev, current.id, prev.difficulty);
        if (!card) return prev;
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
    const timer = window.setTimeout(() => {
      setTableOverlay(null);
      setPracticeEndedEarly(false);
      setScreen('results');
    }, 650);
    return () => window.clearTimeout(timer);
  }, [onlineRoom, screen, localGame]);

  // =========================================================================
  // ONLINE MULTIPLAYER ACTIONS
  // =========================================================================
  const leaveOnlineCompletely = () => {
    const client = mpClientRef.current;
    if (!client || !client.isConnected()) {
      // Offline / already disconnected in lobby or results — clean up locally
      exitPendingRef.current = false;
      client?.disconnect();
      setOnlineRoom(null);
      prevOnlinePhaseRef.current = null;
      prevOnlinePlaysRef.current = 0;
      setScreen('welcome');
      return;
    }
    if (exitPendingRef.current) return;
    exitPendingRef.current = true;
    client.send({ type: 'leave_room' });

    // Safety fallback only if server cannot reply (e.g., sudden network loss)
    if (leaveFallbackTimerRef.current !== null) {
      window.clearTimeout(leaveFallbackTimerRef.current);
    }
    leaveFallbackTimerRef.current = window.setTimeout(() => {
      if (!exitPendingRef.current) return;
      exitPendingRef.current = false;
      client.disconnect();
      setOnlineRoom(null);
      prevOnlinePhaseRef.current = null;
      prevOnlinePlaysRef.current = 0;
      setScreen('welcome');
    }, 4000);
  };

  const requestOnlineVoluntaryExit = () => {
    const client = mpClientRef.current;
    if (!client || !client.isConnected()) {
      pushToast('warning', 'Reconnecting to server — please wait before exiting.');
      return;
    }
    if (exitPendingRef.current) return;
    exitPendingRef.current = true;
    // Wait strictly for server acknowledgement ('left_room') before disconnecting or navigating away
    client.send({ type: 'voluntary_exit' });
  };

  const handleTakeOverInThisTab = () => {
    const client = mpClientRef.current;
    const coordinator = tabCoordinatorRef.current;
    if (!client) return;
    const meta = client.getStoredSessionMeta();
    const fp = multiTabConflict?.fingerprint || meta?.fingerprint;
    const code = multiTabConflict?.roomCode || meta?.roomCode || '';
    if (fp && coordinator) {
      coordinator.claimOwnership(fp);
    }
    setMultiTabConflict(null);
    if (code) setRestoringRoomCode(code);
    const started = client.restoreSession({ rejectIfActive: false });
    if (!started) {
      setRestoringRoomCode(null);
      setHomeError('Your saved session is no longer available.');
      setScreen('welcome');
    }
  };

  const handleKeepSessionInOtherTab = () => {
    // Detach ONLY this tab locally without sending leave_room or revoking the other tab's session
    tabCoordinatorRef.current?.releaseOwnership();
    mpClientRef.current?.clearStoredSessionLocally();
    setMultiTabConflict(null);
    setRestoringRoomCode(null);
    setTableOverlay(null);
    setOnlineRoom(null);
    prevOnlinePhaseRef.current = null;
    prevOnlinePlaysRef.current = 0;
    setScreen('welcome');
  };

  const handleRetryReconnect = () => {
    mpClientRef.current?.retryReconnectNow();
  };

  const handleReturnHomeFromDisconnect = () => {
    tabCoordinatorRef.current?.releaseOwnership();
    mpClientRef.current?.clearStoredSessionLocally();
    setRestoringRoomCode(null);
    setMultiTabConflict(null);
    setTableOverlay(null);
    setOnlineRoom(null);
    prevOnlinePhaseRef.current = null;
    prevOnlinePlaysRef.current = 0;
    setScreen('welcome');
  };

  // Cancel any in-flight background auto-restore before starting a fresh local or online room
  const cancelPendingRestore = () => {
    if (!onlineRoomRef.current && (restoringRoomCode || mpClientRef.current?.hasStoredSession())) {
      tabCoordinatorRef.current?.releaseOwnership();
      mpClientRef.current?.clearStoredSessionLocally();
      setRestoringRoomCode(null);
      setMultiTabConflict(null);
    }
  };

  // Clear invite URL params once used
  const clearInviteParams = () => {
    setIncomingInvite(null);
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  // Global compact toast notifications + Multi-Tab Session Conflict Modal + PWA Offline Indicator
  const globalOverlays = (
    <>
      <OfflineIndicator />

      {/* Initial session restore bar on Welcome screen */}
      {screen === 'welcome' && restoringRoomCode && !multiTabConflict && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-3 z-40 flex justify-center px-4 pointer-events-none"
        >
          <div className="pointer-events-auto max-w-md w-full rounded-2xl bg-[#13361F] text-[#F5F2E8] border border-[#F0B429]/45 px-4 py-2.5 shadow-xl flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-4 h-4 text-[#F0B429] animate-spin shrink-0" aria-hidden="true" />
              <span className="truncate">
                Reconnecting to room <span className="font-mono">{restoringRoomCode}</span>...
              </span>
            </div>
            <button
              type="button"
              onClick={handleKeepSessionInOtherTab}
              className="text-xs font-bold text-[#F5C954] hover:underline shrink-0 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Multi-Tab Duplicate / Superseded Session Modal */}
      {multiTabConflict && (
        <div
          className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="multitab-conflict-title"
        >
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl bg-[#FAF5ED] text-[#261E18] p-6 shadow-2xl border border-[#DFD3C1]">
            <div className="w-12 h-12 rounded-2xl bg-[#FFF4DC] border border-[#E7C67A] flex items-center justify-center text-[#9A5B00]">
              <Layers className="w-6 h-6" aria-hidden="true" />
            </div>
            <h2
              id="multitab-conflict-title"
              className="mt-4 font-display text-xl sm:text-2xl font-bold text-[#261E18]"
            >
              {multiTabConflict.mode === 'duplicate_detected'
                ? 'Game Already Open in Another Tab'
                : 'Session Moved to Another Tab'}
            </h2>
            <p className="mt-2 text-sm text-[#5C4E41] leading-relaxed">
              {multiTabConflict.message}
            </p>
            {multiTabConflict.roomCode && (
              <p className="mt-2 text-xs font-mono font-bold text-[#365B40]">
                Room: {multiTabConflict.roomCode}
              </p>
            )}
            <p className="mt-2 text-xs text-[#736456] leading-relaxed">
              {multiTabConflict.mode === 'duplicate_detected'
                ? 'Leaving it open in the other tab will keep that game uninterrupted so you can start or join a different table here.'
                : 'Returning home will not affect your active seat in the other tab.'}
            </p>
            <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleKeepSessionInOtherTab}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#EFE6D8] hover:bg-[#E5D9C6] text-[#261E18] text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Home className="w-4 h-4" aria-hidden="true" />
                {multiTabConflict.mode === 'duplicate_detected'
                  ? 'Keep Active in Other Tab'
                  : 'Return Home'}
              </button>
              <button
                type="button"
                onClick={handleTakeOverInThisTab}
                className="min-h-[44px] px-5 py-2 rounded-xl btn-orange-3d text-sm font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                {multiTabConflict.mode === 'duplicate_detected'
                  ? 'Switch to This Tab'
                  : 'Switch Back Here'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 top-14 sm:top-16 z-50 flex flex-col items-center gap-2 px-4"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
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
  // SCREEN ROUTING (wrapped in MotionConfig to respect prefers-reduced-motion)
  // =========================================================================
  const renderCurrentScreen = () => {
    if (screen === 'welcome') {
      return (
        <WelcomeScreen
          initialPlayerName={settings.playerName}
          initialAvatarId={settings.selectedAvatarId}
          incomingInvite={incomingInvite}
          onClearIncomingInvite={clearInviteParams}
          onSavePlayerName={(playerName) => updateSettings({ ...settings, playerName })}
          onSaveAvatarId={(selectedAvatarId) => updateSettings({ ...settings, selectedAvatarId })}
          onOpenCreateRoom={(playerName, avatarId) => {
            updateSettings({
              ...settings,
              playerName,
              selectedAvatarId: avatarId ?? settings.selectedAvatarId,
            });
            setCreateInitialMode('online');
            setScreen('create');
          }}
          onOpenPractice={(playerName, avatarId) => {
            cancelPendingRestore();
            const chosenAvatarId = avatarId ?? settings.selectedAvatarId;
            updateSettings({ ...settings, playerName, selectedAvatarId: chosenAvatarId });
            const cfg: LocalLobbyConfig = sanitizeLocalLobbyConfig({
              roomCode: generateRoomCode(),
              tableName: 'Practice vs Bots',
              mode: 'bots',
              visibility: 'private',
              capacity: 4,
              difficulty: settings.defaultDifficulty,
              players: buildDefaultPlayers(4, playerName, 'bots', Math.random, chosenAvatarId || undefined),
            });
            setOnlineRoom(null);
            setLocalLobby(cfg);
            setScreen('lobby');
          }}
          onOpenPassAndPlay={(playerName, avatarId) => {
            updateSettings({
              ...settings,
              playerName,
              selectedAvatarId: avatarId ?? settings.selectedAvatarId,
            });
            setCreateInitialMode('pass-and-play');
            setScreen('create');
          }}
          onJoinOnlineRoom={({ roomCode, playerName, inviteToken, avatarId }) => {
            cancelPendingRestore();
            const chosenAvatarId = avatarId ?? settings.selectedAvatarId;
            updateSettings({ ...settings, playerName, selectedAvatarId: chosenAvatarId });
            setLocalGame(null);
            mpClientRef.current?.send({
              type: 'join_room',
              roomCode,
              playerName,
              inviteToken,
              ...(chosenAvatarId ? { avatarId: chosenAvatarId } : {}),
            });
          }}
          onHowToPlay={() => openRulesFrom('welcome')}
          onSettings={() => openSettingsFrom('welcome')}
          externalError={homeError}
          onDismissError={() => setHomeError(null)}
        />
      );
    }

    if (screen === 'create') {
      return (
        <CreateGameScreen
          initialMode={createInitialMode}
          initialPlayerName={settings.playerName}
          initialAvatarId={settings.selectedAvatarId}
          defaultTurnTimer={settings.turnTimerSeconds}
          defaultDifficulty={settings.defaultDifficulty}
          onBack={() => setScreen('welcome')}
          onSaveAvatarId={(selectedAvatarId) => updateSettings({ ...settings, selectedAvatarId })}
          onCreateOnlineRoom={(params) => {
            cancelPendingRestore();
            const chosenAvatarId = params.avatarId ?? settings.selectedAvatarId;
            updateSettings({
              ...settings,
              playerName: params.playerName,
              selectedAvatarId: chosenAvatarId,
              defaultDifficulty: params.difficulty,
            });
            setLocalGame(null);
            mpClientRef.current?.send({
              type: 'create_room',
              playerName: params.playerName,
              tableName: params.tableName,
              capacity: params.capacity,
              visibility: params.visibility,
              turnTimerSeconds: params.turnTimerSeconds,
              difficulty: params.difficulty,
              ...(chosenAvatarId ? { avatarId: chosenAvatarId } : {}),
            });
          }}
          onCreateLocalLobby={(cfg) => {
            cancelPendingRestore();
            const safe = sanitizeLocalLobbyConfig(cfg);
            const hostAvatarId = safe.players[0]?.avatarId ?? settings.selectedAvatarId;
            updateSettings({
              ...settings,
              defaultDifficulty: safe.difficulty,
              selectedAvatarId: hostAvatarId,
            });
            setOnlineRoom(null);
            setLocalLobby(safe);
            setScreen('lobby');
          }}
        />
      );
    }

    if (screen === 'lobby') {
      return (
        <GameLobbyScreen
          onlineRoom={onlineRoom}
          localConfig={onlineRoom ? null : localLobby}
          onUpdateLocalConfig={(next) => {
            const safe = sanitizeLocalLobbyConfig(next);
            setLocalLobby(safe);
            const hostAvatarId = safe.players[0]?.avatarId;
            if (hostAvatarId && hostAvatarId !== settings.selectedAvatarId) {
              updateSettings({ ...settings, selectedAvatarId: hostAvatarId });
            }
          }}
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
          onOnlineUpdateAvatar={(avatarId) => {
            updateSettings({ ...settings, selectedAvatarId: avatarId });
            mpClientRef.current?.send({ type: 'update_avatar', avatarId });
          }}
          onOnlineStartGame={() => mpClientRef.current?.send({ type: 'start_game' })}
          onOnlineCancelRoom={() => mpClientRef.current?.send({ type: 'cancel_room' })}
          onOnlineRevokeInvite={() => mpClientRef.current?.send({ type: 'revoke_invite' })}
          onOnlineRegenerateCode={() => mpClientRef.current?.send({ type: 'regenerate_code' })}
          onOnlineUpdateTurnTimer={(turnTimerSeconds) =>
            mpClientRef.current?.send({ type: 'update_turn_timer', turnTimerSeconds })
          }
          onOnlineRequestHostTransfer={(targetPlayerId) =>
            mpClientRef.current?.send({ type: 'transfer_host_request', targetPlayerId })
          }
          onOnlineRespondHostTransfer={(accept) =>
            mpClientRef.current?.send({ type: 'transfer_host_respond', accept })
          }
          connectionInfo={connectionInfo}
          onRetryReconnect={handleRetryReconnect}
          onReturnHome={handleReturnHomeFromDisconnect}
        />
      );
    }

    if (screen === 'table') {
      const activeGameState = onlineRoom?.gameState ?? localGame;
      if (activeGameState) {
        const overlayTurnAlert = tableOverlay
          ? computeOverlayTurnAlert({
              isOnline: Boolean(onlineRoom),
              onlineRoom,
              localGame,
              localDeadlineAt: localTurnDeadlineAt,
              nowMs: overlayNowMs,
            })
          : null;

        return (
          <>
            <CardTableScreen
              gameState={activeGameState}
              settings={settings}
              roomCode={onlineRoom ? onlineRoom.roomCode : localLobby.roomCode}
              isOnline={Boolean(onlineRoom)}
              onlineRoom={onlineRoom}
              connectionInfo={connectionInfo}
              onRetryReconnect={handleRetryReconnect}
              onReturnHome={handleReturnHomeFromDisconnect}
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
              onLocalTurnDeadlineChange={setLocalTurnDeadlineAt}
              onContinueTrick={handleLocalContinueTrick}
              onToggleSound={() =>
                updateSettings({ ...settings, soundEnabled: !settings.soundEnabled })
              }
              onToggleOpenHands={() =>
                updateSettings({ ...settings, openHandsTesting: !settings.openHandsTesting })
              }
              onOpenRules={() => openRulesFrom('table')}
              onOpenSettings={() => openSettingsFrom('table')}
              onVoluntaryExit={(exitingPlayerId) => {
                if (onlineRoom) {
                  requestOnlineVoluntaryExit();
                } else {
                  handleLocalVoluntaryExit(exitingPlayerId);
                }
              }}
              isPracticeVsBots={!onlineRoom && localLobby.mode === 'bots'}
              onFinishPracticeEarly={handleFinishPracticeEarly}
              onOnlineRespondHostTransfer={(accept) =>
                mpClientRef.current?.send({ type: 'transfer_host_respond', accept })
              }
            />

            {/* Rules / Settings Overlay above active CardTableScreen so timers never unmount or reset */}
            {tableOverlay && (
              <div
                className="fixed inset-0 z-[45] overflow-y-auto cream-surface"
                role="dialog"
                aria-modal="true"
                aria-label={tableOverlay === 'rules' ? 'How to Play' : 'Settings'}
              >
                {overlayTurnAlert && (
                  <div
                    role={overlayTurnAlert.isYourTurn ? 'alert' : 'status'}
                    aria-live="polite"
                    className={`sticky top-0 z-10 px-3.5 sm:px-4 py-2.5 border-b flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-3 ${
                      overlayTurnAlert.isYourTurn
                        ? overlayTurnAlert.urgent
                          ? 'bg-[#B91C1C] text-white border-[#FCA5A5]/40'
                          : 'bg-[#F0A500] text-[#1D1508] border-[#C98500]/40'
                        : 'bg-[#13361F] text-[#E5F2E9] border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs sm:text-sm font-bold min-w-0">
                      <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span className="leading-snug">
                        {overlayTurnAlert.isYourTurn
                          ? overlayTurnAlert.remainingSeconds !== null
                            ? `${
                                overlayTurnAlert.isOnline
                                  ? 'Your turn!'
                                  : `${overlayTurnAlert.activePlayerName}’s turn!`
                              } Timer running · ${overlayTurnAlert.remainingSeconds}s left`
                            : `${
                                overlayTurnAlert.isOnline
                                  ? 'Your turn!'
                                  : `${overlayTurnAlert.activePlayerName}’s turn!`
                              } (Timer Off)`
                          : `Active match · Waiting for ${overlayTurnAlert.activePlayerName}...`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTableOverlay(null)}
                      className={`shrink-0 min-h-[34px] px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-colors ${
                        overlayTurnAlert.isYourTurn
                          ? overlayTurnAlert.urgent
                            ? 'bg-white text-[#991B1B] hover:bg-[#FEE2E2]'
                            : 'bg-[#1D1508] text-[#FAF5ED] hover:bg-black'
                          : 'bg-[#F0B429] text-[#1D1508] hover:bg-[#F7C64C]'
                      }`}
                    >
                      Return to Table
                    </button>
                  </div>
                )}

                {tableOverlay === 'rules' ? (
                  <HowToPlayScreen
                    onBack={() => setTableOverlay(null)}
                    backLabel="Return to Table"
                  />
                ) : (
                  <SettingsScreen
                    settings={settings}
                    onUpdate={updateSettings}
                    onBack={() => setTableOverlay(null)}
                    backLabel="Return to Table"
                  />
                )}
              </div>
            )}
          </>
        );
      }
    }

    if (screen === 'results') {
      const activeGameState = onlineRoom?.gameState ?? localGame;
      if (activeGameState) {
        return (
          <GameResultsScreen
            gameState={activeGameState}
            onlineRoom={onlineRoom}
            practiceEndedEarly={!onlineRoom && practiceEndedEarly}
            animationsEnabled={settings.animationsEnabled}
            onLocalPlayAgain={() => startLocalMatch(localLobby)}
            onBackToLobby={() => {
              setPracticeEndedEarly(false);
              setLocalGame(null);
              setScreen('lobby');
            }}
            onMainMenu={() => {
              setPracticeEndedEarly(false);
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
            connectionInfo={connectionInfo}
            onRetryReconnect={handleRetryReconnect}
          />
        );
      }
    }

    if (screen === 'rules') {
      return (
        <HowToPlayScreen
          onBack={() => setScreen(returnScreen)}
          backLabel={returnScreen === 'table' ? 'Return to Table' : 'Back'}
        />
      );
    }

    return (
      <SettingsScreen
        settings={settings}
        onUpdate={updateSettings}
        onBack={() => setScreen(returnScreen)}
        backLabel={returnScreen === 'table' ? 'Return to Table' : 'Back'}
      />
    );
  };

  return (
    <MotionConfig reducedMotion="user">
      {renderCurrentScreen()}
      {globalOverlays}
    </MotionConfig>
  );
}
