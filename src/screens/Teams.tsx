import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Header } from '../components/Header';
import { db } from '../db';
import { FORMATS } from '../formats';
import { go, href } from '../router';

export const GUIDE_URL = 'https://github.com/SmithJohnTaylor/coach-sub-assistant#readme';

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

  if (!teams) return null;
  const firstRun = teams.length === 0;

  return (
    <>
      <Header
        title="Sub Assistant"
        right={
          <a href={GUIDE_URL} target="_blank" rel="noopener">
            Guide
          </a>
        }
      />
      <main>
        {firstRun && <Welcome />}

        {live?.map((g) => (
          <a key={g.id} className="banner" href={href.game(g.id!)}>
            <span className="dot" /> Game in progress: {teamName(g.teamId)}
            {g.opponent ? ` vs ${g.opponent}` : ''} <span className="chev">›</span>
          </a>
        ))}

        {!firstRun && (
          <section>
            <h2>Teams</h2>
            <ul className="list">
              {teams.map((t) => {
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
        )}

        <section>
          <h2>{firstRun ? 'Create your team' : 'New team'}</h2>
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

        <InstallTip />

        {firstRun && (
          <p className="center">
            <a href={GUIDE_URL} target="_blank" rel="noopener">
              Read the full guide ›
            </a>
          </p>
        )}
      </main>
    </>
  );
}

/** First-run landing: what the app is, before any team exists. */
function Welcome() {
  return (
    <section className="welcome">
      <img src="./icon.svg" alt="" width={64} height={64} />
      <p className="tagline">Fair playing time, tracked from the sideline</p>
      <p className="muted">
        Sub Assistant runs the game clock and counts every kid's minutes while you make subs, so you can see at a
        glance who's owed time.
      </p>
      <ul className="how">
        <li>
          <strong>Tap to sub.</strong> Tap a bench player, then their spot on the field. Minutes and positions are
          tracked for you.
        </li>
        <li>
          <strong>See who's owed time.</strong> Kids below their fair share turn orange, and the bench lists whoever has
          played least first.
        </li>
        <li>
          <strong>Share after the game.</strong> Send parents a summary or download a CSV. Season totals add up on
          their own.
        </li>
      </ul>
      <p className="small muted">No account, and no signal needed at the field. Everything stays on this phone.</p>
    </section>
  );
}

/** Home-screen install steps, hidden once the app is running installed. */
function InstallTip() {
  const installed =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (installed) return null;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <p className="tip small">
      <strong>Add it to your home screen</strong> so it opens like an app and your teams are kept.{' '}
      {ios ? (
        <>
          In Safari, tap the Share button (square with an arrow), then <strong>Add to Home Screen</strong>.
        </>
      ) : (
        <>
          In your browser menu (⋮), tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.
        </>
      )}
    </p>
  );
}
