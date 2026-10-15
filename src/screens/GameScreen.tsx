import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { ShareSheet, ShareStatus } from '../components/LiveShare';
import { db } from '../db';
import { liveUrl, randomToken, stopShare, watchLink } from '../live/client';
import { useShareSync } from '../live/hooks';
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
  const shareState = useShareSync(game, team, players, events);
  const [showLink, setShowLink] = useState(false);

  if (game === null) return <p style={{ padding: 16 }}>Game not found.</p>;
  if (!game || !team || !players || !events) return null;

  async function startSharing() {
    await db.games.update(gameId, { share: { id: randomToken(16), key: randomToken(32) } });
    setShowLink(true);
  }

  async function stopSharing() {
    if (!game?.share) return;
    if (!confirm("Stop sharing? The other coach's screen stops updating.")) return;
    stopShare(game.share);
    await db.games.update(gameId, { share: undefined });
    setShowLink(false);
  }

  if (game.status !== 'live') return <GameSummary game={game} team={team} players={players} events={events} />;

  return (
    <>
      <LiveGame
        game={game}
        team={team}
        players={players}
        events={events}
        statusBar={
          game.share && <ShareStatus state={shareState} onLink={() => setShowLink(true)} onStop={stopSharing} />
        }
        extraActions={
          !game.share &&
          liveUrl() && (
            <button className="link" onClick={startSharing}>
              Share live view
            </button>
          )
        }
      />
      {showLink && game.share && <ShareSheet url={watchLink(game.share.id)} onClose={() => setShowLink(false)} />}
    </>
  );
}
