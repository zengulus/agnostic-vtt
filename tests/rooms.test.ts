import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager, type Peer } from '../server/rooms.js';
import { SnapshotConflictError, type Persistence } from '../server/persistence.js';
import type { DurableRoom } from '../shared/model.js';
import type { ServerMessage } from '../shared/protocol.js';
import { newRoom } from '../shared/sample.js';

class MemoryPersistence implements Persistence {
  rooms = new Map<string, DurableRoom>();
  async load(id: string) {
    return structuredClone(this.rooms.get(id) || null);
  }
  async save(room: DurableRoom, expectedSaveVersion = room.saveVersion || 0) {
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
  return { identity: { id, name: id }, send: (m: ServerMessage) => messages.push(m), messages };
}

describe('room admission and lifecycle', () => {
  let storage: MemoryPersistence, manager: RoomManager;
  const owner = { id: 'owner', name: 'Owner' };
  beforeEach(() => {
    vi.useFakeTimers();
    storage = new MemoryPersistence();
    manager = new RoomManager(storage, 60000, 100);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await manager.close();
    vi.useRealTimers();
  });
  it('shares bounded measurements without writes and with scene visibility checks', async () => {
    const room = await manager.create(owner, 'Measurements');
    const gm = peer(owner.id),
      player = peer('player');
    await manager.join(gm, room.id);
    await manager.join(player, room.id, room.inviteCode);
    const save = vi.spyOn(storage, 'save');
    const revision = storage.rooms.get(room.id)!.state.revision;
    for (let i = 0; i < 100; i++)
      manager.handle(gm, room.id, {
        v: 7,
        actionId: `measure-${i}`,
        type: 'MEASUREMENT_SHARE',
        sceneId: 'hollow',
        mode: 'distance',
        start: { x: -10, y: 0 },
        end: { x: 100, y: 100 },
        points: [],
      });
    const messages = player.messages.filter((message) => message.type === 'MEASUREMENT_SHARE');
    expect(messages).toHaveLength(100);
    expect(messages[0]).toMatchObject({ start: { x: 0, y: 0 } });
    expect(JSON.stringify(messages[0]).length).toBeLessThan(250);
    await vi.advanceTimersByTimeAsync(60000);
    expect(save).not.toHaveBeenCalled();
    expect(storage.rooms.get(room.id)!.state.revision).toBe(revision);
    manager.handle(gm, room.id, {
      v: 7,
      actionId: 'hide',
      type: 'SCENE_VISIBILITY',
      sceneId: 'sanctuary',
      visibility: 'gm',
    });
    player.messages.length = 0;
    manager.handle(gm, room.id, {
      v: 7,
      actionId: 'secret-measure',
      type: 'MEASUREMENT_SHARE',
      sceneId: 'sanctuary',
      mode: 'distance',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      points: [],
    });
    expect(player.messages.filter((message) => message.type === 'MEASUREMENT_SHARE')).toHaveLength(
      0,
    );
  });
  it('coalesces URL image changes into a single scheduled snapshot', async () => {
    const room = await manager.create(owner, 'Image URLs');
    const gm = peer(owner.id);
    await manager.join(gm, room.id);
    const before = (await manager.authorize(room.id, owner.id)).state.scenes.hollow;
    const save = vi.spyOn(storage, 'save');
    for (let i = 0; i < 5; i++)
      manager.handle(gm, room.id, {
        v: 7,
        actionId: `map-${i}`,
        type: 'SCENE_CONFIG',
        sceneId: before.id,
        name: before.name,
        width: before.width,
        height: before.height,
        map: { kind: 'external', url: `https://images.example.com/map-${i}.png` },
        create: false,
      });
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(storage.rooms.get(room.id)!.state.scenes.hollow.map).toEqual({
      kind: 'external',
      url: 'https://images.example.com/map-4.png',
    });
  });
  it('coalesces wall, door and lighting edits into one scheduled snapshot', async () => {
    const room = await manager.create(owner, 'Lighting'),
      gm = peer(owner.id);
    await manager.join(gm, room.id);
    const save = vi.spyOn(storage, 'save');
    for (let i = 0; i < 20; i++)
      manager.handle(gm, room.id, {
        v: 7,
        actionId: `wall-${i}`,
        type: 'WALL_SET',
        sceneId: 'hollow',
        wall: {
          id: `wall-${i}`,
          a: { x: i, y: 20 },
          b: { x: i, y: 100 },
          kind: i === 0 ? 'door' : 'wall',
        },
      });
    manager.handle(gm, room.id, {
      v: 7,
      actionId: 'lights',
      type: 'LIGHTING_SET',
      sceneId: 'hollow',
      lighting: { vision: true, darkness: 0.7 },
    });
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(save).toHaveBeenCalledTimes(1);
    const persisted = storage.rooms.get(room.id)!;
    expect(Object.keys(persisted.state.scenes.hollow.walls || {})).toHaveLength(20);
    expect(JSON.stringify(persisted.state.scenes.hollow.walls).length).toBeLessThan(2500);
    save.mockClear();
    manager.handle(gm, room.id, {
      v: 7,
      actionId: 'same-light',
      type: 'LIGHTING_SET',
      sceneId: 'hollow',
      lighting: { vision: true, darkness: 0.7 },
    });
    manager.handle(gm, room.id, {
      v: 7,
      actionId: 'same-wall',
      type: 'WALL_SET',
      sceneId: 'hollow',
      wall: { id: 'wall-0', a: { x: 0, y: 20 }, b: { x: 0, y: 100 }, kind: 'door' },
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(save).not.toHaveBeenCalled();
  });
  it('evicts unused new campaigns and can resume their durable snapshots', async () => {
    const room = await manager.create(owner, 'Unused');
    await vi.advanceTimersByTimeAsync(15 * 60000);
    expect(manager.activeRoomCount).toBe(0);
    const gm = peer(owner.id);
    await manager.join(gm, room.id);
    expect(gm.messages.find((m) => m.type === 'ROOM_SNAPSHOT')).toMatchObject({
      state: { name: 'Unused' },
      self: { role: 'gm' },
    });
    await vi.advanceTimersByTimeAsync(15 * 60000);
    expect(manager.activeRoomCount).toBe(1);
    await manager.leave(gm, room.id);
    await vi.advanceTimersByTimeAsync(15 * 60000);
    expect(manager.activeRoomCount).toBe(0);
  });
  it('evicts rooms hydrated by HTTP requests even when access is denied', async () => {
    await storage.save(newRoom('loaded-room', owner.id, owner.name, 'Saved', 'invite'));
    await expect(manager.authorize('loaded-room', 'stranger')).rejects.toThrow('access denied');
    expect(manager.activeRoomCount).toBe(1);
    await vi.advanceTimersByTimeAsync(15 * 60000);
    expect(manager.activeRoomCount).toBe(0);
  });
  it('failed invitations cannot cancel or extend idle eviction', async () => {
    const room = await manager.create(owner, 'Unused');
    await vi.advanceTimersByTimeAsync(14 * 60000);
    await expect(manager.join(peer('stranger'), room.id, 'wrong')).rejects.toThrow('invitation');
    await vi.advanceTimersByTimeAsync(60000);
    expect(manager.activeRoomCount).toBe(0);
  });
  it('retains dirty rooms during storage outages and evicts them after recovery', async () => {
    const room = await manager.create(owner, 'Recovery'),
      gm = peer(owner.id);
    await manager.join(gm, room.id);
    manager.handle(gm, room.id, {
      v: 7,
      type: 'TOKEN_MOVE_COMMIT',
      actionId: 'move',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 520, y: 760 },
    });
    const save = vi.spyOn(storage, 'save').mockRejectedValue(new Error('Offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await manager.leave(gm, room.id);
    await vi.advanceTimersByTimeAsync(15 * 60000);
    expect(manager.activeRoomCount).toBe(1);
    save.mockRestore();
    await vi.advanceTimersByTimeAsync(15 * 60000);
    expect(manager.activeRoomCount).toBe(0);
    expect(storage.rooms.get(room.id)?.state.scenes.hollow.tokens.ranger).toMatchObject({
      x: 520,
      y: 760,
    });
  });
  it('reserves capacity while simultaneous campaign creations are saving', async () => {
    const gate = deferred(),
      save = storage.save.bind(storage);
    vi.spyOn(storage, 'save').mockImplementation(async (room, version) => {
      await gate.promise;
      return save(room, version);
    });
    const pending = Array.from({ length: 100 }, (_, i) => manager.create(owner, `Room ${i}`));
    await expect(manager.create(owner, 'Overflow')).rejects.toThrow('server is full');
    gate.resolve();
    await Promise.all(pending);
    expect(manager.activeRoomCount).toBe(100);
  });
  it('counts pending snapshot hydration toward the shared room capacity', async () => {
    for (let i = 0; i < 100; i++)
      await storage.save(newRoom(`saved-${i}`, owner.id, owner.name, 'Saved', 'invite'));
    const gate = deferred(),
      load = storage.load.bind(storage);
    vi.spyOn(storage, 'load').mockImplementation(async (id) => {
      await gate.promise;
      return load(id);
    });
    const pending = Array.from({ length: 100 }, (_, i) =>
      manager.authorize(`saved-${i}`, owner.id),
    );
    await expect(manager.create(owner, 'Overflow')).rejects.toThrow('server is full');
    gate.resolve();
    await Promise.all(pending);
    expect(manager.activeRoomCount).toBe(100);
  });
  it('keeps a second connection waiting until its membership is durable', async () => {
    const room = await manager.create(owner, 'Simultaneous'),
      first = peer('guest'),
      second = peer('guest');
    const started = deferred(),
      gate = deferred(),
      save = storage.save.bind(storage);
    vi.spyOn(storage, 'save').mockImplementationOnce(async (snapshot, version) => {
      started.resolve();
      await gate.promise;
      return save(snapshot, version);
    });
    const firstJoin = manager.join(first, room.id, room.inviteCode);
    await started.promise;
    const secondJoin = manager.join(second, room.id);
    await Promise.resolve();
    await Promise.resolve();
    expect(second.messages).toEqual([]);
    gate.resolve();
    await Promise.all([firstJoin, secondJoin]);
    expect(storage.rooms.get(room.id)?.members.guest.role).toBe('player');
    expect(second.messages.some((m) => m.type === 'ROOM_SNAPSHOT')).toBe(true);
  });
  it('does not admit a second connection through a membership whose save fails', async () => {
    const room = await manager.create(owner, 'Failure'),
      first = peer('guest'),
      second = peer('guest');
    const started = deferred(),
      gate = deferred();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(storage, 'save').mockImplementationOnce(async () => {
      started.resolve();
      await gate.promise;
      throw new Error('Storage unavailable');
    });
    const firstJoin = expect(manager.join(first, room.id, room.inviteCode)).rejects.toThrow(
      'Storage unavailable',
    );
    await started.promise;
    const secondJoin = expect(manager.join(second, room.id)).rejects.toThrow('invitation');
    gate.resolve();
    await Promise.all([firstJoin, secondJoin]);
    expect(second.messages).toEqual([]);
    expect(manager.stats.connections).toBe(0);
    expect((await manager.authorize(room.id, owner.id)).members.guest).toBeUndefined();
  });
  it('rejects connection overflow before adding durable campaign membership', async () => {
    const room = await manager.create(owner, 'Full');
    for (let i = 0; i < 20; i++) await manager.join(peer(owner.id), room.id);
    const save = vi.spyOn(storage, 'save');
    await expect(manager.join(peer('guest'), room.id, room.inviteCode)).rejects.toThrow(
      'connections',
    );
    expect(save).not.toHaveBeenCalled();
    expect((await manager.authorize(room.id, owner.id)).members.guest).toBeUndefined();
  });
  it('clears shared undo history when accepting a new campaign member', async () => {
    const room = await manager.create(owner, 'History'),
      gm: Peer = peer(owner.id);
    await manager.join(gm, room.id);
    manager.handle(gm, room.id, {
      v: 7,
      type: 'TOKEN_MOVE_COMMIT',
      actionId: 'move',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 520, y: 760 },
    });
    await manager.join(peer('guest'), room.id, room.inviteCode);
    expect(() => manager.handle(gm, room.id, { v: 7, type: 'UNDO', actionId: 'undo' })).toThrow(
      'Nothing to undo',
    );
  });
});
