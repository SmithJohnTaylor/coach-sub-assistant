export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

export interface Team {
  id?: number;
  name: string;
  format: string; // key into FORMATS, or 'custom'
  slots: Position[]; // one entry per on-field spot
  createdAt: number;
}

export interface Player {
  id?: number;
  teamId: number;
  name: string;
  number?: string;
  archived?: boolean;
}

export type GameStatus = 'live' | 'done';

export interface Game {
  id?: number;
  teamId: number;
  date: number;
  opponent?: string;
  periods: number;
  periodMinutes: number;
  slots: Position[]; // snapshot of team formation at game time
  present: number[]; // player ids available for this game
  startLineup: (number | null)[]; // player id per slot at kickoff
  status: GameStatus;
}

/** Everything that changes during a game is an event with a wall-clock timestamp. */
export type GameEvent =
  | { id?: number; gameId: number; t: number; type: 'start' } // clock runs
  | { id?: number; gameId: number; t: number; type: 'pause' } // clock stops, same period
  | { id?: number; gameId: number; t: number; type: 'periodEnd' } // clock stops, next period
  | { id?: number; gameId: number; t: number; type: 'sub'; slot: number; playerIn: number | null }
  | { id?: number; gameId: number; t: number; type: 'swap'; slotA: number; slotB: number };

export type GameEventType = GameEvent['type'];

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before it is stamped with its game and time. */
export type EventInput = DistOmit<GameEvent, 'id' | 'gameId' | 't'>;
