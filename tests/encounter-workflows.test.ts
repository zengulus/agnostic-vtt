import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newRoom } from '../shared/sample.js';
import { prepareAction } from '../shared/actions.js';
import { applyChanges, inverseChanges, projectChanges } from '../shared/state.js';
import { encounterDigest, projectRoom } from '../shared/model.js';
import { characterDigest, parseCharacter } from '../shared/characters.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
const gm = { id: 'gm', name: 'GM' },
  player = { id: 'player', name: 'Player' };
const message = (action: Action) =>
  clientMessageSchema.parse({ v: 7, actionId: 'test', ...action });
function setup() {
  const room = newRoom('test-room', gm.id, gm.name, 'Test', 'invite');
  room.members.player = { name: player.name, role: 'player' };
  return room;
}
function commit(room: ReturnType<typeof setup>, action: Action, user = gm) {
  const before = room.state;
  const changes = prepareAction(room, user, message(action), () => 2);
  room.state = applyChanges(before, changes);
  return { changes, before, inverse: inverseChanges(before, changes) };
}
describe('encounter workflows', () => {
  it('rejects stale repairs and allows links to be removed before deleting a sheet', () => {
    const room = setup();
    const definition = parseCharacter(readFileSync('public/examples/character.txt', 'utf8'));
    room.state.characters = {
      one: { ...definition, id: 'one', ownerId: 'gm', visibility: 'public' },
    };
    room.state.scenes.hollow.tokens.ranger.characterId = 'one';
    commit(room, {
      type: 'ENCOUNTER_SAVE',
      id: 'enc',
      name: 'Fight',
      sceneId: 'hollow',
      tokenIds: ['ranger'],
    });
    const digest = encounterDigest(room.state.encounters!.enc);
    expect(() =>
      commit(room, {
        type: 'CHARACTER_DELETE',
        id: 'one',
        digest: characterDigest(room.state.characters!.one),
      }),
    ).toThrow('linked');
    commit(room, { type: 'ENCOUNTER_REPAIR', id: 'enc', digest, from: 'one', to: null });
    expect(room.state.encounters!.enc.tokens[0].characterId).toBeNull();
    expect(() =>
      commit(room, { type: 'ENCOUNTER_REPAIR', id: 'enc', digest, from: 'one', to: null }),
    ).toThrow('changed');
  });
  it('saves a GM-only encounter and places independent, undoable instances with remapped durations', () => {
    const room = setup();
    room.state.tracker = {
      entries: [{ id: 'turn', name: 'Ranger', value: 5, hidden: false, tokenId: 'ranger' }],
      activeId: 'turn',
      order: 'manual',
      round: 1,
    };
    room.state.scenes.hollow.tokens.ranger.statuses = [
      {
        id: 'mark',
        label: 'Mark',
        color: '#abcdef',
        icon: 'circle',
        duration: { participantId: 'turn', phase: 'start', remaining: 2 },
      },
    ];
    const save = commit(room, {
      type: 'ENCOUNTER_SAVE',
      id: 'enc',
      name: 'Ambush',
      sceneId: 'hollow',
      tokenIds: ['ranger'],
    });
    expect(projectRoom(room, 'player').encounters).toBeUndefined();
    expect(projectChanges(save.changes, save.before, room.state, 'player', 'player')).toEqual([]);
    expect(() =>
      commit(room, { type: 'ENCOUNTER_PLACE', id: 'enc', sceneId: 'hollow' }, player),
    ).toThrow('Only the game master');
    const placed = commit(room, { type: 'ENCOUNTER_PLACE', id: 'enc', sceneId: 'hollow' });
    const fresh = Object.values(room.state.scenes.hollow.tokens).find(
      (t) => t.id !== 'ranger' && t.name === 'Kael · Wanderer',
    )!;
    const turn = room.state.tracker!.entries.find((e) => e.tokenId === fresh.id)!;
    expect(fresh.id).not.toBe('ranger');
    expect(fresh.statuses![0].duration!.participantId).toBe(turn.id);
    expect(applyChanges(room.state, placed.inverse).scenes.hollow.tokens[fresh.id]).toBeUndefined();
  });
  it('clones each linked sheet separately and refreshes the selected placement', () => {
    const room = setup();
    const definition = parseCharacter(readFileSync('public/examples/character.txt', 'utf8'));
    room.state.characters = {
      one: { ...definition, id: 'one', ownerId: 'gm', visibility: 'public' },
    };
    const scene = room.state.scenes.hollow;
    scene.tokens.ranger.characterId = 'one';
    scene.tokens.mage.characterId = 'one';
    commit(room, {
      type: 'ENCOUNTER_SAVE',
      id: 'enc',
      name: 'Fight',
      sceneId: 'hollow',
      tokenIds: ['ranger', 'mage'],
    });
    const placement = commit(room, {
      type: 'ENCOUNTER_PLACE',
      id: 'enc',
      sceneId: 'hollow',
      independent: true,
    });
    const copies = Object.values(room.state.scenes.hollow.tokens).filter(
      (t) => t.encounterId === 'enc',
    );
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map((t) => t.characterId)).size).toBe(2);
    expect(copies.every((t) => t.characterId !== 'one')).toBe(true);
    expect(
      projectRoom(room, 'player').scenes.hollow.tokens[copies[0].id]?.encounterId,
    ).toBeUndefined();
    const token = copies[0],
      original = room.state.encounters!.enc.tokens.find((t) => t.id === token.encounterTokenId)!;
    commit(room, { type: 'TOKEN_UPDATE', sceneId: 'hollow', token: { ...token, x: token.x + 25 } });
    const reset = commit(room, {
      type: 'ENCOUNTER_REFRESH',
      id: 'enc',
      sceneId: 'hollow',
      placementId: token.encounterPlacementId!,
    });
    expect(room.state.scenes.hollow.tokens[token.id].x).toBe(original.x);
    expect(applyChanges(room.state, reset.inverse).scenes.hollow.tokens[token.id].x).toBe(
      token.x + 25,
    );
    expect(applyChanges(placement.before, placement.changes).characters).toHaveProperty(
      token.characterId!,
    );
    expect(() =>
      commit(
        room,
        {
          type: 'ENCOUNTER_REFRESH',
          id: 'enc',
          sceneId: 'hollow',
          placementId: token.encounterPlacementId!,
        },
        player,
      ),
    ).toThrow('Only the game master');
  });
  it('batch effects validate every token before applying and undo together', () => {
    const room = setup();
    room.state.scenes.hollow.tokens.ranger.owners = ['player'];
    room.state.scenes.hollow.tokens.mage.owners = [];
    const op: Action = {
      type: 'TOKEN_BATCH_ACTION',
      sceneId: 'hollow',
      tokenIds: ['ranger', 'mage'],
      operation: {
        kind: 'add-status',
        status: { id: 'mark', label: 'Marked', color: '#abcdef', icon: 'circle' },
      },
    };
    expect(() => commit(room, op, player)).toThrow('do not control');
    expect(room.state.scenes.hollow.tokens.ranger.statuses).toBeUndefined();
    const done = commit(room, op);
    expect(room.state.scenes.hollow.tokens.ranger.statuses![0].label).toBe('Marked');
    expect(room.state.scenes.hollow.tokens.mage.statuses![0].label).toBe('Marked');
    expect(
      applyChanges(room.state, done.inverse).scenes.hollow.tokens.ranger.statuses,
    ).toBeUndefined();
  });
  it('rolls server-side stats separately and limits group permissions and work', () => {
    const room = setup(),
      definition = parseCharacter(readFileSync('public/examples/character.txt', 'utf8'));
    room.state.characters = {
      one: {
        ...definition,
        id: 'one',
        ownerId: 'player',
        visibility: 'public',
        stats: { TEST: 3 },
      },
      two: { ...definition, id: 'two', ownerId: 'gm', visibility: 'private', stats: { TEST: 7 } },
    };
    const roll: Action = {
      type: 'STAT_ROLL_REQUEST',
      characterIds: ['one', 'two'],
      stat: 'TEST',
      expression: '1d20',
      modifier: -1,
      visibility: 'private',
    };
    expect(() => commit(room, roll, player)).toThrow();
    const result = commit(room, roll);
    expect(
      result.changes[0].kind === 'roll' &&
        result.changes[0].roll.macro?.groups.map((group) => group.total),
    ).toEqual([4, 8]);
    const repeated = commit(room, { ...roll, characterIds: ['one', 'one'] });
    expect(
      repeated.changes[0].kind === 'roll' && repeated.changes[0].roll.macro?.groups,
    ).toHaveLength(2);
    expect(() =>
      commit(room, { ...roll, expression: '40d6', characterIds: ['one', 'two', 'one'] }),
    ).toThrow('at most 100');
    const draws = [...Array(10).fill(4), 1, ...Array(11).fill(4), 1];
    expect(() =>
      prepareAction(room, gm, message({ ...roll, expression: 'd4!' }), () => draws.shift()!),
    ).toThrow('Explosion limit reached');
    expect(draws).toEqual([1]);
  });
  it('edits abilities with ownership, full validation and stale-sheet protection', () => {
    const room = setup(),
      definition = parseCharacter(readFileSync('public/examples/character.txt', 'utf8'));
    const sheet = { ...definition, id: 'one', ownerId: 'player', visibility: 'private' as const };
    room.state.characters = { one: sheet };
    const ability = { ...sheet.abilities[0], id: 'new', name: 'New action' };
    const op: Action = {
      type: 'CHARACTER_ABILITY_SAVE',
      id: 'one',
      digest: characterDigest(sheet),
      ability,
    };
    commit(room, op, player);
    expect(room.state.characters.one.abilities.some((item) => item.id === 'new')).toBe(true);
    expect(() => commit(room, op, player)).toThrow('changed');
  });
});
