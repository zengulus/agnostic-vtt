import { expect, it } from 'vitest';
import { clientMessageSchema } from '../shared/protocol.js';
import { newRoom } from '../shared/sample.js';
import { projectRoom } from '../shared/model.js';
import { prepareAction } from '../shared/actions.js';
import { applyChanges } from '../shared/state.js';

it('rejects the removed chat action from older clients', () => {
  expect(
    clientMessageSchema.safeParse({
      v: 7,
      actionId: 'old-client',
      type: 'CHAT_SEND',
      text: 'Hello',
    }).success,
  ).toBe(false);
});
it('keeps legacy campaign data private while existing gameplay still works', () => {
  const room = newRoom('legacy-room', 'owner', 'Owner', 'Existing campaign', 'invite');
  room.state.chat = [{ id: 'old-message', text: 'Legacy conversation' }];
  const legacy = structuredClone(room.state.chat);
  const changes = prepareAction(
    room,
    { id: 'owner', name: 'Owner' },
    {
      v: 7,
      actionId: 'move',
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 440, y: 440 },
    },
    () => 1,
  );
  room.state = applyChanges(room.state, changes);
  expect(room.state.chat).toEqual(legacy);
  for (const role of ['gm', 'player'] as const) {
    const projected = projectRoom(room, 'owner', role);
    expect(projected).not.toHaveProperty('chat');
    expect(projected.scenes.hollow.tokens.ranger.x).toBe(440);
  }
});
