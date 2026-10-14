import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RoomManager } from '../server/rooms.js';
import type { Persistence } from '../server/persistence.js';
import {
  emptyTracker,
  type Annotation,
  type DurableRoom,
  type RoomState,
  type Zone,
} from '../shared/model.js';
import { clientMessageSchema, type Action, type ServerMessage } from '../shared/protocol.js';
import { applyChanges, inverseChanges } from '../shared/state.js';
import { newRoom } from '../shared/sample.js';

class MemoryPersistence implements Persistence {
  rooms = new Map<string, DurableRoom>();
  async load(id: string) {
    return structuredClone(this.rooms.get(id) || null);
  }
  async save(room: DurableRoom) {
    const saveVersion = (room.saveVersion || 0) + 1;
    this.rooms.set(room.state.id, structuredClone({ ...room, saveVersion }));
    return saveVersion;
  }
}
const annotation: Annotation = {
  id: 'drawing',
  kind: 'stroke',
  points: [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ],
  text: '',
  color: '#ffffff',
  width: 4,
  visibility: 'public',
};
const zone: Zone = {
  id: 'region',
  shape: 'rectangle',
  x: 100,
  y: 100,
  width: 80,
  height: 80,
  color: '#ffffff',
  label: 'Region',
};
const cases: Array<[string, (state: RoomState) => Action]> = [
  [
    'move token',
    () => ({
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 200, y: 200 },
    }),
  ],
  [
    'move group',
    () => ({
      type: 'TOKEN_MOVE_BATCH',
      sceneId: 'hollow',
      positions: ['ranger', 'mage'].map((tokenId) => ({ tokenId, position: { x: 200, y: 200 } })),
    }),
  ],
  [
    'create token',
    (s) => ({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      createOnly: true,
      token: { ...s.scenes.hollow.tokens.ranger, id: 'new-token' },
    }),
  ],
  [
    'edit token',
    (s) => ({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...s.scenes.hollow.tokens.ranger, visibility: 'gm', rotation: 45, note: 'Private' },
    }),
  ],
  [
    'patch token',
    (s) => ({
      type: 'TOKEN_PATCH',
      sceneId: 'hollow',
      tokenId: 'ranger',
      edits: [{ field: 'name', before: s.scenes.hollow.tokens.ranger.name, value: 'Renamed' }],
    }),
  ],
  [
    'group tokens',
    (s) => ({
      type: 'TOKENS_UPDATE',
      sceneId: 'hollow',
      tokens: ['ranger', 'mage'].map((id) => ({ ...s.scenes.hollow.tokens[id], groupId: 'group' })),
    }),
  ],
  [
    'duplicate tokens',
    (s) => ({
      type: 'TOKENS_UPDATE',
      sceneId: 'hollow',
      tokens: ['ranger', 'mage'].map((id) => ({ ...s.scenes.hollow.tokens[id], id: `${id}-copy` })),
    }),
  ],
  ['delete token', () => ({ type: 'TOKEN_DELETE', sceneId: 'hollow', tokenId: 'ranger' })],
  ['delete group', () => ({ type: 'TOKENS_DELETE', sceneId: 'hollow', ids: ['ranger', 'mage'] })],
  ['edit scene', (s) => ({ type: 'SCENE_UPDATE', scene: { ...s.scenes.hollow, name: 'Renamed' } })],
  [
    'configure scene',
    (s) => ({
      type: 'SCENE_CONFIG',
      sceneId: 'hollow',
      create: false,
      name: 'Smaller',
      map: s.scenes.hollow.map,
      width: 800,
      height: 600,
    }),
  ],
  [
    'create scene',
    (s) => ({
      type: 'SCENE_CONFIG',
      sceneId: 'new-scene',
      create: true,
      name: 'New scene',
      map: s.scenes.hollow.map,
      width: 800,
      height: 600,
    }),
  ],
  ['switch scene', () => ({ type: 'SCENE_CHANGE', sceneId: 'sanctuary' })],
  [
    'edit grid',
    (s) => ({
      type: 'GRID_UPDATE',
      sceneId: 'hollow',
      grid: { ...s.scenes.hollow.grid, type: 'hex', size: 60, snap: false },
    }),
  ],
  [
    'cover fog',
    () => ({ type: 'FOG_UPDATE', sceneId: 'hollow', fog: { enabled: true, revealed: [] } }),
  ],
  [
    'brush fog',
    () => ({
      type: 'FOG_APPEND',
      sceneId: 'hollow',
      operation: { id: 'dot', mode: 'conceal', shape: 'circle', x: 200, y: 200, radius: 80 },
    }),
  ],
  [
    'create region',
    () => ({ type: 'ZONE_UPDATE', sceneId: 'hollow', zone: { ...zone, id: 'new-region' } }),
  ],
  [
    'edit region',
    () => ({
      type: 'ZONE_UPDATE',
      sceneId: 'hollow',
      zone: { ...zone, label: 'Changed', opacity: 0.7 },
    }),
  ],
  ['delete region', () => ({ type: 'ZONE_DELETE', sceneId: 'hollow', id: zone.id })],
  [
    'erase regions',
    () => ({ type: 'OBJECTS_DELETE', sceneId: 'hollow', annotationIds: [], zoneIds: [zone.id] }),
  ],
  [
    'erase drawings and regions together',
    () => ({
      type: 'OBJECTS_DELETE',
      sceneId: 'hollow',
      annotationIds: ['drawing', 'secret-text'],
      zoneIds: [zone.id],
    }),
  ],
  [
    'draw stroke',
    () => ({
      type: 'ANNOTATION_UPDATE',
      sceneId: 'hollow',
      annotation: { ...annotation, id: 'new-stroke' },
    }),
  ],
  [
    'add text',
    () => ({
      type: 'ANNOTATION_UPDATE',
      sceneId: 'hollow',
      annotation: { ...annotation, id: 'new-text', kind: 'text', text: 'Note' },
    }),
  ],
  [
    'edit drawing',
    () => ({
      type: 'ANNOTATION_UPDATE',
      sceneId: 'hollow',
      annotation: { ...annotation, visibility: 'gm', color: '#aabbcc' },
    }),
  ],
  ['delete drawing', () => ({ type: 'ANNOTATION_DELETE', sceneId: 'hollow', id: annotation.id })],
  [
    'erase drawings',
    () => ({ type: 'ANNOTATIONS_DELETE', sceneId: 'hollow', ids: ['drawing', 'secret-text'] }),
  ],
  [
    'save template',
    (s) => ({
      type: 'LIBRARY_SAVE',
      token: { ...s.scenes.hollow.tokens.ranger, id: 'new-template' },
    }),
  ],
  [
    'edit template',
    (s) => ({
      type: 'LIBRARY_SAVE',
      token: { ...s.tokenLibrary!.template, name: 'Changed template' },
    }),
  ],
  ['delete template', () => ({ type: 'LIBRARY_DELETE', id: 'template' })],
  [
    'edit turns',
    () => ({
      type: 'TRACKER_UPDATE',
      tracker: {
        ...emptyTracker(),
        round: 3,
        entries: [{ id: 'mage', name: 'Mage', hidden: true, value: 4 }],
      },
    }),
  ],
  ['advance turns', () => ({ type: 'TRACKER_ADVANCE', direction: 1 })],
  [
    'import macros',
    () => ({
      type: 'MACRO_IMPORT',
      visibility: 'private',
      text: '[New](Select(1){A,B})\n[Other]([Roll(2d20kh1)])',
    }),
  ],
  ['delete macro', (s) => ({ type: 'MACRO_DELETE', id: Object.keys(s.macros!)[0] })],
];

describe('durable table tool undo audit', () => {
  let manager: RoomManager, room: DurableRoom;
  const messages: ServerMessage[] = [];
  const gm = { identity: { id: 'gm', name: 'GM' }, send: (m: ServerMessage) => messages.push(m) };
  const player = { identity: { id: 'player', name: 'Player' }, send: (_m: ServerMessage) => {} };
  function commit(action: Action) {
    manager.handle(
      gm,
      room.state.id,
      clientMessageSchema.parse({ ...action, v: 2, actionId: crypto.randomUUID() }),
    );
  }
  const contents = (s: RoomState) => structuredClone({ ...s, revision: 0, savedAt: null });
  beforeEach(async () => {
    messages.length = 0;
    manager = new RoomManager(new MemoryPersistence(), 60000, 100);
    const created = await manager.create(gm.identity, 'Tools');
    await manager.join(gm, created.id);
    await manager.join(player, created.id, created.inviteCode);
    room = await manager.authorize(created.id, gm.identity.id);
    commit({ type: 'ANNOTATION_UPDATE', sceneId: 'hollow', annotation });
    commit({
      type: 'ANNOTATION_UPDATE',
      sceneId: 'hollow',
      annotation: {
        ...annotation,
        id: 'secret-text',
        kind: 'text',
        text: 'Secret',
        visibility: 'gm',
      },
    });
    commit({ type: 'ZONE_UPDATE', sceneId: 'hollow', zone });
    commit({
      type: 'LIBRARY_SAVE',
      token: { ...room.state.scenes.hollow.tokens.ranger, id: 'template' },
    });
    commit({
      type: 'TRACKER_UPDATE',
      tracker: {
        ...emptyTracker(),
        activeId: 'ranger',
        entries: ['ranger', 'mage'].map((id) => ({ id, name: id, value: 1, hidden: false })),
      },
    });
    commit({ type: 'MACRO_IMPORT', visibility: 'public', text: '[Existing]([Roll(d6)])' });
  });
  afterEach(async () => {
    await manager.close();
  });
  it.each(cases)('undoes and redoes %s through the authoritative history', (_name, action) => {
    const before = contents(room.state);
    commit(action(room.state));
    const after = contents(room.state);
    expect(after).not.toEqual(before);
    commit({ type: 'UNDO' });
    expect(contents(room.state)).toEqual(before);
    commit({ type: 'REDO' });
    expect(contents(room.state)).toEqual(after);
  });
  it('does not overwrite redo when an erase batch has no remaining targets', () => {
    commit({ type: 'ANNOTATIONS_DELETE', sceneId: 'hollow', ids: ['drawing'] });
    commit({ type: 'UNDO' });
    commit({ type: 'ANNOTATIONS_DELETE', sceneId: 'hollow', ids: ['missing'] });
    commit({ type: 'REDO' });
    expect(room.state.scenes.hollow.annotations!.drawing).toBeUndefined();
  });
  it('denies player erasing and rejects duplicate or excessive batch identifiers atomically', () => {
    const action = {
      type: 'ANNOTATIONS_DELETE' as const,
      sceneId: 'hollow',
      ids: ['drawing', 'secret-text'],
    };
    expect(() =>
      manager.handle(player, room.state.id, { ...action, v: 2, actionId: crypto.randomUUID() }),
    ).toThrow('game master');
    expect(() => commit({ ...action, ids: ['drawing', 'drawing'] })).toThrow('Duplicate');
    expect(() =>
      commit({ ...action, ids: Array.from({ length: 101 }, (_, i) => `id-${i}`) }),
    ).toThrow();
    expect(room.state.scenes.hollow.annotations!.drawing).toBeDefined();
    expect(room.state.scenes.hollow.annotations!['secret-text']).toBeDefined();
  });
  it('validates both lists before deleting objects and preserves redo for missing objects', () => {
    const action: Action = {
      type: 'OBJECTS_DELETE',
      sceneId: 'hollow',
      annotationIds: ['drawing'],
      zoneIds: [zone.id],
    };
    expect(() =>
      manager.handle(player, room.state.id, { ...action, v: 2, actionId: crypto.randomUUID() }),
    ).toThrow('game master');
    expect(() => commit({ ...action, zoneIds: [zone.id, zone.id] })).toThrow('Duplicate');
    expect(room.state.scenes.hollow.annotations!.drawing).toBeDefined();
    expect(room.state.scenes.hollow.zones[zone.id]).toBeDefined();
    expect(() => commit({ ...action, annotationIds: [], zoneIds: [] })).toThrow('Choose');
    commit(action);
    commit({ type: 'UNDO' });
    commit({ ...action, annotationIds: ['missing'], zoneIds: ['missing'] });
    commit({ type: 'REDO' });
    expect(room.state.scenes.hollow.annotations!.drawing).toBeUndefined();
    expect(room.state.scenes.hollow.zones[zone.id]).toBeUndefined();
  });
  it('can invert scene deletion as well as scene creation', () => {
    const state = newRoom('room', 'gm', 'GM', 'Table', '').state;
    const changes = [{ kind: 'scene-delete' as const, sceneId: 'sanctuary' }];
    expect(applyChanges(applyChanges(state, changes), inverseChanges(state, changes))).toEqual(
      state,
    );
  });
});
