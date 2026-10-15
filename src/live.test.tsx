// @vitest-environment jsdom
/**
 * Live sharing: snapshot round trips, clock alignment, and both ends of a share tapped
 * through the real screens with a fake relay standing in for the WebSocket.
 */
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { db } from './db';
import { ClockSync, fromSnapshot, toSnapshot } from './live/client';
import type { ClientMessage, ServerMessage, Snapshot } from './live/protocol';
import { replay } from './timing';
import type { Game, GameEvent, Player, Team } from './types';

const MIN = 60_000;
const T0 = new Date('2026-10-17T09:00:00').getTime();
const SHARE_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  // --- the relay's side
  open() {
    act(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }
  receive(m: ServerMessage) {
    act(() => this.onmessage?.({ data: JSON.stringify(m) }));
  }
  sentOf<T extends ClientMessage['type']>(type: T) {
    return this.sent.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
  }
}

const team: Team = { id: 1, name: 'Tigers', format: 'custom', slots: ['GK', 'DEF', 'FWD'], createdAt: T0 };
const players: Player[] = [
  { id: 1, teamId: 1, name: 'Ava', number: '7' },
  { id: 2, teamId: 1, name: 'Ben' },
  { id: 3, teamId: 1, name: 'Cal' },
  { id: 4, teamId: 1, name: 'Dee' },
  { id: 5, teamId: 1, name: 'Zed' }, // not at this game
];
const game: Game = {
  id: 1,
  teamId: 1,
  date: T0,
  opponent: 'Lions',
  periods: 2,
  periodMinutes: 25,
  slots: ['GK', 'DEF', 'FWD'],
  present: [1, 2, 3, 4],
  startLineup: [1, 2, 3],
  status: 'live',
};
const events: GameEvent[] = [
  { id: 1, gameId: 1, t: T0, type: 'start' },
  { id: 2, gameId: 1, t: T0 + 10 * MIN, type: 'sub', slot: 2, playerIn: 4 },
];

describe('snapshots', () => {
  it('carry only the kids at the game, and replay the same on the other end', () => {
    const snap = toSnapshot(game, team, players, events, 0);
    expect(snap.players.map((p) => p.name)).toEqual(['Ava', 'Ben', 'Cal', 'Dee']);
    expect(snap.players[0]).toEqual({ id: 1, name: 'Ava', number: '7' });
    expect(JSON.stringify(snap)).not.toContain('Zed');

    const back = fromSnapshot(JSON.parse(JSON.stringify(snap)) as Snapshot);
    const at = T0 + 20 * MIN;
    expect(replay(back.game, back.events, at)).toEqual(replay(game, events, at));
    expect(back.team.name).toBe('Tigers');
  });
});

describe('ClockSync', () => {
  it('trusts the fastest recent round trip', () => {
    const c = new ClockSync();
    expect(c.offset).toBe(0);
    c.add(1000, 6000, 1400); // slow: 400ms rtt, estimate 4800
    c.add(2000, 7020, 2040); // fast: 40ms rtt, estimate 5000
    c.add(3000, 8300, 3600);
    expect(c.offset).toBe(5000);
  });

  it('forgets old samples', () => {
    const c = new ClockSync();
    c.add(0, 100, 0);
    for (let i = 1; i <= 5; i++) c.add(i * 1000, i * 1000 + 300, i * 1000 + 100);
    expect(c.offset).toBe(250);
  });
});

function nav(hash: string) {
  act(() => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
function wake() {
  act(() => document.dispatchEvent(new Event('visibilitychange')));
}
function button(text: string | RegExp): HTMLElement {
  const all = [...document.querySelectorAll<HTMLElement>('button, a')];
  const hit = all.find((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')));
  if (!hit) throw new Error(`no button "${text}". Have: ${all.map((b) => b.textContent?.trim()).join(' | ')}`);
  return hit;
}
const hasButton = (text: string) => [...document.querySelectorAll('button, a')].some((b) => b.textContent?.trim() === text);
async function tap(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}
async function sees(text: string | RegExp) {
  await waitFor(() => expect(document.body.textContent).toMatch(text));
}
const clock = () => document.querySelector('.clock')?.textContent;
const lastSocket = () => FakeWebSocket.all.at(-1)!;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.stubEnv('VITE_LIVE_URL', 'wss://relay.test');
  vi.stubGlobal('WebSocket', FakeWebSocket);
  fetchMock = vi.fn(() => Promise.resolve(new Response('stopped')));
  vi.stubGlobal('fetch', fetchMock);
  FakeWebSocket.all = [];
  window.confirm = vi.fn(() => true);
  await db.delete();
  await db.open();
  location.hash = '#/';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('sharing a game (coach running it)', () => {
  it('shows a link, pushes the game on every change, and stops cleanly', async () => {
    await db.teams.add(team);
    await db.players.bulkAdd(players);
    await db.games.add(game);
    nav('#/game/1');
    render(<App />);
    await sees('Share live view');
    expect(FakeWebSocket.all).toHaveLength(0);

    await tap(button('Share live view'));
    await sees('Another coach can scan this');
    const share = (await db.games.get(1))!.share!;
    expect(share.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(share.key.length).toBeGreaterThanOrEqual(43);
    expect(document.querySelector('.share-url')!.textContent).toContain(`#/watch/${share.id}`);
    expect(document.querySelector('svg.qr path')).toBeTruthy();
    await tap(button('Done'));

    await waitFor(() => expect(FakeWebSocket.all).toHaveLength(1));
    const ws = lastSocket();
    expect(ws.url).toBe(`wss://relay.test/live/${share.id}?role=owner`);
    await sees('Connecting…');
    ws.open();
    expect(ws.sent[0]).toEqual({ type: 'auth', key: share.key });
    const first = ws.sentOf('snapshot').at(-1)!.snap;
    expect(first.teamName).toBe('Tigers');
    expect(first.events).toEqual([]);
    expect(first.players.map((p) => p.name)).not.toContain('Zed');

    ws.receive({ type: 'watchers', n: 0 });
    await sees('Live · no one watching yet');
    ws.receive({ type: 'watchers', n: 2 });
    await sees('Live · 2 watching');

    // Every change goes out, undo included.
    await tap(button('Start'));
    await waitFor(() => expect(ws.sentOf('snapshot').at(-1)!.snap.events.map((e) => e.type)).toEqual(['start']));
    await tap(button(/^↶ Undo/));
    await waitFor(() => expect(ws.sentOf('snapshot').at(-1)!.snap.events).toEqual([]));

    // Losing signal shows, and reconnecting re-authenticates and re-sends.
    act(() => ws.close(1006));
    await sees('No signal');
    wake();
    const ws2 = lastSocket();
    expect(ws2).not.toBe(ws);
    ws2.open();
    expect(ws2.sent[0]).toEqual({ type: 'auth', key: share.key });
    expect(ws2.sentOf('snapshot')).toHaveLength(1);

    await tap(button('Stop'));
    expect(fetchMock).toHaveBeenCalledWith(`https://relay.test/live/${share.id}/stop`, {
      method: 'POST',
      body: share.key,
      keepalive: true,
    });
    await sees('Share live view');
    expect((await db.games.get(1))!.share).toBeUndefined();
    expect(ws2.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('discarding a shared game ends the share', async () => {
    await db.teams.add(team);
    await db.players.bulkAdd(players);
    await db.games.add({ ...game, share: { id: SHARE_ID, key: 'k' } });
    nav('#/game/1');
    render(<App />);
    await sees('Stop');
    await tap(button('Discard game'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`https://relay.test/live/${SHARE_ID}/stop`, expect.anything()));
  });

  it('a share the relay has ended is forgotten, so a new one can start', async () => {
    await db.teams.add(team);
    await db.players.bulkAdd(players);
    await db.games.add({ ...game, share: { id: SHARE_ID, key: 'k' } });
    nav('#/game/1');
    render(<App />);
    await waitFor(() => expect(FakeWebSocket.all).toHaveLength(1));
    lastSocket().open();
    lastSocket().receive({ type: 'ended' });
    await sees('Share live view');
    expect((await db.games.get(1))!.share).toBeUndefined();
  });
});

describe('watching a shared game', () => {
  it("shows the coach's game read-only, with the clock lined up across phones", async () => {
    // This phone's clock runs 30 seconds slow. The coach's phone matches the server.
    const SKEW = 30_000;
    vi.setSystemTime(T0 + 20 * MIN - SKEW);
    nav(`#/watch/${SHARE_ID}`);
    render(<App />);
    await sees('Connecting…');
    const ws = lastSocket();
    expect(ws.url).toBe(`wss://relay.test/live/${SHARE_ID}?role=watch`);

    ws.open();
    const ping = ws.sentOf('ping').at(-1)!;
    ws.receive({ type: 'pong', c: ping.c, s: ping.c + SKEW });
    ws.receive({ type: 'owner', online: true });
    ws.receive({ type: 'waiting' });
    await sees("Waiting for the coach's phone");

    ws.receive({ type: 'snapshot', snap: toSnapshot(game, team, players, events, 0), at: T0 + 10 * MIN });
    await sees('Watching live');
    await sees('Tigers vs Lions');
    expect(clock()).toBe('20:00');
    const names = (sel: string) => [...document.querySelectorAll(`${sel} .pname`)].map((n) => n.textContent);
    expect(names('.slot')).toEqual(['Dee', 'Ben', '7 Ava']); // FWD row first
    expect(names('.bench-card')).toEqual(['Cal']);

    // Nothing to change anything with, and taps do nothing.
    for (const label of ['Pause', 'End period', 'Discard game', '+ Late arrival', 'Share live view']) {
      expect(hasButton(label), label).toBe(false);
    }
    expect(document.querySelector('.bottom-bar')).toBeNull();
    await tap(document.querySelector<HTMLElement>('.slot')!);
    expect(document.querySelector('.selected')).toBeNull();
    // The table view still works.
    await tap(button('Table'));
    expect(document.querySelector('table.times')).toBeTruthy();
    await tap(button('Field'));

    // Updates replace the game; the coach pausing stops the clock here too.
    vi.setSystemTime(T0 + 22 * MIN - SKEW);
    const paused = [...events, { id: 3, gameId: 1, t: T0 + 21 * MIN, type: 'pause' } as GameEvent];
    ws.receive({ type: 'snapshot', snap: toSnapshot(game, team, players, paused, 0), at: T0 + 21 * MIN });
    await waitFor(() => expect(clock()).toBe('21:00'));
    await sees('Clock paused');

    ws.receive({ type: 'owner', online: false });
    await sees("Coach's phone is offline · last update 1 min ago");

    ws.receive({ type: 'ended' });
    await sees("isn't being shared anymore");
  });

  it('a mangled link does not try to connect', async () => {
    nav('#/watch/nope');
    render(<App />);
    await sees("isn't being shared anymore, or the link is incomplete");
    expect(FakeWebSocket.all).toHaveLength(0);
  });
});
