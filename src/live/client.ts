import type { Game, GameEvent, Player, Team } from '../types';
import type { ClientMessage, ServerMessage, Snapshot } from './protocol';

/**
 * Relay address. Set VITE_LIVE_URL for builds (see .env.production); in dev it defaults to
 * `wrangler dev` on the same host, so phones on the LAN can reach it too. Empty disables sharing.
 */
export function liveUrl(): string {
  const configured = import.meta.env.VITE_LIVE_URL as string | undefined;
  if (configured != null) return configured.replace(/\/$/, '');
  return import.meta.env.DEV ? `ws://${location.hostname}:8787` : '';
}

export function watchLink(shareId: string): string {
  return `${location.origin}${location.pathname}#/watch/${shareId}`;
}

/** Unguessable base64url token: 16 bytes for share ids, 32 for owner keys. */
export function randomToken(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Tell the relay to end a share. Fire-and-forget; survives the page navigating away. */
export function stopShare(share: NonNullable<Game['share']>): void {
  const base = liveUrl().replace(/^ws/, 'http');
  if (!base) return;
  fetch(`${base}/live/${share.id}/stop`, { method: 'POST', body: share.key, keepalive: true }).catch(() => {});
}

/** Only kids at this game travel, and only their name and number. */
export function toSnapshot(game: Game, team: Team, players: Player[], events: GameEvent[], clockOffset: number): Snapshot {
  const here = new Set([...game.present, ...game.startLineup.filter((x): x is number => x != null)]);
  return {
    v: 1,
    teamName: team.name,
    opponent: game.opponent,
    date: game.date,
    periods: game.periods,
    periodMinutes: game.periodMinutes,
    slots: game.slots,
    present: game.present,
    startLineup: game.startLineup,
    status: game.status,
    players: players
      .filter((p) => here.has(p.id!))
      .map((p) => (p.number ? { id: p.id!, name: p.name, number: p.number } : { id: p.id!, name: p.name })),
    events,
    clockOffset,
  };
}

/** Rebuild the shapes the game screens expect. Ids are 0: a watched game has no local record. */
export function fromSnapshot(s: Snapshot): { game: Game; team: Team; players: Player[]; events: GameEvent[] } {
  const team: Team = { id: 0, name: s.teamName, format: 'custom', slots: s.slots, createdAt: s.date };
  const game: Game = {
    id: 0,
    teamId: 0,
    date: s.date,
    opponent: s.opponent,
    periods: s.periods,
    periodMinutes: s.periodMinutes,
    slots: s.slots,
    present: s.present,
    startLineup: s.startLineup,
    status: s.status,
  };
  const players: Player[] = s.players.map((p) => ({ ...p, teamId: 0 }));
  return { game, team, players, events: s.events };
}

/**
 * Estimates (server clock − local clock) from ping round trips, trusting the fastest of the
 * recent samples: the less time a round trip took, the less room for asymmetric delay.
 */
export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];

  add(sentAt: number, serverAt: number, receivedAt: number): void {
    const rtt = receivedAt - sentAt;
    if (rtt < 0) return;
    this.samples.push({ rtt, offset: serverAt - (sentAt + rtt / 2) });
    if (this.samples.length > 5) this.samples.shift();
  }

  get offset(): number {
    if (!this.samples.length) return 0;
    return this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
  }
}

export type SocketStatus = 'connecting' | 'open' | 'offline' | 'ended';

interface SocketHandlers {
  onOpen?(): void;
  onMessage(m: ServerMessage): void;
  onStatus(s: SocketStatus): void;
  /** Called when the clock offset estimate changes. */
  onOffset?(offset: number): void;
}

const PING_EVERY = 20_000;
/** No word from the server for this long means the connection silently died (common on cellular). */
const DEAD_AFTER = 45_000;

/**
 * A WebSocket that keeps itself connected: retries with backoff, reconnects straight away
 * when the phone comes back online or the app returns to the foreground, and pings to keep
 * the clock offset fresh and to notice dead connections.
 */
export class LiveSocket {
  readonly clock = new ClockSync();
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private lastHeard = 0;
  private stopped = false;
  private status: SocketStatus = 'connecting';

  constructor(
    private url: string,
    private h: SocketHandlers,
  ) {
    window.addEventListener('online', this.wake);
    document.addEventListener('visibilitychange', this.wake);
    this.connect();
  }

  send(m: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  close(): void {
    this.stopped = true;
    window.removeEventListener('online', this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.close(1000);
    this.ws = null;
  }

  private setStatus(s: SocketStatus) {
    if (s === this.status) return;
    this.status = s;
    this.h.onStatus(s);
  }

  private wake = () => {
    if (this.stopped || document.visibilityState === 'hidden') return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (Date.now() - this.lastHeard > DEAD_AFTER) this.ws.close();
      else this.ping();
      return;
    }
    clearTimeout(this.retryTimer);
    this.retry = 0;
    this.connect();
  };

  private connect() {
    if (this.stopped) return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this.scheduleRetry();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.lastHeard = Date.now();
      this.setStatus('open');
      this.h.onOpen?.();
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastHeard > DEAD_AFTER) ws.close();
        else this.ping();
      }, PING_EVERY);
    };
    ws.onmessage = (e) => {
      this.lastHeard = Date.now();
      let m: ServerMessage;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === 'pong') {
        const before = this.clock.offset;
        this.clock.add(m.c, m.s, Date.now());
        if (this.clock.offset !== before) this.h.onOffset?.(this.clock.offset);
        return;
      }
      if (m.type === 'ended') this.end();
      this.h.onMessage(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.ws = null;
      if (this.stopped) return;
      if (e.code === 4003) return this.end(); // someone else holds this share
      this.scheduleRetry();
    };
  }

  private end() {
    this.setStatus('ended');
    this.close();
  }

  private ping() {
    this.send({ type: 'ping', c: Date.now() });
  }

  private scheduleRetry() {
    this.setStatus('offline');
    const delay = Math.min(15_000, 1000 * 2 ** this.retry++);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
}
