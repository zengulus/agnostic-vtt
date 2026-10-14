import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import {
  clientMessageSchema,
  MAX_CLIENT_MESSAGE_BYTES,
  type ServerMessage,
} from '../shared/protocol.js';
import { metrics } from './persistence.js';
import { LocalAuth, type Auth } from './auth.js';
import { RoomManager, type Peer } from './rooms.js';
import { randomUUID } from 'node:crypto';
import { normalizeImage, UPLOAD_LIMIT, type AssetStorage } from './assets.js';

export function createApp(
  manager: RoomManager,
  auth: Auth,
  origins: Set<string>,
  assets?: AssetStorage,
) {
  if (assets) manager.setAssetStorage(assets);
  let decoding = 0;
  const assetCache = new Map<string, Buffer>();
  const pendingAssetReads = new Map<string, Promise<Buffer>>();
  const assetCacheLimit = 16 * 1024 * 1024;
  let cacheBytes = 0;
  const invalidateAssetCache = (key: string) => {
    const cached = assetCache.get(key);
    if (cached) cacheBytes -= cached.length;
    assetCache.delete(key);
    pendingAssetReads.delete(key);
  };
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const body = async (req: IncomingMessage) => {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 4096) throw new Error('Request too large.');
    }
    return JSON.parse(text);
  };
  const buckets = new Map<string, { count: number; until: number }>();
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) {
      json(res, 403, { error: 'Origin not permitted.' });
      return;
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization,Content-Type,X-Image-Name,X-Image-Purpose',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      if (req.url === '/api/health') {
        json(res, 200, {
          ok: true,
          protocol: 2,
          authMode: auth instanceof LocalAuth ? 'local' : 'supabase',
        });
        return;
      }
      if (req.url === '/api/metrics') {
        const identity = await auth.verify(
          (req.headers.authorization || '').replace(/^Bearer /, ''),
        );
        void identity;
        json(res, 200, manager.stats);
        return;
      }
      if (req.method === 'GET' && req.url === '/api/campaigns') {
        const user = await auth.verify((req.headers.authorization || '').replace(/^Bearer /, ''));
        json(res, 200, await manager.list(user.id));
        return;
      }
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
        const ip = req.socket.remoteAddress || 'unknown',
          now = Date.now();
        let bucket = buckets.get(ip);
        if (!bucket || bucket.until < now) {
          bucket = { count: 0, until: now + 60000 };
          if (buckets.size > 1000) buckets.clear();
          buckets.set(ip, bucket);
        }
        if (++bucket.count > 20) {
          json(res, 429, { error: 'Too many requests. Try again in a minute.' });
          return;
        }
      }
      const discord =
        /^\/api\/campaigns\/([a-zA-Z0-9_-]{6,64})\/discord(?:\/rolls\/([a-zA-Z0-9_-]{1,64}))?$/.exec(
          req.url || '',
        );
      if (discord) {
        const user = await auth.verify((req.headers.authorization || '').replace(/^Bearer /, ''));
        if (!discord[2] && req.method === 'GET') {
          json(res, 200, await manager.discordStatus(discord[1], user.id));
          return;
        }
        if (!discord[2] && req.method === 'PUT') {
          const settings = z
            .object({
              url: z.string().max(512).optional(),
              enabled: z.boolean(),
              mode: z.enum(['automatic', 'manual']),
            })
            .strict()
            .parse(await body(req));
          json(res, 200, await manager.configureDiscord(discord[1], user.id, settings));
          return;
        }
        if (!discord[2] && req.method === 'DELETE') {
          json(res, 200, await manager.configureDiscord(discord[1], user.id, null));
          return;
        }
        if (discord[2] && req.method === 'POST') {
          await manager.shareDiscord(discord[1], user.id, discord[2]);
          json(res, 202, { queued: true });
          return;
        }
      }
      const match = /^\/api\/assets\/([a-zA-Z0-9_-]{6,64})(?:\/([a-zA-Z0-9_-]{1,64}))?$/.exec(
        req.url || '',
      );
      if (match && assets) {
        const user = await auth.verify((req.headers.authorization || '').replace(/^Bearer /, '')),
          roomId = match[1],
          id = match[2];
        if (id && req.method === 'GET') {
          await manager.assetReadable(roomId, id, user.id);
          const key = `${roomId}/${id}`;
          let data = assetCache.get(key);
          if (!data) {
            let pending = pendingAssetReads.get(key);
            if (!pending) {
              pending = assets
                .get(roomId, id)
                .then((download) => {
                  // A deleted image must not repopulate the cache from an older read.
                  // Oversized images can be served without evicting the bounded cache.
                  if (
                    pendingAssetReads.get(key) === pending &&
                    download.length <= assetCacheLimit
                  ) {
                    while (cacheBytes + download.length > assetCacheLimit && assetCache.size) {
                      const first = assetCache.keys().next().value!;
                      cacheBytes -= assetCache.get(first)!.length;
                      assetCache.delete(first);
                    }
                    assetCache.set(key, download);
                    cacheBytes += download.length;
                  }
                  return download;
                })
                .finally(() => {
                  if (pendingAssetReads.get(key) === pending) pendingAssetReads.delete(key);
                });
              pendingAssetReads.set(key, pending);
            }
            data = await pending;
            // Access may have changed while this request waited on shared storage.
            await manager.assetReadable(roomId, id, user.id);
          }
          res.writeHead(200, {
            'Content-Type': 'image/webp',
            'Content-Length': data.length,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(data);
          return;
        }
        await manager.authorize(roomId, user.id, true);
        if (!id && req.method === 'POST') {
          if (decoding >= 2) {
            json(res, 429, { error: 'Image processing is busy. Try again shortly.' });
            return;
          }
          decoding++;
          try {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > UPLOAD_LIMIT) throw new Error('Upload images up to 10 MiB.');
              chunks.push(Buffer.from(chunk));
            }
            const image = await normalizeImage(
                Buffer.concat(chunks),
                req.headers['x-image-purpose'] === 'token' ? 512 : 4096,
              ),
              assetId = randomUUID();
            const metadata = {
              id: assetId,
              name: decodeURIComponent(
                String(req.headers['x-image-name'] || 'Uploaded image'),
              ).slice(0, 80),
              bytes: image.data.length,
              width: image.width,
              height: image.height,
              createdAt: new Date().toISOString(),
              createdBy: user.id,
            };
            await manager.uploadAsset(roomId, user.id, metadata, image.data);
            json(res, 201, { asset: { kind: 'uploaded', url: assetId }, ...metadata });
            return;
          } finally {
            decoding--;
          }
        }
        if (id && req.method === 'DELETE') {
          try {
            await manager.removeAsset(roomId, id, user.id);
          } finally {
            invalidateAssetCache(`${roomId}/${id}`);
          }
          json(res, 200, { ok: true });
          return;
        }
      }
      if (req.method !== 'POST') {
        json(res, 404, { error: 'Not found.' });
        return;
      }
      if (req.url === '/api/guest' && auth instanceof LocalAuth) {
        const { name } = z
          .object({ name: z.string().trim().min(1).max(32) })
          .parse(await body(req));
        json(res, 200, auth.issue(name));
        return;
      }
      if (req.url === '/api/campaigns') {
        const identity = await auth.verify(
          (req.headers.authorization || '').replace(/^Bearer /, ''),
        );
        const { name } = z
          .object({ name: z.string().trim().min(1).max(60) })
          .parse(await body(req));
        json(res, 201, await manager.create(identity, name));
        return;
      }
      json(res, 404, { error: 'Not found.' });
    } catch (error) {
      json(res, 400, {
        error:
          error instanceof z.ZodError
            ? 'Check the request fields.'
            : error instanceof Error
              ? error.message
              : 'Request failed.',
      });
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_CLIENT_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  server.on('upgrade', (req, socket, head) => {
    if (
      req.url !== '/ws' ||
      !req.headers.origin ||
      !origins.has(req.headers.origin) ||
      wss.clients.size >= 200
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    let peer: Peer | undefined,
      roomId: string | undefined,
      joining = false,
      alive = true,
      count = 0,
      window = Date.now(),
      lastPreview = 0;
    const send = (message: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 1024 * 1024) {
          ws.close(1013, 'Client too slow');
          return;
        }
        ws.send(JSON.stringify(message));
        metrics.messagesOut++;
      }
    };
    const timeout = setTimeout(() => {
      if (!peer) ws.close(1008, 'Join timeout');
    }, 15000);
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (peer?.identity.expiresAt && peer.identity.expiresAt <= Date.now()) {
        ws.close(1008, 'Session expired');
        return;
      }
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 30000);
    ws.on('message', async (raw) => {
      metrics.messagesIn++;
      const now = Date.now();
      if (now - window > 1000) {
        window = now;
        count = 0;
      }
      if (++count > 100) {
        ws.close(1008, 'Rate limit');
        return;
      }
      let actionId: string | undefined;
      try {
        const message = clientMessageSchema.parse(JSON.parse(raw.toString()));
        actionId = message.actionId;
        if (message.type === 'JOIN_ROOM') {
          if (peer || joining) throw new Error('Already joining a room.');
          joining = true;
          try {
            const identity = await auth.verify(message.token);
            if (ws.readyState !== WebSocket.OPEN) return;
            const candidate = {
              identity,
              role: message.role,
              send,
              close: (reason: string) => ws.close(1008, reason),
            };
            await manager.join(candidate, message.roomId, message.inviteCode);
            if (ws.readyState !== WebSocket.OPEN) {
              await manager.leave(candidate, message.roomId);
              return;
            }
            peer = candidate;
            roomId = message.roomId;
            clearTimeout(timeout);
          } finally {
            joining = false;
          }
          return;
        }
        if (!peer || !roomId) throw new Error('Join a campaign first.');
        if (peer.identity.expiresAt && peer.identity.expiresAt <= Date.now()) {
          ws.close(1008, 'Session expired');
          return;
        }
        if (message.type === 'TOKEN_MOVE_PREVIEW' || message.type === 'TOKEN_MOVE_PREVIEW_BATCH') {
          if (now - lastPreview < 40) return;
          lastPreview = now;
        }
        manager.handle(peer, roomId, message);
      } catch (error) {
        send({
          v: 2,
          type: 'ERROR',
          actionId,
          message:
            error instanceof z.ZodError
              ? 'Invalid tabletop action.'
              : error instanceof Error
                ? error.message
                : 'Action failed.',
        });
      }
    });
    ws.on('close', () => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (peer && roomId) void manager.leave(peer, roomId);
    });
    ws.on('error', () => {
      ws.terminate();
    });
  });
  return {
    server,
    wss,
    async close() {
      const httpClosed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const ws of wss.clients) ws.terminate();
      const socketsClosed = new Promise<void>((resolve) => wss.close(() => resolve()));
      try {
        await manager.close();
      } finally {
        // Upload HTTP requests can outlive the bounded shutdown grace period.
        server.closeAllConnections();
        await Promise.all([httpClosed, socketsClosed]);
      }
    },
  };
}
