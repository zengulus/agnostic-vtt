import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  characterDigest,
  exportCharacter,
  parseCharacter,
  unavailableAbility,
} from '../shared/characters.js';
import { newRoom } from '../shared/sample.js';
import { prepareAction } from '../shared/actions.js';
import { projectRoom } from '../shared/model.js';
import { applyChanges, inverseChanges, projectChanges } from '../shared/state.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
import { discordPayload } from '../server/discord.js';
import { tokenEdits } from '../shared/tokenEdits.js';

const text = readFileSync(new URL('../public/examples/character.txt', import.meta.url), 'utf8');
function setup() {
  const room = newRoom('testing', 'gm', 'GM', 'Characters', 'invite');
  room.members.player = { name: 'Player', role: 'player' };
  room.members.other = { name: 'Other', role: 'player' };
  const prepare = (
    action: Action,
    user = 'player',
    random = (_min: number, max: number) => Math.min(10, max - 1),
  ) =>
    prepareAction(
      room,
      { id: user, name: user },
      clientMessageSchema.parse({ ...action, v: 2, actionId: crypto.randomUUID() }),
      random,
    );
  const act = (action: Action, user = 'player') => {
    const changes = prepare(action, user);
    room.state = applyChanges(room.state, changes);
    return changes;
  };
  act({ type: 'CHARACTER_IMPORT', id: 'kael', text, visibility: 'private' });
  return { room, prepare, act, sheet: () => room.state.characters!.kael };
}
describe('text-imported character sheets', () => {
  it('round-trips stats, quoted multiline descriptions, resource pools and prepared uses', () => {
    const definition = parseCharacter('\uFEFF' + text.replaceAll('\n', '\r\n'));
    definition.description = 'A # sign, "quoted text", and\na second line.';
    definition.abilities[0].remainingUses = 0;
    definition.abilities[1].prepared = false;
    expect(parseCharacter(exportCharacter(definition))).toEqual(definition);
    expect(definition.abilities[2]).toMatchObject({ maxUses: 0, remainingUses: 0 });
  });
  it.each([
    text + '\n[other]\nx = 1',
    text + '\n[character]\nname = Duplicate',
    text.replace('current = 3', 'current = 3\ncurrent = 2'),
    text.replace('[resource focus]', '[resource __proto__]'),
    text.replace('ATTACK = 6', 'constructor = 6'),
    text.replace('ATTACK = 6', 'ATTACK = 6\nid = 2\nATTACK = 7'),
    text.replace('cost = focus:1', 'cost = missing:1'),
    text.replace('cost = focus:1', 'cost = focus:1, focus:1'),
    text.replace('cost = focus:1', 'cost = focus:4'),
    text.replace('current = 3', 'current = 4'),
    text.replace('uses = 1', 'uses = 1\nremaining = 2'),
    text.replace('uses = 1', 'uses = -1'),
    text.replace('uses = 1', 'uses = 0'),
    text.replace('refresh = recovery', 'refresh = automatic'),
    text.replace('uses = 1', 'uses = 1\nprepared = yes'),
    text.replace('1d20 + ATTACK', 'alert(1)'),
  ])('rejects malformed, unknown or inconsistent input before an import', (source) =>
    expect(() => parseCharacter(source)).toThrow(),
  );
  it('bounds UTF-8 text size and rejects unknown keys with line locations', () => {
    expect(() => parseCharacter('é'.repeat(32769))).toThrow('64 KiB');
    expect(() => parseCharacter('[character]\nname = Name\nunknown = value')).toThrow('Line 3');
    expect(() => parseCharacter('[character]\nname = Name\n[stats]\nSTR =')).toThrow('Line 4');
  });
  it('uses stats and spends all costs and a prepared use in the same action as its result', () => {
    const { act, sheet, room } = setup();
    const changes = act({
      type: 'CHARACTER_ABILITY_USE',
      id: 'kael',
      abilityId: 'sweeping-strike',
      variables: {},
      visibility: 'public',
    });
    expect(changes.map((c) => c.kind)).toEqual(['character', 'roll']);
    expect(sheet().resources[0].current).toBe(2);
    expect(sheet().abilities[0].remainingUses).toBe(0);
    expect(room.state.rolls[0].macro!.groups.map((g) => g.total)).toEqual([16, 16]);
    expect(room.state.rolls[0].character).toMatchObject({
      characterId: 'kael',
      name: 'Kael',
      remainingUses: 0,
      resources: [{ name: 'Focus', current: 2, spent: 1 }],
    });
    expect(() =>
      act({
        type: 'CHARACTER_ABILITY_USE',
        id: 'kael',
        abilityId: 'sweeping-strike',
        variables: {},
        visibility: 'public',
      }),
    ).toThrow('Expended');
    expect(room.state.rolls).toHaveLength(1);
  });
  it('keeps use counts and pools unchanged when numeric inputs fail', () => {
    const { prepare, sheet } = setup(),
      before = structuredClone(sheet());
    const action: Action = {
      type: 'CHARACTER_ABILITY_USE',
      id: 'kael',
      abilityId: 'sweeping-strike',
      variables: { ATTACK: 99 },
      visibility: 'public',
    };
    expect(() => prepare(action)).toThrow('unbound');
    expect(sheet()).toEqual(before);
    sheet().abilities[0].macro = '[Check]([Roll(d20 + EXTRA)])';
    expect(() => prepare({ ...action, variables: {} })).toThrow('EXTRA');
    expect(sheet().resources[0].current).toBe(3);
    expect(sheet().abilities[0].remainingUses).toBe(1);
    expect(prepare({ ...action, variables: { EXTRA: 4 } }).at(-1)).toMatchObject({
      kind: 'roll',
      roll: { total: 14 },
    });
  });
  it('announces text-only spells with no fake numeric total and spends prepared slots', () => {
    const { act, room, sheet } = setup();
    for (let i = 0; i < 2; i++)
      act({
        type: 'CHARACTER_ABILITY_USE',
        id: 'kael',
        abilityId: 'ward',
        variables: {},
        visibility: 'public',
      });
    expect(sheet().abilities[1].remainingUses).toBe(0);
    expect(sheet().resources[1].current).toBe(0);
    const roll = room.state.rolls[0];
    expect(roll.terms).toEqual([]);
    expect(roll.macro!.groups[0].selections).toEqual([sheet().abilities[1].text]);
    const fields = discordPayload(roll, 'Campaign').embeds[0].fields;
    expect(fields[0].value).toContain('Spell slots: 1 / 2');
    expect(fields[1].value).toContain('protective ward');
    expect(fields[1].value).not.toContain('= 0');
  });
  it('recovers only explicitly tagged groups and keeps preparation state', () => {
    const { act, sheet } = setup();
    act({
      type: 'CHARACTER_ABILITY_USE',
      id: 'kael',
      abilityId: 'sweeping-strike',
      variables: {},
      visibility: 'private',
    });
    act({
      type: 'CHARACTER_ABILITY_USE',
      id: 'kael',
      abilityId: 'ward',
      variables: {},
      visibility: 'private',
    });
    act({ type: 'CHARACTER_ABILITY_STATE', id: 'kael', abilityId: 'ward', operation: 'unprepare' });
    act({ type: 'CHARACTER_REFRESH', id: 'kael', refresh: 'recovery' });
    expect(sheet().abilities[0].remainingUses).toBe(1);
    expect(sheet().resources[0].current).toBe(2);
    expect(sheet().abilities[1]).toMatchObject({ remainingUses: 1, prepared: false });
    act({ type: 'CHARACTER_REFRESH', id: 'kael', refresh: 'rest' });
    expect(sheet().resources[1].current).toBe(2);
    expect(sheet().abilities[1]).toMatchObject({ remainingUses: 2, prepared: false });
    act({ type: 'CHARACTER_REFRESH', id: 'kael', refresh: 'encounter' });
    expect(sheet().resources[0].current).toBe(3);
    expect(unavailableAbility(sheet(), sheet().abilities[1])).toBe('Not prepared');
  });
  it('checks available pools independently of unlimited or recovered uses', () => {
    const { act, prepare, sheet } = setup();
    act({ type: 'CHARACTER_RESOURCE_ADJUST', id: 'kael', resourceId: 'focus', delta: -3 });
    expect(unavailableAbility(sheet(), sheet().abilities[0])).toBe('Needs 1 Focus');
    expect(() =>
      prepare({
        type: 'CHARACTER_ABILITY_USE',
        id: 'kael',
        abilityId: 'sweeping-strike',
        variables: {},
        visibility: 'public',
      }),
    ).toThrow('Needs 1 Focus');
    for (let i = 0; i < 3; i++)
      act({
        type: 'CHARACTER_ABILITY_USE',
        id: 'kael',
        abilityId: 'weapon-attack',
        variables: {},
        visibility: 'private',
      });
    expect(sheet().abilities[2].remainingUses).toBe(0);
    expect(unavailableAbility(sheet(), sheet().abilities[2])).toBeNull();
  });
  it('conflict-checks text replacement and deletion against resource use', () => {
    const { act, prepare, sheet } = setup(),
      digest = characterDigest(sheet());
    act({ type: 'CHARACTER_RESOURCE_ADJUST', id: 'kael', resourceId: 'focus', delta: -1 });
    expect(() =>
      prepare({ type: 'CHARACTER_IMPORT', id: 'kael', text, visibility: 'private', digest }),
    ).toThrow('changed since');
    expect(() => prepare({ type: 'CHARACTER_DELETE', id: 'kael', digest })).toThrow('changed');
    expect(sheet().resources[0].current).toBe(2);
    act({
      type: 'CHARACTER_IMPORT',
      id: 'kael',
      text: exportCharacter({ ...sheet(), name: 'Renamed' }),
      visibility: 'private',
      digest: characterDigest(sheet()),
    });
    expect(sheet().name).toBe('Renamed');
    expect(sheet().resources[0].current).toBe(2);
  });
  it('protects private snapshots, private results, read-only party sheets and reassignment patches', () => {
    const { act, prepare, room, sheet } = setup();
    expect(projectRoom(room, 'other').characters).toEqual({});
    expect(() =>
      prepare({ type: 'CHARACTER_REFRESH', id: 'kael', refresh: 'rest' }, 'other'),
    ).toThrow('not found');
    const before = room.state;
    const assignment = act({ type: 'CHARACTER_ASSIGN', id: 'kael', ownerId: 'other' }, 'gm');
    expect(projectChanges(assignment, before, room.state, 'player', 'player')).toEqual([
      { kind: 'character', id: 'kael', character: null },
    ]);
    expect(projectChanges(assignment, before, room.state, 'player', 'other')[0]).toMatchObject({
      character: { ownerId: 'other' },
    });
    act(
      {
        type: 'CHARACTER_IMPORT',
        id: 'kael',
        text: exportCharacter(sheet()),
        digest: characterDigest(sheet()),
        visibility: 'public',
      },
      'other',
    );
    expect(projectRoom(room, 'player').characters!.kael.name).toBe('Kael');
    expect(() =>
      prepare(
        { type: 'CHARACTER_RESOURCE_ADJUST', id: 'kael', resourceId: 'focus', delta: 1 },
        'player',
      ),
    ).toThrow('owner');
    const rollBefore = room.state,
      changes = act(
        {
          type: 'CHARACTER_ABILITY_USE',
          id: 'kael',
          abilityId: 'ward',
          variables: {},
          visibility: 'private',
        },
        'other',
      );
    expect(
      projectChanges(changes, rollBefore, room.state, 'player', 'player').map((c) => c.kind),
    ).toEqual(['character']);
    expect(projectRoom(room, 'player').rolls).toEqual([]);
    expect(() => discordPayload(room.state.rolls[0], 'Campaign')).toThrow('Private');
  });
  it('supports undo for resource edits and token links without coupling token movement', () => {
    const { act, room } = setup(),
      before = room.state;
    const change = act({
      type: 'CHARACTER_RESOURCE_ADJUST',
      id: 'kael',
      resourceId: 'focus',
      delta: -1,
    });
    expect(applyChanges(room.state, inverseChanges(before, change))).toEqual(before);
    const token = room.state.scenes.hollow.tokens.ranger;
    act(
      {
        type: 'TOKEN_PATCH',
        sceneId: 'hollow',
        tokenId: token.id,
        edits: tokenEdits(token, { ...token, characterId: 'kael' }),
      },
      'gm',
    );
    expect(room.state.scenes.hollow.tokens.ranger).toMatchObject({
      characterId: 'kael',
      x: token.x,
      y: token.y,
    });
  });
});
