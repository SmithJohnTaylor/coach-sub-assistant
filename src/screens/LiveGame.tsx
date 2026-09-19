import { useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { TimeTable } from '../components/TimeTable';
import { addEvent, db, deleteGame, undoLast } from '../db';
import { useNow, useWakeLock } from '../hooks';
import { go, href } from '../router';
import { playerLabel, type PlayerLine } from '../stats';
import { fmt, replay, type GameState } from '../timing';
import type { EventInput, Game, GameEvent, Player, Position, Team } from '../types';

type Selection = { kind: 'slot'; slot: number } | { kind: 'bench'; playerId: number } | null;

const ROWS: Position[] = ['FWD', 'MID', 'DEF', 'GK'];

export function periodName(game: Pick<Game, 'periods'>, period: number): string {
  if (game.periods === 2) return period === 1 ? '1st half' : '2nd half';
  if (game.periods === 4) return `Q${period}`;
  if (game.periods === 1) return 'Game';
  return `Period ${period}`;
}

interface Props {
  game: Game;
  team: Team;
  players: Player[];
  events: GameEvent[];
}

export function LiveGame({ game, team, players, events }: Props) {
  const lastRunning = useMemo(() => replay(game, events, Date.now()).running, [game, events]);
  const now = useNow(lastRunning);
  const s = replay(game, events, now);
  useWakeLock(s.running);

  const [sel, setSel] = useState<Selection>(null);
  const [view, setView] = useState<'field' | 'table'>('field');
  const [toast, setToast] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const byId = useMemo(() => new Map(players.map((p) => [p.id!, p])), [players]);
  const name = (id: number | null | undefined) => (id != null ? byId.get(id)?.name ?? '?' : 'empty');

  const gameId = game.id!;
  const periodLen = game.periodMinutes * 60_000;
  const over = s.periodMs - periodLen >= 1000 ? s.periodMs - periodLen : 0;

  // Fair share: each present kid's portion of the on-field minutes so far.
  const onFieldCount = s.lineup.filter((x) => x != null).length;
  const target = game.present.length ? (s.gameMs * onFieldCount) / game.present.length : 0;
  const tolerance = Math.max(60_000, target * 0.15);
  const fairness = (id: number) => {
    if (s.gameMs < 120_000) return '';
    const t = s.players[id]?.total ?? 0;
    if (t < target - tolerance) return 'low';
    if (t > target + tolerance) return 'high';
    return '';
  };

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2500);
  }

  async function emit(e: EventInput) {
    await addEvent({ ...e, gameId, t: Date.now() } as GameEvent);
    setSel(null);
  }

  async function sub(slot: number, playerIn: number | null) {
    const out = s.lineup[slot];
    await emit({ type: 'sub', slot, playerIn });
    if (playerIn == null) flash(`${name(out)} to bench`);
    else flash(out != null ? `${name(playerIn)} in for ${name(out)}` : `${name(playerIn)} in`);
  }

  function tapSlot(slot: number) {
    if (!sel) return setSel({ kind: 'slot', slot });
    if (sel.kind === 'slot') {
      if (sel.slot === slot) return setSel(null);
      emit({ type: 'swap', slotA: sel.slot, slotB: slot });
      flash(`Swapped ${name(s.lineup[sel.slot])} ↔ ${name(s.lineup[slot])}`);
      return;
    }
    sub(slot, sel.playerId);
  }

  function tapBench(id: number) {
    if (sel?.kind === 'slot') return sub(sel.slot, id);
    if (sel?.kind === 'bench' && sel.playerId === id) return setSel(null);
    setSel({ kind: 'bench', playerId: id });
  }

  async function undo() {
    const last = await undoLast(gameId);
    setSel(null);
    if (last) flash(`Undid: ${describe(last, name)}`);
  }

  async function endPeriod() {
    const last = s.period >= game.periods;
    if (!confirm(last ? 'End the game?' : `End ${periodName(game, s.period)}?`)) return;
    await emit({ type: 'periodEnd' });
  }

  async function finish() {
    await db.games.update(gameId, { status: 'done' });
  }

  async function discard() {
    if (!confirm('Discard this game and all its data?')) return;
    await deleteGame(gameId);
    go(href.team(team.id!), true);
  }

  async function addLate(id: number) {
    await db.games.update(gameId, { present: [...game.present, id] });
    setShowAdd(false);
    flash(`${name(id)} added to bench`);
  }

  const onField = new Set(s.lineup.filter((x): x is number => x != null));
  const bench = game.present
    .filter((id) => !onField.has(id))
    .sort((a, b) => (s.players[a]?.total ?? 0) - (s.players[b]?.total ?? 0));
  const notHere = players.filter((p) => !p.archived && !game.present.includes(p.id!) && !onField.has(p.id!));

  const hint =
    sel?.kind === 'bench'
      ? `Tap a spot on the field to put ${name(sel.playerId)} in`
      : sel?.kind === 'slot'
        ? s.lineup[sel.slot] != null
          ? `Tap a bench player to sub for ${name(s.lineup[sel.slot])}, or another spot to swap`
          : 'Tap a bench player to fill this spot'
        : null;

  return (
    <>
      <Header
        title={`${team.name}${game.opponent ? ` vs ${game.opponent}` : ''}`}
        back={href.team(team.id!)}
        right={
          <button className="link" onClick={() => setView(view === 'field' ? 'table' : 'field')}>
            {view === 'field' ? 'Table' : 'Field'}
          </button>
        }
      />

      <div className="clock-bar">
        <div className="clock-info">
          <div className="muted small">
            {s.finished ? 'Full time' : `${periodName(game, s.period)} · ${game.periodMinutes} min`}
          </div>
          <div className={`clock ${over > 0 ? 'over' : ''}`}>
            {fmt(Math.min(s.periodMs, periodLen))}
            {over > 0 && <span className="stoppage"> +{fmt(over)}</span>}
          </div>
        </div>
        {s.finished ? (
          <button className="primary" onClick={finish}>
            Save game
          </button>
        ) : (
          <div className="clock-buttons">
            <button
              className={s.running ? 'pause' : 'primary'}
              onClick={() => emit({ type: s.running ? 'pause' : 'start' })}
            >
              {s.running ? 'Pause' : s.periodMs > 0 ? 'Resume' : 'Start'}
            </button>
            {(s.running || s.periodMs > 0) && (
              <button onClick={endPeriod}>{s.period >= game.periods ? 'End game' : 'End period'}</button>
            )}
          </div>
        )}
      </div>

      <main className="live">
        {view === 'table' ? (
          <TimeTable lines={liveLines(game, s, byId)} />
        ) : (
          <>
            <div className="pitch">
              {ROWS.map((pos) => {
                const slots = game.slots.map((p, i) => (p === pos ? i : -1)).filter((i) => i >= 0);
                if (!slots.length) return null;
                return (
                  <div className="field-row" key={pos}>
                    {slots.map((i) => {
                      const id = s.lineup[i];
                      const p = id != null ? s.players[id] : undefined;
                      const selected = sel?.kind === 'slot' && sel.slot === i;
                      return (
                        <button
                          key={i}
                          className={`slot ${selected ? 'selected' : ''} ${id == null ? 'empty' : fairness(id)} ${sel?.kind === 'bench' ? 'target' : ''}`}
                          onClick={() => tapSlot(i)}
                        >
                          <span className={`pos pos-${pos}`}>{pos}</span>
                          {id != null ? (
                            <>
                              <span className="pname">{shortLabel(byId.get(id))}</span>
                              <span className="ptime">{fmt(p?.total ?? 0)}</span>
                              <span className="pstint">on {fmt(s.gameMs - (p?.onSince ?? 0))}</span>
                            </>
                          ) : (
                            <span className="pname muted">empty</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className="hint">{hint ?? (s.running ? '' : s.gameMs === 0 ? 'Tap Start at kickoff' : 'Clock paused')}</div>

            {sel?.kind === 'slot' && s.lineup[sel.slot] != null && (
              <button className="small-action" onClick={() => sub(sel.slot, null)}>
                Send {name(s.lineup[sel.slot])} to bench, leave spot empty
              </button>
            )}

            <h2 className="bench-title">
              Bench ({bench.length}) <span className="muted small">least time first</span>
            </h2>
            <div className="bench">
              {bench.map((id) => {
                const p = s.players[id];
                const selected = sel?.kind === 'bench' && sel.playerId === id;
                return (
                  <button
                    key={id}
                    className={`bench-card ${selected ? 'selected' : ''} ${fairness(id)} ${sel?.kind === 'slot' ? 'target' : ''}`}
                    onClick={() => tapBench(id)}
                  >
                    <span className="pname">{shortLabel(byId.get(id))}</span>
                    <span className="ptime">{fmt(p?.total ?? 0)}</span>
                    <span className="pstint">sat {fmt(s.gameMs - (p?.benchSince ?? 0))}</span>
                  </button>
                );
              })}
              <button className="bench-card add" onClick={() => setShowAdd(!showAdd)}>
                + Late arrival
              </button>
            </div>

            {showAdd && (
              <div className="chips">
                {notHere.length === 0 && <span className="muted small">Everyone on the roster is here.</span>}
                {notHere.map((p) => (
                  <button key={p.id} className="chip on" onClick={() => addLate(p.id!)}>
                    + {playerLabel(p)}
                  </button>
                ))}
              </div>
            )}

            <div className="legend muted small">
              <span className="swatch low" /> below fair share <span className="swatch high" /> above fair share
            </div>
          </>
        )}

        <div className="footer-actions">
          <button className="link danger-text" onClick={discard}>
            Discard game
          </button>
        </div>
      </main>

      <div className="bottom-bar">
        <button onClick={undo} disabled={events.length === 0}>
          ↶ Undo{events.length ? `: ${describe(events[events.length - 1], name)}` : ''}
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function shortLabel(p: Player | undefined): string {
  if (!p) return '?';
  return p.number ? `${p.number} ${p.name}` : p.name;
}

function describe(e: GameEvent, name: (id: number | null) => string): string {
  switch (e.type) {
    case 'start':
      return 'clock start';
    case 'pause':
      return 'pause';
    case 'periodEnd':
      return 'end of period';
    case 'sub':
      return e.playerIn == null ? `bench spot ${e.slot + 1}` : `${name(e.playerIn)} in`;
    case 'swap':
      return 'position swap';
  }
}

function liveLines(game: Game, s: GameState, byId: Map<number, Player>): PlayerLine[] {
  return Object.entries(s.players)
    .map(([id, t]) => ({
      player: byId.get(Number(id)) ?? { id: Number(id), teamId: game.teamId, name: '?' },
      games: 1,
      total: t.total,
      byPos: t.byPos,
    }))
    .sort((a, b) => b.total - a.total);
}
