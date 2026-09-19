import { replay, type PlayerTime } from './timing';
import type { Game, GameEvent, Player, Position } from './types';
import { POSITIONS } from './types';

export interface PlayerLine {
  player: Player;
  games: number; // games attended (in present list or played)
  total: number;
  byPos: Record<Position, number>;
}

/** Final per-player time for a game, computed at the time of its last event. */
export function gameTotals(game: Game, events: GameEvent[]): Record<number, PlayerTime> {
  const end = events.length ? events[events.length - 1].t : game.date;
  return replay(game, events, end).players;
}

export function seasonLines(players: Player[], games: Game[], eventsByGame: Map<number, GameEvent[]>): PlayerLine[] {
  const lines = new Map<number, PlayerLine>();
  for (const p of players) {
    lines.set(p.id!, { player: p, games: 0, total: 0, byPos: { GK: 0, DEF: 0, MID: 0, FWD: 0 } });
  }
  for (const g of games) {
    const totals = gameTotals(g, eventsByGame.get(g.id!) ?? []);
    for (const [idStr, t] of Object.entries(totals)) {
      const line = lines.get(Number(idStr));
      if (!line) continue;
      line.games += 1;
      line.total += t.total;
      for (const pos of POSITIONS) line.byPos[pos] += t.byPos[pos];
    }
  }
  return [...lines.values()];
}

export function playerLabel(p: Pick<Player, 'name' | 'number'>): string {
  return p.number ? `#${p.number} ${p.name}` : p.name;
}
