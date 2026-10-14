import { describe, expect, it } from 'vitest';
import { prepareAction } from '../shared/actions.js';
import { applyChanges, inverseChanges } from '../shared/state.js';
import { newRoom } from '../shared/sample.js';
import {
  clientMessageSchema,
  serializeClientAction,
  MAX_CLIENT_MESSAGE_BYTES,
  type Action,
} from '../shared/protocol.js';
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
        replacements: [{ line: 1, id: 'attack', version: 0 }],
      }),
      () => 1,
    );
    const next = applyChanges(room.state, changes);
    expect(Object.keys(next.macros!)).toEqual(['attack']);
    expect(next.macros?.attack).toEqual({
      ...room.state.macros!.attack,
      source: revised,
      version: room.state.revision + 1,
    });
  });
  it('rejects stale previews atomically, including new macros in the same import', () => {
    const room = setup();
    room.state.macros!.attack.source = revised;
    room.state.macros!.attack.version = 1;
    expect(() =>
      prepareAction(
        room,
        user,
        message({
          type: 'MACRO_IMPORT',
          text: `${original}\n[Heal]([HP(d6)])`,
          visibility: 'public',
          replacements: [{ line: 1, id: 'attack', version: 0 }],
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
          replacements: [{ line: 1, id: 'attack', version: 0 }],
        }),
        () => 1,
      ),
    ).toThrow('changed since');
  });
  it('does not reuse replacement guards after undo followed by a different edit', () => {
    const room = setup();
    const replace = (text: string, version: number) =>
      message({
        type: 'MACRO_IMPORT',
        text,
        visibility: 'public',
        replacements: [{ line: 1, id: 'attack', version }],
      });
    const first = prepareAction(room, user, replace(revised, 0), () => 1);
    const undo = inverseChanges(room.state, first);
    room.state = { ...applyChanges(room.state, first), revision: 1 };
    const staleVersion = room.state.macros!.attack.version!;
    room.state = { ...applyChanges(room.state, undo), revision: 2 };
    const another = prepareAction(room, user, replace('[Attack]([Hit(d20 + X + 3)])', 0), () => 1);
    room.state = { ...applyChanges(room.state, another), revision: 3 };
    expect(room.state.macros!.attack.version).toBe(3);
    expect(() => prepareAction(room, user, replace(original, staleVersion), () => 1)).toThrow(
      'changed since',
    );
  });
  it('replaces 100 long definitions using guards that stay below the socket limit', () => {
    const room = setup();
    room.state.macros = {};
    const entries = Array.from({ length: 100 }, (_, i) => ({
      id: `roll-${i}`,
      name: `Roll ${i}`,
      ownerId: user.id,
      visibility: 'private' as const,
      source: `[Roll ${i}](Select(1){${Array.from({ length: 4 }, () => 'x'.repeat(900)).join(',')}})`,
    }));
    for (const macro of entries) room.state.macros[macro.id] = macro;
    const text = entries.map((macro) => `[${macro.name}]([Check(d6)])`).join('\n');
    const replacements = entries.map((macro, i) => ({ line: i + 1, id: macro.id, version: 0 }));
    const action: Action = { type: 'MACRO_IMPORT', text, visibility: 'public', replacements };
    const legacy = JSON.stringify({
      ...action,
      replacements: entries.map((macro, i) => ({
        line: i + 1,
        id: macro.id,
        source: macro.source,
      })),
    });
    expect(Buffer.byteLength(legacy)).toBeGreaterThan(MAX_CLIENT_MESSAGE_BYTES);
    expect(Buffer.byteLength(serializeClientAction(action, 'bounded-import'))).toBeLessThan(
      MAX_CLIENT_MESSAGE_BYTES,
    );
    expect(prepareAction(room, user, message(action), () => 1)).toHaveLength(100);
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
