import { describe, expect, it } from 'vitest';
import { tableToolDigest, projectRoom } from '../shared/model.js';
import { newRoom } from '../shared/sample.js';
import { prepareAction } from '../shared/actions.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
import { applyChanges, inverseChanges, projectChanges } from '../shared/state.js';

function setup() {
  const room = newRoom('test-room', 'gm', 'GM', 'Test', 'invite');
  room.members.player = { name: 'Player', role: 'player' };
  return room;
}
function perform(room: ReturnType<typeof setup>, action: Action, user = 'gm') {
  const before = room.state;
  const changes = prepareAction(
    room,
    { id: user, name: user },
    clientMessageSchema.parse({ ...action, v: 7, actionId: 'test' }),
    () => 1,
  );
  room.state = applyChanges(before, changes);
  return { before, changes };
}
describe('shared table tools', () => {
  it('keeps atomic adjustments bounded, recoverable and available to players', () => {
    const room = setup();
    perform(room, {
      type: 'TABLE_TOOL_SAVE',
      tool: { id: 'clock', kind: 'clock', name: 'Alert', value: 0, segments: 4 },
    });
    const update = perform(room, { type: 'TABLE_TOOL_ADJUST', id: 'clock', delta: 1 }, 'player');
    expect(room.state.tableTools?.clock).toMatchObject({ value: 1 });
    expect(
      applyChanges(room.state, inverseChanges(update.before, update.changes)).tableTools?.clock,
    ).toMatchObject({ value: 0 });
    for (let i = 0; i < 10; i++)
      perform(room, { type: 'TABLE_TOOL_ADJUST', id: 'clock', delta: 1 }, 'player');
    expect(room.state.tableTools?.clock).toMatchObject({ value: 4 });
    expect(() => perform(room, { type: 'TABLE_TOOL_DELETE', id: 'clock' }, 'player')).toThrow();
    expect(() =>
      perform(room, {
        type: 'TABLE_TOOL_SAVE',
        tool: { id: 'clock', kind: 'clock', name: 'Overwrite', value: 0, segments: 4 },
      }),
    ).toThrow();
  });
  it('limits table definitions and snapshot growth', () => {
    const room = setup();
    const before = JSON.stringify(room.state).length;
    const entries = Array.from({ length: 50 }, () => ({ text: 'x'.repeat(200), weight: 1000 }));
    for (let i = 0; i < 50; i++)
      perform(room, {
        type: 'TABLE_TOOL_SAVE',
        tool: { id: `table${i}`, kind: 'table', name: 'Table', entries },
      });
    expect(JSON.stringify(room.state).length - before).toBeLessThan(600000);
    expect(() =>
      perform(room, {
        type: 'TABLE_TOOL_SAVE',
        tool: { id: 'extra', kind: 'table', name: 'Table', entries },
      }),
    ).toThrow();
    expect(
      clientMessageSchema.safeParse({
        v: 7,
        actionId: 'test',
        type: 'TABLE_TOOL_SAVE',
        tool: { id: 'bad', kind: 'table', name: 'Bad', entries: [...entries, entries[0]] },
      }).success,
    ).toBe(false);
  });
  it('redacts entries from snapshots and patches while preserving guarded GM edits', () => {
    const room = setup();
    const tool = {
      id: 'rumour',
      kind: 'table' as const,
      name: 'Rumour',
      entries: [{ text: 'A hidden dragon', weight: 3 }],
    };
    const created = perform(room, { type: 'TABLE_TOOL_SAVE', tool });
    expect(JSON.stringify(projectRoom(room, 'player'))).not.toContain('A hidden dragon');
    expect(
      JSON.stringify(
        projectChanges(created.changes, created.before, room.state, 'player', 'player'),
      ),
    ).not.toContain('A hidden dragon');
    const updated = { ...tool, name: 'New rumour' };
    perform(room, { type: 'TABLE_TOOL_SAVE', tool: updated, digest: tableToolDigest(tool) });
    expect(() =>
      perform(room, { type: 'TABLE_TOOL_SAVE', tool, digest: tableToolDigest(tool) }),
    ).toThrow(/changed/);
    expect(room.state.tableTools?.rumour).toEqual(updated);
  });
  it('does not produce a change at either clock limit', () => {
    const room = setup();
    perform(room, {
      type: 'TABLE_TOOL_SAVE',
      tool: { id: 'c', kind: 'clock', name: 'Clock', value: 0, segments: 2 },
    });
    expect(perform(room, { type: 'TABLE_TOOL_ADJUST', id: 'c', delta: -1 }).changes).toEqual([]);
    perform(room, { type: 'TABLE_TOOL_ADJUST', id: 'c', delta: 1 });
    perform(room, { type: 'TABLE_TOOL_ADJUST', id: 'c', delta: 1 });
    expect(perform(room, { type: 'TABLE_TOOL_ADJUST', id: 'c', delta: 1 }).changes).toEqual([]);
  });
});
