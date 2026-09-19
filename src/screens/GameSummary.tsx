import { ExportButtons } from '../components/ExportButtons';
import { Header } from '../components/Header';
import { TimeTable } from '../components/TimeTable';
import { db, deleteGame } from '../db';
import { go, href } from '../router';
import { gameTotals, type PlayerLine } from '../stats';
import { fmt } from '../timing';
import type { Game, GameEvent, Player, Team } from '../types';

interface Props {
  game: Game;
  team: Team;
  players: Player[];
  events: GameEvent[];
}

export function GameSummary({ game, team, players, events }: Props) {
  const totals = gameTotals(game, events);
  const byId = new Map(players.map((p) => [p.id!, p]));
  const lines: PlayerLine[] = Object.entries(totals)
    .map(([id, t]) => ({
      player: byId.get(Number(id)) ?? { id: Number(id), teamId: team.id!, name: '?' },
      games: 1,
      total: t.total,
      byPos: t.byPos,
    }))
    .sort((a, b) => b.total - a.total);

  const played = Math.max(0, ...lines.map((l) => l.total));
  const date = new Date(game.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const title = `${team.name}${game.opponent ? ` vs ${game.opponent}` : ''} (${date})`;

  async function reopen() {
    await db.games.update(game.id!, { status: 'live' });
  }
  async function remove() {
    if (!confirm('Delete this game? Its minutes will be removed from season totals.')) return;
    await deleteGame(game.id!);
    go(href.team(team.id!), true);
  }

  return (
    <>
      <Header title={game.opponent ? `vs ${game.opponent}` : 'Game'} back={href.team(team.id!)} />
      <main>
        <p className="muted">
          {date} · {game.periods} × {game.periodMinutes} min · {lines.length} players
          {played > 0 && ` · most ${fmt(played)}`}
        </p>
        <ExportButtons title={`Playing time: ${title}`} lines={lines} perGame={false} />
        <TimeTable lines={lines} />
        <div className="footer-actions">
          <button className="link" onClick={reopen}>
            Reopen game
          </button>
          <button className="link danger-text" onClick={remove}>
            Delete game
          </button>
        </div>
      </main>
    </>
  );
}
