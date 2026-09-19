import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { ExportButtons } from '../components/ExportButtons';
import { Header } from '../components/Header';
import { TimeTable } from '../components/TimeTable';
import { db } from '../db';
import { href } from '../router';
import { seasonLines } from '../stats';
import type { GameEvent } from '../types';

type Sort = 'total' | 'avg' | 'name';

export function Season({ teamId }: { teamId: number }) {
  const [sort, setSort] = useState<Sort>('avg');
  const data = useLiveQuery(async () => {
    const [team, players, games] = await Promise.all([
      db.teams.get(teamId),
      db.players.where('teamId').equals(teamId).toArray(),
      db.games.where('teamId').equals(teamId).filter((g) => g.status === 'done').toArray(),
    ]);
    const events = await db.events.where('gameId').anyOf(games.map((g) => g.id!)).toArray();
    const byGame = new Map<number, GameEvent[]>();
    for (const e of events) {
      if (!byGame.has(e.gameId)) byGame.set(e.gameId, []);
      byGame.get(e.gameId)!.push(e);
    }
    return { team, players, games, byGame };
  }, [teamId]);

  if (!data?.team) return null;
  const { team, players, games, byGame } = data;

  const lines = seasonLines(players, games, byGame)
    // Hide archived players who never played.
    .filter((l) => !l.player.archived || l.games > 0)
    .sort((a, b) => {
      if (sort === 'name') return a.player.name.localeCompare(b.player.name);
      if (sort === 'total') return b.total - a.total;
      return b.total / (b.games || 1) - a.total / (a.games || 1);
    });

  return (
    <>
      <Header title="Season" back={href.team(teamId)} />
      <main>
        <p className="muted">
          {team.name} · {games.length} completed game{games.length === 1 ? '' : 's'}
        </p>
        {games.length === 0 ? (
          <p className="muted">Finish a game to see season totals.</p>
        ) : (
          <>
            <ExportButtons title={`Season playing time: ${team.name}`} lines={lines} perGame />
            <div className="segmented">
              {(['avg', 'total', 'name'] as Sort[]).map((k) => (
                <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
                  {k === 'avg' ? 'Avg/game' : k === 'total' ? 'Total' : 'Name'}
                </button>
              ))}
            </div>
            <TimeTable lines={lines} perGame />
            <p className="muted small">GP = games attended. Avg is per game attended, so absences don't count against a player.</p>
          </>
        )}
      </main>
    </>
  );
}
