import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import type { AssetStorage } from '../server/assets.js';
import { LocalAuth } from '../server/auth.js';
import { RoomManager, type Peer } from '../server/rooms.js';
import type { Persistence } from '../server/persistence.js';
import type { DurableRoom } from '../shared/model.js';

class MemoryPersistence implements Persistence {
  rooms = new Map<string, DurableRoom>();
  async load(id: string) {
    return structuredClone(this.rooms.get(id) || null);
  }
  async save(room: DurableRoom, expectedSaveVersion: number) {
    const saveVersion = expectedSaveVersion + 1;
    this.rooms.set(room.state.id, structuredClone({ ...room, saveVersion }));
    return saveVersion;
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('authenticated HTTP asset download cache', () => {
  const MiB = 1024 * 1024;
  let manager: RoomManager,
    persistence: MemoryPersistence,
    app: ReturnType<typeof createApp>,
    auth: LocalAuth,
    owner: ReturnType<LocalAuth['issue']>,
    room: { id: string; inviteCode: string },
    http: string,
    assets: AssetStorage,
    payloads: Map<string, Buffer>;
  const releases: Array<() => void> = [];

  const request = (id: string, token = owner.token, method = 'GET') =>
    fetch(`${http}/api/assets/${room.id}/${id}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (response) => ({
      status: response.status,
      headers: response.headers,
      data: Buffer.from(await response.arrayBuffer()),
    }));

  async function addAsset(id: string, bytes: number) {
    const data = Buffer.alloc(bytes, id.charCodeAt(0));
    payloads.set(id, data);
    await manager.registerAsset(room.id, owner.id, {
      id,
      name: id,
      bytes,
      width: 1,
      height: 1,
      createdAt: new Date().toISOString(),
      createdBy: owner.id,
    });
    return data;
  }

  function gate() {
    const pending = deferred();
    releases.push(pending.resolve);
    return pending;
  }

  beforeEach(async () => {
    payloads = new Map();
    assets = {
      put: vi.fn(async (_room, id, data) => {
        payloads.set(id, data);
      }),
      get: vi.fn(async (_room, id) => {
        const data = payloads.get(id);
        if (!data) throw new Error('Stored image unavailable.');
        return data;
      }),
      remove: vi.fn(async (_room, id) => {
        payloads.delete(id);
      }),
    };
    auth = new LocalAuth('asset-cache-test-key');
    owner = auth.issue('Keeper');
    persistence = new MemoryPersistence();
    manager = new RoomManager(persistence, 60000, 100);
    room = await manager.create(owner, 'Asset cache');
    app = createApp(manager, auth, new Set(), assets);
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    http = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    releases.splice(0).forEach((release) => release());
    await app.close();
    vi.restoreAllMocks();
  });

  it('shares concurrent cold reads and accounts for the stored bytes only once', async () => {
    const data = await addAsset('a', 6 * MiB),
      pending = gate(),
      readable = vi.spyOn(manager, 'assetReadable');
    vi.mocked(assets.get).mockImplementationOnce(async () => {
      await pending.promise;
      return data;
    });
    const reads = [request('a'), request('a'), request('a')];
    await vi.waitFor(() => expect(readable).toHaveBeenCalledTimes(3));
    expect(assets.get).toHaveBeenCalledTimes(1);
    pending.resolve();
    for (const result of await Promise.all(reads)) {
      expect(result.status).toBe(200);
      expect(result.data.equals(data)).toBe(true);
      expect(result.headers.get('content-type')).toBe('image/webp');
      expect(result.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(readable).toHaveBeenCalledTimes(6);

    // Three distinct entries exactly fill the 16 MiB budget, even after parallel reads.
    await addAsset('b', 6 * MiB);
    await addAsset('c', 4 * MiB);
    await request('b');
    await request('c');
    for (const id of ['a', 'b', 'c']) expect((await request(id)).status).toBe(200);
    expect(assets.get).toHaveBeenCalledTimes(3);

    await addAsset('d', MiB);
    await request('d');
    for (const id of ['b', 'c', 'd']) await request(id);
    expect(assets.get).toHaveBeenCalledTimes(4);
    await request('a');
    expect(assets.get).toHaveBeenCalledTimes(5);
    expect(assets.get).toHaveBeenLastCalledWith(room.id, 'a');
    await request('c');
    expect(assets.get).toHaveBeenCalledTimes(5);
    await request('b');
    expect(assets.get).toHaveBeenCalledTimes(6);
  });

  it('serves oversized objects without caching them or evicting existing entries', async () => {
    await addAsset('small', 8 * MiB);
    await addAsset('oversized', 17 * MiB);
    await request('small');
    for (let i = 0; i < 2; i++) {
      const result = await request('oversized');
      expect(result.status).toBe(200);
      expect(result.data.length).toBe(17 * MiB);
    }
    await request('small');
    expect(assets.get).toHaveBeenCalledTimes(3);
  });

  it('clears a failed shared download so a later request can retry', async () => {
    const data = await addAsset('image', 16),
      pending = gate(),
      readable = vi.spyOn(manager, 'assetReadable');
    vi.mocked(assets.get).mockImplementationOnce(async () => {
      await pending.promise;
      throw new Error('Temporary storage failure.');
    });
    const reads = [request('image'), request('image')];
    await vi.waitFor(() => expect(readable).toHaveBeenCalledTimes(2));
    expect(assets.get).toHaveBeenCalledTimes(1);
    pending.resolve();
    for (const result of await Promise.all(reads)) {
      expect(result.status).toBe(400);
      expect(JSON.parse(result.data.toString())).toEqual({ error: 'Temporary storage failure.' });
    }
    expect((await request('image')).data.equals(data)).toBe(true);
    expect((await request('image')).data.equals(data)).toBe(true);
    expect(assets.get).toHaveBeenCalledTimes(2);
  });

  it('rechecks each waiting caller and rejects revoked access while serving authorized peers', async () => {
    const player = auth.issue('Player'),
      gm: Peer = { identity: owner, send: () => {} },
      pc: Peer = { identity: player, send: () => {} },
      data = await addAsset('image', 16);
    await manager.join(gm, room.id);
    await manager.join(pc, room.id, room.inviteCode);
    const scene = (await manager.authorize(room.id, owner.id)).state.scenes.hollow;
    manager.handle(gm, room.id, {
      v: 2,
      type: 'SCENE_CONFIG',
      actionId: 'share-image',
      sceneId: scene.id,
      name: scene.name,
      width: scene.width,
      height: scene.height,
      map: { kind: 'uploaded', url: 'image' },
      create: false,
    });
    const pending = gate(),
      readable = vi.spyOn(manager, 'assetReadable');
    vi.mocked(assets.get).mockImplementationOnce(async () => {
      await pending.promise;
      return data;
    });
    const playerRead = request('image', player.token),
      ownerRead = request('image');
    await vi.waitFor(() => expect(readable).toHaveBeenCalledTimes(2));
    manager.handle(gm, room.id, {
      v: 2,
      type: 'MEMBER_UPDATE',
      actionId: 'revoke-player',
      userId: player.id,
      role: 'remove',
    });
    pending.resolve();
    const denied = await playerRead;
    expect(denied.status).toBe(400);
    expect(JSON.parse(denied.data.toString())).toEqual({ error: 'Campaign access denied.' });
    expect((await ownerRead).data.equals(data)).toBe(true);
    expect(readable).toHaveBeenCalledTimes(4);
    expect(assets.get).toHaveBeenCalledTimes(1);

    // Even a hot cache entry still goes through this caller's current authorization.
    expect((await request('image', player.token)).status).toBe(400);
    expect((await request('image')).status).toBe(200);
    expect(assets.get).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'does not serve or retain an image deleted during a pending read (cleanup failure: %s)',
    async (failCleanup) => {
      const data = await addAsset('image', 16),
        pending = gate();
      vi.mocked(assets.get).mockImplementationOnce(async () => {
        await pending.promise;
        return data;
      });
      const read = request('image');
      await vi.waitFor(() => expect(assets.get).toHaveBeenCalledTimes(1));
      if (failCleanup) {
        // The manifest removal commits, but the cleanup fence's next snapshot fails.
        const save = persistence.save.bind(persistence);
        vi.spyOn(persistence, 'save')
          .mockImplementationOnce(save)
          .mockRejectedValueOnce(new Error('Cleanup snapshot failed.'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
      }
      expect((await request('image', owner.token, 'DELETE')).status).toBe(failCleanup ? 400 : 200);
      pending.resolve();
      const denied = await read;
      expect(denied.status).toBe(400);
      expect(JSON.parse(denied.data.toString())).toEqual({ error: 'Image access denied.' });

      // Reusing an identifier must not expose bytes from the invalidated in-flight read.
      const replacement = await addAsset('image', 32);
      expect((await request('image')).data.equals(replacement)).toBe(true);
      expect(assets.get).toHaveBeenCalledTimes(2);
    },
  );

  it('releases cached byte accounting when an image is deleted', async () => {
    for (const [id, size] of [
      ['a', 6],
      ['b', 6],
      ['c', 4],
    ] as const) {
      await addAsset(id, size * MiB);
      await request(id);
    }
    expect((await request('a', owner.token, 'DELETE')).status).toBe(200);
    await addAsset('d', 6 * MiB);
    await request('d');
    for (const id of ['b', 'c', 'd']) await request(id);
    expect(assets.get).toHaveBeenCalledTimes(4);
  });
});
