import { describe, expect, it } from 'vitest';
import { prepareAction } from '../shared/actions.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
import { newRoom } from '../shared/sample.js';
import { applyChanges, inverseChanges } from '../shared/state.js';
import { applyTokenEdits, tokenEdits } from '../shared/tokenEdits.js';

describe('conflict-checked token form edits', () => {
  const create = () => newRoom('testing', 'gm', 'Keeper', 'Test', 'invite');
  const message = (action: Action) =>
    clientMessageSchema.parse({ ...action, v: 2, actionId: 'edit' });
  it('rejects create-only collisions atomically while preserving legacy upsert behavior', () => {
    const room = create(),
      original = room.state.scenes.hollow.tokens.ranger;
    const update = {
      type: 'TOKEN_UPDATE' as const,
      sceneId: 'hollow',
      token: { ...original, name: 'New name' },
    };
    expect(() =>
      prepareAction(
        room,
        { id: 'gm', name: 'GM' },
        message({ ...update, createOnly: true }),
        () => 1,
      ),
    ).toThrow(/already exists/);
    expect(room.state.scenes.hollow.tokens.ranger).toBe(original);
    expect(
      prepareAction(room, { id: 'gm', name: 'GM' }, message(update), () => 1)[0],
    ).toMatchObject({ token: { name: 'New name' } });
  });
  it('transmits only changed fields, including independent resource fields', () => {
    const original = create().state.scenes.hollow.tokens.ranger;
    const draft = {
      ...original,
      name: 'Renamed',
      resource: { ...original.resource!, label: 'Focus' },
    };
    expect(tokenEdits(original, draft)).toEqual([
      { field: 'name', before: original.name, value: 'Renamed' },
      { field: 'resource.label', before: original.resource!.label, value: 'Focus' },
    ]);
  });
  it('preserves a player move already accepted by the server but not yet seen by the editor', () => {
    const room = create();
    room.members.player = { name: 'Player', role: 'player' };
    const original = structuredClone(room.state.scenes.hollow.tokens.ranger);
    const edits = tokenEdits(original, { ...original, note: 'New GM note' });
    const moved = prepareAction(
      room,
      { id: 'player', name: 'Player' },
      message({
        type: 'TOKEN_MOVE_COMMIT',
        sceneId: 'hollow',
        tokenId: 'ranger',
        position: { x: 920, y: 760 },
      }),
      () => 1,
    );
    room.state = applyChanges(room.state, moved);
    const position = room.state.scenes.hollow.tokens.ranger;
    const changes = prepareAction(
      room,
      { id: 'gm', name: 'Keeper' },
      message({
        type: 'TOKEN_PATCH',
        sceneId: 'hollow',
        tokenId: 'ranger',
        edits,
      }),
      () => 1,
    );
    expect(changes[0]).toMatchObject({
      token: { x: position.x, y: position.y, note: 'New GM note' },
    });
    const undo = inverseChanges(room.state, changes);
    const restored = applyChanges(applyChanges(room.state, changes), undo);
    expect(restored.scenes.hollow.tokens.ranger).toEqual(position);
  });
  it('preserves unrelated edits and resource counter changes', () => {
    const original = create().state.scenes.hollow.tokens.ranger;
    const edits = tokenEdits(original, {
      ...original,
      resource: { ...original.resource!, label: 'Focus' },
    });
    const current = {
      ...original,
      color: '#123456',
      groupId: 'new-group',
      resource: { ...original.resource!, value: 2 },
    };
    expect(applyTokenEdits(current, edits)).toEqual({
      ...current,
      resource: { ...current.resource, label: 'Focus' },
    });
  });
  it('rejects same-field conflicts atomically without overwriting any field', () => {
    const original = create().state.scenes.hollow.tokens.ranger;
    const edits = tokenEdits(original, { ...original, name: 'My name', note: 'My note' });
    const current = { ...original, name: 'Their name' };
    expect(() => applyTokenEdits(current, edits)).toThrow(/name changed while you were editing/);
    expect(current.name).toBe('Their name');
    expect(current.note).toBe(original.note);
  });
  it('treats status-list changes as conflicting rather than deleting concurrent statuses', () => {
    const original = create().state.scenes.hollow.tokens.ranger;
    const edits = tokenEdits(original, { ...original, statuses: [] });
    const current = {
      ...original,
      statuses: [{ id: 'new', label: 'Inspired', color: '#123456', icon: 'star' as const }],
    };
    expect(() => applyTokenEdits(current, edits)).toThrow(/statuses changed/);
  });
  it('compares asset objects structurally and allows an absent optional field baseline', () => {
    const original = create().state.scenes.hollow.tokens.ranger;
    delete original.note;
    const draft = {
      ...original,
      image: { url: original.image.url, kind: original.image.kind },
      note: '',
    };
    expect(tokenEdits(original, draft)).toEqual([{ field: 'note', before: null, value: '' }]);
    expect(applyTokenEdits(original, tokenEdits(original, draft)).note).toBe('');
  });
  it('rejects duplicate fields and patches for deleted tokens or from players', () => {
    const room = create(),
      original = room.state.scenes.hollow.tokens.ranger;
    const edits = tokenEdits(original, { ...original, name: 'Rename' });
    expect(() => applyTokenEdits(original, [...edits, ...edits])).toThrow(/Duplicate/);
    const action = message({ type: 'TOKEN_PATCH', sceneId: 'hollow', tokenId: original.id, edits });
    expect(() => prepareAction(room, { id: 'gm', name: 'GM' }, action, () => 1, 'player')).toThrow(
      /game master/,
    );
    delete room.state.scenes.hollow.tokens.ranger;
    expect(() => prepareAction(room, { id: 'gm', name: 'GM' }, action, () => 1)).toThrow(/removed/);
  });
  it.each(['x', 'y', 'id', 'groupId', '__proto__'])(
    'does not accept %s as a form field',
    (field) => {
      expect(
        clientMessageSchema.safeParse({
          v: 2,
          actionId: 'edit',
          type: 'TOKEN_PATCH',
          sceneId: 'hollow',
          tokenId: 'ranger',
          edits: [{ field, before: null, value: 10 }],
        }).success,
      ).toBe(false);
    },
  );
  it('validates proposed values and requires a baseline and at least one changed field', () => {
    const action = {
      v: 2,
      actionId: 'edit',
      type: 'TOKEN_PATCH',
      sceneId: 'hollow',
      tokenId: 'ranger',
    };
    for (const edits of [
      [],
      [{ field: 'size', before: 80, value: 10000 }],
      [{ field: 'name', value: 'Rename' }],
    ])
      expect(clientMessageSchema.safeParse({ ...action, edits }).success).toBe(false);
  });
});
