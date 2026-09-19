import Dexie, { type EntityTable } from 'dexie';
import type { Game, GameEvent, Player, Team } from './types';

export const db = new Dexie('coach-sub-assistant') as Dexie & {
  teams: EntityTable<Team, 'id'>;
  players: EntityTable<Player, 'id'>;
  games: EntityTable<Game, 'id'>;
  events: EntityTable<GameEvent, 'id'>;
};

db.version(1).stores({
  teams: '++id, name',
  players: '++id, teamId',
  games: '++id, teamId, status, date',
  events: '++id, gameId, t',
});

export async function gameEvents(gameId: number): Promise<GameEvent[]> {
  return db.events.where('gameId').equals(gameId).sortBy('t');
}

export async function addEvent(e: GameEvent): Promise<void> {
  await db.events.add(e);
}

/** Remove the most recent event for a game. */
export async function undoLast(gameId: number): Promise<GameEvent | undefined> {
  const events = await gameEvents(gameId);
  const last = events.at(-1);
  if (last?.id != null) await db.events.delete(last.id);
  return last;
}

export async function deleteGame(gameId: number): Promise<void> {
  await db.transaction('rw', db.games, db.events, async () => {
    await db.events.where('gameId').equals(gameId).delete();
    await db.games.delete(gameId);
  });
}

export async function deleteTeam(teamId: number): Promise<void> {
  await db.transaction('rw', [db.teams, db.players, db.games, db.events], async () => {
    const games = (await db.games.where('teamId').equals(teamId).primaryKeys()) as number[];
    await db.events.where('gameId').anyOf(games).delete();
    await db.games.bulkDelete(games);
    await db.players.where('teamId').equals(teamId).delete();
    await db.teams.delete(teamId);
  });
}

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence(): void {
  navigator.storage?.persist?.().catch(() => {});
}
