/**
 * Live-sharing relay. One Durable Object per shared game holds the latest snapshot from the
 * owner's phone and fans it out to watchers over WebSockets.
 *
 *   GET  /live/:id?role=owner|watch   WebSocket. The owner's first message is { type: 'auth', key }.
 *   POST /live/:id/stop               Body is the owner key. Ends the share for everyone.
 *
 * The first owner to authenticate claims the id (it is 128 random bits, so nobody else has it).
 * The game is deleted 24 hours after the last snapshot, or when the owner stops; only an
 * "ended" marker stays, so a phone reopening an old game can't quietly start sharing it again.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  MAX_SNAPSHOT_BYTES,
  SHARE_ID,
  type ClientMessage,
  type ServerMessage,
  type Snapshot,
} from '../../src/live/protocol';

export interface Env {
  SHARE_ROOM: DurableObjectNamespace<ShareRoom>;
}

const EXPIRE_MS = 24 * 60 * 60 * 1000;
const CORS = { 'Access-Control-Allow-Origin': '*' };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/live\/([^/]+)(\/stop)?$/);
    if (!m || !SHARE_ID.test(m[1])) return new Response('Sub Assistant live relay', { status: 404, headers: CORS });
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST' } });
    }
    return env.SHARE_ROOM.getByName(m[1]).fetch(req);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  role: 'owner' | 'watch';
  authed: boolean;
}

interface Stored {
  snap: Snapshot;
  at: number;
}

export class ShareRoom extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/stop')) {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });
      const ok = await this.stop(await req.text());
      return new Response(ok ? 'stopped' : 'forbidden', { status: ok ? 200 : 403, headers: CORS });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });

    const role = url.searchParams.get('role') === 'owner' ? 'owner' : 'watch';
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, authed: false } satisfies Attachment);

    if (role === 'watch') {
      if (await this.ctx.storage.get('stopped')) {
        send(server, { type: 'ended' });
        server.close(1000, 'ended');
      } else {
        const stored = await this.ctx.storage.get<Stored>('snap');
        send(server, { type: 'owner', online: this.ownerOnline() });
        send(server, stored ? { type: 'snapshot', ...stored } : { type: 'waiting' });
        this.tellOwner();
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_SNAPSHOT_BYTES) return ws.close(1009, 'too big');
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return ws.close(1003, 'bad json');
    }
    const att = ws.deserializeAttachment() as Attachment;

    if (msg.type === 'ping') return send(ws, { type: 'pong', c: msg.c, s: Date.now() });
    if (att.role !== 'owner') return;

    if (msg.type === 'auth') {
      if (await this.ctx.storage.get('stopped')) {
        send(ws, { type: 'ended' });
        return ws.close(1000, 'ended');
      }
      const hash = await sha256(String(msg.key));
      const stored = await this.ctx.storage.get<string>('keyHash');
      if (stored == null) await this.ctx.storage.put('keyHash', hash);
      else if (stored !== hash) return ws.close(4003, 'bad key');
      ws.serializeAttachment({ ...att, authed: true } satisfies Attachment);
      send(ws, { type: 'watchers', n: this.watchers().length });
      this.broadcast({ type: 'owner', online: true });
      return;
    }

    if (msg.type === 'snapshot') {
      if (!att.authed) return ws.close(4001, 'auth first');
      if (!isSnapshot(msg.snap)) return ws.close(1003, 'bad snapshot');
      const stored: Stored = { snap: msg.snap, at: Date.now() };
      await this.ctx.storage.put('snap', stored);
      await this.ctx.storage.setAlarm(stored.at + EXPIRE_MS);
      this.broadcast({ type: 'snapshot', ...stored });
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code);
    } catch {
      /* already closed */
    }
    const att = ws.deserializeAttachment() as Attachment;
    if (att.role === 'watch') this.tellOwner(ws);
    else if (att.authed && !this.ownerOnline(ws)) this.broadcast({ type: 'owner', online: false });
  }

  async alarm(): Promise<void> {
    await this.end();
  }

  private async stop(key: string): Promise<boolean> {
    const stored = await this.ctx.storage.get<string>('keyHash');
    if (stored == null || stored !== (await sha256(key))) return false;
    await this.end();
    return true;
  }

  private async end() {
    for (const ws of this.ctx.getWebSockets()) {
      send(ws, { type: 'ended' });
      ws.close(1000, 'ended');
    }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('stopped', true);
  }

  private watchers(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets('watch').filter((w) => w !== except);
  }

  private ownerOnline(except?: WebSocket): boolean {
    return this.ctx
      .getWebSockets('owner')
      .some((w) => w !== except && (w.deserializeAttachment() as Attachment).authed);
  }

  private broadcast(msg: ServerMessage) {
    for (const ws of this.watchers()) send(ws, msg);
  }

  private tellOwner(except?: WebSocket) {
    const n = this.watchers(except).length;
    for (const ws of this.ctx.getWebSockets('owner')) {
      if ((ws.deserializeAttachment() as Attachment).authed) send(ws, { type: 'watchers', n });
    }
  }
}

function send(ws: WebSocket, msg: ServerMessage) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket closing; the close handler tidies up */
  }
}

function isSnapshot(s: unknown): s is Snapshot {
  const x = s as Snapshot;
  return (
    typeof x === 'object' &&
    x !== null &&
    x.v === 1 &&
    Array.isArray(x.events) &&
    Array.isArray(x.players) &&
    Array.isArray(x.slots)
  );
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
