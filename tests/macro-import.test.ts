import { describe, expect, it } from 'vitest';
import { prepareAction } from '../shared/actions.js';
import { applyChanges } from '../shared/state.js';
import { newRoom } from '../shared/sample.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
const original = '[Attack]([Hit(d20 + X)])';
const revised = '[Attack]([Hit(d20 + X + 2)])';
const message = (action: Action) =>
  clientMessageSchema.parse({ v: 2, actionId: 'test', ...action });
function setup() {
  const room = newRoom('test-room', 'gm', 'GM', 'Macros', 'invite');
  room.state.macros = {
    attack: {
      id: 'attack',
      name: 'Attack',
      source: original,
      visibility: 'private',
      ownerId: 'gm',
    },
  };
  return room;
}
const user = { id: 'gm', name: 'GM' };
describe('safe revised macro imports', () => {
  it('skips unchanged and unconfirmed changed definitions while adding new names', () => {
    const room = setup();
    for (const text of [original, revised])
      expect(
        prepareAction(
          room,
          user,
          message({ type: 'MACRO_IMPORT', text, visibility: 'public' }),
          () => 1,
        ),
      ).toEqual([]);
    const changes = prepareAction(
      room,
      user,
      message({
        type: 'MACRO_IMPORT',
        text: `${original}\n[Heal]([HP(d6)])`,
        visibility: 'public',
      }),
      () => 1,
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ macro: { name: 'Heal' } });
  });
  it('keeps the identity, owner and privacy of explicitly replaced definitions', () => {
    const room = setup();
    const changes = prepareAction(
      room,
      user,
      message({
        type: 'MACRO_IMPORT',
        text: revised,
        visibility: 'public',
        replacements: [{ line: 1, id: 'attack', source: original }],
      }),
      () => 1,
    );
    const next = applyChanges(room.state, changes);
    expect(Object.keys(next.macros!)).toEqual(['attack']);
    expect(next.macros?.attack).toEqual({ ...room.state.macros!.attack, source: revised });
  });
  it('rejects stale previews atomically, including new macros in the same import', () => {
    const room = setup();
    room.state.macros!.attack.source = revised;
    expect(() =>
      prepareAction(
        room,
        user,
        message({
          type: 'MACRO_IMPORT',
          text: `${original}\n[Heal]([HP(d6)])`,
          visibility: 'public',
          replacements: [{ line: 1, id: 'attack', source: original }],
        }),
        () => 1,
      ),
    ).toThrow('changed since');
    expect(Object.keys(room.state.macros!)).toEqual(['attack']);
  });
  it('does not allow replacing someone else’s shared definition, including as GM', () => {
    const room = setup();
    room.state.macros!.attack.ownerId = 'other';
    expect(() =>
      prepareAction(
        room,
        user,
        message({
          type: 'MACRO_IMPORT',
          text: revised,
          visibility: 'public',
          replacements: [{ line: 1, id: 'attack', source: original }],
        }),
        () => 1,
      ),
    ).toThrow('changed since');
  });
  it('rejects duplicate names and counts only additions toward limits', () => {
    const room = setup();
    expect(() =>
      prepareAction(
        room,
        user,
        message({ type: 'MACRO_IMPORT', text: `${original}\n${revised}`, visibility: 'public' }),
        () => 1,
      ),
    ).toThrow('Duplicate macro name');
    for (let i = 1; i < 100; i++)
      room.state.macros![`m${i}`] = {
        ...room.state.macros!.attack,
        id: `m${i}`,
        name: `Name ${i}`,
      };
    expect(
      prepareAction(
        room,
        user,
        message({ type: 'MACRO_IMPORT', text: original, visibility: 'public' }),
        () => 1,
      ),
    ).toEqual([]);
    expect(() =>
      prepareAction(
        room,
        user,
        message({ type: 'MACRO_IMPORT', text: '[New]([Roll(d6)])', visibility: 'public' }),
        () => 1,
      ),
    ).toThrow('100 macros');
  });
});
