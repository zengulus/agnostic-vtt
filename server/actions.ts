import { randomInt } from 'node:crypto';
import { prepareAction as prepare } from '../shared/actions.js';
import type { DurableRoom } from '../shared/model.js';
import type { ClientMessage } from '../shared/protocol.js';
import type { Identity } from './auth.js';
export { assertAsset } from '../shared/actions.js';
export function prepareAction(
  room: DurableRoom,
  user: Identity,
  message: ClientMessage,
  role = room.members[user.id]?.role,
) {
  return prepare(room, user, message, randomInt, role);
}
