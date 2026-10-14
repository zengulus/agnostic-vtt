import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let demo: typeof import('../src/demo.js');
let table: typeof import('../src/store.js');
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Demo must not fetch');
    }),
  );
  demo = await import('../src/demo.js');
  table = await import('../src/store.js');
  demo.startDemo();
});
afterEach(() => vi.unstubAllGlobals());
it('supports edits, undo, macros, rolls and chat without network access', () => {
  const initial = table.useTable.getState().room.scenes.hollow.tokens.ranger;
  demo.demoAction({
    type: 'TOKEN_MOVE_COMMIT',
    sceneId: 'hollow',
    tokenId: 'ranger',
    position: { x: 400, y: 400 },
  });
  expect(table.useTable.getState().room.scenes.hollow.tokens.ranger.x).toBe(440);
  demo.demoAction({ type: 'UNDO' });
  expect(table.useTable.getState().room.scenes.hollow.tokens.ranger).toEqual(initial);
  demo.demoAction({ type: 'REDO' });
  expect(table.useTable.getState().room.scenes.hollow.tokens.ranger.x).toBe(440);
  demo.demoAction({
    type: 'MACRO_IMPORT',
    text: '[Test]([Check(1d20 + 5)])',
    visibility: 'public',
  });
  const id = Object.keys(table.useTable.getState().room.macros!)[0];
  demo.demoAction({ type: 'MACRO_ROLL_REQUEST', id, variables: {}, visibility: 'public' });
  const roll = table.useTable.getState().room.rolls[0];
  expect(roll.total).toBeGreaterThanOrEqual(6);
  expect(roll.total).toBeLessThanOrEqual(25);
  expect(table.useTable.getState().presentation).toEqual(roll);
  demo.demoAction({ type: 'CHAT_SEND', text: 'Browser only' });
  expect(table.useTable.getState().room.chat[0].text).toBe('Browser only');
  expect(fetch).not.toHaveBeenCalled();
});
it('filters player content, denies GM edits, and restores GM state when switching back', () => {
  const token = table.useTable.getState().room.scenes.hollow.tokens.sentinel;
  demo.demoAction({
    type: 'TOKEN_UPDATE',
    sceneId: 'hollow',
    token: { ...token, visibility: 'gm', note: 'Secret' },
  });
  demo.demoAction({ type: 'SESSION_ROLE', role: 'player' });
  expect(table.useTable.getState().room.scenes.hollow.tokens.sentinel).toBeUndefined();
  expect(table.useTable.getState().self?.role).toBe('player');
  expect(() =>
    demo.demoAction({ type: 'TOKEN_DELETE', sceneId: 'hollow', tokenId: 'ranger' }),
  ).toThrow('game master');
  expect(() => demo.demoAction({ type: 'UNDO' })).toThrow('game master');
  demo.demoAction({ type: 'SESSION_ROLE', role: 'gm' });
  expect(table.useTable.getState().room.scenes.hollow.tokens.sentinel.note).toBe('Secret');
  demo.startDemo('player');
  expect(table.useTable.getState().room.scenes.hollow.tokens.sentinel.visibility).toBe('public');
  expect(table.useTable.getState().room.revision).toBe(0);
});
it('refits scenes and clears selection when undoing or redoing a scene switch', () => {
  const initialFit = table.useTable.getState().fitNonce;
  demo.demoAction({ type: 'SCENE_CHANGE', sceneId: 'sanctuary' });
  table.useTable.getState().set({ selected: 'ranger', selectedIds: ['ranger'] });
  demo.demoAction({ type: 'UNDO' });
  expect(table.useTable.getState().room.activeSceneId).toBe('hollow');
  expect(table.useTable.getState().selected).toBeNull();
  expect(table.useTable.getState().fitNonce).toBe(initialFit + 2);
  demo.demoAction({ type: 'REDO' });
  expect(table.useTable.getState().room.activeSceneId).toBe('sanctuary');
  expect(table.useTable.getState().fitNonce).toBe(initialFit + 3);
});
