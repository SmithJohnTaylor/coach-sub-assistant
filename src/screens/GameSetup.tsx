import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { db } from '../db';
import { formatByKey } from '../formats';
import { go, href } from '../router';
import { playerLabel } from '../stats';

export function GameSetup({ teamId }: { teamId: number }) {
  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const players = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).filter((p) => !p.archived).sortBy('name'),
    [teamId],
  );

  const [opponent, setOpponent] = useState('');
  const [periods, setPeriods] = useState(2);
  const [periodMinutes, setPeriodMinutes] = useState(25);
  const [absent, setAbsent] = useState<Set<number>>(new Set());
  const [lineup, setLineup] = useState<(number | null)[]>([]);
  const [ready, setReady] = useState(false);

  // Seed defaults once the team loads.
  useEffect(() => {
    if (!team || ready) return;
    const f = formatByKey(team.format);
    if (f) {
      setPeriods(f.periods);
      setPeriodMinutes(f.periodMinutes);
    }
    setLineup(team.slots.map(() => null));
    setReady(true);
  }, [team, ready]);

  if (!team || !players) return null;

  const present = players.filter((p) => !absent.has(p.id!));
  const used = new Set(lineup.filter((x): x is number => x != null));

  function toggleAbsent(id: number) {
    const next = new Set(absent);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      setLineup((l) => l.map((x) => (x === id ? null : x)));
    }
    setAbsent(next);
  }

  function setSlot(i: number, id: number | null) {
    setLineup((l) => l.map((x, j) => (j === i ? id : x === id ? null : x)));
  }

  function autoFill() {
    const free = present.map((p) => p.id!).filter((id) => !used.has(id));
    setLineup(lineup.map((x) => x ?? free.shift() ?? null));
  }

  async function start() {
    const id = await db.games.add({
      teamId,
      date: Date.now(),
      opponent: opponent.trim() || undefined,
      periods,
      periodMinutes,
      slots: team!.slots,
      present: present.map((p) => p.id!),
      startLineup: lineup,
      status: 'live',
    });
    go(href.game(id!), true);
  }

  const filled = lineup.filter((x) => x != null).length;

  return (
    <>
      <Header title="New game" back={href.team(teamId)} />
      <main>
        <section className="stack">
          <input placeholder="Opponent (optional)" value={opponent} onChange={(e) => setOpponent(e.target.value)} />
          <div className="two-col">
            <label className="field">
              <span>Periods</span>
              <select value={periods} onChange={(e) => setPeriods(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n === 2 ? '2 halves' : n === 4 ? '4 quarters' : n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Minutes each</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                value={periodMinutes}
                onChange={(e) => setPeriodMinutes(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
          </div>
        </section>

        <section>
          <h2>
            Who's here ({present.length}/{players.length})
          </h2>
          <div className="chips">
            {players.map((p) => (
              <button
                key={p.id}
                className={`chip ${absent.has(p.id!) ? 'off' : 'on'}`}
                onClick={() => toggleAbsent(p.id!)}
              >
                {playerLabel(p)}
              </button>
            ))}
          </div>
          <p className="muted small">Tap to mark a player absent. Late arrivals can be added during the game.</p>
        </section>

        <section>
          <div className="row">
            <h2>
              Starting lineup ({filled}/{team.slots.length})
            </h2>
            <button className="link" onClick={autoFill}>
              Auto-fill
            </button>
          </div>
          <ul className="list">
            {team.slots.map((pos, i) => (
              <li key={i} className="row">
                <span className={`pos pos-${pos}`}>{pos}</span>
                <select
                  className="grow"
                  value={lineup[i] ?? ''}
                  onChange={(e) => setSlot(i, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— empty —</option>
                  {present.map((p) => (
                    <option key={p.id} value={p.id}>
                      {playerLabel(p)}
                      {used.has(p.id!) && lineup[i] !== p.id ? ' (on field)' : ''}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>

        <button className="primary big" disabled={filled === 0} onClick={start}>
          Start game
        </button>
        {filled > 0 && filled < team.slots.length && (
          <p className="muted small center">
            {team.slots.length - filled} empty spot{team.slots.length - filled > 1 ? 's' : ''}. You can fill them during the game.
          </p>
        )}
      </main>
    </>
  );
}
