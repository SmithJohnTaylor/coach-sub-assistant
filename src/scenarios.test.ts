/**
 * Game-day scenario simulations for the timing engine: realistic full games,
 * sideline mistakes, and a randomized differential test against a naive
 * second-by-second reference model.
 */
import { describe, expect, it } from 'vitest';
import { toCsv, toText } from './export';
import { FORMATS } from './formats';
import { gameTotals, seasonLines } from './stats';
import { replay, undoReplacement, type GameState } from './timing';
import type { EventInput, Game, GameEvent, Player, Position } from './types';

const SEC = 1000;
const MIN = 60 * SEC;

/** Builds an event log the way the app does: wall-clock stamps, auto-increment ids. */
class Sim {
  events: GameEvent[] = [];
  t: number;
  private nextId = 1;
  constructor(
    public game: Game,
    start = Date.UTC(2026, 8, 27, 9, 0),
  ) {
    this.t = start;
  }
  wait(ms: number) {
    this.t += ms;
    return this;
  }
  emit(e: EventInput) {
    this.events.push({ ...e, id: this.nextId++, gameId: this.game.id!, t: this.t } as GameEvent);
    return this;
  }
  start = () => this.emit({ type: 'start' });
  pause = () => this.emit({ type: 'pause' });
  endPeriod = () => this.emit({ type: 'periodEnd' });
  sub = (slot: number, playerIn: number | null) => this.emit({ type: 'sub', slot, playerIn });
  swap = (slotA: number, slotB: number) => this.emit({ type: 'swap', slotA, slotB });
  /** Put `playerIn` into whichever slot `playerOut` currently occupies. */
  subFor(playerOut: number, playerIn: number) {
    const slot = this.state().lineup.indexOf(playerOut);
    if (slot === -1) throw new Error(`player ${playerOut} is not on the field`);
    return this.sub(slot, playerIn);
  }
  /** Same as the app's Undo button (db.undoLast). */
  undo() {
    const last = this.events.pop();
    const replacement = last && undoReplacement(last);
    if (replacement) this.events.push({ ...replacement, id: this.nextId++ });
    return this;
  }
  state(now = this.t): GameState {
    return replay(this.game, this.events, now);
  }
}

function makeGame(formatKey: string, rosterSize: number, overrides: Partial<Game> = {}): Game {
  const f = FORMATS.find((x) => x.key === formatKey)!;
  const ids = Array.from({ length: rosterSize }, (_, i) => i + 1);
  return {
    id: 1,
    teamId: 1,
    date: Date.UTC(2026, 8, 27, 9, 0),
    periods: f.periods,
    periodMinutes: f.periodMinutes,
    slots: f.slots,
    present: ids,
    startLineup: ids.slice(0, f.slots.length),
    status: 'live',
    ...overrides,
  };
}

/** Invariants that must hold for any state the app can show. */
function checkInvariants(game: Pick<Game, 'slots'>, s: GameState) {
  const onField = s.lineup.filter((x): x is number => x != null);
  expect(new Set(onField).size, 'a player is in two spots at once').toBe(onField.length);
  expect(s.periodMs).toBeLessThanOrEqual(s.gameMs);
  for (const [id, p] of Object.entries(s.players)) {
    const posSum = Object.values(p.byPos).reduce((a, b) => a + b, 0);
    expect(posSum, `player ${id} position split != total`).toBe(p.total);
    expect(p.total, `player ${id} has more time than the game`).toBeLessThanOrEqual(s.gameMs);
    const isOn = onField.includes(Number(id));
    expect(p.onSince !== undefined, `player ${id} onSince disagrees with lineup`).toBe(isOn);
  }
  expect(s.lineup.length).toBe(game.slots.length);
}

const total = (s: GameState, id: number) => s.players[id].total;

describe('full game scenarios', () => {
  it('7v7, 10 kids, two halves with rolling subs: exact minutes for everyone', () => {
    // Slots: GK DEF DEF MID MID MID FWD. Players 1-7 start, 8-10 on the bench.
    const g = new Sim(makeGame('7v7', 10));
    g.start().wait(8 * MIN);
    g.subFor(7, 8).subFor(6, 9).subFor(5, 10); // 3 subs at 8:00
    g.wait(8 * MIN);
    g.subFor(4, 7).subFor(3, 6); // 2 more at 16:00
    g.wait(9 * MIN).wait(20 * SEC); // half runs 25:20 (stoppage)
    g.endPeriod();

    const half = g.state();
    expect(half.period).toBe(2);
    expect(half.running).toBe(false);
    expect(half.gameMs).toBe(25 * MIN + 20 * SEC);

    // Halftime: 10 minutes pass; none of it should count. New keeper, subs.
    g.wait(5 * MIN).swap(0, 1); // GK 1 <-> DEF 2
    g.subFor(8, 4).subFor(9, 3).subFor(10, 5);
    g.wait(5 * MIN).start();
    checkInvariants(g.game, g.state());

    g.wait(12 * MIN).subFor(2, 8).subFor(1, 9);
    g.wait(13 * MIN).endPeriod();
    const end = g.state();
    expect(end.finished).toBe(true);
    expect(end.gameMs).toBe(50 * MIN + 20 * SEC);

    // Hand-computed expectations (first half 25:20, second half 25:00).
    const h1 = 25 * MIN + 20 * SEC;
    expect(total(end, 1)).toBe(h1 + 12 * MIN); // GK first half, DEF until 12' of 2nd half
    expect(end.players[1].byPos).toMatchObject({ GK: h1, DEF: 12 * MIN });
    expect(total(end, 2)).toBe(h1 + 12 * MIN);
    expect(end.players[2].byPos).toMatchObject({ DEF: h1, GK: 12 * MIN });
    expect(total(end, 3)).toBe(16 * MIN + 25 * MIN);
    expect(total(end, 4)).toBe(16 * MIN + 25 * MIN);
    expect(total(end, 5)).toBe(8 * MIN + 25 * MIN);
    expect(total(end, 6)).toBe(8 * MIN + (h1 - 16 * MIN) + 25 * MIN);
    expect(total(end, 7)).toBe(8 * MIN + (h1 - 16 * MIN) + 25 * MIN);
    expect(total(end, 8)).toBe(h1 - 8 * MIN + 13 * MIN);
    expect(total(end, 9)).toBe(h1 - 8 * MIN + 13 * MIN);
    expect(total(end, 10)).toBe(h1 - 8 * MIN);

    // On-field minutes always add up to 7 spots × game length.
    const sum = Object.values(end.players).reduce((a, p) => a + p.total, 0);
    expect(sum).toBe(7 * end.gameMs);
    checkInvariants(g.game, end);

    // Time after the final whistle never counts, and the saved summary matches.
    expect(g.state(g.t + 3 * 60 * MIN).gameMs).toBe(end.gameMs);
    const saved = gameTotals(g.game, g.events);
    for (let id = 1; id <= 10; id++) expect(saved[id].total).toBe(total(end, id));
  });

  it('4v4 quarters, no keeper, rotate everyone at each quarter break', () => {
    // 7 kids, 4 on field, 4 × 10 min.
    const g = new Sim(makeGame('4v4', 7));
    for (let q = 1; q <= 4; q++) {
      g.start().wait(10 * MIN).endPeriod();
      if (q < 4) {
        // Break: the three least-played bench kids replace the three most-played on the field.
        g.wait(2 * MIN);
        const s = g.state();
        const on = s.lineup.filter((x): x is number => x != null);
        const bench = g.game.present.filter((id) => !on.includes(id)).sort((a, b) => total(s, a) - total(s, b));
        const tired = [...on].sort((a, b) => total(s, b) - total(s, a));
        bench.slice(0, 3).forEach((id, k) => g.subFor(tired[k], id));
      }
      checkInvariants(g.game, g.state());
    }
    const s = g.state();
    expect(s.finished).toBe(true);
    expect(s.gameMs).toBe(40 * MIN);
    const sum = Object.values(s.players).reduce((a, p) => a + p.total, 0);
    expect(sum).toBe(4 * 40 * MIN);
    // With 7 kids and 16 player-quarters, nobody plays fewer than 2 or more than 3 quarters.
    for (let id = 1; id <= 7; id++) {
      expect(total(s, id)).toBeGreaterThanOrEqual(20 * MIN);
      expect(total(s, id)).toBeLessThanOrEqual(30 * MIN);
      expect(s.players[id].byPos.GK).toBe(0);
    }
  });

  it('every built-in format plays a full game with correct totals', () => {
    for (const f of FORMATS) {
      const roster = f.slots.length + 3;
      const g = new Sim(makeGame(f.key, roster));
      for (let p = 1; p <= f.periods; p++) {
        g.start().wait(f.periodMinutes * MIN).endPeriod();
        if (p < f.periods) g.wait(5 * MIN);
      }
      const s = g.state();
      expect(s.finished, f.key).toBe(true);
      expect(s.gameMs, f.key).toBe(f.periods * f.periodMinutes * MIN);
      for (let id = 1; id <= f.slots.length; id++) expect(total(s, id)).toBe(s.gameMs);
      for (let id = f.slots.length + 1; id <= roster; id++) expect(total(s, id)).toBe(0);
    }
  });
});

describe('sideline situations', () => {
  it('injury stoppage: pause, sub, resume — stoppage time counts for nobody', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.start().wait(14 * MIN).pause();
    g.wait(4 * MIN).subFor(3, 8); // 4 minutes tending to the injured player
    g.wait(30 * SEC).start().wait(6 * MIN);
    const s = g.state();
    expect(s.gameMs).toBe(20 * MIN);
    expect(total(s, 3)).toBe(14 * MIN);
    expect(total(s, 8)).toBe(6 * MIN);
    expect(s.players[3].benchSince).toBe(14 * MIN);
    checkInvariants(g.game, s);
  });

  it('playing short: player leaves with no replacement, spot filled later', () => {
    const g = new Sim(makeGame('7v7', 7));
    g.start().wait(10 * MIN).sub(4, null).wait(5 * MIN);
    let s = g.state();
    expect(s.lineup.filter((x) => x != null)).toHaveLength(6);
    expect(total(s, 5)).toBe(10 * MIN);
    g.sub(4, 5).wait(5 * MIN); // back on
    s = g.state();
    expect(total(s, 5)).toBe(15 * MIN);
    // 10 min × 7 on + 5 min × 6 on + 5 min × 7 on
    expect(Object.values(s.players).reduce((a, p) => a + p.total, 0)).toBe((70 + 30 + 35) * MIN);
    checkInvariants(g.game, s);
  });

  it('late arrival joins the bench and then the field', () => {
    const game = makeGame('7v7', 9, { present: [1, 2, 3, 4, 5, 6, 7, 8] });
    const g = new Sim(game);
    g.start().wait(12 * MIN);
    g.game = { ...game, present: [...game.present, 9] }; // "+ Late arrival"
    g.subFor(6, 9).wait(13 * MIN).endPeriod();
    const s = g.state();
    expect(total(s, 9)).toBe(13 * MIN);
    expect(total(s, 6)).toBe(12 * MIN);
    checkInvariants(g.game, s);
  });

  it('starting with an empty spot (not enough kids yet) and filling it after kickoff', () => {
    const game = makeGame('7v7', 7, { startLineup: [1, 2, 3, 4, 5, 6, null], present: [1, 2, 3, 4, 5, 6] });
    const g = new Sim(game);
    g.start().wait(3 * MIN);
    g.game = { ...game, present: [...game.present, 7] };
    g.sub(6, 7).wait(7 * MIN);
    const s = g.state();
    expect(total(s, 7)).toBe(7 * MIN);
    expect(total(s, 1)).toBe(10 * MIN);
  });

  it('phone locked / app closed for 20 minutes: time keeps accruing correctly', () => {
    const g = new Sim(makeGame('9v9', 12));
    g.start().wait(3 * MIN).subFor(9, 10);
    // No events for 20 minutes — the app is reopened and replays from the log.
    const s = g.state(g.t + 20 * MIN);
    expect(s.gameMs).toBe(23 * MIN);
    expect(total(s, 10)).toBe(20 * MIN);
    expect(s.running).toBe(true);
  });

  it('forgot to press Start at kickoff: those minutes are lost for everyone equally', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.wait(2 * MIN).start().wait(23 * MIN); // pressed Start two minutes late
    const s = g.state();
    expect(s.gameMs).toBe(23 * MIN);
    expect(total(s, 1)).toBe(23 * MIN);
  });

  it('forgot to end the half: clock runs through halftime, shown as stoppage', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.start().wait(35 * MIN); // 25 min half + 10 min break, never ended
    const s = g.state();
    expect(s.period).toBe(1);
    expect(s.periodMs - 25 * MIN).toBe(10 * MIN); // the "+10:00" the clock shows
    expect(total(s, 1)).toBe(35 * MIN); // starters are over-credited by the break
  });

  it('accidental End period, undone: back in the same period, paused at the whistle', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.start().wait(10 * MIN).endPeriod();
    g.wait(15 * SEC).undo(); // "↶ Undo: end of period"
    let s = g.state(g.t + 5 * MIN);
    expect(s.period).toBe(1);
    expect(s.running).toBe(false);
    expect(s.gameMs).toBe(10 * MIN);
    g.start().wait(5 * MIN); // coach taps Resume
    s = g.state();
    expect(s.gameMs).toBe(15 * MIN);
    expect(total(s, 1)).toBe(15 * MIN);
  });

  it('undoing End period during halftime never counts the break', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.start().wait(25 * MIN).endPeriod();
    g.wait(10 * MIN).undo(); // oops, meant to undo something else
    const s = g.state();
    expect(s.period).toBe(1);
    expect(s.periodMs).toBe(25 * MIN);
    expect(total(s, 1)).toBe(25 * MIN);
    g.endPeriod().start().wait(25 * MIN).endPeriod(); // re-end the half and play on
    expect(g.state().gameMs).toBe(50 * MIN);
    expect(g.state().finished).toBe(true);
  });

  it('saved game reopened days later, final whistle undone: no phantom minutes', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.start().wait(25 * MIN).endPeriod().wait(10 * MIN).start().wait(25 * MIN).endPeriod();
    const saved = gameTotals(g.game, g.events);
    g.wait(2 * 24 * 60 * MIN).undo(); // Reopen game → Undo: end of period
    const s = g.state(g.t + 60 * MIN);
    expect(s.finished).toBe(false);
    expect(s.running).toBe(false);
    expect(s.period).toBe(2);
    expect(s.gameMs).toBe(50 * MIN);
    expect(total(s, 1)).toBe(saved[1].total);
    g.endPeriod(); // End game again
    expect(gameTotals(g.game, g.events)[1].total).toBe(50 * MIN);
  });

  it('wrong player subbed in, undone', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.start().wait(10 * MIN).subFor(4, 8);
    g.wait(20 * SEC).undo().subFor(4, 9).wait(5 * MIN);
    const s = g.state();
    expect(total(s, 8)).toBe(0);
    expect(total(s, 9)).toBe(5 * MIN);
    expect(total(s, 4)).toBe(10 * MIN + 20 * SEC); // was still on the field until the fix
    expect(s.players[8].onSince).toBeUndefined();
  });

  it('double tap: two events in the same millisecond keep their tap order', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.start().wait(5 * MIN);
    g.subFor(7, 8).subFor(8, 9); // same timestamp: 8 in, then immediately replaced by 9
    g.wait(MIN);
    const s = g.state();
    expect(s.lineup[6]).toBe(9);
    expect(total(s, 8)).toBe(0);
    // Order comes from ids, not array position.
    const shuffled = [...g.events].reverse();
    expect(replay(g.game, shuffled, g.t)).toEqual(s);
  });

  it('double tap on Start / Pause is harmless', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.start().start().wait(5 * MIN).pause().pause().wait(MIN).start().start().wait(MIN);
    expect(g.state().gameMs).toBe(6 * MIN);
  });

  it('subbing in a player who is already on the field moves them', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.start().wait(5 * MIN).sub(0, 7).wait(5 * MIN); // FWD 7 goes in goal, FWD spot now empty
    const s = g.state();
    expect(s.lineup[0]).toBe(7);
    expect(s.lineup[6]).toBeNull();
    expect(s.players[1].onSince).toBeUndefined();
    expect(s.players[7].byPos).toMatchObject({ FWD: 5 * MIN, GK: 5 * MIN });
    checkInvariants(g.game, s);
  });
});

describe('after the game', () => {
  it('saved game totals ignore anything done after the final whistle', () => {
    const g = new Sim(makeGame('7v7', 9));
    g.start().wait(25 * MIN).endPeriod().wait(10 * MIN).start().wait(25 * MIN).endPeriod();
    g.wait(2 * MIN).subFor(1, 8); // fiddling with the field after full time
    const saved = gameTotals(g.game, g.events);
    expect(saved[1].total).toBe(50 * MIN);
    expect(saved[8].total).toBe(0);
  });

  it('season: averages are per game attended', () => {
    const players: Player[] = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, teamId: 1, name: `Kid ${i + 1}` }));
    const games: Game[] = [];
    const byGame = new Map<number, GameEvent[]>();
    for (let n = 1; n <= 3; n++) {
      // Kid 9 misses game 2.
      const present = n === 2 ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const g = new Sim(makeGame('7v7', 9, { id: n, present, status: 'done' }));
      g.start().wait(20 * MIN).subFor(1, 8);
      if (n !== 2) g.subFor(2, 9);
      g.wait(30 * MIN).endPeriod();
      g.game = { ...g.game, periods: 1 };
      games.push(g.game);
      byGame.set(n, g.events);
    }
    const lines = new Map(seasonLines(players, games, byGame).map((l) => [l.player.id!, l]));
    expect(lines.get(9)!.games).toBe(2);
    expect(lines.get(9)!.total).toBe(2 * 30 * MIN);
    expect(lines.get(8)!.games).toBe(3);
    expect(lines.get(8)!.total).toBe(3 * 30 * MIN);
    expect(lines.get(1)!.total).toBe(3 * 20 * MIN);
    expect(lines.get(2)!.total).toBe(20 * MIN + 50 * MIN + 20 * MIN);
  });

  it('CSV and share text survive awkward names', () => {
    const lines = [
      {
        player: { id: 1, teamId: 1, name: 'Smith, "JJ" Jr.', number: '7' },
        games: 2,
        total: 45 * MIN,
        byPos: { GK: 0, DEF: 15 * MIN, MID: 30 * MIN, FWD: 0 } as Record<Position, number>,
      },
    ];
    const csv = toCsv(lines, { perGame: true }).split('\n');
    expect(csv[0]).toBe('Player,Number,Games,Avg min/game,Total min,GK min,DEF min,MID min,FWD min');
    expect(csv[1]).toBe('"Smith, ""JJ"" Jr.",7,2,22.5,45,0,15,30,0');
    expect(toText('T', lines, { perGame: true })).toContain('#7 Smith, "JJ" Jr.: 45 min (2 games, avg 22.5) — DEF 15, MID 30');
  });
});

/** Tiny seeded PRNG so failures are reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/** Deliberately naive reference: walk the game one second at a time. */
function reference(game: Game, events: GameEvent[], now: number) {
  const lineup = [...game.startLineup];
  const totals: Record<number, Record<Position, number>> = {};
  let running = false;
  let period = 1;
  let finished = false;
  const bump = (id: number, pos: Position) => {
    totals[id] ??= { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    totals[id][pos] += SEC;
  };
  const byT = new Map<number, GameEvent[]>();
  for (const e of events) byT.set(e.t, [...(byT.get(e.t) ?? []), e]);
  const t0 = Math.min(now, ...events.map((e) => e.t));
  for (let t = t0; t < now; t += SEC) {
    for (const e of byT.get(t) ?? []) {
      if (e.type === 'start' && !finished) running = true;
      if (e.type === 'pause') running = false;
      if (e.type === 'periodEnd') {
        running = false;
        if (period >= game.periods) finished = true;
        else period++;
      }
      if (e.type === 'swap') [lineup[e.slotA], lineup[e.slotB]] = [lineup[e.slotB], lineup[e.slotA]];
      if (e.type === 'sub') {
        const already = e.playerIn == null ? -1 : lineup.indexOf(e.playerIn);
        if (already !== -1 && already !== e.slot) lineup[already] = null;
        lineup[e.slot] = e.playerIn;
      }
    }
    if (running) lineup.forEach((id, slot) => id != null && bump(id, game.slots[slot]));
  }
  return totals;
}

describe('randomized games vs. reference model', () => {
  it('2,000 random games agree second-for-second and keep invariants', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const r = rng(seed);
      const f = FORMATS[Math.floor(r() * FORMATS.length)];
      const roster = f.slots.length + Math.floor(r() * 6);
      const g = new Sim(makeGame(f.key, roster, { periods: 1 + Math.floor(r() * 4) }));
      const pick = () => (r() < 0.1 ? null : 1 + Math.floor(r() * roster));
      const n = 5 + Math.floor(r() * 60);
      for (let i = 0; i < n; i++) {
        // Mostly seconds apart, sometimes several in the same instant.
        if (r() > 0.15) g.wait(SEC * (1 + Math.floor(r() * 300)));
        const k = r();
        if (k < 0.15) g.start();
        else if (k < 0.22) g.pause();
        else if (k < 0.27) g.endPeriod();
        else if (k < 0.85) g.sub(Math.floor(r() * f.slots.length), pick());
        else g.swap(Math.floor(r() * f.slots.length), Math.floor(r() * f.slots.length));
        if (r() < 0.05) g.undo();
      }
      const now = g.t + SEC * Math.floor(r() * 600);
      const s = g.state(now);
      try {
        checkInvariants(g.game, s);
        const ref = reference(g.game, g.events, now);
        for (const [id, p] of Object.entries(s.players)) {
          const want = ref[Number(id)] ?? { GK: 0, DEF: 0, MID: 0, FWD: 0 };
          expect(p.byPos).toEqual(want);
        }
        const sum = Object.values(s.players).reduce((a, p) => a + p.total, 0);
        const refSum = Object.values(ref).reduce((a, p) => a + p.GK + p.DEF + p.MID + p.FWD, 0);
        expect(sum).toBe(refSum);
      } catch (err) {
        throw new Error(`seed ${seed} (${f.key}): ${(err as Error).message}`);
      }
    }
  });
});
