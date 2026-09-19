import { fmt } from '../timing';
import { POSITIONS } from '../types';
import type { PlayerLine } from '../stats';
import { playerLabel } from '../stats';

/** Per-player minutes with position breakdown. Used mid-game, post-game, and for the season. */
export function TimeTable({ lines, perGame = false }: { lines: PlayerLine[]; perGame?: boolean }) {
  const max = Math.max(1, ...lines.map((l) => l.total));
  return (
    <div className="table-wrap">
      <table className="times">
        <thead>
          <tr>
            <th className="left">Player</th>
            {perGame && <th>GP</th>}
            {perGame && <th>Avg</th>}
            <th>Total</th>
            {POSITIONS.map((p) => (
              <th key={p}>{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.player.id}>
              <td className="left">
                <div>{playerLabel(l.player)}</div>
                <div className="bar">
                  <span style={{ width: `${(l.total / max) * 100}%` }} />
                </div>
              </td>
              {perGame && <td>{l.games}</td>}
              {perGame && <td>{l.games ? fmt(l.total / l.games) : '–'}</td>}
              <td>
                <strong>{fmt(l.total)}</strong>
              </td>
              {POSITIONS.map((p) => (
                <td key={p} className={l.byPos[p] ? '' : 'muted'}>
                  {l.byPos[p] ? fmt(l.byPos[p]) : '–'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
