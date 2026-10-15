import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ServerMessage, Snapshot } from '../../src/live/protocol';
import type { Env } from '../src/index';

const BASE = 'https://live.example';
let n = 0;
/** A fresh 22-char share id per test so Durable Objects don't leak state between tests. */
const newId = () => `test${String(++n).padStart(4, '0')}_______________`.slice(0, 22);

interface Client {
  ws: WebSocket;
  msgs: ServerMessage[];
  /** Resolve with the next not-yet-consumed message matching `pred` (already received or still to come). */
  next(pred: (m: ServerMessage) => boolean): Promise<ServerMessage>;
  closed: Promise<number>;
  send(m: unknown): void;
}

async function connect(id: string, role: 'owner' | 'watch'): Promise<Client> {
  const res = await SELF.fetch(`${BASE}/live/${id}?role=${role}`, { headers: { Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const msgs: ServerMessage[] = [];
  const waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  let seen = 0;
  ws.addEventListener('message', (e: MessageEvent) => {
    const m = JSON.parse(e.data as string) as ServerMessage;
    msgs.push(m);
    const w = waiters.find((w) => w.pred(m));
    if (w) {
      waiters.splice(waiters.indexOf(w), 1);
      seen = msgs.length;
      w.resolve(m);
    }
  });
  const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e: CloseEvent) => resolve(e.code)));
  ws.accept();
  return {
    ws,
    msgs,
    closed,
    send: (m) => ws.send(JSON.stringify(m)),
    next(pred) {
      const i = msgs.findIndex((m, j) => j >= seen && pred(m));
      if (i !== -1) {
        seen = i + 1;
        return Promise.resolve(msgs[i]);
      }
      seen = msgs.length;
      return new Promise((resolve) => waiters.push({ pred, resolve }));
    },
  };
}

const is = <T extends ServerMessage['type']>(t: T) => (m: ServerMessage) => m.type === t;

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 1,
    teamName: 'Hawks',
    date: 1,
    periods: 2,
    periodMinutes: 25,
    slots: ['GK', 'DEF'],
    present: [1, 2, 3],
    startLineup: [1, 2],
    status: 'live',
    players: [
      { id: 1, name: 'Ava' },
      { id: 2, name: 'Ben' },
      { id: 3, name: 'Cy' },
    ],
    events: [],
    clockOffset: 0,
    ...over,
  };
}

async function ownerOf(id: string, key = 'owner-key') {
  const owner = await connect(id, 'owner');
  owner.send({ type: 'auth', key });
  await owner.next(is('watchers'));
  return owner;
}

describe('relay', () => {
  it('rejects malformed ids and plain requests', async () => {
    expect((await SELF.fetch(`${BASE}/live/short`)).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/`)).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/live/${newId()}`)).status).toBe(426);
  });

  it('tells an early watcher to wait, then delivers snapshots as they arrive', async () => {
    const id = newId();
    const watcher = await connect(id, 'watch');
    expect(await watcher.next(is('owner'))).toEqual({ type: 'owner', online: false });
    await watcher.next(is('waiting'));

    const owner = await ownerOf(id);
    expect(await watcher.next(is('owner'))).toEqual({ type: 'owner', online: true });

    owner.send({ type: 'snapshot', snap: snap() });
    const got = await watcher.next(is('snapshot'));
    expect(got.type === 'snapshot' && got.snap.teamName).toBe('Hawks');
  });

  it('gives a late watcher the latest snapshot and tells the owner how many are watching', async () => {
    const id = newId();
    const owner = await ownerOf(id);
    owner.send({ type: 'snapshot', snap: snap({ opponent: 'First' }) });
    owner.send({ type: 'snapshot', snap: snap({ opponent: 'Second' }) });
    // Ping round-trips after the snapshots, so they have been stored by the time it returns.
    owner.send({ type: 'ping', c: 5 });
    await owner.next(is('pong'));

    const w1 = await connect(id, 'watch');
    const first = await w1.next(is('snapshot'));
    expect(first.type === 'snapshot' && first.snap.opponent).toBe('Second');
    expect(await owner.next(is('watchers'))).toEqual({ type: 'watchers', n: 1 });

    const w2 = await connect(id, 'watch');
    await w2.next(is('snapshot'));
    expect(await owner.next(is('watchers'))).toEqual({ type: 'watchers', n: 2 });

    w1.ws.close(1000);
    expect(await owner.next(is('watchers'))).toEqual({ type: 'watchers', n: 1 });
  });

  it('answers pings with server time', async () => {
    const w = await connect(newId(), 'watch');
    w.send({ type: 'ping', c: 123 });
    const pong = await w.next(is('pong'));
    expect(pong.type === 'pong' && pong.c).toBe(123);
    expect(pong.type === 'pong' && pong.s).toBeGreaterThan(0);
  });

  it('only lets the claiming key push snapshots', async () => {
    const id = newId();
    await ownerOf(id, 'right');
    const intruder = await connect(id, 'owner');
    intruder.send({ type: 'auth', key: 'wrong' });
    expect(await intruder.closed).toBe(4003);

    const unauthed = await connect(id, 'owner');
    unauthed.send({ type: 'snapshot', snap: snap() });
    expect(await unauthed.closed).toBe(4001);
  });

  it('ignores snapshots sent by watchers', async () => {
    const id = newId();
    const owner = await ownerOf(id);
    owner.send({ type: 'snapshot', snap: snap({ opponent: 'Real' }) });
    const watcher = await connect(id, 'watch');
    await watcher.next(is('snapshot'));
    watcher.send({ type: 'snapshot', snap: snap({ opponent: 'Fake' }) });
    watcher.send({ type: 'ping', c: 1 });
    await watcher.next(is('pong'));
    expect(watcher.msgs.filter(is('snapshot'))).toHaveLength(1);
  });

  it('tells watchers when the owner drops and comes back', async () => {
    const id = newId();
    const owner = await ownerOf(id);
    const watcher = await connect(id, 'watch');
    await watcher.next(is('owner'));
    owner.ws.close(1000);
    expect(await watcher.next(is('owner'))).toEqual({ type: 'owner', online: false });
    await ownerOf(id);
    expect(await watcher.next(is('owner'))).toEqual({ type: 'owner', online: true });
  });

  it('stop ends the share for everyone, needs the key, and cannot be revived', async () => {
    const id = newId();
    const owner = await ownerOf(id, 'k');
    owner.send({ type: 'snapshot', snap: snap() });
    const watcher = await connect(id, 'watch');
    await watcher.next(is('snapshot'));

    const stop = (key: string) => SELF.fetch(`${BASE}/live/${id}/stop`, { method: 'POST', body: key });
    expect((await stop('nope')).status).toBe(403);
    expect((await stop('k')).status).toBe(200);
    await watcher.next(is('ended'));
    await watcher.closed;
    await owner.closed;

    const late = await connect(id, 'watch');
    await late.next(is('ended'));
    const revive = await connect(id, 'owner');
    revive.send({ type: 'auth', key: 'k' });
    await revive.next(is('ended'));
  });

  it('expires: the alarm ends the share for good and deletes the snapshot', async () => {
    const id = newId();
    const owner = await ownerOf(id);
    owner.send({ type: 'snapshot', snap: snap() });
    owner.send({ type: 'ping', c: 1 });
    await owner.next(is('pong'));

    const stub = (env as Env).SHARE_ROOM.getByName(id);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await owner.closed;

    const stored = await runInDurableObject(stub, (_, state) => state.storage.list());
    expect([...stored.keys()]).toEqual(['stopped']);

    const watcher = await connect(id, 'watch');
    await watcher.next(is('ended'));
    const reopened = await connect(id, 'owner');
    reopened.send({ type: 'auth', key: 'owner-key' });
    await reopened.next(is('ended'));
  });
});
