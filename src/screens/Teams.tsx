import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Header } from '../components/Header';
import { db } from '../db';
import { FORMATS } from '../formats';
import { go, href } from '../router';

export function Teams() {
  const teams = useLiveQuery(() => db.teams.orderBy('name').toArray(), []);
  const players = useLiveQuery(() => db.players.toArray(), []);
  const live = useLiveQuery(() => db.games.where('status').equals('live').toArray(), []);
  const [name, setName] = useState('');
  const [format, setFormat] = useState('7v7');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const f = FORMATS.find((x) => x.key === format)!;
    const id = await db.teams.add({ name: trimmed, format, slots: f.slots, createdAt: Date.now() });
    setName('');
    go(href.team(id!));
  }

  const teamName = (id: number) => teams?.find((t) => t.id === id)?.name ?? 'Team';

  return (
    <>
      <Header title="Sub Assistant" />
      <main>
        {live?.map((g) => (
          <a key={g.id} className="banner" href={href.game(g.id!)}>
            <span className="dot" /> Game in progress: {teamName(g.teamId)}
            {g.opponent ? ` vs ${g.opponent}` : ''} <span className="chev">›</span>
          </a>
        ))}

        <section>
          <h2>Teams</h2>
          {teams?.length === 0 && <p className="muted">No teams yet. Add your first team below.</p>}
          <ul className="list">
            {teams?.map((t) => {
              const count = players?.filter((p) => p.teamId === t.id && !p.archived).length ?? 0;
              return (
                <li key={t.id}>
                  <a className="row-link" href={href.team(t.id!)}>
                    <div>
                      <strong>{t.name}</strong>
                      <div className="muted small">
                        {t.slots.length} on field · {count} players
                      </div>
                    </div>
                    <span className="chev">›</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2>New team</h2>
          <form className="stack" onSubmit={create}>
            <input placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="field">
              <span>Format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                {FORMATS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={!name.trim()}>
              Add team
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
