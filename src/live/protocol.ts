/**
 * Wire format for live sharing, shared by the app and the relay server (server/).
 * One coach's phone owns the game and pushes a full snapshot on every change; watchers
 * only listen. Snapshots are a few KB, so there is no diffing and undo needs no special case.
 */
import type { GameEvent, GameStatus, Position } from '../types';

export interface SnapshotPlayer {
  id: number;
  name: string;
  number?: string;
}

export interface Snapshot {
  v: 1;
  teamName: string;
  opponent?: string;
  date: number;
  periods: number;
  periodMinutes: number;
  slots: Position[];
  present: number[];
  startLineup: (number | null)[];
  status: GameStatus;
  players: SnapshotPlayer[];
  events: GameEvent[];
  /** Owner's clock offset from the server (server minus owner), so watchers can line up. */
  clockOffset: number;
}

export type ClientMessage =
  | { type: 'auth'; key: string } // owner only, first message
  | { type: 'snapshot'; snap: Snapshot } // owner only
  | { type: 'ping'; c: number }; // client clock, for offset estimation

export type ServerMessage =
  | { type: 'pong'; c: number; s: number }
  | { type: 'snapshot'; snap: Snapshot; at: number } // `at` = server time it arrived
  | { type: 'waiting' } // no snapshot yet
  | { type: 'owner'; online: boolean } // to watchers
  | { type: 'watchers'; n: number } // to owner
  | { type: 'ended' }; // owner stopped sharing, or the share expired

/** Share ids are 128 random bits, base64url. Owner keys are 256. */
export const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;
export const MAX_SNAPSHOT_BYTES = 256 * 1024;
