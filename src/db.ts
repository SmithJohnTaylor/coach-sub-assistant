import Dexie, { type EntityTable } from 'dexie';
import { undoReplacement } from './timing';
import type { Game, GameEvent, Player, Team } from './types';

// Dexie's live-query cache can keep serving a deleted game (seen with deleteGame in 4.4.6),
// which left "Resume game" pointing at nothing. The data is tiny, so always read through.
export const db = new Dexie('coach-sub-assistant', { cache: 'disabled' }) as Dexie & {
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

/** Remove the most recent event for a game (see undoReplacement for End period). */
export async function undoLast(gameId: number): Promise<GameEvent | undefined> {
  return db.transaction('rw', db.events, async () => {
    const last = (await gameEvents(gameId)).at(-1);
    if (last?.id == null) return last;
    await db.events.delete(last.id);
    const replacement = undoReplacement(last);
    if (replacement) await db.events.add(replacement);
    return last;
  });
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
