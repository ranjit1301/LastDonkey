import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACE_OF_SPADES_ID,
  createInitialGameState,
  getLegalCards,
  handleMissedTurn,
  makeCard,
  type PlayerConfig,
} from '../engine';
import { RoomManager } from '../server/roomManager';
import type { ClientRoomState } from '../server/roomTypes';
import {
  buildTurnKey,
  computeOverlayTurnAlert,
  EMPTY_LOCAL_TURN_TIMER,
  getRemainingSeconds,
  getTrickBannerInteraction,
  isTimerExpired,
  syncLocalTurnTimer,
} from './turnTimer';

function makePracticePlayers(): PlayerConfig[] {
  return [
    { id: 'human', name: 'You', type: 'human' },
    { id: 'b1', name: 'Bot Raju', type: 'bot' },
    { id: 'b2', name: 'Bot Pinky', type: 'bot' },
  ];
}

describe('Phase 2 Batch 3 — Active Game Timer & Online Trick-Banner Fixes', () => {
  it('local timer remaining time survives Rules navigation without resetting or extending', () => {
    const state = createInitialGameState(makePracticePlayers(), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 5)],
        [makeCard('spades', 10), makeCard('hearts', 6)],
        [makeCard('spades', 6), makeCard('hearts', 7)],
      ],
    });
    const turnKey = buildTurnKey(state);
    assert.ok(turnKey !== null);

    // Turn begins at t = 10_000 with 15s timer -> deadline = 25_000
    const t0 = 10_000;
    const started = syncLocalTurnTimer(EMPTY_LOCAL_TURN_TIMER, {
      turnKey,
      playerId: 'human',
      timerEligible: true,
      turnTimerSeconds: 15,
      nowMs: t0,
    });
    assert.equal(started.deadlineAt, 25_000);
    assert.equal(getRemainingSeconds(started.deadlineAt, 10_000), 15);

    // Player spends 6s on table -> 9s remaining, then opens Rules overlay at t = 16_000
    assert.equal(getRemainingSeconds(started.deadlineAt, 16_000), 9);

    // Syncing again while Rules is open and after returning to table at t = 20_000 MUST NOT reset/extend deadline
    const whileInRules = syncLocalTurnTimer(started, {
      turnKey,
      playerId: 'human',
      timerEligible: true,
      turnTimerSeconds: 15,
      nowMs: 18_000,
    });
    assert.equal(whileInRules.deadlineAt, 25_000);

    const afterReturning = syncLocalTurnTimer(whileInRules, {
      turnKey,
      playerId: 'human',
      timerEligible: true,
      turnTimerSeconds: 15,
      nowMs: 20_000,
    });
    assert.equal(afterReturning.deadlineAt, 25_000);
    assert.equal(getRemainingSeconds(afterReturning.deadlineAt, 20_000), 5);
  });

  it('local timer remaining time survives Settings navigation and never grants extra time mid-turn', () => {
    const state = createInitialGameState(makePracticePlayers(), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 5)],
        [makeCard('spades', 10), makeCard('hearts', 6)],
        [makeCard('spades', 6), makeCard('hearts', 7)],
      ],
    });
    const turnKey = buildTurnKey(state);

    // Turn starts at t = 1_000 with 15s timer -> deadline = 16_000
    const started = syncLocalTurnTimer(EMPTY_LOCAL_TURN_TIMER, {
      turnKey,
      playerId: 'human',
      timerEligible: true,
      turnTimerSeconds: 15,
      nowMs: 1_000,
    });
    assert.equal(started.deadlineAt, 16_000);

    // At t = 9_000 (7s left), player opens Settings and tries changing timer to 30s!
    // Must NOT extend the active turn beyond 16_000!
    const triedExtend = syncLocalTurnTimer(started, {
      turnKey,
      playerId: 'human',
      timerEligible: true,
      turnTimerSeconds: 30,
      nowMs: 9_000,
    });
    assert.equal(triedExtend.deadlineAt, 16_000);
    assert.equal(getRemainingSeconds(triedExtend.deadlineAt, 9_000), 7);

    // Returning to table at t = 12_000 still shows exact 4s left
    const returned = syncLocalTurnTimer(triedExtend, {
      turnKey,
      playerId: 'human',
      timerEligible: true,
      turnTimerSeconds: 30,
      nowMs: 12_000,
    });
    assert.equal(returned.deadlineAt, 16_000);
    assert.equal(getRemainingSeconds(returned.deadlineAt, 12_000), 4);

    // Shortening timer mid-turn (e.g. from 30s to 10s when 25s remain) clamps properly without extending
    const longTurn = syncLocalTurnTimer(EMPTY_LOCAL_TURN_TIMER, {
      turnKey: '2:0:human',
      playerId: 'human',
      timerEligible: true,
      turnTimerSeconds: 30,
      nowMs: 20_000,
    });
    assert.equal(longTurn.deadlineAt, 50_000);
    const shortened = syncLocalTurnTimer(longTurn, {
      turnKey: '2:0:human',
      playerId: 'human',
      timerEligible: true,
      turnTimerSeconds: 10,
      nowMs: 25_000,
    });
    assert.equal(shortened.deadlineAt, 35_000);
  });

  it('Timer Off (0) disables automatic timeout completely while preserving all configured durations (Off, 10, 15, 20, 30)', () => {
    const turnKey = '1:0:human';
    const offTimer = syncLocalTurnTimer(EMPTY_LOCAL_TURN_TIMER, {
      turnKey,
      playerId: 'human',
      timerEligible: true,
      turnTimerSeconds: 0,
      nowMs: 10_000,
    });
    assert.equal(offTimer.deadlineAt, null);
    assert.equal(getRemainingSeconds(offTimer.deadlineAt, 999_999), null);
    assert.equal(isTimerExpired(offTimer.deadlineAt, 999_999), false);

    // Configured options 10, 15, 20, 30 seconds each stamp the exact expected deadline
    for (const sec of [10, 15, 20, 30] as const) {
      const timed = syncLocalTurnTimer(EMPTY_LOCAL_TURN_TIMER, {
        turnKey: `t:${sec}`,
        playerId: 'human',
        timerEligible: true,
        turnTimerSeconds: sec,
        nowMs: 5_000,
      });
      assert.equal(timed.deadlineAt, 5_000 + sec * 1000);
      assert.equal(getRemainingSeconds(timed.deadlineAt, 5_000), sec);
    }
  });

  it('timeout expiration automatically selects a legal card', () => {
    const state = createInitialGameState(makePracticePlayers(), {
      customHands: [
        [makeCard('spades', 14), makeCard('hearts', 5), makeCard('clubs', 7)],
        [makeCard('spades', 10), makeCard('hearts', 6), makeCard('clubs', 8)],
        [makeCard('spades', 6), makeCard('hearts', 7), makeCard('clubs', 9)],
      ],
    });
    const turnKey = buildTurnKey(state);
    const timer = syncLocalTurnTimer(EMPTY_LOCAL_TURN_TIMER, {
      turnKey,
      playerId: 'human',
      timerEligible: true,
      turnTimerSeconds: 10,
      nowMs: 1_000,
    });

    assert.equal(isTimerExpired(timer.deadlineAt, 10_999), false);
    assert.equal(isTimerExpired(timer.deadlineAt, 11_000), true);

    const legalIds = new Set(getLegalCards(state, 'human').map((c) => c.id));
    const missed = handleMissedTurn(state, 'human', () => 0.4);
    assert.equal(missed.ok, true);
    if (!missed.ok) return;
    assert.equal(missed.action, 'auto_played');
    assert.ok(missed.autoPlayedCard !== undefined);
    assert.equal(legalIds.has(missed.autoPlayedCard.id), true);
    assert.equal(missed.autoPlayedCard.id, ACE_OF_SPADES_ID);
  });

  it('communicates clearly when a turn starts while Rules or Settings is open and shows exact online remaining time on return', () => {
    const baseRoom: ClientRoomState = {
      roomCode: 'TIME01',
      tableName: 'Timer Test',
      visibility: 'private',
      status: 'playing',
      capacity: 2,
      difficulty: 'medium',
      hostPlayerId: 'p1',
      aiHostActive: false,
      suspendedHostId: null,
      turnTimerSeconds: 15,
      turnDeadlineAt: 25_000,
      vacancyExpiresAt: null,
      inviteToken: 'tok',
      yourPlayerId: 'p1',
      removedFromOngoingGame: false,
      closeReason: null,
      seats: [
        { playerId: 'p1', name: 'Alice', type: 'human', avatarColor: '#E59A00', connected: true, joinedAt: 1_000 },
        { playerId: 'p2', name: 'Bob', type: 'human', avatarColor: '#2E6340', connected: true, joinedAt: 1_100 },
      ],
      pendingHostTransfer: null,
      rematch: null,
      gameState: {
        phase: 'playing',
        difficulty: 'medium',
        players: [
          {
            id: 'p1',
            name: 'Alice',
            type: 'human',
            seatIndex: 0,
            cardCount: 5,
            hand: [makeCard('hearts', 8)],
            finished: false,
            finishOrder: null,
            removed: false,
            connected: true,
            consecutiveMissedTurns: 0,
            avatarColor: '#E59A00',
          },
          {
            id: 'p2',
            name: 'Bob',
            type: 'human',
            seatIndex: 1,
            cardCount: 5,
            hand: [],
            finished: false,
            finishOrder: null,
            removed: false,
            connected: true,
            consecutiveMissedTurns: 0,
            avatarColor: '#2E6340',
          },
        ],
        currentTurnPlayerId: 'p2',
        isFirstTurnOfGame: false,
        currentTrick: {
          trickNumber: 2,
          ledSuit: null,
          plays: [],
          expectedPlayerIds: ['p2', 'p1'],
        },
        removedCards: [],
        lastOutcome: null,
        trickHistory: [],
        finishGroups: [],
        finishOrder: [],
        donkeyPlayerId: null,
        endReason: null,
        lastRedistribution: null,
      },
    };

    // Initially it's Bob's turn while Alice opened Rules/Settings
    const waitingAlert = computeOverlayTurnAlert({
      isOnline: true,
      onlineRoom: baseRoom,
      localGame: null,
      localDeadlineAt: null,
      nowMs: 12_000,
    });
    assert.ok(waitingAlert !== null);
    assert.equal(waitingAlert.isYourTurn, false);
    assert.equal(waitingAlert.activePlayerName, 'Bob');

    // Bob plays -> server broadcasts new state where it is NOW Alice's turn with turnDeadlineAt = 30_000!
    const myTurnRoom: ClientRoomState = {
      ...baseRoom,
      turnDeadlineAt: 30_000,
      gameState: {
        ...baseRoom.gameState!,
        currentTurnPlayerId: 'p1',
      },
    };

    // At t = 18_000 (12s remaining): overlay immediately alerts Alice!
    const myTurnAlert = computeOverlayTurnAlert({
      isOnline: true,
      onlineRoom: myTurnRoom,
      localGame: null,
      localDeadlineAt: null,
      nowMs: 18_000,
    });
    assert.ok(myTurnAlert !== null);
    assert.equal(myTurnAlert.isYourTurn, true);
    assert.equal(myTurnAlert.remainingSeconds, 12);
    assert.equal(myTurnAlert.urgent, false);

    // At t = 26_000 (4s remaining): urgent alert active, and returning to table immediately shows exact 4s!
    const urgentAlert = computeOverlayTurnAlert({
      isOnline: true,
      onlineRoom: myTurnRoom,
      localGame: null,
      localDeadlineAt: null,
      nowMs: 26_000,
    });
    assert.equal(urgentAlert?.urgent, true);
    assert.equal(urgentAlert?.remainingSeconds, 4);
    assert.equal(getRemainingSeconds(myTurnRoom.turnDeadlineAt, 26_000), 4);
  });

  it('online trick banner disables manual click advancement and misleading affordances while preserving local trick-banner behavior unchanged', () => {
    // Online (server-controlled): strictly non-clickable, no misleading tooltip or pointer cursor, no Continue button
    const onlineBanner = getTrickBannerInteraction({
      isServerControlled: true,
      autoAdvance: true,
    });
    assert.equal(onlineBanner.allowClickToAdvance, false);
    assert.equal(onlineBanner.showManualContinueButton, false);
    assert.equal(onlineBanner.showProgressBar, true);
    assert.equal(onlineBanner.tooltip, undefined);
    assert.equal(onlineBanner.cursorClass, '');

    // Even if autoAdvance were false on server-controlled banner, online NEVER exposes manual advance
    const onlineBannerManualFlag = getTrickBannerInteraction({
      isServerControlled: true,
      autoAdvance: false,
    });
    assert.equal(onlineBannerManualFlag.allowClickToAdvance, false);
    assert.equal(onlineBannerManualFlag.showManualContinueButton, false);

    // Local Auto mode: preserves existing tap-to-continue + progress bar
    const localAuto = getTrickBannerInteraction({
      isServerControlled: false,
      autoAdvance: true,
    });
    assert.equal(localAuto.allowClickToAdvance, true);
    assert.equal(localAuto.showManualContinueButton, false);
    assert.equal(localAuto.showProgressBar, true);
    assert.equal(localAuto.tooltip, 'Tap to continue immediately');
    assert.equal(localAuto.cursorClass, 'cursor-pointer');

    // Local Manual mode: preserves existing Continue button without auto progress bar
    const localManual = getTrickBannerInteraction({
      isServerControlled: false,
      autoAdvance: false,
    });
    assert.equal(localManual.allowClickToAdvance, false);
    assert.equal(localManual.showManualContinueButton, true);
    assert.equal(localManual.showProgressBar, false);
    assert.equal(localManual.tooltip, undefined);
    assert.equal(localManual.cursorClass, '');
  });

  it('online server-driven trick progression and turn timer remain authoritative for all connected players', async () => {
    const statesByPlayer = new Map<string, ClientRoomState[]>();
    const rm = new RoomManager(
      {
        onRoomUpdated(room) {
          for (const seat of room.seats) {
            if (seat.type !== 'human') continue;
            const view = rm.buildClientView(room, seat.playerId);
            const list = statesByPlayer.get(seat.playerId) ?? [];
            list.push(view);
            statesByPlayer.set(seat.playerId, list);
          }
        },
        onNotification() {},
        onRoomClosed() {},
      },
      {
        // Fast trick continue for deterministic unit test; disable background sweep timer
        trickSuccessDelayMs: 60,
        trickFailDelayMs: 60,
        cleanupIntervalMs: 0,
      }
    );

    try {
      const created = rm.createRoom({
        playerName: 'Alice',
        tableName: 'Server Authority Table',
        capacity: 2,
        visibility: 'private',
        turnTimerSeconds: 10,
        difficulty: 'easy',
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const roomCode = created.room.roomCode;
      const p1Id = created.playerId;

      const joined = rm.joinRoom({
        roomCode,
        playerName: 'Bob',
        inviteToken: created.room.inviteToken ?? undefined,
      });
      assert.equal(joined.ok, true);
      if (!joined.ok) return;
      const p2Id = joined.playerId;

      const started = rm.startGame(roomCode, p1Id);
      assert.equal(started.ok, true);

      const getView = (pid: string): ClientRoomState => {
        const room = rm.getRoom(roomCode);
        assert.ok(room !== undefined);
        return rm.buildClientView(room, pid);
      };

      // Verify server stamped authoritative turnDeadlineAt for BOTH clients
      const p1Start = getView(p1Id);
      const p2Start = getView(p2Id);
      assert.equal(p1Start.status, 'playing');
      assert.ok(p1Start.turnDeadlineAt !== null && p1Start.turnDeadlineAt > Date.now());
      assert.equal(p1Start.turnDeadlineAt, p2Start.turnDeadlineAt);

      // Play Trick 1 completely: leader plays A♠, follower plays a legal card
      const leaderId = p1Start.gameState!.currentTurnPlayerId!;
      const followerId = leaderId === p1Id ? p2Id : p1Id;
      const play1 = rm.playCardAction(roomCode, leaderId, ACE_OF_SPADES_ID);
      assert.equal(play1.ok, true);

      const followerView = getView(followerId);
      const followerHand = followerView.gameState!.players.find((p) => p.id === followerId)!.hand;
      const spadeCard = followerHand.find((c) => c.suit === 'spades') ?? followerHand[0];
      const play2 = rm.playCardAction(roomCode, followerId, spadeCard.id);
      assert.equal(play2.ok, true);

      // Immediately after Trick 1 completes, BOTH players are in 'trick_result'
      // and premature card plays are rejected while the server controls the banner duration.
      assert.equal(getView(p1Id).gameState!.phase, 'trick_result');
      assert.equal(getView(p2Id).gameState!.phase, 'trick_result');
      const prematurePlay = rm.playCardAction(
        roomCode,
        leaderId,
        getView(leaderId).gameState!.players.find((p) => p.id === leaderId)!.hand[0].id
      );
      assert.equal(prematurePlay.ok, false);

      // Wait for server-authoritative trick transition timer (60ms + buffer)
      await new Promise((r) => setTimeout(r, 120));

      // BOTH connected players MUST transition consistently to Trick 2 ('playing') with identical leader & deadline
      const p1After = getView(p1Id);
      const p2After = getView(p2Id);
      assert.equal(p1After.gameState!.phase, 'playing');
      assert.equal(p2After.gameState!.phase, 'playing');
      assert.equal(p1After.gameState!.currentTrick.trickNumber, 2);
      assert.equal(p2After.gameState!.currentTrick.trickNumber, 2);
      assert.equal(
        p1After.gameState!.currentTurnPlayerId,
        p2After.gameState!.currentTurnPlayerId
      );
      assert.ok(p1After.turnDeadlineAt !== null);
      assert.equal(p1After.turnDeadlineAt, p2After.turnDeadlineAt);
      // Both players received server room updates for Trick 2
      assert.ok((statesByPlayer.get(p1Id) ?? []).some((s) => s.gameState?.currentTrick.trickNumber === 2));
      assert.ok((statesByPlayer.get(p2Id) ?? []).some((s) => s.gameState?.currentTrick.trickNumber === 2));
    } finally {
      rm.disposeAll();
    }
  });
});
