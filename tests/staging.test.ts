import { describe, expect, it } from 'vitest';
import { newRoom } from '../shared/sample.js';
import { prepareAction } from '../shared/actions.js';
import { applyChanges, projectChanges } from '../shared/state.js';
import { pinDigest, projectRoom, type ScenePin } from '../shared/model.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
import { proximityCues } from '../shared/proximity.js';

const gm = { id: 'gm', name: 'GM' };
function setup() {
  const room = newRoom('test-room', 'gm', 'GM', 'Test', 'invite');
  room.members.player = { name: 'Player', role: 'player' };
  return room;
}
function commit(room: ReturnType<typeof setup>, action: Action) {
  const before = room.state;
  const changes = prepareAction(
    room,
    gm,
    clientMessageSchema.parse({ ...action, v: 7, actionId: 'test' }),
    () => 1,
  );
  room.state = applyChanges(before, changes);
  return { before, changes };
}
const pin: ScenePin = {
  id: 'pin',
  x: 700,
  y: 680,
  label: 'Door',
  description: 'A door',
  gmNote: 'Secret',
  visibility: 'public',
  destinationSceneId: 'sanctuary',
  proximity: { distance: 40, when: 'both', playerMessage: 'A door creaks.' },
};
describe('GM scene staging and proximity', () => {
  it('hides scene contents and assets from snapshots and incremental updates until revealed', () => {
    const room = setup();
    room.state.assets = {
      secret: {
        id: 'secret',
        name: 'Secret',
        bytes: 1,
        width: 1,
        height: 1,
        createdAt: '',
        createdBy: 'gm',
      },
    };
    room.state.scenes.sanctuary.map = { kind: 'uploaded', url: 'secret' };
    const hidden = commit(room, {
      type: 'SCENE_VISIBILITY',
      sceneId: 'sanctuary',
      visibility: 'gm',
    });
    expect(
      projectChanges(hidden.changes, hidden.before, room.state, 'player', 'player'),
    ).toContainEqual({ kind: 'scene-delete', sceneId: 'sanctuary' });
    expect(projectRoom(room, 'player').scenes.sanctuary).toBeUndefined();
    expect(projectRoom(room, 'player').assets).not.toHaveProperty('secret');
    const changed = commit(room, {
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'sanctuary',
      tokenId: 'ranger',
      position: { x: 100, y: 100 },
    });
    expect(projectChanges(changed.changes, changed.before, room.state, 'player', 'player')).toEqual(
      [],
    );
    const reveal = commit(room, {
      type: 'SCENE_CHANGE',
      sceneId: 'sanctuary',
      transition: {
        style: 'curtain',
        title: 'The Vault',
        subtitle: 'Beyond the door',
        duration: 3500,
        color: '#112233',
      },
    });
    const result = projectChanges(reveal.changes, reveal.before, room.state, 'player', 'player');
    expect(result[0].kind).toBe('scene');
    expect(result).toContainEqual({
      kind: 'scene-active',
      sceneId: 'sanctuary',
      transition: {
        style: 'curtain',
        title: 'The Vault',
        subtitle: 'Beyond the door',
        duration: 3500,
        color: '#112233',
      },
    });
    expect(projectRoom(room, 'player').assets).toHaveProperty('secret');
    expect(() =>
      commit(room, { type: 'SCENE_VISIBILITY', sceneId: 'sanctuary', visibility: 'gm' }),
    ).toThrow('active scene');
  });
  it('projects pins without GM secrets and rejects stale edits', () => {
    const room = setup();
    const created = commit(room, { type: 'PIN_SET', sceneId: 'hollow', pin });
    const player = projectRoom(room, 'player').scenes.hollow.pins!.pin;
    expect(player.description).toBe('A door');
    expect(player.gmNote).toBeUndefined();
    expect(player.destinationSceneId).toBeUndefined();
    expect(player.proximity).toBeUndefined();
    expect(
      JSON.stringify(
        projectChanges(created.changes, created.before, room.state, 'player', 'player'),
      ),
    ).not.toContain('Secret');
    commit(room, {
      type: 'PIN_SET',
      sceneId: 'hollow',
      pin: { ...pin, label: 'New door' },
      expected: pinDigest(pin),
    });
    expect(() =>
      commit(room, { type: 'PIN_SET', sceneId: 'hollow', pin, expected: pinDigest(pin) }),
    ).toThrow('changed');
  });
  it('detects entry and exit across pins, regions and tokens and protects hidden cues', () => {
    const room = setup(),
      scene = room.state.scenes.hollow;
    scene.pins = { pin };
    scene.zones.test = {
      id: 'test',
      shape: 'rectangle',
      x: 670,
      y: 640,
      width: 70,
      height: 80,
      label: 'Trap',
      color: '#ffffff',
      visibility: 'gm',
      proximity: { distance: 0, when: 'both', playerMessage: 'Secret' },
    };
    scene.tokens.mage = {
      ...scene.tokens.mage,
      x: 700,
      y: 680,
      proximity: { distance: 40, when: 'both', playerMessage: 'Someone is close.' },
    };
    const before = structuredClone(room.state);
    scene.tokens.ranger.x = 700;
    const enter = proximityCues(before, room.state, 'hollow', ['ranger']);
    expect(enter).toHaveLength(3);
    expect(enter.find((cue) => cue.gm.includes('Trap'))?.player).toBeUndefined();
    expect(enter.find((cue) => cue.gm.includes('Door'))?.player).toBe('A door creaks.');
    expect(
      proximityCues(room.state, before, 'hollow', ['ranger']).every((cue) =>
        cue.gm.includes('left'),
      ),
    ).toBe(true);
    expect(proximityCues(before, room.state, 'sanctuary', ['ranger'])).toEqual([]);
  });
  it('fires when a token carrying a rule or anchored region moves over a stationary token', () => {
    const room = setup(),
      scene = room.state.scenes.hollow;
    scene.tokens.mage.proximity = { distance: 40, when: 'enter' };
    scene.zones.aura = {
      id: 'aura',
      shape: 'circle',
      x: 720,
      y: 560,
      width: 80,
      height: 80,
      label: 'Aura',
      color: '#ffffff',
      anchorTokenId: 'mage',
      proximity: { distance: 0, when: 'enter' },
    };
    const before = structuredClone(room.state);
    scene.tokens.mage.x = scene.tokens.ranger.x;
    scene.tokens.mage.y = scene.tokens.ranger.y;
    scene.zones.aura.x = scene.tokens.ranger.x - 40;
    scene.zones.aura.y = scene.tokens.ranger.y - 40;
    const cues = proximityCues(before, room.state, 'hollow', ['mage']);
    expect(cues.some((cue) => cue.gm.includes('Aura'))).toBe(true);
    expect(cues.some((cue) => cue.gm.includes('Lyra'))).toBe(true);
  });
  it('detects a full crossing of pin, zone, line and moving-token ranges', () => {
    const room = setup(),
      scene = room.state.scenes.hollow;
    scene.tokens.ranger.x = 500;
    scene.tokens.ranger.y = 680;
    scene.tokens.mage.x = 700;
    scene.tokens.mage.y = 680;
    scene.tokens.mage.proximity = { distance: 30, when: 'both' };
    scene.pins = { pin };
    scene.zones.test = {
      id: 'test',
      shape: 'rectangle',
      x: 680,
      y: 650,
      width: 40,
      height: 60,
      label: 'Trap',
      color: '#ffffff',
      visibility: 'gm',
      proximity: { distance: 0, when: 'both' },
    };
    scene.zones.line = {
      id: 'line',
      shape: 'line',
      x: 690,
      y: 640,
      width: 20,
      height: 80,
      points: [
        { x: 700, y: 640 },
        { x: 700, y: 720 },
      ],
      label: 'Tripwire',
      color: '#ffffff',
      visibility: 'gm',
      proximity: { distance: 0, when: 'both' },
    };
    const before = structuredClone(room.state);
    scene.tokens.ranger.x = 900;
    const cues = proximityCues(before, room.state, 'hollow', ['ranger']);
    for (const label of ['Door', 'Trap', 'Tripwire', scene.tokens.mage.name]) {
      expect(
        cues
          .filter((c) => c.gm.includes(label))
          .map((c) => (c.gm.includes('entered') ? 'enter' : 'leave')),
      ).toEqual(['enter', 'leave']);
    }
    const movingBefore = structuredClone(before);
    movingBefore.scenes.hollow.tokens.mage.x = 500;
    movingBefore.scenes.hollow.tokens.ranger.x = 700;
    movingBefore.scenes.hollow.zones.aura = {
      id: 'aura',
      shape: 'circle',
      x: 470,
      y: 650,
      width: 60,
      height: 60,
      color: '#ffffff',
      label: 'Aura',
      anchorTokenId: 'mage',
      proximity: { distance: 0, when: 'both' },
    };
    const movingAfter = structuredClone(movingBefore);
    movingAfter.scenes.hollow.tokens.mage.x = 900;
    movingAfter.scenes.hollow.zones.aura.x = 870;
    const moving = proximityCues(movingBefore, movingAfter, 'hollow', ['mage']);
    expect(
      moving
        .filter((c) => c.gm.endsWith(` ${scene.tokens.mage.name}.`))
        .map((c) => (c.gm.includes('entered') ? 'enter' : 'leave')),
    ).toEqual(['enter', 'leave']);
    expect(
      moving
        .filter((c) => c.gm.endsWith(' Aura.'))
        .map((c) => (c.gm.includes('entered') ? 'enter' : 'leave')),
    ).toEqual(['enter', 'leave']);
  });
});
