import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Header } from '../components/Header';
import { db, deleteTeam } from '../db';
import { FORMATS, sortSlots } from '../formats';
import { go, href } from '../router';
import { playerLabel } from '../stats';
import { POSITIONS, type Player, type Position, type Team } from '../types';

export function TeamPage({ teamId }: { teamId: number }) {
  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const players = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).filter((p) => !p.archived).sortBy('name'),
    [teamId],
  );
  const games = useLiveQuery(
    () => db.games.where('teamId').equals(teamId).reverse().sortBy('date'),
    [teamId],
  );

  if (team === undefined) return null;
  if (team === null) return <p>Team not found.</p>;

  const live = games?.find((g) => g.status === 'live');

  return (
    <>
      <Header title={team.name} back={href.home()} />
      <main>
        <div className="actions">
          {live ? (
            <a className="button primary" href={href.game(live.id!)}>
              Resume game
            </a>
          ) : (
            <a
              className={`button primary ${players && players.length < team.slots.length ? 'disabled' : ''}`}
              href={href.newGame(teamId)}
            >
              New game
            </a>
          )}
          <a className="button" href={href.season(teamId)}>
            Season stats
          </a>
        </div>
        {players && players.length < team.slots.length && (
          <p className="muted small">
            Add at least {team.slots.length} players to start a game.
          </p>
        )}

        <Roster teamId={teamId} players={players ?? []} />

        <section>
          <h2>Games</h2>
          {games?.length === 0 && <p className="muted">No games yet.</p>}
          <ul className="list">
            {games?.map((g) => (
              <li key={g.id}>
                <a className="row-link" href={href.game(g.id!)}>
                  <div>
                    <strong>{g.opponent ? `vs ${g.opponent}` : 'Game'}</strong>
                    <div className="muted small">
                      {new Date(g.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      {g.status === 'live' && ' · in progress'}
                    </div>
                  </div>
                  <span className="chev">›</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <Formation team={team} />
        <TeamSettings team={team} />
      </main>
    </>
  );
}

function Roster({ teamId, players }: { teamId: number; players: Player[] }) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [editing, setEditing] = useState<number | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await db.players.add({ teamId, name: name.trim(), number: number.trim() || undefined });
    setName('');
    setNumber('');
  }

  return (
    <section>
      <h2>Roster ({players.length})</h2>
      <ul className="list">
        {players.map((p) =>
          editing === p.id ? (
            <li key={p.id}>
              <PlayerEdit player={p} done={() => setEditing(null)} />
            </li>
          ) : (
            <li key={p.id} className="row">
              <span>{playerLabel(p)}</span>
              <button className="link" onClick={() => setEditing(p.id!)}>
                Edit
              </button>
            </li>
          ),
        )}
      </ul>
      <form className="inline-form" onSubmit={add}>
        <input className="num" inputMode="numeric" placeholder="#" value={number} onChange={(e) => setNumber(e.target.value)} />
        <input placeholder="Player name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

function PlayerEdit({ player, done }: { player: Player; done: () => void }) {
  const [name, setName] = useState(player.name);
  const [number, setNumber] = useState(player.number ?? '');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await db.players.update(player.id!, { name: name.trim(), number: number.trim() || undefined });
    done();
  }
  async function remove() {
    if (!confirm(`Remove ${player.name} from the roster? Past game stats are kept.`)) return;
    // Archive rather than delete so past games still show the name.
    await db.players.update(player.id!, { archived: true });
    done();
  }

  return (
    <form className="inline-form" onSubmit={save}>
      <input className="num" inputMode="numeric" placeholder="#" value={number} onChange={(e) => setNumber(e.target.value)} />
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <button className="primary">Save</button>
      <button type="button" className="danger" onClick={remove}>
        Remove
      </button>
    </form>
  );
}

function Formation({ team }: { team: Team }) {
  const save = (patch: Partial<Team>) => db.teams.update(team.id!, patch);

  function pickFormat(key: string) {
    const f = FORMATS.find((x) => x.key === key);
    if (f) save({ format: key, slots: f.slots });
    else save({ format: 'custom' });
  }
  function setSlot(i: number, pos: Position) {
    const slots = [...team.slots];
    slots[i] = pos;
    save({ format: 'custom', slots: sortSlots(slots) });
  }
  function addSlot() {
    save({ format: 'custom', slots: sortSlots([...team.slots, 'MID']) });
  }
  function removeSlot(i: number) {
    if (team.slots.length <= 1) return;
    save({ format: 'custom', slots: team.slots.filter((_, j) => j !== i) });
  }

  return (
    <section>
      <h2>Formation ({team.slots.length} on field)</h2>
      <label className="field">
        <span>Format</span>
        <select value={team.format} onChange={(e) => pickFormat(e.target.value)}>
          {FORMATS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      <details>
        <summary>Edit positions</summary>
        <ul className="list">
          {team.slots.map((pos, i) => (
            <li key={i} className="row">
              <select value={pos} onChange={(e) => setSlot(i, e.target.value as Position)}>
                {POSITIONS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <button className="link danger-text" onClick={() => removeSlot(i)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button onClick={addSlot}>+ Add position</button>
      </details>
    </section>
  );
}

function TeamSettings({ team }: { team: Team }) {
  const [name, setName] = useState(team.name);

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) await db.teams.update(team.id!, { name: name.trim() });
  }
  async function remove() {
    if (!confirm(`Delete ${team.name}, its roster, and all its games? This cannot be undone.`)) return;
    await deleteTeam(team.id!);
    go(href.home(), true);
  }

  return (
    <section>
      <details>
        <summary>Team settings</summary>
        <form className="inline-form" onSubmit={rename}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <button disabled={!name.trim() || name.trim() === team.name}>Rename</button>
        </form>
        <button className="danger" onClick={remove}>
          Delete team
        </button>
      </details>
    </section>
  );
}
