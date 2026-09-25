import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { LiveGame } from './LiveGame';
import { GameSummary } from './GameSummary';

export function GameScreen({ gameId }: { gameId: number }) {
  // null = no such game (undefined means still loading).
  const game = useLiveQuery(async () => (await db.games.get(gameId)) ?? null, [gameId]);
  const team = useLiveQuery(async () => (game ? db.teams.get(game.teamId) : undefined), [game?.teamId]);
  const players = useLiveQuery(
    async () => (game ? db.players.where('teamId').equals(game.teamId).toArray() : undefined),
    [game?.teamId],
  );
  const events = useLiveQuery(() => db.events.where('gameId').equals(gameId).sortBy('t'), [gameId]);

  if (game === null) return <p style={{ padding: 16 }}>Game not found.</p>;
  if (!game || !team || !players || !events) return null;

  return game.status === 'live' ? (
    <LiveGame game={game} team={team} players={players} events={events} />
  ) : (
    <GameSummary game={game} team={team} players={players} events={events} />
  );
}
