import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assignOvalOpponentSeats, estimateOvalViewportBudget } from './tableSeatLayout.ts';

describe('Oval Card-Table Dynamic Opponent Arrangement (2 to 6 Players)', () => {
  it('places 2-player opponent at top-center', () => {
    const map = assignOvalOpponentSeats(['Opp1']);
    assert.equal(map.mode, '2p');
    assert.deepEqual(map.topRow, [{ opponent: 'Opp1', slot: 'top-center' }]);
    assert.equal(map.leftSeat, null);
    assert.equal(map.rightSeat, null);
  });

  it('places 3-player opponents at upper-left and upper-right in clockwise order', () => {
    const map = assignOvalOpponentSeats(['Opp1', 'Opp2']);
    assert.equal(map.mode, '3p');
    assert.deepEqual(map.topRow, [
      { opponent: 'Opp1', slot: 'upper-left' },
      { opponent: 'Opp2', slot: 'upper-right' },
    ]);
    assert.equal(map.leftSeat, null);
    assert.equal(map.rightSeat, null);
  });

  it('places 4-player opponents clockwise at left (#1), top-center (#2), and right (#3)', () => {
    const map = assignOvalOpponentSeats(['Opp1', 'Opp2', 'Opp3']);
    assert.equal(map.mode, '4p');
    assert.deepEqual(map.leftSeat, { opponent: 'Opp1', slot: 'left' });
    assert.deepEqual(map.topRow, [{ opponent: 'Opp2', slot: 'top-center' }]);
    assert.deepEqual(map.rightSeat, { opponent: 'Opp3', slot: 'right' });
  });

  it('places 5-player opponents clockwise at left, top-left, top-right, and right', () => {
    const map = assignOvalOpponentSeats(['Opp1', 'Opp2', 'Opp3', 'Opp4']);
    assert.equal(map.mode, '5p');
    assert.deepEqual(map.leftSeat, { opponent: 'Opp1', slot: 'left' });
    assert.deepEqual(map.topRow, [
      { opponent: 'Opp2', slot: 'top-left' },
      { opponent: 'Opp3', slot: 'top-right' },
    ]);
    assert.deepEqual(map.rightSeat, { opponent: 'Opp4', slot: 'right' });
  });

  it('places 6-player opponents clockwise around left, top-left, top-center, top-right, and right', () => {
    const map = assignOvalOpponentSeats(['Opp1', 'Opp2', 'Opp3', 'Opp4', 'Opp5']);
    assert.equal(map.mode, '6p');
    assert.deepEqual(map.leftSeat, { opponent: 'Opp1', slot: 'left' });
    assert.deepEqual(map.topRow, [
      { opponent: 'Opp2', slot: 'top-left' },
      { opponent: 'Opp3', slot: 'top-center' },
      { opponent: 'Opp4', slot: 'top-right' },
    ]);
    assert.deepEqual(map.rightSeat, { opponent: 'Opp5', slot: 'right' });
  });
});

describe('Oval Card-Table Responsive Viewport Verification (360×800 → 430×932 + Landscape + 30+ Cards)', () => {
  const portraitViewports = [
    { name: '360×800', widthPx: 360, heightPx: 800 },
    { name: '375×812', widthPx: 375, heightPx: 812 },
    { name: '390×844', widthPx: 390, heightPx: 844 },
    { name: '412×915', widthPx: 412, heightPx: 915 },
    { name: '430×932', widthPx: 430, heightPx: 932 },
  ];

  it('fits 2, 3, 4, 5, and 6 players without horizontal overflow or portrait scrolling across all 5 mobile viewports (even with 30+ card hands)', () => {
    for (const vp of portraitViewports) {
      for (const totalPlayers of [2, 3, 4, 5, 6]) {
        for (const handSize of [10, 26, 35, 51]) {
          const budget = estimateOvalViewportBudget({
            widthPx: vp.widthPx,
            heightPx: vp.heightPx,
            totalPlayers,
            handSize,
            hasMediumAssist: true,
          });
          assert.equal(
            budget.hasHorizontalOverflow,
            false,
            `Expected no horizontal overflow at ${vp.name} (${totalPlayers}p, ${handSize} cards)`
          );
          assert.equal(
            budget.fitsWithoutPortraitScroll,
            true,
            `Expected no portrait scroll at ${vp.name} (${totalPlayers}p, ${handSize} cards; estimated ${budget.estimatedTotalHeightPx}px > ${vp.heightPx}px)`
          );
          assert.ok(
            budget.ovalCenterWidthPx >= 320,
            `Expected generous oval playing area width at ${vp.name} (got ${budget.ovalCenterWidthPx}px)`
          );
        }
      }
    }
  });

  it('maintains zero horizontal overflow and generous central felt width in mobile landscape and desktop viewports', () => {
    const wideViewports = [
      { name: 'Landscape 800×360', widthPx: 800, heightPx: 360 },
      { name: 'Landscape 844×390', widthPx: 844, heightPx: 390 },
      { name: 'Desktop 1024×768', widthPx: 1024, heightPx: 768 },
      { name: 'Desktop 1280×800', widthPx: 1280, heightPx: 800 },
    ];

    for (const vp of wideViewports) {
      for (const totalPlayers of [2, 3, 4, 6]) {
        const budget = estimateOvalViewportBudget({
          widthPx: vp.widthPx,
          heightPx: vp.heightPx,
          totalPlayers,
          handSize: 32,
        });
        assert.equal(
          budget.hasHorizontalOverflow,
          false,
          `Expected no horizontal overflow at ${vp.name} (${totalPlayers}p)`
        );
        assert.ok(
          budget.ovalCenterWidthPx >= 360,
          `Expected >= 360px oval center width at ${vp.name} (${totalPlayers}p; got ${budget.ovalCenterWidthPx}px)`
        );
      }
    }
  });
});
