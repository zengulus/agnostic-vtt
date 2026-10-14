import { describe, expect, it } from 'vitest';
import { newRoom } from '../shared/sample.js';
import { emptyTracker, projectRoom } from '../shared/model.js';
import { applyChanges, inverseChanges, projectChanges } from '../shared/state.js';
import { nudgePoint, hexToWorld, snapPoint } from '../shared/geometry.js';

describe('linked turn and image projection', () => {
  it('omits hidden token names, ids, assets and next-turn hints from snapshots, live patches and undo', () => {
    const room = newRoom('usability-room', 'gm', 'GM', 'Table', 'invite');
    room.members.pc = { name: 'Player', role: 'player' };
    const scene = room.state.scenes.hollow;
    scene.fog = { enabled: false, revealed: [] };
    scene.tokens.sentinel.visibility = 'gm';
    scene.tokens.sentinel.image = { kind: 'uploaded', url: 'secret-art' };
    room.state.assets = {
      'secret-art': {
        id: 'secret-art',
        name: 'Secret enemy art',
        bytes: 100,
        width: 100,
        height: 100,
        createdAt: '',
        createdBy: 'gm',
      },
    };
    room.state.tracker = {
      ...emptyTracker(),
      activeId: 'hero',
      entries: [
        { id: 'hero', name: 'Hero', value: 1, hidden: false, tokenId: 'ranger' },
        { id: 'secret-turn', name: 'Secret enemy', value: 2, hidden: false, tokenId: 'sentinel' },
        { id: 'public-turn', name: 'Public participant', value: 3, hidden: false },
      ],
    };
    const projected = projectRoom(room, 'pc');
    expect(projected.tracker?.entries.map((e) => e.id)).toEqual(['hero', 'public-turn']);
    expect(projected.tracker?.nextId).toBeNull();
    expect(JSON.stringify(projected)).not.toMatch(/secret-art|Secret enemy|secret-turn/);
    expect(projectRoom(room, 'gm').tracker?.nextId).toBe('secret-turn');
    const before = room.state,
      changes = [
        {
          kind: 'token' as const,
          sceneId: 'hollow',
          token: { ...scene.tokens.sentinel, visibility: 'public' as const },
        },
      ];
    const after = applyChanges(before, changes);
    const patch = projectChanges(changes, before, after, 'player', 'pc');
    expect(patch).toContainEqual(
      expect.objectContaining({
        kind: 'tracker',
        tracker: expect.objectContaining({ nextId: 'secret-turn' }),
      }),
    );
    expect(patch).toContainEqual(
      expect.objectContaining({ kind: 'assets', assets: before.assets }),
    );
    const undo = inverseChanges(before, changes);
    const hidden = projectChanges(undo, after, applyChanges(after, undo), 'player', 'pc');
    expect(hidden).toContainEqual(
      expect.objectContaining({
        kind: 'tracker',
        tracker: expect.objectContaining({ nextId: null }),
      }),
    );
    expect(JSON.stringify(hidden)).not.toMatch(/Secret enemy|secret-art|secret-turn/);
  });
  it('removes linked turns when fog covers their token and restores them when revealed', () => {
    const room = newRoom('usability-room', 'gm', 'GM', 'Table', 'invite');
    const before = room.state;
    before.scenes.hollow.fog = { enabled: false, revealed: [] };
    before.tracker = {
      ...emptyTracker(),
      activeId: 'ranger-turn',
      entries: [
        {
          id: 'ranger-turn',
          name: 'Covered character',
          value: 0,
          hidden: false,
          tokenId: 'ranger',
        },
      ],
    };
    const changes = [
      { kind: 'fog' as const, sceneId: 'hollow', fog: { enabled: true, revealed: [] } },
    ];
    const after = applyChanges(before, changes);
    const patch = projectChanges(changes, before, after, 'player', 'pc');
    expect(patch).toContainEqual(
      expect.objectContaining({
        kind: 'tracker',
        tracker: expect.objectContaining({ entries: [], activeId: null, nextId: null }),
      }),
    );
    expect(JSON.stringify(patch)).not.toContain('Covered character');
    const undo = inverseChanges(before, changes);
    const restored = projectChanges(undo, after, before, 'player', 'pc');
    expect(restored).toContainEqual(
      expect.objectContaining({
        kind: 'tracker',
        tracker: expect.objectContaining({ activeId: 'ranger-turn' }),
      }),
    );
  });
});
it('nudges square and hex cells with offsets, and gridless tokens by ten pixels', () => {
  const grid = newRoom('usability-room', 'gm', 'GM', 'Table', 'invite').state.scenes.hollow.grid;
  const square = {
    ...grid,
    enabled: true,
    snap: true,
    offsetX: 13,
    offsetY: -7,
    type: 'square' as const,
  };
  const p = snapPoint({ x: 300, y: 300 }, square);
  expect(nudgePoint(p, 'ArrowRight', square)).toEqual({ x: p.x + square.size, y: p.y });
  const hex = { ...square, type: 'hex' as const };
  expect(nudgePoint(hexToWorld(2, 3, hex), 'ArrowDown', hex)).toEqual(hexToWorld(2, 4, hex));
  expect(nudgePoint(p, 'ArrowUp', { ...grid, snap: false })).toEqual({ x: p.x, y: p.y - 10 });
});
