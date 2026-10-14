import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager, type Peer } from '../server/rooms.js';
import { SnapshotConflictError, type Persistence } from '../server/persistence.js';
import type { AssetStorage } from '../server/assets.js';
import type { DurableRoom, UploadedAsset } from '../shared/model.js';
import type { ServerMessage } from '../shared/protocol.js';

class MemoryPersistence implements Persistence {
  rooms = new Map<string, DurableRoom>();
  async load(id: string) {
    return structuredClone(this.rooms.get(id) || null);
  }
  async save(room: DurableRoom, expectedSaveVersion: number) {
    if ((this.rooms.get(room.state.id)?.saveVersion || 0) !== expectedSaveVersion)
      throw new SnapshotConflictError();
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
function peer(id: string) {
  const messages: ServerMessage[] = [];
  return {
    identity: { id, name: id },
    send: (message: ServerMessage) => messages.push(message),
    close: vi.fn(),
    messages,
  };
}
const owner = { id: 'owner', name: 'Owner' };
const image: UploadedAsset = {
  id: 'image-one',
  name: 'Image',
  width: 32,
  height: 32,
  bytes: 4,
  createdAt: '2026-10-14T00:00:00Z',
  createdBy: owner.id,
};

describe('snapshot ownership and durable image cleanup', () => {
  let storage: MemoryPersistence;
  const managers: RoomManager[] = [];
  function manager(assets?: AssetStorage) {
    const result = new RoomManager(storage, 90000, 5000);
    if (assets) result.setAssetStorage(assets);
    managers.push(result);
    return result;
  }
  const assets = () => ({
    put: vi.fn(async () => {}),
    get: vi.fn(async () => Buffer.from('webp')),
    remove: vi.fn(async () => {}),
  });
  beforeEach(() => {
    vi.useFakeTimers();
    storage = new MemoryPersistence();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const m of managers) await m.close();
    managers.length = 0;
    vi.useRealTimers();
  });
  it('fences a stale process even when membership saves have the same gameplay revision', async () => {
    const old = manager(),
      room = await old.create(owner, 'Overlap'),
      stale = peer(owner.id);
    await old.join(stale, room.id);
    const next = manager(),
      fresh = peer(owner.id);
    await next.join(fresh, room.id);
    await next.join(peer('accepted'), room.id, room.inviteCode);
    expect(storage.rooms.get(room.id)?.state.revision).toBe(0);
    const first = old.join(peer('loser'), room.id, room.inviteCode);
    const queued = old.join(peer('loser'), room.id);
    await expect(first).rejects.toBeInstanceOf(SnapshotConflictError);
    await expect(queued).rejects.toBeInstanceOf(SnapshotConflictError);
    expect(old.activeRoomCount).toBe(0);
    expect(stale.close).toHaveBeenCalledOnce();
    expect(stale.messages.at(-1)).toMatchObject({
      type: 'ERROR',
      message: expect.stringContaining('another server'),
    });
    expect(storage.rooms.get(room.id)?.members.accepted).toBeDefined();
    expect(storage.rooms.get(room.id)?.members.loser).toBeUndefined();
    const save = vi.spyOn(storage, 'save');
    await vi.advanceTimersByTimeAsync(120000);
    await old.flushAll();
    expect(save).not.toHaveBeenCalled();
    expect((await old.authorize(room.id, owner.id)).members.accepted).toBeDefined();
    expect(() =>
      old.handle(stale, room.id, { v: 2, type: 'INVITE_ROTATE', actionId: 'stale' }),
    ).toThrow('Join');
  });
  it('does not retry rollback snapshots after a concurrent in-flight membership save loses CAS', async () => {
    const old = manager(),
      room = await old.create(owner, 'Concurrent');
    const next = manager();
    await next.authorize(room.id, owner.id);
    const gate = deferred(),
      started = deferred(),
      save = storage.save.bind(storage);
    const calls = vi.spyOn(storage, 'save').mockImplementation(async (snapshot, version) => {
      if (snapshot.members.loser) {
        started.resolve();
        await gate.promise;
      }
      return save(snapshot, version);
    });
    const lost = expect(old.join(peer('loser'), room.id, room.inviteCode)).rejects.toBeInstanceOf(
      SnapshotConflictError,
    );
    await started.promise;
    const alsoLost = expect(
      old.configureDiscord(room.id, owner.id, {
        url: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_123456',
        enabled: true,
        mode: 'manual',
      }),
    ).rejects.toBeInstanceOf(SnapshotConflictError);
    await next.join(peer('winner'), room.id, room.inviteCode);
    gate.resolve();
    await Promise.all([lost, alsoLost]);
    expect(old.activeRoomCount).toBe(0);
    const count = calls.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(calls).toHaveBeenCalledTimes(count);
    const persisted = storage.rooms.get(room.id)!;
    expect(persisted.members.winner).toBeDefined();
    expect(persisted.members.loser).toBeUndefined();
    expect(persisted.discord).toBeUndefined();
  });
  it('reports newer configuration changes during a save even when gameplay revision is unchanged', async () => {
    const m = manager(),
      room = await m.create(owner, 'Save status'),
      gm = peer(owner.id);
    await m.join(gm, room.id);
    const first = deferred(),
      second = deferred(),
      secondStarted = deferred(),
      save = storage.save.bind(storage);
    vi.spyOn(storage, 'save')
      .mockImplementationOnce(async (snapshot, version) => {
        await first.promise;
        return save(snapshot, version);
      })
      .mockImplementationOnce(async (snapshot, version) => {
        secondStarted.resolve();
        await second.promise;
        return save(snapshot, version);
      });
    m.handle(gm, room.id, { v: 2, type: 'INVITE_ROTATE', actionId: 'first' });
    expect(gm.messages.filter((message) => message.type === 'ROOM_SNAPSHOT').at(-1)).toMatchObject({
      savedRevision: 0,
      savePending: true,
    });
    m.handle(gm, room.id, { v: 2, type: 'INVITE_ROTATE', actionId: 'second' });
    first.resolve();
    await secondStarted.promise;
    expect(gm.messages.filter((message) => message.type === 'SAVED').at(-1)).toMatchObject({
      revision: 0,
      pending: true,
    });
    m.handle(gm, room.id, { v: 2, type: 'STATE_RESYNC', actionId: 'resync' });
    expect(gm.messages.filter((message) => message.type === 'ROOM_SNAPSHOT').at(-1)).toMatchObject({
      savedRevision: 0,
      savePending: true,
    });
    second.resolve();
    await m.flushAll();
    expect(gm.messages.filter((message) => message.type === 'SAVED').at(-1)).toMatchObject({
      revision: 0,
      pending: false,
    });
  });
  it('keeps deletion cleanup durable on Storage failure and accepts an idempotent DELETE retry', async () => {
    const blobs = assets(),
      m = manager(blobs),
      room = await m.create(owner, 'Cleanup');
    await m.registerAsset(room.id, owner.id, image);
    blobs.remove.mockRejectedValueOnce(new Error('Storage offline'));
    await m.removeAsset(room.id, image.id, owner.id);
    expect(storage.rooms.get(room.id)?.state.assets?.[image.id]).toBeUndefined();
    expect(storage.rooms.get(room.id)?.assetCleanup?.[image.id]).toBeDefined();
    await expect(m.assetReadable(room.id, image.id, owner.id)).rejects.toThrow('access denied');
    await m.removeAsset(room.id, image.id, owner.id);
    expect(blobs.remove).toHaveBeenCalledTimes(2);
    await m.flushAll();
    expect(storage.rooms.get(room.id)?.assetCleanup?.[image.id]).toBeUndefined();
  });
  it('retries failed deletion after hydration and handles a crash before cleanup acknowledgment', async () => {
    const blobs = assets(),
      first = manager(blobs),
      room = await first.create(owner, 'Restart');
    await first.registerAsset(room.id, owner.id, image);
    blobs.remove.mockRejectedValueOnce(new Error('Storage offline'));
    await first.removeAsset(room.id, image.id, owner.id);
    await first.close();
    const resumed = manager(blobs);
    await resumed.authorize(room.id, owner.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(blobs.remove).toHaveBeenCalledTimes(2);
    // Bytes were removed, but the batched acknowledgment has not been saved.
    const crashSnapshot = structuredClone(storage.rooms.get(room.id)!);
    expect(crashSnapshot.assetCleanup?.[image.id]).toBeDefined();
    await resumed.close();
    storage.rooms.set(room.id, crashSnapshot);
    const restarted = manager(blobs);
    await restarted.authorize(room.id, owner.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(blobs.remove).toHaveBeenCalledTimes(3);
    await restarted.flushAll();
    expect(storage.rooms.get(room.id)?.assetCleanup?.[image.id]).toBeUndefined();
  });
  it('does not delete bytes when persisting the deletion intent fails', async () => {
    const blobs = assets(),
      m = manager(blobs),
      room = await m.create(owner, 'Failure');
    await m.registerAsset(room.id, owner.id, image);
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('Offline'));
    await expect(m.removeAsset(room.id, image.id, owner.id)).rejects.toThrow('Offline');
    expect(blobs.remove).not.toHaveBeenCalled();
    expect(await m.assetReadable(room.id, image.id, owner.id)).toEqual(image);
    await m.flushAll();
    expect(storage.rooms.get(room.id)?.assetCleanup?.[image.id]).toBeUndefined();
  });
  it('persists upload rollback cleanup before writing bytes and retries it after restart', async () => {
    const blobs = assets(),
      m = manager(blobs),
      room = await m.create(owner, 'Upload rollback');
    const save = storage.save.bind(storage);
    vi.spyOn(storage, 'save')
      .mockImplementationOnce(save)
      .mockRejectedValueOnce(new Error('Manifest unavailable'))
      .mockImplementation(save);
    blobs.put.mockImplementationOnce(async () => {
      expect(storage.rooms.get(room.id)?.assetCleanup?.[image.id]).toBeDefined();
    });
    blobs.remove.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(m.uploadAsset(room.id, owner.id, image, Buffer.from('webp'))).rejects.toThrow(
      'Manifest unavailable',
    );
    expect(storage.rooms.get(room.id)?.state.assets?.[image.id]).toBeUndefined();
    expect(storage.rooms.get(room.id)?.assetCleanup?.[image.id]).toBeDefined();
    await m.close();
    const resumed = manager(blobs);
    await resumed.authorize(room.id, owner.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(blobs.remove).toHaveBeenCalledTimes(2);
    await resumed.flushAll();
    expect(storage.rooms.get(room.id)?.assetCleanup?.[image.id]).toBeUndefined();
  });
  it('never deletes an uploaded image after an uncertain manifest commit succeeded', async () => {
    const blobs = assets(),
      m = manager(blobs),
      room = await m.create(owner, 'Uncertain write');
    const save = storage.save.bind(storage);
    vi.spyOn(storage, 'save')
      .mockImplementationOnce(save)
      .mockImplementationOnce(async (snapshot, version) => {
        await save(snapshot, version);
        throw new Error('Response lost');
      })
      .mockImplementation(save);
    await expect(m.uploadAsset(room.id, owner.id, image, Buffer.from('webp'))).rejects.toThrow(
      'Response lost',
    );
    expect(m.activeRoomCount).toBe(0);
    expect(blobs.remove).not.toHaveBeenCalled();
    expect(storage.rooms.get(room.id)?.state.assets?.[image.id]).toEqual(image);
    expect(storage.rooms.get(room.id)?.assetCleanup?.[image.id]).toBeUndefined();
    expect(await m.assetReadable(room.id, image.id, owner.id)).toEqual(image);
  });
  it('retains an unfinished upload intent over restart until its grace period elapses', async () => {
    const blobs = assets(),
      first = manager(blobs),
      room = await first.create(owner, 'Interrupted upload');
    blobs.put.mockRejectedValueOnce(new Error('Upload aborted'));
    await expect(first.uploadAsset(room.id, owner.id, image, Buffer.from('webp'))).rejects.toThrow(
      'Upload aborted',
    );
    await first.close();
    const resumed = manager(blobs);
    await resumed.authorize(room.id, owner.id);
    await vi.advanceTimersByTimeAsync(14 * 60000);
    expect(blobs.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(blobs.remove).toHaveBeenCalledOnce();
    await resumed.flushAll();
    expect(storage.rooms.get(room.id)?.assetCleanup?.[image.id]).toBeUndefined();
  });
  it('rolls back a failed save shared by membership, configuration and an upload intent', async () => {
    const blobs = assets(),
      m = manager(blobs),
      room = await m.create(owner, 'Shared failure');
    const gate = deferred(),
      started = deferred();
    vi.spyOn(storage, 'save').mockImplementationOnce(async () => {
      started.resolve();
      await gate.promise;
      throw new Error('Shared save failed');
    });
    const join = expect(m.join(peer('guest'), room.id, room.inviteCode)).rejects.toThrow(
      'Shared save failed',
    );
    await started.promise;
    const config = expect(
      m.configureDiscord(room.id, owner.id, {
        url: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_123456',
        enabled: true,
        mode: 'manual',
      }),
    ).rejects.toThrow('Shared save failed');
    const upload = expect(
      m.uploadAsset(room.id, owner.id, image, Buffer.from('webp')),
    ).rejects.toThrow('Shared save failed');
    const live = await m.authorize(room.id, owner.id);
    await vi.waitFor(() => {
      expect(live.discord).toBeDefined();
      expect(live.assetCleanup?.[image.id]).toBeDefined();
    });
    gate.resolve();
    await Promise.all([join, config, upload]);
    expect(live.members.guest).toBeUndefined();
    expect(live.discord).toBeUndefined();
    expect(live.assetCleanup?.[image.id]).toBeDefined();
    expect(blobs.put).not.toHaveBeenCalled();
    expect(blobs.remove).not.toHaveBeenCalled();
    await m.flushAll();
    const saved = storage.rooms.get(room.id)!;
    expect(saved.members.guest).toBeUndefined();
    expect(saved.discord).toBeUndefined();
    expect(saved.assetCleanup?.[image.id]).toBeDefined();
  });
  it('fences stale hydrated cleanup before it can delete a newer successfully registered upload', async () => {
    const blobs = assets(),
      uploader = manager(blobs),
      room = await uploader.create(owner, 'Stale cleanup');
    const gate = deferred(),
      started = deferred();
    blobs.put.mockImplementationOnce(async () => {
      started.resolve();
      await gate.promise;
    });
    const uploading = uploader.uploadAsset(room.id, owner.id, image, Buffer.from('webp'));
    await started.promise;
    const stale = manager(blobs);
    expect((await stale.authorize(room.id, owner.id)).assetCleanup?.[image.id]).toBeDefined();
    gate.resolve();
    await uploading;
    expect(storage.rooms.get(room.id)?.state.assets?.[image.id]).toEqual(image);
    await vi.advanceTimersByTimeAsync(15 * 60000);
    expect(stale.activeRoomCount).toBe(0);
    expect(blobs.remove).not.toHaveBeenCalled();
    expect(storage.rooms.get(room.id)?.state.assets?.[image.id]).toEqual(image);
    expect(storage.rooms.get(room.id)?.assetCleanup?.[image.id]).toBeUndefined();
  });
  it('keeps server-only cleanup metadata and save versions out of peer snapshots', async () => {
    const m = manager(assets()),
      room = await m.create(owner, 'Private metadata');
    const gm: Peer & { messages: ServerMessage[] } = peer(owner.id);
    await m.join(gm, room.id);
    expect(JSON.stringify(gm.messages)).not.toContain('saveVersion');
    expect(JSON.stringify(gm.messages)).not.toContain('assetCleanup');
  });
});
