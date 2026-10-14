import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager, type Peer } from '../server/rooms.js';
import type { DurableRoom, UploadedAsset } from '../shared/model.js';
import type { Persistence } from '../server/persistence.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const owner = { id: 'owner', name: 'Keeper' };
const image: UploadedAsset = {
  id: 'image',
  name: 'Image',
  width: 32,
  height: 32,
  bytes: 4,
  createdBy: owner.id,
  createdAt: '2026-10-15T00:00:00Z',
};
describe('shutdown persistence', () => {
  let manager: RoomManager;
  const snapshots = new Map<string, DurableRoom>();
  const storage: Persistence = {
    async load(id) {
      return structuredClone(snapshots.get(id) || null);
    },
    async save(room, version = 0) {
      snapshots.set(room.state.id, structuredClone({ ...room, saveVersion: version + 1 }));
      return version + 1;
    },
  };
  beforeEach(() => {
    vi.useFakeTimers();
    snapshots.clear();
    manager = new RoomManager(storage);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  async function move(id: string, actionId = 'move') {
    const peer: Peer = { identity: owner, send() {} };
    await manager.join(peer, id);
    manager.handle(peer, id, {
      v: 2,
      actionId,
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 520, y: 760 },
    });
  }
  it('saves other campaigns immediately and finishes within the upload grace period', async () => {
    const gate = deferred(),
      started = deferred();
    manager.setAssetStorage({
      put: async () => {
        started.resolve();
        await gate.promise;
      },
      get: async () => Buffer.from(''),
      remove: async () => {},
    });
    const first = await manager.create(owner, 'Upload'),
      second = await manager.create(owner, 'Movement');
    const uploading = manager.uploadAsset(first.id, owner.id, image, Buffer.from('webp'));
    await started.promise;
    await move(second.id);
    await move(first.id);
    let finished = false;
    const closing = manager.close().then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    for (const room of [first, second])
      expect(snapshots.get(room.id)?.state.scenes.hollow.tokens.ranger).toMatchObject({
        x: 520,
        y: 760,
      });
    await vi.advanceTimersByTimeAsync(2999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(finished).toBe(true);
    expect(snapshots.get(first.id)?.assetCleanup?.image).toBeDefined();
    gate.resolve();
    await uploading;
  });
  it('saves uploads that complete within the grace period in the final snapshot', async () => {
    const gate = deferred(),
      started = deferred();
    manager.setAssetStorage({
      put: async () => {
        started.resolve();
        await gate.promise;
      },
      get: async () => Buffer.from(''),
      remove: async () => {},
    });
    const room = await manager.create(owner, 'Finishing upload');
    const uploading = manager.uploadAsset(room.id, owner.id, image, Buffer.from('webp'));
    await started.promise;
    const closing = manager.close();
    await vi.advanceTimersByTimeAsync(1000);
    gate.resolve();
    await Promise.all([uploading, closing]);
    expect(snapshots.get(room.id)?.state.assets?.image).toEqual(image);
    expect(snapshots.get(room.id)?.assetCleanup?.image).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for independent saves even when one campaign fails and retries in the final pass', async () => {
    const first = await manager.create(owner, 'Failing'),
      second = await manager.create(owner, 'Healthy');
    await move(first.id);
    await move(second.id);
    const save = storage.save.bind(storage),
      calls: string[] = [];
    vi.spyOn(storage, 'save').mockImplementation(async (room, version) => {
      calls.push(room.state.id);
      if (room.state.id === first.id) throw new Error('Offline');
      return save(room, version);
    });
    await expect(manager.close()).rejects.toThrow('Offline');
    expect(calls.filter((id) => id === first.id)).toHaveLength(2);
    expect(snapshots.get(second.id)?.state.scenes.hollow.tokens.ranger.x).toBe(520);
  });
});
