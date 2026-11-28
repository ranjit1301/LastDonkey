import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BOT_AVATAR_PROFILES } from './botAvatars.ts';
import {
  computePenaltyExpression,
  derivePlayerExpressionStates,
  getBasePenaltyExpression,
  getBotReliefMotionStyle,
  getReliefEligiblePlayerIds,
  resolveHumanAvatarPersona,
} from './facialExpressions.ts';
import {
  getReliefFrameForElapsed,
  RELIEF_ANIMATION_TIMING_MS,
} from './gameAnimations.ts';
import type { Card, FailedTrickOutcome, SuccessfulTrickOutcome, TrickOutcome } from '../engine/types.ts';

function makeDummyCards(count: number, prefix = 'c'): Card[] {
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
  return Array.from({ length: count }, (_, idx) => ({
    id: `${prefix}-${idx}`,
    suit: suits[idx % 4],
    rank: ((idx % 13) + 2) as Card['rank'],
  }));
}

function makeFailedOutcome(
  trickNumber: number,
  collectorId: string,
  penaltyCardsCount: number
): FailedTrickOutcome {
  const cards = makeDummyCards(penaltyCardsCount, `t${trickNumber}`);
  const plays = cards.map((card, i) => ({
    playerId: i === 0 ? collectorId : `other-${i}`,
    card,
    order: i,
  }));
  return {
    type: 'failed',
    trickNumber,
    ledSuit: 'spades',
    plays,
    offSuitPlay: plays[plays.length - 1],
    collectorId,
    collectedCards: cards,
    nextLeaderId: collectorId,
    newlyFinishedIds: [],
  };
}

function makeSuccessOutcome(
  trickNumber: number,
  winnerId: string,
  newlyFinishedIds: string[] = []
): SuccessfulTrickOutcome {
  const cards = makeDummyCards(2, `s${trickNumber}`);
  const plays = cards.map((card, i) => ({
    playerId: i === 0 ? winnerId : 'other',
    card,
    order: i,
  }));
  return {
    type: 'success',
    trickNumber,
    ledSuit: 'hearts',
    plays,
    highestPlay: plays[0],
    nextLeaderId: winnerId,
    newlyFinishedIds,
    removedCards: cards,
  };
}

test('getBasePenaltyExpression maps 0, 1, 2, 3, and 4+ penalty cards accurately', () => {
  assert.equal(getBasePenaltyExpression(0), 'normal');
  assert.equal(getBasePenaltyExpression(1), 'annoyed');
  assert.equal(getBasePenaltyExpression(2), 'shocked');
  assert.equal(getBasePenaltyExpression(3), 'sad');
  assert.equal(getBasePenaltyExpression(4), 'crying');
  assert.equal(getBasePenaltyExpression(6), 'crying');
});

test('computePenaltyExpression combines penalty count with consecutive-failure streak intensity', () => {
  const annoyed1 = computePenaltyExpression(1, 1);
  assert.equal(annoyed1.expression, 'annoyed');
  assert.equal(annoyed1.intensity, 1);

  const shocked1 = computePenaltyExpression(2, 1);
  assert.equal(shocked1.expression, 'shocked');
  assert.equal(shocked1.intensity, 1);

  const sad1 = computePenaltyExpression(3, 1);
  assert.equal(sad1.expression, 'sad');
  assert.equal(sad1.intensity, 1);

  const crying1 = computePenaltyExpression(4, 1);
  assert.equal(crying1.expression, 'crying');
  assert.equal(crying1.intensity, 1);

  const annoyed2 = computePenaltyExpression(1, 2);
  assert.equal(annoyed2.expression, 'annoyed');
  assert.equal(annoyed2.intensity, 2);
  assert.equal(annoyed2.consecutiveFailStreak, 2);

  const escalatedFrom1 = computePenaltyExpression(1, 3);
  assert.equal(escalatedFrom1.baseExpression, 'annoyed');
  assert.equal(escalatedFrom1.expression, 'shocked');
  assert.equal(escalatedFrom1.intensity, 3);

  const escalatedFrom3 = computePenaltyExpression(3, 3);
  assert.equal(escalatedFrom3.baseExpression, 'sad');
  assert.equal(escalatedFrom3.expression, 'crying');
  assert.equal(escalatedFrom3.intensity, 3);

  const escalatedFrom4 = computePenaltyExpression(5, 4);
  assert.equal(escalatedFrom4.expression, 'crying');
  assert.equal(escalatedFrom4.intensity, 3);
});

test('derivePlayerExpressionStates increments consecutive failure streak and resets on clean trick', () => {
  const playerIds = ['human-1', 'babloo'];

  const h1: TrickOutcome[] = [makeFailedOutcome(1, 'babloo', 1)];
  const s1 = derivePlayerExpressionStates({ playerIds, trickHistory: h1 });
  assert.equal(s1.babloo.expression, 'annoyed');
  assert.equal(s1.babloo.consecutiveFailStreak, 1);
  assert.equal(s1.babloo.intensity, 1);
  assert.equal(s1['human-1'].expression, 'normal');

  const h2: TrickOutcome[] = [...h1, makeFailedOutcome(2, 'babloo', 2)];
  const s2 = derivePlayerExpressionStates({ playerIds, trickHistory: h2 });
  assert.equal(s2.babloo.expression, 'shocked');
  assert.equal(s2.babloo.consecutiveFailStreak, 2);
  assert.equal(s2.babloo.intensity, 2);

  const h3: TrickOutcome[] = [...h2, makeFailedOutcome(3, 'babloo', 3)];
  const s3 = derivePlayerExpressionStates({ playerIds, trickHistory: h3 });
  assert.equal(s3.babloo.baseExpression, 'sad');
  assert.equal(s3.babloo.expression, 'crying');
  assert.equal(s3.babloo.consecutiveFailStreak, 3);
  assert.equal(s3.babloo.intensity, 3);

  const h4: TrickOutcome[] = [...h3, makeSuccessOutcome(4, 'human-1')];
  const s4 = derivePlayerExpressionStates({ playerIds, trickHistory: h4 });
  assert.equal(s4.babloo.expression, 'normal');
  assert.equal(s4.babloo.consecutiveFailStreak, 0);
  assert.equal(s4.babloo.intensity, 0);
});

test('derivePlayerExpressionStates resets a player streak when a DIFFERENT player receives the next failed-trick penalty', () => {
  const playerIds = ['human-1', 'babloo'];
  const history: TrickOutcome[] = [
    makeFailedOutcome(1, 'babloo', 2),
    makeFailedOutcome(2, 'babloo', 3),
    makeFailedOutcome(3, 'human-1', 4),
  ];

  const states = derivePlayerExpressionStates({ playerIds, trickHistory: history });
  assert.equal(states.babloo.expression, 'normal');
  assert.equal(states.babloo.consecutiveFailStreak, 0);
  assert.equal(states.babloo.intensity, 0);

  assert.equal(states['human-1'].expression, 'crying');
  assert.equal(states['human-1'].consecutiveFailStreak, 1);
  assert.equal(states['human-1'].intensity, 1);
});

test('derivePlayerExpressionStates deduplicates lastOutcome and is deterministic across reconnects', () => {
  const playerIds = ['human-1', 'babloo'];
  const outcome2 = makeFailedOutcome(2, 'babloo', 2);
  const history: TrickOutcome[] = [
    makeFailedOutcome(1, 'babloo', 1),
    outcome2,
  ];

  const clientA = derivePlayerExpressionStates({
    playerIds,
    trickHistory: history,
    lastOutcome: outcome2,
  });
  const reconnectedClientB = derivePlayerExpressionStates({
    playerIds,
    trickHistory: history,
    lastOutcome: outcome2,
  });

  assert.deepEqual(clientA, reconnectedClientB);
  assert.equal(clientA.babloo.consecutiveFailStreak, 2);
  assert.equal(clientA.babloo.expression, 'shocked');
  assert.equal(clientA.babloo.intensity, 2);
});

test('getReliefEligiblePlayerIds animates all active players simultaneously and excludes finished/removed players', () => {
  const players = [
    { id: 'human-1', finished: false, removed: false },
    { id: 'babloo', finished: false, removed: false },
    { id: 'surili', finished: true, removed: false },
    { id: 'rocky', finished: false, removed: false },
    { id: 'exited', finished: false, removed: true },
  ];

  // Successful trick where rocky also finishes on this exact trick
  const success = makeSuccessOutcome(5, 'babloo', ['rocky']);
  const eligible = getReliefEligiblePlayerIds(players, success);
  assert.deepEqual(eligible, ['human-1', 'babloo']);

  // Failed trick must NEVER trigger Sigh of Relief
  const failed = makeFailedOutcome(6, 'babloo', 2);
  assert.deepEqual(getReliefEligiblePlayerIds(players, failed), []);
});

test('getReliefFrameForElapsed sequences through hold -> exhale -> smile -> settle -> idle within 1-2 seconds', () => {
  assert.ok(
    RELIEF_ANIMATION_TIMING_MS.totalDurationMs >= 1000 &&
      RELIEF_ANIMATION_TIMING_MS.totalDurationMs <= 2000,
    'Relief animation duration must stay within 1-2 seconds'
  );
  assert.equal(getReliefFrameForElapsed(0), 'hold');
  assert.equal(getReliefFrameForElapsed(RELIEF_ANIMATION_TIMING_MS.frame1ExhaleMs + 10), 'exhale');
  assert.equal(getReliefFrameForElapsed(RELIEF_ANIMATION_TIMING_MS.frame2SmileMs + 10), 'smile');
  assert.equal(getReliefFrameForElapsed(RELIEF_ANIMATION_TIMING_MS.frame3SettleMs + 10), 'settle');
  assert.equal(getReliefFrameForElapsed(RELIEF_ANIMATION_TIMING_MS.totalDurationMs), 'idle');
});

test('resolveHumanAvatarPersona & getBotReliefMotionStyle personalize relief animations by character/avatar', () => {
  assert.equal(resolveHumanAvatarPersona({ avatarColor: '#E59A00' }), 'classic');
  assert.equal(resolveHumanAvatarPersona({ avatarColor: '#D95732' }), 'dramatic');
  assert.equal(resolveHumanAvatarPersona({ avatarColor: '#3A6B8A' }), 'cool');
  assert.equal(resolveHumanAvatarPersona({ avatarColor: '#8B5E83' }), 'zen');
  assert.equal(resolveHumanAvatarPersona({ preferredPersona: 'cool', avatarColor: '#E59A00' }), 'cool');

  assert.equal(getBotReliefMotionStyle('babloo-uncle'), 'dramatic');
  assert.equal(getBotReliefMotionStyle('surili'), 'graceful');
  assert.equal(getBotReliefMotionStyle('rocky-raja'), 'swagger');
});

test('all 12 bot characters have personalised Sigh of Relief sprite sheets registered in BotAvatar.tsx', () => {
  const botAvatarSource = fs.readFileSync(
    path.resolve(import.meta.dirname, '../components/BotAvatar.tsx'),
    'utf8'
  );
  const registryMatch = botAvatarSource.match(
    /const BOT_RELIEF_SHEETS[\s\S]*?=\s*\{([\s\S]*?)\};/
  );
  assert.ok(registryMatch, 'BOT_RELIEF_SHEETS registry must exist in BotAvatar.tsx');
  const registryBody = registryMatch[1];

  const validMotionStyles = new Set(['dramatic', 'graceful', 'swagger', 'calm']);
  for (const bot of BOT_AVATAR_PROFILES) {
    assert.ok(
      validMotionStyles.has(getBotReliefMotionStyle(bot.id)),
      `Bot ${bot.id} must have a valid relief motion style`
    );
    const hasKey =
      registryBody.includes(`'${bot.id}':`) ||
      new RegExp(`\\b${bot.id}\\s*:`).test(registryBody);
    assert.ok(
      hasKey,
      `Bot ${bot.id} (${bot.name}) must have a registered personalised relief sprite sheet`
    );
  }
});

test('all 12 characters have a registered penalty expression rendering path in BotAvatar.tsx', () => {
  const botAvatarSource = fs.readFileSync(
    path.resolve(import.meta.dirname, '../components/BotAvatar.tsx'),
    'utf8'
  );
  const exprSheetsMatch = botAvatarSource.match(
    /const BOT_EXPRESSION_SHEETS[\s\S]*?=\s*\{([\s\S]*?)\};/
  );
  const anchorsMatch = botAvatarSource.match(
    /export const CHARACTER_FACE_ANCHORS[\s\S]*?=\s*\{([\s\S]*?)\};/
  );
  assert.ok(exprSheetsMatch, 'BOT_EXPRESSION_SHEETS registry must exist in BotAvatar.tsx');
  assert.ok(anchorsMatch, 'CHARACTER_FACE_ANCHORS registry must exist in BotAvatar.tsx');

  const sheetsBody = exprSheetsMatch[1];
  const anchorsBody = anchorsMatch[1];

  for (const profile of BOT_AVATAR_PROFILES) {
    const inSheets =
      sheetsBody.includes(`'${profile.id}':`) ||
      new RegExp(`\\b${profile.id}\\s*:`).test(sheetsBody);
    const inAnchors =
      anchorsBody.includes(`'${profile.id}':`) ||
      new RegExp(`\\b${profile.id}\\s*:`).test(anchorsBody);
    assert.ok(
      inSheets || inAnchors,
      `Character ${profile.id} (${profile.name}) must have a penalty expression sheet or face-anchor overlay registered`
    );
  }
});

test('obsolete dizzy-star and shock-burst overlays are removed from BotAvatar.tsx and CardTableScreen.tsx', () => {
  const botAvatarSource = fs.readFileSync(
    path.resolve(import.meta.dirname, '../components/BotAvatar.tsx'),
    'utf8'
  );
  const cardTableSource = fs.readFileSync(
    path.resolve(import.meta.dirname, '../screens/CardTableScreen.tsx'),
    'utf8'
  );

  assert.equal(
    botAvatarSource.includes('showDizzyStars'),
    false,
    'BotAvatar.tsx must not render obsolete showDizzyStars overlay'
  );
  assert.equal(
    botAvatarSource.includes('showShockBurst'),
    false,
    'BotAvatar.tsx must not render obsolete showShockBurst overlay'
  );
  assert.equal(
    cardTableSource.includes('getPlayerStageEffect'),
    false,
    'CardTableScreen.tsx must not pass obsolete stageEffect overlays'
  );
});

test('human and bot penalty expressions track 1/2/3/4+ returned cards, escalate across consecutive fails, and reset after a successful trick', () => {
  const playerIds = ['human-p1', 'bot-surili', 'bot-rocky'];

  // Trick 1: human takes 1 card -> annoyed (intensity 1)
  const t1 = makeFailedOutcome(1, 'human-p1', 1);
  const afterT1 = derivePlayerExpressionStates({ playerIds, trickHistory: [t1] });
  assert.equal(afterT1['human-p1'].expression, 'annoyed');
  assert.equal(afterT1['human-p1'].intensity, 1);
  assert.equal(afterT1['human-p1'].consecutiveFailStreak, 1);

  // Trick 2: human takes 2 cards consecutively -> shocked (intensity 2, streak 2)
  const t2 = makeFailedOutcome(2, 'human-p1', 2);
  const afterT2 = derivePlayerExpressionStates({ playerIds, trickHistory: [t1, t2] });
  assert.equal(afterT2['human-p1'].expression, 'shocked');
  assert.equal(afterT2['human-p1'].intensity, 2);
  assert.equal(afterT2['human-p1'].consecutiveFailStreak, 2);

  // Trick 3: human takes 3 cards consecutively -> escalates from sad -> crying (intensity 3, streak 3)
  const t3 = makeFailedOutcome(3, 'human-p1', 3);
  const afterT3 = derivePlayerExpressionStates({ playerIds, trickHistory: [t1, t2, t3] });
  assert.equal(afterT3['human-p1'].baseExpression, 'sad');
  assert.equal(afterT3['human-p1'].expression, 'crying');
  assert.equal(afterT3['human-p1'].intensity, 3);
  assert.equal(afterT3['human-p1'].consecutiveFailStreak, 3);

  // Trick 4: successful trick resets human streak immediately
  const t4 = makeSuccessOutcome(4, 'bot-surili');
  const afterT4 = derivePlayerExpressionStates({ playerIds, trickHistory: [t1, t2, t3, t4] });
  assert.equal(afterT4['human-p1'].expression, 'normal');
  assert.equal(afterT4['human-p1'].intensity, 0);
  assert.equal(afterT4['human-p1'].consecutiveFailStreak, 0);

  // Trick 5: bot-surili takes 4+ cards -> crying (intensity 1, streak 1)
  const t5 = makeFailedOutcome(5, 'bot-surili', 4);
  const afterT5 = derivePlayerExpressionStates({ playerIds, trickHistory: [t1, t2, t3, t4, t5] });
  assert.equal(afterT5['bot-surili'].expression, 'crying');
  assert.equal(afterT5['bot-surili'].intensity, 1);
  assert.equal(afterT5['bot-surili'].consecutiveFailStreak, 1);
});

