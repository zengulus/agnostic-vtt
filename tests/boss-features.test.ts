import { describe, expect, it } from 'vitest';
import { newRoom } from '../shared/sample.js';
import { prepareAction } from '../shared/actions.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
import { applyChanges, inverseChanges } from '../shared/state.js';
import { projectRoom } from '../shared/model.js';

function setup() {
  const room = newRoom('test-room', 'gm', 'GM', 'Test', 'invite');
  room.members.player = { name: 'Player', role: 'player' };
  const scene = room.state.scenes[room.state.activeSceneId];
  const template = Object.values(scene.tokens)[0];
  scene.tokens.enemy1 = {
    ...template,
    id: 'enemy1',
    owners: [],
    characterId: undefined,
    resourceId: undefined,
    visibility: 'public',
  };
  scene.tokens.enemy2 = { ...scene.tokens.enemy1, id: 'enemy2' };
  room.state.tracker = {
    entries: [
      { id: 'turn1', name: 'Enemy', value: 10, hidden: false, tokenId: 'enemy1' },
      { id: 'turn2', name: 'Enemy 2', value: 9, hidden: false, tokenId: 'enemy2' },
    ],
    activeId: 'turn1',
    round: 1,
    order: 'manual',
  };
  return { room, scene };
}
function run(room: ReturnType<typeof setup>['room'], action: Action, user = 'gm') {
  const before = room.state;
  const changes = prepareAction(
    room,
    { id: user, name: user },
    clientMessageSchema.parse({ ...action, v: 7, actionId: 'a' }),
    () => 1,
  );
  room.state = applyChanges(before, changes);
  return { before, changes };
}
describe('boss tools', () => {
  it('designates one visible boss with bounded metadata and GM authorization', () => {
    const { room, scene } = setup();
    const action: Action = {
      type: 'BOSS_SET',
      sceneId: scene.id,
      tokenId: 'enemy1',
      boss: { title: 'Bellkeeper', phase: 'Two' },
    };
    expect(() => run(room, action, 'player')).toThrow();
    const size = JSON.stringify(room.state).length;
    run(room, action);
    expect(JSON.stringify(room.state).length - size).toBeLessThan(150);
    expect(projectRoom(room, 'player').scenes[scene.id].tokens.enemy1.boss?.title).toBe(
      'Bellkeeper',
    );
    run(room, { ...action, tokenId: 'enemy2' });
    expect(room.state.scenes[scene.id].tokens.enemy1.boss).toBeUndefined();
  });
  it('defeats a batch atomically and restores tokens and turns with one inverse', () => {
    const { room, scene } = setup();
    const action: Action = {
      type: 'DEFEAT_SELECTED',
      sceneId: scene.id,
      tokenIds: ['enemy1', 'enemy2'],
    };
    expect(() => run(room, action, 'player')).toThrow();
    const { before, changes } = run(room, action);
    expect(room.state.tracker?.entries).toHaveLength(0);
    expect(room.state.scenes[scene.id].tokens.enemy1.statuses?.at(-1)?.label).toBe('Defeated');
    expect(applyChanges(room.state, inverseChanges(before, changes))).toEqual(before);
  });
  it('protects timed effects anchored to removed participants', () => {
    const { room, scene } = setup();
    scene.zones.test = {
      id: 'test',
      shape: 'circle',
      x: 1,
      y: 1,
      width: 20,
      height: 20,
      label: 'Fire',
      color: '#ff0000',
      duration: { participantId: 'turn1', remaining: 1, phase: 'start' },
    };
    expect(() =>
      run(room, { type: 'DEFEAT_SELECTED', sceneId: scene.id, tokenIds: ['enemy1'] }),
    ).toThrow(/timed/);
    expect(room.state.tracker?.entries).toHaveLength(2);
  });
});
