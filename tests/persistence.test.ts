import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FilePersistence,
  SnapshotConflictError,
  SupabasePersistence,
} from '../server/persistence.js';
import { newRoom } from '../shared/sample.js';
import { FileAssetStorage } from '../server/assets.js';

describe('snapshot save-version adapters', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aether-version-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });
  it('upgrades an existing unversioned local snapshot without changing gameplay revision', async () => {
    const original = newRoom('saved-room', 'owner', 'Owner', 'Legacy', 'invite');
    await writeFile(join(dir, 'saved-room.json'), JSON.stringify(original));
    const storage = new FilePersistence(dir),
      loaded = (await storage.load('saved-room'))!;
    loaded.members.player = { name: 'Player', role: 'player' };
    expect(await storage.save(loaded, 0)).toBe(1);
    expect(await storage.load('saved-room')).toMatchObject({
      saveVersion: 1,
      state: { revision: 0 },
    });
    await expect(storage.save(original, 0)).rejects.toBeInstanceOf(SnapshotConflictError);
    expect((await storage.load('saved-room'))?.members.player).toBeDefined();
  });
  it('serializes CAS across local adapter instances and rejects a stale same-revision write', async () => {
    const first = new FilePersistence(dir),
      second = new FilePersistence(dir);
    const original = newRoom('saved-room', 'owner', 'Owner', 'Concurrent', 'invite');
    await first.save(original, 0);
    const a = (await first.load('saved-room'))!,
      b = (await second.load('saved-room'))!;
    a.inviteCode = 'first-invite';
    b.inviteCode = 'second-invite';
    const writes = await Promise.allSettled([first.save(a, 1), second.save(b, 1)]);
    expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = writes.find((result) => result.status === 'rejected')!;
    expect(rejected.reason).toBeInstanceOf(SnapshotConflictError);
    expect((await first.load('saved-room'))?.saveVersion).toBe(2);
  });
  it('treats absent local image files as successful idempotent cleanup', async () => {
    const assets = new FileAssetStorage(dir);
    await expect(assets.remove('saved-room', 'missing-image')).resolves.toBeUndefined();
    await assets.put('saved-room', 'image-one', Buffer.from('webp'));
    await assets.remove('saved-room', 'image-one');
    await expect(assets.remove('saved-room', 'image-one')).resolves.toBeUndefined();
  });
  it('sends the independent expected version to Supabase and maps only CAS failures to conflicts', async () => {
    const storage = new SupabasePersistence('https://example.supabase.co', 'test-service-role-key');
    const rpc = vi.spyOn(storage.client, 'rpc');
    rpc.mockResolvedValueOnce({ data: 5, error: null } as never);
    const room = newRoom('saved-room', 'owner', 'Owner', 'RPC', 'invite');
    expect(await storage.save(room, 4)).toBe(5);
    expect(rpc).toHaveBeenCalledWith(
      'save_room_snapshot',
      expect.objectContaining({ p_expected_save_version: 4, p_revision: 0 }),
    );
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409' } } as never);
    await expect(storage.save(room, 4)).rejects.toBeInstanceOf(SnapshotConflictError);
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'offline' } } as never);
    await expect(storage.save(room, 4)).rejects.toThrow('Snapshot write failed: offline');
    rpc.mockResolvedValueOnce({ data: null, error: null } as never);
    await expect(storage.save(room, 4)).rejects.toThrow('invalid save version');
  });
  it('uses Supabase column save_version rather than the older counter inside the JSON snapshot', async () => {
    const storage = new SupabasePersistence('https://example.supabase.co', 'test-service-role-key');
    const room = { ...newRoom('saved-room', 'owner', 'Owner', 'RPC', 'invite'), saveVersion: 1 };
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { snapshot: room, save_version: 7 }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle }),
      select = vi.fn().mockReturnValue({ eq });
    vi.spyOn(storage.client, 'from').mockReturnValue({ select } as never);
    expect((await storage.load(room.state.id))?.saveVersion).toBe(7);
    expect(select).toHaveBeenCalledWith('snapshot,save_version');
  });
});
