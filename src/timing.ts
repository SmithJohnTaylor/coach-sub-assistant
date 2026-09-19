import type { Game, GameEvent, Position } from './types';

export interface PlayerTime {
  /** Total on-field ms while the clock was running. */
  total: number;
  byPos: Record<Position, number>;
  /** gameMs when the player last came on (undefined while on the bench). */
  onSince?: number;
  /** gameMs when the player last went to the bench (0 = sat from kickoff). */
  benchSince: number;
}

export interface GameState {
  running: boolean;
  /** 1-based current period. */
  period: number;
  /** Running ms elapsed in the current period. */
  periodMs: number;
  /** Running ms elapsed across the whole game. */
  gameMs: number;
  finished: boolean;
  lineup: (number | null)[];
  players: Record<number, PlayerTime>;
}

type GameShape = Pick<Game, 'slots' | 'startLineup' | 'periods' | 'present'>;

const emptyByPos = (): Record<Position, number> => ({ GK: 0, DEF: 0, MID: 0, FWD: 0 });

/**
 * Rebuild game state from the event log. Time only accrues while the clock runs,
 * and is measured from wall-clock timestamps, so a locked phone or a reload loses nothing.
 */
export function replay(game: GameShape, events: GameEvent[], now: number): GameState {
  const players: Record<number, PlayerTime> = {};
  const ensure = (id: number): PlayerTime =>
    (players[id] ??= { total: 0, byPos: emptyByPos(), benchSince: 0 });

  for (const id of game.present) ensure(id);

  const s: GameState = {
    running: false,
    period: 1,
    periodMs: 0,
    gameMs: 0,
    finished: false,
    lineup: [...game.startLineup],
    players,
  };
  for (const id of s.lineup) if (id != null) ensure(id).onSince = 0;

  let lastT = 0;

  const accrue = (t: number) => {
    if (!s.running) return;
    const dt = Math.max(0, t - lastT);
    s.periodMs += dt;
    s.gameMs += dt;
    s.lineup.forEach((id, slot) => {
      if (id == null) return;
      const p = ensure(id);
      p.total += dt;
      p.byPos[game.slots[slot]] += dt;
    });
  };

  const goOff = (id: number) => {
    const p = ensure(id);
    p.onSince = undefined;
    p.benchSince = s.gameMs;
  };
  const goOn = (id: number) => {
    ensure(id).onSince = s.gameMs;
  };

  const sorted = [...events].sort((a, b) => a.t - b.t || (a.id ?? 0) - (b.id ?? 0));

  for (const e of sorted) {
    accrue(e.t);
    lastT = e.t;

    switch (e.type) {
      case 'start':
        if (!s.finished) s.running = true;
        break;
      case 'pause':
        s.running = false;
        break;
      case 'periodEnd':
        s.running = false;
        if (s.period >= game.periods) s.finished = true;
        else {
          s.period += 1;
          s.periodMs = 0;
        }
        break;
      case 'sub': {
        const out = s.lineup[e.slot];
        if (out === e.playerIn) break;
        // If the incoming player is already on the field elsewhere, vacate that slot.
        if (e.playerIn != null) {
          const from = s.lineup.indexOf(e.playerIn);
          if (from !== -1) s.lineup[from] = null;
          else goOn(e.playerIn);
        }
        if (out != null) goOff(out);
        s.lineup[e.slot] = e.playerIn;
        break;
      }
      case 'swap': {
        const a = s.lineup[e.slotA];
        s.lineup[e.slotA] = s.lineup[e.slotB];
        s.lineup[e.slotB] = a;
        break;
      }
    }
  }

  accrue(now);
  return s;
}

/** mm:ss, or h:mm:ss past an hour. */
export function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Whole-ish minutes for summaries: 12.5 → "12.5". */
export function mins(ms: number): string {
  const m = ms / 60000;
  return (Math.round(m * 10) / 10).toString();
}
