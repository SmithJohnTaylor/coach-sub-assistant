import { db } from './db';
import { slug } from './export';
import { formatByKey } from './formats';
import { POSITIONS, type Player, type Position, type Team } from './types';

/**
 * A team and its roster as a file one coach can send another, so either phone can run a game.
 * Only the team setup travels: no games, minutes, or live-sharing keys.
 */
export interface RosterFile {
  app: 'sub-assistant-roster';
  v: 1;
  team: { name: string; format: string; slots: Position[] };
  players: { name: string; number?: string }[];
}

const MAX_PLAYERS = 100;
const MAX_SLOTS = 20;

export function toRosterFile(team: Team, players: Player[]): { filename: string; json: string } {
  const file: RosterFile = {
    app: 'sub-assistant-roster',
    v: 1,
    team: { name: team.name, format: team.format, slots: team.slots },
    players: players.filter((p) => !p.archived).map((p) => (p.number ? { name: p.name, number: p.number } : { name: p.name })),
  };
  return { filename: `${slug(team.name) || 'team'}-roster.json`, json: JSON.stringify(file, null, 2) };
}

/** Read a roster file, or throw an Error whose message can be shown to the coach as-is. */
export function parseRosterFile(text: string): RosterFile {
  const bad = new Error("That file isn't a Sub Assistant roster.");
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    throw bad;
  }
  if (!isObj(x) || x.app !== 'sub-assistant-roster') throw bad;
  if (x.v !== 1) throw new Error('That roster was made by a newer version of Sub Assistant. Reload the app and try again.');

  const t = x.team;
  if (!isObj(t) || !Array.isArray(t.slots) || !Array.isArray(x.players)) throw bad;
  const name = str(t.name, 60);
  const slots = t.slots.filter((s): s is Position => POSITIONS.includes(s as Position));
  if (!name || slots.length !== t.slots.length || !slots.length || slots.length > MAX_SLOTS) throw bad;
  if (x.players.length > MAX_PLAYERS) throw bad;

  const players: RosterFile['players'] = [];
  for (const p of x.players) {
    if (!isObj(p)) throw bad;
    const pname = str(p.name, 60);
    if (!pname) throw bad;
    const number = str(p.number, 5);
    players.push(number ? { name: pname, number } : { name: pname });
  }
  // A format whose positions don't match is really a custom formation.
  const f = typeof t.format === 'string' ? formatByKey(t.format) : undefined;
  const format = f && f.slots.join() === slots.join() ? f.key : 'custom';
  return { app: x.app, v: 1, team: { name, format, slots }, players };
}

/** Add the roster as a new team on this phone. Returns the new team's id. */
export async function importRoster(file: RosterFile): Promise<number> {
  return db.transaction('rw', db.teams, db.players, async () => {
    const teamId = (await db.teams.add({ ...file.team, createdAt: Date.now() })) as number;
    await db.players.bulkAdd(file.players.map((p) => ({ ...p, teamId })));
    return teamId;
  });
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
