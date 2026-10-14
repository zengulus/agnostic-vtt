import { describe, expect, it } from 'vitest';
import { newRoom } from '../shared/sample.js';
import { prepareAction } from '../shared/actions.js';
import { applyChanges } from '../shared/state.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
const message = (action: Action) =>
  clientMessageSchema.parse({ v: 2, actionId: 'test', ...action });
const action = (delta: number): Action => ({
  type: 'TOKEN_RESOURCE_ADJUST',
  sceneId: 'hollow',
  tokenId: 'ranger',
  delta,
});
function setup() {
  const room = newRoom('test-room', 'gm', 'GM', 'Resources', 'invite');
  room.members.player = { name: 'Player', role: 'player' };
  room.state.scenes.hollow.tokens.ranger.owners = ['player'];
  return room;
}
describe('controller resource adjustments', () => {
  it('adjusts only the current value and preserves concurrent moves and other fields', () => {
    const room = setup(),
      token = room.state.scenes.hollow.tokens.ranger;
    token.x = 920;
    const changed = applyChanges(
      room.state,
      prepareAction(room, { id: 'player', name: 'Player' }, message(action(-3)), () => 1),
    );
    expect(changed.scenes.hollow.tokens.ranger).toEqual({
      ...token,
      resource: { ...token.resource!, value: 5 },
    });
    room.state = changed;
    const healed = applyChanges(
      room.state,
      prepareAction(room, { id: 'player', name: 'Player' }, message(action(2)), () => 1),
    );
    expect(healed.scenes.hollow.tokens.ranger.resource?.value).toBe(7);
  });
  it.each([
    [-10000, 0],
    [10000, 10],
  ])('clamps adjustment %s to %s', (delta, value) => {
    const room = setup();
    const next = applyChanges(
      room.state,
      prepareAction(room, { id: 'player', name: 'Player' }, message(action(delta)), () => 1),
    );
    expect(next.scenes.hollow.tokens.ranger.resource?.value).toBe(value);
  });
  it('denies other controllers, hidden tokens, missing resources and broad token edits', () => {
    const room = setup(),
      player = { id: 'player', name: 'Player' },
      token = room.state.scenes.hollow.tokens.ranger;
    token.owners = [];
    expect(() => prepareAction(room, player, message(action(1)), () => 1)).toThrow(
      'do not control',
    );
    token.owners = ['*'];
    token.visibility = 'gm';
    expect(() => prepareAction(room, player, message(action(1)), () => 1)).toThrow(
      'do not control',
    );
    token.visibility = 'public';
    delete token.resource;
    expect(() => prepareAction(room, player, message(action(1)), () => 1)).toThrow('no resource');
    expect(() =>
      prepareAction(
        room,
        player,
        message({ type: 'TOKEN_UPDATE', sceneId: 'hollow', token }),
        () => 1,
      ),
    ).toThrow('Only the game master');
  });
  it('rejects nonfinite and excessive deltas at the protocol boundary', () => {
    for (const delta of [NaN, Infinity, 10001, -10001])
      expect(() => message(action(delta))).toThrow();
  });
});
