import type { Position } from './types';

export interface Format {
  key: string;
  label: string;
  slots: Position[];
  periods: number;
  periodMinutes: number;
}

export const FORMATS: Format[] = [
  { key: '4v4', label: '4v4 (no GK)', slots: ['DEF', 'DEF', 'FWD', 'FWD'], periods: 4, periodMinutes: 10 },
  { key: '5v5', label: '5v5', slots: ['GK', 'DEF', 'DEF', 'FWD', 'FWD'], periods: 4, periodMinutes: 12 },
  { key: '7v7', label: '7v7', slots: ['GK', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD'], periods: 2, periodMinutes: 25 },
  { key: '9v9', label: '9v9', slots: ['GK', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD'], periods: 2, periodMinutes: 30 },
  {
    key: '11v11',
    label: '11v11',
    slots: ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'],
    periods: 2,
    periodMinutes: 35,
  },
];

export function formatByKey(key: string): Format | undefined {
  return FORMATS.find((f) => f.key === key);
}

/** Order slots GK → DEF → MID → FWD so the field view draws goal-to-attack. */
const ORDER: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
export function sortSlots(slots: Position[]): Position[] {
  return [...slots].sort((a, b) => ORDER[a] - ORDER[b]);
}
