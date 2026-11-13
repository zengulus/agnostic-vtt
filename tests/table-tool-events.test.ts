import { expect, it, vi } from 'vitest';
import { RoomManager } from '../server/rooms.js';
import type { Persistence } from '../server/persistence.js';
import type { DurableRoom } from '../shared/model.js';
import type { ServerMessage } from '../shared/protocol.js';

it('presents redacted handouts and table rolls without additional saves', async () => {
  vi.useFakeTimers();
  const rooms = new Map<string, DurableRoom>();
  const storage: Persistence = {
    load: async (id) => structuredClone(rooms.get(id) || null),
    save: vi.fn(async (room, version = room.saveVersion || 0) => {
      rooms.set(room.state.id, structuredClone({ ...room, saveVersion: version + 1 }));
      return version + 1;
    }),
  };
  const manager = new RoomManager(storage, 60000, 100);
  const gm = { identity: { id: 'gm', name: 'GM' }, send: (_m: ServerMessage) => {} };
  const messages: ServerMessage[] = [];
  const player = {
    identity: { id: 'player', name: 'Player' },
    send: (m: ServerMessage) => messages.push(m),
  };
  try {
    const room = await manager.create(gm.identity, 'Test');
    await manager.join(gm, room.id);
    await manager.join(player, room.id, room.inviteCode);
    manager.handle(gm, room.id, {
      v: 7,
      actionId: 'handout',
      type: 'HANDOUT_SAVE',
      handout: {
        id: 'h',
        title: 'Letter',
        text: 'Clue',
        imageUrl: '',
        gmNote: 'Secret',
        shared: false,
      },
    });
    manager.handle(gm, room.id, {
      v: 7,
      actionId: 'table',
      type: 'TABLE_TOOL_SAVE',
      tool: { id: 't', name: 'Rumours', kind: 'table', entries: [{ text: 'A clue', weight: 1 }] },
    });
    expect(JSON.stringify(messages)).not.toContain('A clue');
    await vi.advanceTimersByTimeAsync(60000);
    vi.mocked(storage.save).mockClear();
    manager.handle(gm, room.id, { v: 7, actionId: 'present', type: 'HANDOUT_PRESENT', id: 'h' });
    manager.handle(player, room.id, { v: 7, actionId: 'roll', type: 'TABLE_TOOL_ROLL', id: 't' });
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'HANDOUT_PRESENT',
        handout: expect.objectContaining({ title: 'Letter', gmNote: '' }),
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'TABLE_TOOL_RESULT', result: 'A clue' }),
    );
    expect(() =>
      manager.handle(player, room.id, { v: 7, actionId: 'bad', type: 'HANDOUT_PRESENT', id: 'h' }),
    ).toThrow();
    await vi.advanceTimersByTimeAsync(60000);
    expect(storage.save).not.toHaveBeenCalled();
    manager.handle(gm, room.id, {
      v: 7,
      actionId: 'counter',
      type: 'TABLE_TOOL_SAVE',
      tool: { id: 'c', name: 'Supplies', kind: 'counter', value: 0 },
    });
    for (let i = 0; i < 20; i++)
      manager.handle(player, room.id, {
        v: 7,
        actionId: `adjust-${i}`,
        type: 'TABLE_TOOL_ADJUST',
        id: 'c',
        delta: 1,
      });
    expect(storage.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(rooms.get(room.id)?.state.tableTools?.c).toMatchObject({ value: 20 });
    manager.handle(gm, room.id, {
      v: 7,
      actionId: 'clock',
      type: 'TABLE_TOOL_SAVE',
      tool: { id: 'clock', name: 'Alert', kind: 'clock', segments: 2, value: 2 },
    });
    await vi.advanceTimersByTimeAsync(60000);
    const revision = rooms.get(room.id)!.state.revision;
    vi.mocked(storage.save).mockClear();
    manager.handle(player, room.id, {
      v: 7,
      actionId: 'full',
      type: 'TABLE_TOOL_ADJUST',
      id: 'clock',
      delta: 1,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(storage.save).not.toHaveBeenCalled();
    expect(rooms.get(room.id)!.state.revision).toBe(revision);
  } finally {
    await manager.close();
    vi.useRealTimers();
  }
});
