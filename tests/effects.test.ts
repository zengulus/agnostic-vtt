import { describe, expect, it } from 'vitest';
import { newRoom } from '../shared/sample.js';
import { prepareAction } from '../shared/actions.js';
import { applyChanges, inverseChanges, projectChanges } from '../shared/state.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
import { projectRoom, REDACTED_TURN_ID, statusDigest, zoneDigest } from '../shared/model.js';
import { parseCharacter } from '../shared/characters.js';
import { readFileSync } from 'node:fs';
const msg = (action: Action) => clientMessageSchema.parse({ ...action, v: 7, actionId: 'test' });
const user = { id: 'gm', name: 'GM' };
const setup = () => {
  const room = newRoom('test-room', 'gm', 'GM', 'Test', 'invite');
  room.members.player = { name: 'Player', role: 'player' };
  room.state.tracker = {
    entries: [
      { id: 'a', name: 'A', value: 10, hidden: false },
      { id: 'b', name: 'B', value: 5, hidden: false },
    ],
    activeId: 'a',
    round: 1,
    order: 'manual',
  };
  return room;
};
const step = (room: ReturnType<typeof setup>, action: Action, who = user) => {
  const before = room.state;
  const changes = prepareAction(room, who, msg(action), () => 1);
  room.state = applyChanges(before, changes);
  return { before, changes, inverse: inverseChanges(before, changes) };
};
describe('generic timed effects', () => {
  it('rejects edits based on expired conditions and zones, and rejects old protocol clients', () => {
    const room = setup();
    const status = { id: 'slow', label: 'Slow', color: '#abcdef', icon: 'circle' as const };
    step(room, { type: 'TOKEN_STATUS_SET', sceneId: 'hollow', tokenId: 'ranger', status });
    const digest = statusDigest(status);
    room.state.scenes.hollow.tokens.ranger.statuses = [];
    expect(() =>
      step(room, {
        type: 'TOKEN_STATUS_SET',
        sceneId: 'hollow',
        tokenId: 'ranger',
        status,
        expected: digest,
      }),
    ).toThrow();
    const zone = {
      id: 'z',
      shape: 'circle' as const,
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      color: '#abcdef',
      label: 'Zone',
    };
    step(room, { type: 'ZONE_UPDATE', sceneId: 'hollow', zone });
    const expected = zoneDigest(zone);
    room.state.scenes.hollow.zones.z = { ...zone, visibility: 'gm' };
    expect(() => step(room, { type: 'ZONE_UPDATE', sceneId: 'hollow', zone, expected })).toThrow();
    const frame = {
      type: 'TOKEN_STATUS_SET',
      sceneId: 'hollow',
      tokenId: 'ranger',
      status,
      actionId: 'test',
    };
    expect(clientMessageSchema.safeParse({ ...frame, v: 7 }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ ...frame, v: 2 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ ...frame, v: 3 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ ...frame, v: 4 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ ...frame, v: 5 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ ...frame, v: 6 }).success).toBe(false);
  });
  it('ticks token conditions and zones at their selected turn phase and undo restores them', () => {
    const room = setup();
    step(room, {
      type: 'TOKEN_STATUS_SET',
      sceneId: 'hollow',
      tokenId: 'ranger',
      status: {
        id: 'slow',
        label: 'Slow',
        color: '#abcdef',
        icon: 'circle',
        duration: { participantId: 'b', phase: 'start', remaining: 2 },
      },
    });
    step(room, {
      type: 'ZONE_UPDATE',
      sceneId: 'hollow',
      zone: {
        id: 'hazard',
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        color: '#abcdef',
        label: 'Hazard',
        duration: { participantId: 'a', phase: 'end', remaining: 1 },
      },
    });
    const advanced = step(room, { type: 'TRACKER_ADVANCE', direction: 1 });
    expect(room.state.scenes.hollow.tokens.ranger.statuses?.[0].duration?.remaining).toBe(1);
    expect(room.state.scenes.hollow.zones.hazard).toBeUndefined();
    const restored = applyChanges(room.state, advanced.inverse);
    expect(restored.scenes.hollow.zones.hazard.duration?.remaining).toBe(1);
    expect(restored.scenes.hollow.tokens.ranger.statuses?.[0].duration?.remaining).toBe(2);
    step(room, { type: 'TRACKER_ADVANCE', direction: 1 });
    step(room, { type: 'TRACKER_ADVANCE', direction: 1 });
    expect(room.state.scenes.hollow.tokens.ranger.statuses).toEqual([]);
  });
  it('only allows token controllers to change conditions and rejects missing turn anchors', () => {
    const room = setup();
    room.state.scenes.hollow.tokens.ranger.owners = [];
    const action: Action = {
      type: 'TOKEN_STATUS_SET',
      sceneId: 'hollow',
      tokenId: 'ranger',
      status: { id: 'x', label: 'Marked', color: '#ffffff', icon: 'circle' },
    };
    expect(() => step(room, action, { id: 'player', name: 'Player' })).toThrow('do not control');
    if (action.type === 'TOKEN_STATUS_SET')
      action.status.duration = { participantId: 'missing', phase: 'end', remaining: 1 };
    expect(() => step(room, action)).toThrow('participant');
  });
  it('prevents removing a participant while effects depend on it', () => {
    const room = setup();
    step(room, {
      type: 'TOKEN_STATUS_SET',
      sceneId: 'hollow',
      tokenId: 'ranger',
      status: {
        id: 'marked',
        label: 'Marked',
        color: '#ffffff',
        icon: 'circle',
        duration: { participantId: 'b', phase: 'end', remaining: 1 },
      },
    });
    expect(() =>
      step(room, {
        type: 'TRACKER_UPDATE',
        tracker: {
          ...room.state.tracker!,
          entries: room.state.tracker!.entries.filter((e) => e.id !== 'b'),
        },
      }),
    ).toThrow('Remove or reassign');
  });
  it('does not expose hidden turn anchors and preserves them during player edits', () => {
    const room = setup();
    room.state.tracker!.entries[1].hidden = true;
    room.state.scenes.hollow.tokens.ranger.owners = ['player'];
    step(room, {
      type: 'TOKEN_STATUS_SET',
      sceneId: 'hollow',
      tokenId: 'ranger',
      status: {
        id: 'marked',
        label: 'Marked',
        color: '#ffffff',
        icon: 'circle',
        duration: { participantId: 'b', phase: 'end', remaining: 2 },
      },
    });
    const projected = projectRoom(room, 'player').scenes.hollow.tokens.ranger.statuses![0];
    expect(projected.duration?.participantId).toBe(REDACTED_TURN_ID);
    const edit = step(
      room,
      {
        type: 'TOKEN_STATUS_SET',
        sceneId: 'hollow',
        tokenId: 'ranger',
        status: { ...projected, note: 'Changed' },
        expected: statusDigest(projected),
      },
      { id: 'player', name: 'Player' },
    );
    expect(room.state.scenes.hollow.tokens.ranger.statuses![0].duration?.participantId).toBe('b');
    expect(
      JSON.stringify(projectChanges(edit.changes, edit.before, room.state, 'player', 'player')),
    ).not.toContain('"participantId":"b"');
  });
  it('withholds GM zones from snapshots, updates and deletions', () => {
    const room = setup();
    const zone = {
      id: 'secret',
      shape: 'rectangle' as const,
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      color: '#abcdef',
      label: 'Secret',
      visibility: 'gm' as const,
    };
    const added = step(room, { type: 'ZONE_UPDATE', sceneId: 'hollow', zone });
    expect(projectRoom(room, 'player').scenes.hollow.zones.secret).toBeUndefined();
    expect(projectChanges(added.changes, added.before, room.state, 'player', 'player')).toEqual([]);
    const deleted = step(room, { type: 'ZONE_DELETE', sceneId: 'hollow', id: 'secret' });
    expect(projectChanges(deleted.changes, deleted.before, room.state, 'player', 'player')).toEqual(
      [],
    );
    step(room, { type: 'ZONE_UPDATE', sceneId: 'hollow', zone: { ...zone, visibility: 'public' } });
    const hide = step(room, {
      type: 'ZONE_UPDATE',
      sceneId: 'hollow',
      zone,
      expected: zoneDigest({ ...zone, visibility: 'public' }),
    });
    expect(projectChanges(hide.changes, hide.before, room.state, 'player', 'player')).toEqual([
      { kind: 'zone-delete', sceneId: 'hollow', id: 'secret' },
    ]);
  });
  it('moves attached zones atomically with tokens and detaches them on deletion', () => {
    const room = setup();
    step(room, {
      type: 'ZONE_UPDATE',
      sceneId: 'hollow',
      zone: {
        id: 'aura',
        shape: 'rectangle',
        x: 20,
        y: 30,
        width: 100,
        height: 100,
        color: '#abcdef',
        label: 'Aura',
        anchorTokenId: 'ranger',
      },
    });
    const before = room.state.scenes.hollow.tokens.ranger;
    const moved = step(room, {
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 680, y: 760 },
    });
    expect(room.state.scenes.hollow.zones.aura.x).toBe(
      20 + room.state.scenes.hollow.tokens.ranger.x - before.x,
    );
    expect(applyChanges(room.state, moved.inverse).scenes.hollow.zones.aura.x).toBe(20);
    expect(projectRoom(room, 'player').scenes.hollow.zones.aura.anchorTokenId).toBeUndefined();
    step(room, { type: 'TOKEN_DELETE', sceneId: 'hollow', tokenId: 'ranger' });
    expect(room.state.scenes.hollow.zones.aura.anchorTokenId).toBeUndefined();
  });
  it('uses linked resources as the single authoritative counter with sheet permissions', () => {
    const room = setup();
    const sheet = parseCharacter(readFileSync('public/examples/character.txt', 'utf8'));
    room.state.characters = {
      kael: { ...sheet, id: 'kael', ownerId: 'player', visibility: 'private' },
    };
    const token = room.state.scenes.hollow.tokens.ranger;
    token.owners = ['player'];
    token.characterId = 'kael';
    token.resourceId = 'focus';
    step(
      room,
      { type: 'TOKEN_RESOURCE_ADJUST', sceneId: 'hollow', tokenId: 'ranger', delta: -1 },
      { id: 'player', name: 'Player' },
    );
    expect(room.state.characters.kael.resources.find((r) => r.id === 'focus')?.current).toBe(2);
    expect(room.state.scenes.hollow.tokens.ranger.resource?.value).toBe(8);
    room.state.characters.kael.ownerId = 'gm';
    expect(() =>
      step(
        room,
        { type: 'TOKEN_RESOURCE_ADJUST', sceneId: 'hollow', tokenId: 'ranger', delta: -1 },
        { id: 'player', name: 'Player' },
      ),
    ).toThrow('Character not found');
  });
});
