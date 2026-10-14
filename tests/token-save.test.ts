import { describe, expect, it } from 'vitest';
import { saveTokenDraft } from '../src/tokenSave.js';
import { newRoom } from '../shared/sample.js';
import { prepareAction } from '../shared/actions.js';
import { applyChanges } from '../shared/state.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
import type { Scene, Token } from '../shared/model.js';

function editor(existing: boolean) {
  const room = newRoom('testing', 'gm', 'Keeper', 'Test', 'invite');
  room.members.player = { name: 'Player', role: 'player' };
  const initial = room.state.scenes.hollow.tokens.ranger;
  let original: Token | undefined = existing ? initial : undefined;
  let token: Token = { ...initial, id: existing ? initial.id : 'new-token', name: 'Saved name' };
  let loseConfirmation = false,
    staleScene: Scene | undefined;
  const sent: Action[] = [],
    accepted: Token[] = [];
  room.state.tokenLibrary = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => {
      const id = `template-${i}`;
      return [id, { ...initial, id }];
    }),
  );
  const commit = (action: Action, role: 'gm' | 'player' = 'gm') => {
    const message = clientMessageSchema.parse({ ...action, v: 2, actionId: crypto.randomUUID() });
    const changes = prepareAction(room, { id: role, name: role }, message, () => 1, role);
    room.state = applyChanges(room.state, changes);
  };
  return {
    room,
    sent,
    accepted,
    get token() {
      return token;
    },
    get original() {
      return original;
    },
    edit(value: Partial<Token>) {
      token = { ...token, ...value };
    },
    loseNextConfirmation() {
      loseConfirmation = true;
    },
    freezeClientView() {
      staleScene = structuredClone(room.state.scenes.hollow);
    },
    reloadLatest() {
      staleScene = undefined;
      original = room.state.scenes.hollow.tokens[token.id];
      token = original;
    },
    commit,
    move() {
      commit(
        {
          type: 'TOKEN_MOVE_COMMIT',
          sceneId: 'hollow',
          tokenId: token.id,
          position: { x: 920, y: 760 },
        },
        'player',
      );
    },
    save(saveTemplate: boolean) {
      return saveTokenDraft(
        { sceneId: 'hollow', original, token, saveTemplate },
        {
          currentScene: () => staleScene || room.state.scenes.hollow,
          send: async (action) => {
            sent.push(action);
            commit(action);
            if (loseConfirmation) {
              loseConfirmation = false;
              throw new Error('No confirmation received.');
            }
          },
          accepted: (saved) => {
            original = saved;
            token = saved;
            accepted.push(saved);
          },
        },
      );
    },
  };
}

describe('partial token save success', () => {
  it.each([false, true])(
    'cannot overwrite a moved token after its creation confirmation is lost (stale client: %s)',
    async (stale) => {
      const form = editor(false);
      if (stale) form.freezeClientView();
      form.loseNextConfirmation();
      await expect(form.save(false)).rejects.toThrow('No confirmation received.');
      expect(form.original).toBeUndefined();
      expect(form.accepted).toEqual([]);
      expect(form.sent[0]).toMatchObject({ type: 'TOKEN_UPDATE', createOnly: true });
      form.move();
      const moved = structuredClone(form.room.state.scenes.hollow.tokens['new-token']);
      await expect(form.save(false)).rejects.toThrow(/already exists.*Reload/);
      expect(form.room.state.scenes.hollow.tokens['new-token']).toEqual(moved);
      expect(form.original).toBeUndefined();
      form.reloadLatest();
      form.edit({ note: 'Reviewed after reconnect' });
      await form.save(false);
      expect(form.sent.at(-1)).toMatchObject({
        type: 'TOKEN_PATCH',
        edits: [{ field: 'note', value: 'Reviewed after reconnect' }],
      });
      expect(form.room.state.scenes.hollow.tokens['new-token']).toMatchObject({
        x: 920,
        y: 760,
        note: 'Reviewed after reconnect',
      });
    },
  );
  it('promotes confirmed creation before a full library rejects, then preserves a player move on retry', async () => {
    const form = editor(false);
    await expect(form.save(true)).rejects.toThrow('Library limit reached.');
    expect(form.original?.id).toBe('new-token');
    expect(form.accepted).toHaveLength(1);
    expect(form.sent.map((action) => action.type)).toEqual(['TOKEN_UPDATE', 'LIBRARY_SAVE']);
    form.move();
    const saved = await form.save(false);
    expect(saved).toMatchObject({ id: 'new-token', name: 'Saved name', x: 920, y: 760 });
    expect(form.sent.map((action) => action.type)).toEqual(['TOKEN_UPDATE', 'LIBRARY_SAVE']);
  });

  it('retries only the optional template after accepting an existing-token patch', async () => {
    const form = editor(true);
    await expect(form.save(true)).rejects.toThrow('Library limit reached.');
    expect(form.original?.name).toBe('Saved name');
    form.move();
    delete form.room.state.tokenLibrary!['template-0'];
    await form.save(true);
    expect(form.sent.map((action) => action.type)).toEqual([
      'TOKEN_PATCH',
      'LIBRARY_SAVE',
      'LIBRARY_SAVE',
    ]);
    const template = Object.values(form.room.state.tokenLibrary!).find(
      (entry) => entry.name === 'Saved name',
    );
    expect(template).toMatchObject({ x: 920, y: 760 });
  });

  it('sends only edits made after the accepted token save when retrying a failed template', async () => {
    const form = editor(true);
    await expect(form.save(true)).rejects.toThrow('Library limit reached.');
    form.move();
    form.edit({ name: 'Later edit' });
    await form.save(false);
    expect(form.sent.at(-1)).toMatchObject({
      type: 'TOKEN_PATCH',
      edits: [{ field: 'name', before: 'Saved name', value: 'Later edit' }],
    });
    expect(form.room.state.scenes.hollow.tokens.ranger).toMatchObject({
      name: 'Later edit',
      x: 920,
      y: 760,
    });
  });

  it('rebases the draft as well as its baseline onto unrelated authoritative image and resource edits', async () => {
    const form = editor(true),
      current = form.room.state.scenes.hollow.tokens.ranger;
    const image = { kind: 'builtin' as const, url: 'wisp.svg' };
    form.commit({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: {
        ...current,
        image,
        resource: { ...current.resource!, value: 2 },
      },
    });
    await expect(form.save(true)).rejects.toThrow('Library limit reached.');
    expect(form.token).toMatchObject({ image, resource: { value: 2 } });
    expect(form.original).toBe(form.token);
    form.move();
    const newer = form.room.state.scenes.hollow.tokens.ranger;
    form.commit({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: {
        ...newer,
        resource: { ...newer.resource!, value: 1 },
      },
    });
    await form.save(false);
    expect(form.room.state.scenes.hollow.tokens.ranger).toMatchObject({
      image,
      resource: { value: 1 },
      x: 920,
      y: 760,
      name: 'Saved name',
    });
    expect(form.sent.map((action) => action.type)).toEqual(['TOKEN_PATCH', 'LIBRARY_SAVE']);
  });

  it.each([false, true])(
    'does not resurrect a deleted token after a partial save (changed draft: %s)',
    async (changed) => {
      const form = editor(false);
      await expect(form.save(true)).rejects.toThrow('Library limit reached.');
      form.commit({ type: 'TOKEN_DELETE', sceneId: 'hollow', tokenId: form.token.id });
      if (changed) form.edit({ name: 'Later edit' });
      await expect(form.save(false)).rejects.toThrow(/removed/);
      expect(form.room.state.scenes.hollow.tokens['new-token']).toBeUndefined();
      expect(form.sent.filter((action) => action.type === 'TOKEN_UPDATE')).toHaveLength(1);
    },
  );

  it('does not promote a rejected table edit or attempt to save its template', async () => {
    const form = editor(true),
      oldOriginal = form.original;
    const current = form.room.state.scenes.hollow.tokens.ranger;
    form.commit({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...current, name: 'Other edit' },
    });
    await expect(form.save(true)).rejects.toThrow(/name changed/);
    expect(form.original).toBe(oldOriginal);
    expect(form.token.name).toBe('Saved name');
    expect(form.accepted).toEqual([]);
    expect(form.sent.map((action) => action.type)).toEqual(['TOKEN_PATCH']);
  });
});
