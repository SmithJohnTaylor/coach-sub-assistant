import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import type { Game, GameEvent, Player, Team } from '../types';
import { LiveSocket, liveUrl, toSnapshot, type SocketStatus } from './client';
import { SHARE_ID, type Snapshot } from './protocol';

export interface ShareState {
  status: SocketStatus;
  watchers: number;
}

/**
 * While a game has a share, keep a connection to the relay open and push a fresh snapshot
 * on every change. Snapshots are tiny, so this simply re-sends the whole game each time.
 */
export function useShareSync(
  game: Game | null | undefined,
  team: Team | undefined,
  players: Player[] | undefined,
  events: GameEvent[] | undefined,
): ShareState {
  const share = game?.share;
  const gameId = game?.id;
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [watchers, setWatchers] = useState(0);
  const sock = useRef<LiveSocket | null>(null);
  const sentOffset = useRef(0);

  const latest = useRef<() => Snapshot | null>(() => null);
  latest.current = () =>
    game && team && players && events ? toSnapshot(game, team, players, events, sock.current?.clock.offset ?? 0) : null;
  const push = () => {
    const snap = latest.current();
    if (snap && sock.current?.send({ type: 'snapshot', snap })) sentOffset.current = snap.clockOffset;
  };

  useEffect(() => {
    const url = liveUrl();
    if (!share || !url || gameId == null) return;
    setStatus('connecting');
    setWatchers(0);
    const s = new LiveSocket(`${url}/live/${share.id}?role=owner`, {
      onOpen() {
        s.send({ type: 'auth', key: share.key });
        push();
      },
      onMessage(m) {
        if (m.type === 'watchers') setWatchers(m.n);
      },
      onStatus(st) {
        setStatus(st);
        // Stopped elsewhere or expired: forget it so the coach can start a fresh one.
        if (st === 'ended') db.games.update(gameId, { share: undefined });
      },
      onOffset(offset) {
        if (Math.abs(offset - sentOffset.current) > 100) push();
      },
    });
    sock.current = s;
    return () => {
      s.close();
      sock.current = null;
    };
    // Reconnect only when the share itself changes; `push` reads the latest game through a ref.
  }, [share?.id, share?.key, gameId]);

  useEffect(push, [game, team, players, events]);

  return { status, watchers };
}

export interface WatchState {
  status: SocketStatus;
  snap: Snapshot | null;
  /** Server time the snapshot reached the relay. */
  at: number;
  /** No snapshot exists yet: the coach shared the link before the phone got through. */
  waiting: boolean;
  ownerOnline: boolean;
  /** This phone's offset from the server (server − local). */
  offset: number;
}

export function useWatch(shareId: string): WatchState {
  const [state, setState] = useState<WatchState>({
    status: 'connecting',
    snap: null,
    at: 0,
    waiting: false,
    ownerOnline: false,
    offset: 0,
  });

  useEffect(() => {
    const url = liveUrl();
    if (!url || !SHARE_ID.test(shareId)) return setState((s) => ({ ...s, status: 'ended' }));
    const s = new LiveSocket(`${url}/live/${shareId}?role=watch`, {
      onMessage(m) {
        if (m.type === 'snapshot') setState((st) => ({ ...st, snap: m.snap, at: m.at, waiting: false }));
        else if (m.type === 'waiting') setState((st) => ({ ...st, waiting: true }));
        else if (m.type === 'owner') setState((st) => ({ ...st, ownerOnline: m.online }));
      },
      onStatus: (status) => setState((st) => ({ ...st, status })),
      onOffset: (offset) => setState((st) => ({ ...st, offset })),
    });
    return () => s.close();
  }, [shareId]);

  return state;
}
