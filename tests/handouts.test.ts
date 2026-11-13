import { describe, expect, it } from 'vitest';
import { newRoom } from '../shared/sample.js';
import { prepareAction } from '../shared/actions.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
import { handoutDigest, projectRoom, type Handout } from '../shared/model.js';
import { applyChanges, inverseChanges, projectChanges } from '../shared/state.js';

const handout: Handout = {
  id: 'clue',
  title: 'Letter',
  text: 'Meet at dusk',
  imageUrl: 'https://example.com/letter.png',
  gmNote: 'The author is a spy',
  shared: false,
};
function setup() {
  const room = newRoom('test-room', 'gm', 'GM', 'Test', 'invite');
  room.members.player = { name: 'Player', role: 'player' };
  return room;
}
function commit(room: ReturnType<typeof setup>, action: Action, user = 'gm') {
  const before = room.state;
  const changes = prepareAction(
    room,
    { id: user, name: user },
    clientMessageSchema.parse({ ...action, v: 7, actionId: 'test' }),
    () => 1,
  );
  room.state = applyChanges(before, changes);
  return { before, changes };
}

describe('handouts', () => {
  it('projects only shared content, strips notes, and removes unshared content', () => {
    const room = setup();
    const created = commit(room, { type: 'HANDOUT_SAVE', handout });
    expect(projectRoom(room, 'player').handouts).toEqual({});
    expect(projectChanges(created.changes, created.before, room.state, 'player', 'player')).toEqual(
      [],
    );
    const shared = { ...handout, shared: true };
    const reveal = commit(room, {
      type: 'HANDOUT_SAVE',
      handout: shared,
      digest: handoutDigest(handout),
    });
    expect(projectRoom(room, 'player').handouts?.clue).toEqual({ ...shared, gmNote: '' });
    expect(projectChanges(reveal.changes, reveal.before, room.state, 'player', 'player')).toEqual([
      { kind: 'handout', id: 'clue', handout: { ...shared, gmNote: '' } },
    ]);
    const hide = commit(room, { type: 'HANDOUT_SAVE', handout, digest: handoutDigest(shared) });
    expect(projectChanges(hide.changes, hide.before, room.state, 'player', 'player')).toEqual([
      { kind: 'handout', id: 'clue', handout: null },
    ]);
    expect(
      applyChanges(room.state, inverseChanges(hide.before, hide.changes)).handouts?.clue,
    ).toEqual(shared);
  });
  it('enforces permissions, size and concurrency limits, and validates image URLs', () => {
    const room = setup();
    expect(() => commit(room, { type: 'HANDOUT_SAVE', handout }, 'player')).toThrow();
    expect(() =>
      commit(room, {
        type: 'HANDOUT_SAVE',
        handout: { ...handout, imageUrl: 'http://localhost/private' },
      }),
    ).toThrow();
    expect(() =>
      commit(room, { type: 'HANDOUT_SAVE', handout: { ...handout, text: 'x'.repeat(8001) } }),
    ).toThrow();
    commit(room, { type: 'HANDOUT_SAVE', handout });
    expect(() => commit(room, { type: 'HANDOUT_SAVE', handout })).toThrow(/changed/);
    expect(() =>
      commit(room, { type: 'HANDOUT_DELETE', id: 'clue', digest: '0'.repeat(64) }),
    ).toThrow(/changed/);
    commit(room, { type: 'HANDOUT_DELETE', id: 'clue', digest: handoutDigest(handout) });
    expect(room.state.handouts).toEqual({});
  });
  it('bounds representative maximum snapshot and single-save payload growth', () => {
    const room = setup();
    const before = Buffer.byteLength(JSON.stringify(room.state));
    const full = {
      ...handout,
      title: 't'.repeat(120),
      text: 'x'.repeat(8000),
      gmNote: 'n'.repeat(4000),
      imageUrl: `https://example.com/${'a'.repeat(2028)}`,
    };
    for (let index = 0; index < 50; index++)
      commit(room, { type: 'HANDOUT_SAVE', handout: { ...full, id: `h${index}` } });
    const growth = Buffer.byteLength(JSON.stringify(room.state)) - before;
    expect(growth).toBeLessThan(720_000);
    expect(Buffer.byteLength(JSON.stringify({ type: 'HANDOUT_SAVE', handout: full }))).toBeLessThan(
      15_000,
    );
    expect(() =>
      commit(room, { type: 'HANDOUT_SAVE', handout: { ...full, id: 'overflow' } }),
    ).toThrow(/50 handouts/);
  });
});
