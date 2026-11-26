import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSessionFingerprint,
  MultiTabSessionCoordinator,
  type TabSyncMessage,
  type TabSyncTransport,
} from './multiTabSession';
import {
  getReconnectDelayMs,
  MultiplayerClient,
  type ConnectionStatus,
  type ConnectionStatusInfo,
} from './multiplayerClient';

/**
 * Deterministic in-memory cross-tab message bus simulating BroadcastChannel across browser tabs.
 */
function createVirtualTabBus() {
  const subscribers = new Set<(msg: TabSyncMessage) => void>();
  const sentMessages: TabSyncMessage[] = [];

  const createTransport = (): TabSyncTransport => {
    let localHandlers = new Set<(msg: TabSyncMessage) => void>();
    return {
      postMessage(msg) {
        sentMessages.push(msg);
        // Deliver asynchronously on next microtask, mirroring real BroadcastChannel delivery
        queueMicrotask(() => {
          for (const sub of subscribers) {
            sub(msg);
          }
        });
      },
      subscribe(handler) {
        subscribers.add(handler);
        localHandlers.add(handler);
        return () => {
          subscribers.delete(handler);
          localHandlers.delete(handler);
        };
      },
      close() {
        for (const h of localHandlers) {
          subscribers.delete(h);
        }
        localHandlers.clear();
      },
    };
  };

  return { createTransport, sentMessages };
}

describe('Phase 3 Batch 3 — Multi-Tab Session Coordinator', () => {
  it('derives deterministic, non-reversible fingerprints that never leak raw session tokens', () => {
    const tokenA = 'secret_session_token_alpha_9f81c2b4';
    const tokenB = 'secret_session_token_beta_7a13e9d0';

    const fpA1 = computeSessionFingerprint(tokenA);
    const fpA2 = computeSessionFingerprint(tokenA);
    const fpB = computeSessionFingerprint(tokenB);

    assert.equal(fpA1, fpA2);
    assert.notEqual(fpA1, fpB);
    assert.ok(fpA1.startsWith('fp_'));
    assert.equal(fpA1.includes('secret'), false);
    assert.equal(fpA1.includes(tokenA), false);
    assert.equal(fpA1.includes('9f81c2b4'), false);
  });

  it('detects when a duplicated tab opens the same active session without silently overwriting the original tab', async () => {
    const bus = createVirtualTabBus();
    const token = 'tok_room_alpha_player1';
    const fp = computeSessionFingerprint(token);

    let tabASuperseded = false;
    const tabA = new MultiTabSessionCoordinator({
      tabId: 'tab_A',
      transport: bus.createTransport(),
      onSuperseded: () => {
        tabASuperseded = true;
      },
    });
    const tabB = new MultiTabSessionCoordinator({
      tabId: 'tab_B',
      transport: bus.createTransport(),
    });

    try {
      tabA.claimOwnership(fp);
      const probe = await tabB.probeSession(fp, 50);

      assert.equal(probe.activeElsewhere, true);
      assert.equal(probe.ownerTabId, 'tab_A');
      assert.equal(tabASuperseded, false);
      assert.equal(tabA.getOwnedFingerprint(), fp);

      // Verify raw session token was NEVER transmitted over the cross-tab channel
      const serialized = JSON.stringify(bus.sentMessages);
      assert.equal(serialized.includes(token), false);
    } finally {
      tabA.dispose();
      tabB.dispose();
    }
  });

  it('notifies the original tab cleanly when the user explicitly takes over in a second tab', async () => {
    const bus = createVirtualTabBus();
    const fp = computeSessionFingerprint('tok_shared_seat');

    const supersededEvents: Array<{ fingerprint: string; newOwnerTabId: string }> = [];
    const tabA = new MultiTabSessionCoordinator({
      tabId: 'tab_A',
      transport: bus.createTransport(),
      onSuperseded: (info) => supersededEvents.push(info),
    });
    const tabB = new MultiTabSessionCoordinator({
      tabId: 'tab_B',
      transport: bus.createTransport(),
    });

    try {
      tabA.claimOwnership(fp);
      await new Promise((r) => setTimeout(r, 5));

      tabB.claimOwnership(fp);
      await new Promise((r) => setTimeout(r, 15));

      assert.equal(supersededEvents.length, 1);
      assert.equal(supersededEvents[0].fingerprint, fp);
      assert.equal(supersededEvents[0].newOwnerTabId, 'tab_B');
      assert.equal(tabA.getOwnedFingerprint(), null);
      assert.equal(tabB.getOwnedFingerprint(), fp);
    } finally {
      tabA.dispose();
      tabB.dispose();
    }
  });

  it('keeps unrelated rooms and separate player sessions completely isolated', async () => {
    const bus = createVirtualTabBus();
    const fpRoom1 = computeSessionFingerprint('tok_room1_alice');
    const fpRoom2 = computeSessionFingerprint('tok_room2_bob');

    let tabASuperseded = false;
    let tabBSuperseded = false;

    const tabA = new MultiTabSessionCoordinator({
      tabId: 'tab_A',
      transport: bus.createTransport(),
      onSuperseded: () => {
        tabASuperseded = true;
      },
    });
    const tabB = new MultiTabSessionCoordinator({
      tabId: 'tab_B',
      transport: bus.createTransport(),
      onSuperseded: () => {
        tabBSuperseded = true;
      },
    });

    try {
      tabA.claimOwnership(fpRoom1);
      const probeB = await tabB.probeSession(fpRoom2, 30);
      assert.equal(probeB.activeElsewhere, false);

      tabB.claimOwnership(fpRoom2);
      await new Promise((r) => setTimeout(r, 15));

      assert.equal(tabASuperseded, false);
      assert.equal(tabBSuperseded, false);
      assert.equal(tabA.getOwnedFingerprint(), fpRoom1);
      assert.equal(tabB.getOwnedFingerprint(), fpRoom2);
    } finally {
      tabA.dispose();
      tabB.dispose();
    }
  });

  it('closing one tab never revokes or supersedes another tab holding a valid session', async () => {
    const bus = createVirtualTabBus();
    const fp = computeSessionFingerprint('tok_active_seat');

    let tabBSuperseded = false;
    const tabA = new MultiTabSessionCoordinator({
      tabId: 'tab_A',
      transport: bus.createTransport(),
    });
    const tabB = new MultiTabSessionCoordinator({
      tabId: 'tab_B',
      transport: bus.createTransport(),
      onSuperseded: () => {
        tabBSuperseded = true;
      },
    });

    try {
      tabB.claimOwnership(fp);
      // Tab A was a duplicate or unrelated tab that closes
      tabA.releaseOwnership();
      tabA.dispose();
      await new Promise((r) => setTimeout(r, 15));

      assert.equal(tabBSuperseded, false);
      assert.equal(tabB.getOwnedFingerprint(), fp);
    } finally {
      tabB.dispose();
    }
  });

  it('resolves simultaneous duplicate-tab initialization races deterministically so only one tab proceeds', async () => {
    const bus = createVirtualTabBus();
    const fp = computeSessionFingerprint('tok_simultaneous_race');

    const tabA = new MultiTabSessionCoordinator({
      tabId: 'tab_001',
      transport: bus.createTransport(),
    });
    const tabB = new MultiTabSessionCoordinator({
      tabId: 'tab_002',
      transport: bus.createTransport(),
    });

    try {
      const [resA, resB] = await Promise.all([
        tabA.probeSession(fp, 45),
        tabB.probeSession(fp, 45),
      ]);

      // Exactly one tab proceeds (activeElsewhere: false) and the other defers (activeElsewhere: true)
      assert.equal(resA.activeElsewhere, false);
      assert.equal(resB.activeElsewhere, true);
      assert.equal(resB.ownerTabId, 'tab_001');
    } finally {
      tabA.dispose();
      tabB.dispose();
    }
  });
});

describe('Phase 3 Batch 3 — MultiplayerClient Reconnect UX & Multi-Tab Recovery', () => {
  function setupFakeBrowserEnv() {
    const storageMap = new Map<string, string>();
    const sentFrames: string[] = [];

    class FakeWS {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = FakeWS.CONNECTING;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onclose: ((ev: { code: number }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        FakeWS.instances.push(this);
      }
      send(data: string) {
        sentFrames.push(data);
      }
      close(code = 1000) {
        this.readyState = FakeWS.CLOSED;
        this.onclose?.({ code });
      }
      emitMessage(payload: unknown) {
        this.onmessage?.({ data: JSON.stringify(payload) });
      }
      emitDrop(code = 1006) {
        this.readyState = FakeWS.CLOSED;
        this.onclose?.({ code });
      }
      static instances: FakeWS[] = [];
    }

    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevWS = (globalThis as Record<string, unknown>).WebSocket;
    (globalThis as Record<string, unknown>).WebSocket = FakeWS;
    (globalThis as Record<string, unknown>).window = {
      location: { protocol: 'http:', host: 'localhost:3000' },
      sessionStorage: {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => storageMap.set(k, v),
        removeItem: (k: string) => storageMap.delete(k),
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    };

    return {
      FakeWS,
      storageMap,
      sentFrames,
      restore() {
        (globalThis as Record<string, unknown>).window = prevWindow;
        (globalThis as Record<string, unknown>).WebSocket = prevWS;
      },
    };
  }

  it('handles SESSION_ACTIVE_ELSEWHERE without clearing sessionStorage or sending leave_room', () => {
    const env = setupFakeBrowserEnv();
    env.storageMap.set(
      'last_donkey_online_session_v1',
      JSON.stringify({ roomCode: 'DUPL01', sessionToken: 'tok_secret_123' })
    );

    let client: MultiplayerClient | null = null;
    try {
      const conflicts: Array<{ roomCode: string; message: string }> = [];
      const statuses: ConnectionStatus[] = [];

      client = new MultiplayerClient({
        onRoomState: () => {},
        onNotification: () => {},
        onError: () => {},
        onLeftRoom: () => {},
        onRoomClosed: () => {},
        onSessionExpired: () => {},
        onConnectionChange: (s) => statuses.push(s),
        onSessionActiveElsewhere: (info) => conflicts.push(info),
      });

      const meta = client.getStoredSessionMeta();
      assert.ok(meta);
      assert.equal(meta!.roomCode, 'DUPL01');
      assert.equal(meta!.fingerprint.includes('tok_secret_123'), false);

      assert.equal(client.restoreSession({ rejectIfActive: true }), true);
      const ws = env.FakeWS.instances[0];
      ws.readyState = env.FakeWS.OPEN;
      ws.onopen?.();

      const firstSent = JSON.parse(env.sentFrames[0]) as {
        type: string;
        rejectIfActive?: boolean;
      };
      assert.equal(firstSent.type, 'reconnect');
      assert.equal(firstSent.rejectIfActive, true);

      ws.emitMessage({
        type: 'error',
        code: 'SESSION_ACTIVE_ELSEWHERE',
        message: 'This seat is already active in another tab or window.',
      });

      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0].roomCode, 'DUPL01');
      assert.equal(statuses[statuses.length - 1], 'superseded');
      // sessionStorage MUST remain intact until user chooses Switch or Keep Other Tab
      assert.equal(client.hasStoredSession(), true);
      // Must NEVER send leave_room when stepping aside or encountering conflict
      assert.equal(
        env.sentFrames.some((f) => JSON.parse(f).type === 'leave_room'),
        false
      );

      // Choosing "Keep Active in Other Tab" clears ONLY local storage without sending leave_room
      client.clearStoredSessionLocally();
      assert.equal(client.hasStoredSession(), false);
      assert.equal(
        env.sentFrames.some((f) => JSON.parse(f).type === 'leave_room'),
        false
      );
    } finally {
      client?.disconnect();
      env.restore();
    }
  });

  it('transitions through connecting -> reconnecting -> failed backoff, recovers on retryReconnectNow, and emits onReconnected once', () => {
    const env = setupFakeBrowserEnv();
    env.storageMap.set(
      'last_donkey_online_session_v1',
      JSON.stringify({ roomCode: 'RECON1', sessionToken: 'tok_recon_abc' })
    );

    // Backoff schedule should increase monotonically and cap cleanly
    assert.ok(getReconnectDelayMs(1) < getReconnectDelayMs(2));
    assert.ok(getReconnectDelayMs(2) < getReconnectDelayMs(3));
    assert.equal(getReconnectDelayMs(4), getReconnectDelayMs(10));

    let client: MultiplayerClient | null = null;
    try {
      const history: ConnectionStatusInfo[] = [];
      const reconnectedCodes: string[] = [];
      const errors: string[] = [];

      client = new MultiplayerClient({
        onRoomState: () => {},
        onNotification: () => {},
        onError: (m) => errors.push(m),
        onLeftRoom: () => {},
        onRoomClosed: () => {},
        onSessionExpired: () => {},
        onConnectionChange: (_s, info) => {
          if (info) history.push(info);
        },
        onReconnected: (code) => reconnectedCodes.push(code),
      });

      client.restoreSession();
      // Simulate 4 consecutive drops before server becomes reachable
      for (let i = 0; i < 4; i++) {
        const ws = env.FakeWS.instances[env.FakeWS.instances.length - 1];
        ws.emitDrop(1006);
        if (i < 3) {
          // Force immediate reconnect attempt via retryReconnectNow to avoid real wall-clock waits
          client.retryReconnectNow();
        }
      }

      // 4th drop must enter 'failed' state with attempt >= 4
      const last = history[history.length - 1];
      assert.equal(last.status, 'failed');
      assert.ok(last.attempt >= 4);

      // Attempting play_card while disconnected MUST NOT queue play_card
      client.send({ type: 'play_card', cardId: 'spades-14' });
      assert.ok(errors.length >= 1);

      // Manual Retry Now -> socket opens -> server sends authoritative room_state
      client.retryReconnectNow();
      const recoveredWs = env.FakeWS.instances[env.FakeWS.instances.length - 1];
      recoveredWs.readyState = env.FakeWS.OPEN;
      recoveredWs.onopen?.();
      recoveredWs.emitMessage({
        type: 'room_state',
        room: { roomCode: 'RECON1' },
      });
      // Subsequent room_state updates MUST NOT re-fire onReconnected
      recoveredWs.emitMessage({
        type: 'room_state',
        room: { roomCode: 'RECON1' },
      });

      assert.deepEqual(reconnectedCodes, ['RECON1']);
      assert.equal(
        env.sentFrames.some((f) => JSON.parse(f).type === 'play_card'),
        false
      );
    } finally {
      client?.disconnect();
      env.restore();
    }
  });

  it('handles session_superseded cleanly without auto-reconnecting and provides friendly messages on expired/missing room', () => {
    const env = setupFakeBrowserEnv();
    env.storageMap.set(
      'last_donkey_online_session_v1',
      JSON.stringify({ roomCode: 'SUP001', sessionToken: 'tok_super_secret' })
    );

    let client: MultiplayerClient | null = null;
    try {
      const superseded: string[] = [];
      const expiredReasons: string[] = [];
      const errors: string[] = [];

      client = new MultiplayerClient({
        onRoomState: () => {},
        onNotification: () => {},
        onError: (m) => errors.push(m),
        onLeftRoom: () => {},
        onRoomClosed: () => {},
        onSessionExpired: (r) => expiredReasons.push(r),
        onConnectionChange: () => {},
        onSessionSuperseded: (info) => superseded.push(info.message),
      });

      client.restoreSession();
      const ws1 = env.FakeWS.instances[0];
      ws1.readyState = env.FakeWS.OPEN;
      ws1.onopen?.();
      ws1.emitMessage({
        type: 'session_superseded',
        roomCode: 'SUP001',
        message: 'This game session was opened in another tab or window.',
      });

      assert.equal(superseded.length, 1);
      // Blocked from sending actions while superseded
      client.send({ type: 'play_card', cardId: 'hearts-10' });
      assert.match(errors[0], /another tab/i);

      // Now simulate taking back control -> server replies ROOM_NOT_FOUND -> friendly non-technical message & cleared session
      client.restoreSession({ rejectIfActive: false });
      const ws2 = env.FakeWS.instances[env.FakeWS.instances.length - 1];
      ws2.readyState = env.FakeWS.OPEN;
      ws2.onopen?.();
      ws2.emitMessage({
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: 'Room no longer exists.',
      });

      assert.equal(expiredReasons.length, 1);
      assert.match(expiredReasons[0], /no longer available/i);
      assert.equal(expiredReasons[0].includes('tok_super_secret'), false);
      assert.equal(client.hasStoredSession(), false);
    } finally {
      client?.disconnect();
      env.restore();
    }
  });

  it('canceling an in-flight restore before create_room never emits stale reconnect or leave_room', () => {
    const env = setupFakeBrowserEnv();
    env.storageMap.set(
      'last_donkey_online_session_v1',
      JSON.stringify({ roomCode: 'OLD999', sessionToken: 'tok_old_room' })
    );

    let client: MultiplayerClient | null = null;
    try {
      client = new MultiplayerClient({
        onRoomState: () => {},
        onNotification: () => {},
        onError: () => {},
        onLeftRoom: () => {},
        onRoomClosed: () => {},
        onSessionExpired: () => {},
        onConnectionChange: () => {},
      });

      // Background auto-restore starts while user is on WelcomeScreen
      assert.equal(client.restoreSession({ rejectIfActive: true }), true);
      assert.equal(env.FakeWS.instances.length, 1);

      // User decides to create a brand-new room instead -> cancelPendingRestore clears local session first
      client.clearStoredSessionLocally();
      assert.equal(client.hasStoredSession(), false);

      client.send({
        type: 'create_room',
        playerName: 'FreshHost',
        capacity: 4,
        visibility: 'private',
      });

      const freshWs = env.FakeWS.instances[env.FakeWS.instances.length - 1];
      freshWs.readyState = env.FakeWS.OPEN;
      freshWs.onopen?.();

      const sentTypes = env.sentFrames.map((f) => (JSON.parse(f) as { type: string }).type);
      assert.deepEqual(sentTypes, ['create_room']);
    } finally {
      client?.disconnect();
      env.restore();
    }
  });
});

