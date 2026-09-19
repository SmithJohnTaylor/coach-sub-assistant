import { describe, expect, it } from 'vitest';
import { fmt, replay } from './timing';
import type { EventInput, GameEvent, Position } from './types';

const MIN = 60_000;
const slots: Position[] = ['GK', 'DEF', 'FWD'];
// Players 1,2,3 start; 4,5 on bench.
const game = { slots, startLineup: [1, 2, 3], periods: 2, present: [1, 2, 3, 4, 5] };
const ev = (t: number, e: EventInput) => ({ gameId: 1, t, ...e }) as GameEvent;

describe('replay', () => {
  it('accrues nothing before kickoff', () => {
    const s = replay(game, [], 10 * MIN);
    expect(s.gameMs).toBe(0);
    expect(s.players[1].total).toBe(0);
    expect(s.running).toBe(false);
  });

  it('accrues time for starters while running', () => {
    const s = replay(game, [ev(0, { type: 'start' })], 5 * MIN);
    expect(s.running).toBe(true);
    expect(s.periodMs).toBe(5 * MIN);
    expect(s.players[1].total).toBe(5 * MIN);
    expect(s.players[1].byPos.GK).toBe(5 * MIN);
    expect(s.players[2].byPos.DEF).toBe(5 * MIN);
    expect(s.players[4].total).toBe(0);
  });

  it('handles a mid-period sub', () => {
    const s = replay(
      game,
      [ev(0, { type: 'start' }), ev(4 * MIN, { type: 'sub', slot: 2, playerIn: 4 })],
      10 * MIN,
    );
    expect(s.lineup).toEqual([1, 2, 4]);
    expect(s.players[3].total).toBe(4 * MIN);
    expect(s.players[4].total).toBe(6 * MIN);
    expect(s.players[4].byPos.FWD).toBe(6 * MIN);
    expect(s.players[3].benchSince).toBe(4 * MIN);
    expect(s.players[4].onSince).toBe(4 * MIN);
  });

  it('does not count paused time', () => {
    const s = replay(
      game,
      [ev(0, { type: 'start' }), ev(3 * MIN, { type: 'pause' }), ev(10 * MIN, { type: 'start' })],
      12 * MIN,
    );
    expect(s.gameMs).toBe(5 * MIN);
    expect(s.players[1].total).toBe(5 * MIN);
  });

  it('subs while paused take effect with no time lost', () => {
    const s = replay(
      game,
      [
        ev(0, { type: 'start' }),
        ev(5 * MIN, { type: 'pause' }),
        ev(6 * MIN, { type: 'sub', slot: 0, playerIn: 5 }),
        ev(7 * MIN, { type: 'start' }),
      ],
      9 * MIN,
    );
    expect(s.players[1].total).toBe(5 * MIN);
    expect(s.players[5].total).toBe(2 * MIN);
    expect(s.players[5].byPos.GK).toBe(2 * MIN);
  });

  it('swaps positions and splits time by position', () => {
    const s = replay(
      game,
      [ev(0, { type: 'start' }), ev(2 * MIN, { type: 'swap', slotA: 0, slotB: 2 })],
      5 * MIN,
    );
    expect(s.lineup).toEqual([3, 2, 1]);
    expect(s.players[1].byPos).toEqual({ GK: 2 * MIN, DEF: 0, MID: 0, FWD: 3 * MIN });
    expect(s.players[3].byPos).toEqual({ GK: 3 * MIN, DEF: 0, MID: 0, FWD: 2 * MIN });
    expect(s.players[1].total).toBe(5 * MIN);
  });

  it('moves a player between slots when subbed into another slot', () => {
    const s = replay(
      game,
      [ev(0, { type: 'start' }), ev(MIN, { type: 'sub', slot: 0, playerIn: 3 })],
      2 * MIN,
    );
    expect(s.lineup).toEqual([3, 2, null]);
    expect(s.players[1].onSince).toBeUndefined();
    expect(s.players[3].byPos.GK).toBe(MIN);
    expect(s.players[3].byPos.FWD).toBe(MIN);
  });

  it('advances periods and finishes the game', () => {
    const s1 = replay(game, [ev(0, { type: 'start' }), ev(20 * MIN, { type: 'periodEnd' })], 30 * MIN);
    expect(s1.period).toBe(2);
    expect(s1.periodMs).toBe(0);
    expect(s1.gameMs).toBe(20 * MIN);
    expect(s1.finished).toBe(false);

    const s2 = replay(
      game,
      [
        ev(0, { type: 'start' }),
        ev(20 * MIN, { type: 'periodEnd' }),
        ev(25 * MIN, { type: 'start' }),
        ev(45 * MIN, { type: 'periodEnd' }),
        ev(46 * MIN, { type: 'start' }), // ignored after full time
      ],
      60 * MIN,
    );
    expect(s2.finished).toBe(true);
    expect(s2.running).toBe(false);
    expect(s2.gameMs).toBe(40 * MIN);
  });

  it('supports late arrivals not in the original present list', () => {
    const s = replay(
      { ...game, present: [1, 2, 3] },
      [ev(0, { type: 'start' }), ev(8 * MIN, { type: 'sub', slot: 1, playerIn: 9 })],
      10 * MIN,
    );
    expect(s.players[9].total).toBe(2 * MIN);
  });

  it('undo = replay without the last event', () => {
    const events = [ev(0, { type: 'start' }), ev(4 * MIN, { type: 'sub', slot: 2, playerIn: 4 })];
    const undone = replay(game, events.slice(0, -1), 10 * MIN);
    expect(undone.lineup).toEqual([1, 2, 3]);
    expect(undone.players[3].total).toBe(10 * MIN);
    expect(undone.players[4].total).toBe(0);
  });

  it('empty slot (player leaves with no replacement)', () => {
    const s = replay(
      game,
      [ev(0, { type: 'start' }), ev(3 * MIN, { type: 'sub', slot: 1, playerIn: null })],
      5 * MIN,
    );
    expect(s.lineup).toEqual([1, null, 3]);
    expect(s.players[2].total).toBe(3 * MIN);
  });
});

describe('fmt', () => {
  it('formats clocks', () => {
    expect(fmt(0)).toBe('0:00');
    expect(fmt(65_000)).toBe('1:05');
    expect(fmt(3_725_000)).toBe('1:02:05');
  });
});
