import { describe, expect, it } from 'vitest';
import { newRoom } from '../shared/sample.js';
import { sightContains, visibilityPolygon } from '../shared/vision.js';
import { lightSchema, projectRoom, type Wall } from '../shared/model.js';
import { prepareAction } from '../shared/actions.js';
import { applyChanges, inverseChanges, projectChanges } from '../shared/state.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
const gm = { id: 'gm', name: 'GM' };
function setup() {
  const room = newRoom('test-room', 'gm', 'GM', 'Test', 'invite');
  room.members.player = { name: 'Player', role: 'player' };
  const s = room.state.scenes.hollow;
  s.tokens.ranger = {
    ...s.tokens.ranger,
    x: 100,
    y: 100,
    owners: ['player'],
    sight: { range: 600, angle: 360 },
  };
  s.tokens.mage = { ...s.tokens.mage, x: 300, y: 100, owners: [] };
  s.tokens.sentinel.owners = [];
  s.lighting = { vision: true, darkness: 0.5 };
  return room;
}
function commit(room: ReturnType<typeof setup>, action: Action, who = gm) {
  const before = room.state;
  const changes = prepareAction(
    room,
    who,
    clientMessageSchema.parse({ ...action, v: 7, actionId: 'test' }),
    () => 1,
  );
  room.state = applyChanges(before, changes);
  return { before, changes };
}
const wall: Wall = {
  id: 'door',
  a: { x: 200, y: 0 },
  b: { x: 200, y: 200 },
  kind: 'door',
  open: false,
};
describe('wall occlusion and sight', () => {
  it('projects anonymous public light even when its bearer is occluded', () => {
    const room = setup(),
      scene = room.state.scenes.hollow;
    scene.tokens.ranger = { ...scene.tokens.ranger, x: 100, y: 100 };
    scene.tokens.mage = {
      ...scene.tokens.mage,
      x: 300,
      y: 200,
      name: 'Secret identity',
      light: { radius: 250, color: '#ffaa55', intensity: 1 },
    };
    scene.walls = {
      wall: { id: 'wall', a: { x: 200, y: 0 }, b: { x: 200, y: 180 }, kind: 'wall' },
    };
    const projected = projectRoom(room, 'player').scenes.hollow;
    expect(projected.tokens.mage).toBeUndefined();
    expect(Object.values(projected.lightSources || {})).toContainEqual(
      expect.objectContaining({ x: 300, y: 200 }),
    );
    expect(JSON.stringify(projected.lightSources)).not.toContain('Secret identity');
    const moved = commit(room, {
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'mage',
      position: { x: 320, y: 200 },
    });
    expect(
      projectChanges(moved.changes, moved.before, room.state, 'player', 'player'),
    ).toContainEqual(
      expect.objectContaining({
        kind: 'light-source',
        source: expect.objectContaining({ x: expect.any(Number) }),
      }),
    );
  });
  it('keeps existing radial lights valid and limits directional beams to the chosen angle', () => {
    expect(
      lightSchema.parse({ radius: 200, color: '#ffddaa', intensity: 0.8 }).angle,
    ).toBeUndefined();
    const cone = visibilityPolygon({ x: 0, y: 0 }, 200, 90, 0, {});
    expect(cone[0]).toEqual({ x: 0, y: 0 });
    expect(cone.slice(1).every((p) => p.x >= 0)).toBe(true);
    const blocked = visibilityPolygon({ x: 0, y: 0 }, 200, 90, 0, {
      wall: { id: 'wall', a: { x: 50, y: -100 }, b: { x: 50, y: 100 }, kind: 'wall' },
    });
    expect(Math.max(...blocked.map((p) => p.x))).toBeLessThanOrEqual(50.0001);
  });
  it('honours walls, open doors, windows, range and facing', () => {
    const room = setup(),
      source = room.state.scenes.hollow.tokens.ranger,
      point = { x: 300, y: 100 };
    expect(sightContains(source, point, { door: wall })).toBe(false);
    expect(sightContains(source, point, { door: { ...wall, open: true } })).toBe(true);
    expect(sightContains(source, point, { door: { ...wall, kind: 'window' } })).toBe(true);
    expect(sightContains({ ...source, sight: { range: 50, angle: 360 } }, point, {})).toBe(false);
    expect(
      sightContains({ ...source, rotation: 180, sight: { range: 500, angle: 90 } }, point, {}),
    ).toBe(false);
    const polygon = visibilityPolygon(source, 500, 360, 0, { door: wall });
    expect(polygon.length).toBeGreaterThan(64);
    expect(
      Math.min(...polygon.map((p) => Math.hypot(p.x - source.x, p.y - source.y))),
    ).toBeLessThan(105);
  });
  it('projects tokens per owner and reconciles visibility immediately on wall and movement changes', () => {
    const room = setup(),
      hide = commit(room, { type: 'WALL_SET', sceneId: 'hollow', wall });
    expect(projectRoom(room, 'player').scenes.hollow.tokens.mage).toBeUndefined();
    expect(
      projectChanges(hide.changes, hide.before, room.state, 'player', 'player'),
    ).toContainEqual({ kind: 'token-delete', sceneId: 'hollow', tokenId: 'mage' });
    const open = commit(room, {
      type: 'WALL_SET',
      sceneId: 'hollow',
      wall: { ...wall, open: true },
    });
    expect(
      projectChanges(open.changes, open.before, room.state, 'player', 'player'),
    ).toContainEqual(
      expect.objectContaining({ kind: 'token', token: expect.objectContaining({ id: 'mage' }) }),
    );
    expect(
      applyChanges(room.state, inverseChanges(open.before, open.changes)).scenes.hollow.walls!.door
        .open,
    ).toBe(false);
    expect(() =>
      commit(
        room,
        { type: 'WALL_DELETE', sceneId: 'hollow', id: 'door' },
        { id: 'player', name: 'Player' },
      ),
    ).toThrow('Only the game master');
  });
  it('does not leak a hidden token in movement previews or patches when another player controls a different observer', () => {
    const room = setup();
    room.state.scenes.hollow.walls = { door: wall };
    const move = commit(room, {
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'mage',
      position: { x: 320, y: 100 },
    });
    expect(
      JSON.stringify(projectChanges(move.changes, move.before, room.state, 'player', 'player')),
    ).not.toContain('mage');
  });
  it('reveals and conceals stationary tokens as an observer moves', () => {
    const room = setup();
    room.state.scenes.hollow.walls = { door: wall };
    const moved = commit(
      room,
      {
        type: 'TOKEN_MOVE_COMMIT',
        sceneId: 'hollow',
        tokenId: 'ranger',
        position: { x: 280, y: 100 },
      },
      { id: 'player', name: 'Player' },
    );
    const patch = projectChanges(moved.changes, moved.before, room.state, 'player', 'player');
    expect(patch).toContainEqual(
      expect.objectContaining({ kind: 'token', token: expect.objectContaining({ id: 'mage' }) }),
    );
  });
  it('shares unlimited 360-degree sight across the whole party and keeps NPC cones optional', () => {
    const room = setup();
    room.members.second = { name: 'Second', role: 'player' };
    const scene = room.state.scenes.hollow;
    scene.tokens.ranger = { ...scene.tokens.ranger, sight: { range: 1, angle: 10 }, rotation: 180 };
    scene.tokens.mage = { ...scene.tokens.mage, owners: ['second'], x: 1200, y: 100 };
    scene.tokens.sentinel = {
      ...scene.tokens.sentinel,
      owners: [],
      x: 1450,
      y: 100,
      sight: { range: 300, angle: 90, showCone: true, showToPlayers: false },
    };
    scene.walls = { door: wall };
    const first = projectRoom(room, 'player').scenes.hollow;
    const second = projectRoom(room, 'second').scenes.hollow;
    expect(first.tokens.sentinel).toBeDefined();
    expect(second.tokens.sentinel).toBeDefined();
    expect(first.tokens.mage.sharedVisionSource).toBe(true);
    expect(first.tokens.sentinel.sight).toBeUndefined();
    scene.tokens.sentinel.sight!.showToPlayers = true;
    expect(projectRoom(room, 'player').scenes.hollow.tokens.sentinel.sight?.showToPlayers).toBe(
      true,
    );
  });
});
