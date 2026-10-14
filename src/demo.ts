import { prepareAction } from '../shared/actions.js';
import { projectRoom, type DurableRoom, type StateChange } from '../shared/model.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
import { applyChanges, inverseChanges } from '../shared/state.js';
import { newRoom } from '../shared/sample.js';
import { useTable } from './store.js';

const identity = { id: 'demo-gm', name: 'Storykeeper' };
let room: DurableRoom;
let role: 'gm' | 'player' = 'gm';
type Edit = { forward: StateChange[]; inverse: StateChange[]; label: string; groupId?: string };
let undo: Edit[] = [],
  redo: Edit[] = [];
function randomInt(min: number, max: number) {
  const range = max - min,
    limit = Math.floor(2 ** 32 / range) * range;
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= limit);
  return min + (value % range);
}
function publish(reset = false) {
  const s = useTable.getState();
  const self = { ...identity, role, color: '#d8b46c' };
  const projected = projectRoom(room, identity.id, role);
  const oldScene = s.room.scenes[s.room.activeSceneId],
    newScene = projected.scenes[projected.activeSceneId];
  s.set({
    room: projected,
    self,
    presence: [self],
    status: 'demo',
    canGM: true,
    inviteCode: undefined,
    ownerId: null,
    members: [],
    removedMembers: [],
    discord: { configured: false, enabled: false, mode: 'automatic', canManage: false },
    history: {
      canUndo: role === 'gm' && !!undo.length,
      canRedo: role === 'gm' && !!redo.length,
      undoLabel: undo.at(-1)?.label || '',
      redoLabel: redo.at(-1)?.label || '',
    },
    selected:
      s.selected && projected.scenes[projected.activeSceneId].tokens[s.selected]
        ? s.selected
        : null,
    selectedIds: s.selectedIds.filter((id) => projected.scenes[projected.activeSceneId].tokens[id]),
    previews: {},
    fitNonce:
      s.fitNonce +
      (reset || oldScene.width !== newScene.width || oldScene.height !== newScene.height ? 1 : 0),
    ...(reset
      ? {
          selected: null,
          selectedIds: [],
          presentation: null,
          rollQueue: [],
          pings: [],
          tool: 'select',
          dialog: null,
          error: null,
          deliveries: {},
        }
      : {}),
  });
}
export function startDemo(roleChoice: 'gm' | 'player' = 'gm') {
  room = newRoom('offline-demo', identity.id, identity.name, 'The Hollow Chronicles', '');
  role = roleChoice;
  undo = [];
  redo = [];
  publish(true);
}
export function demoAction(action: Action) {
  const m = clientMessageSchema.parse({ ...action, v: 2, actionId: crypto.randomUUID() });
  if (m.type === 'SESSION_ROLE') {
    role = m.role;
    publish(true);
    return m.actionId;
  }
  if (m.type === 'PING') {
    const s = useTable.getState();
    s.set({
      pings: [
        ...s.pings.filter((p) => Date.now() - p.at < 2000),
        { ...m.position, at: Date.now() },
      ],
    });
    return m.actionId;
  }
  if (m.type === 'STATE_RESYNC') {
    publish();
    return m.actionId;
  }
  if (m.type === 'TOKEN_MOVE_PREVIEW' || m.type === 'TOKEN_MOVE_PREVIEW_BATCH') return m.actionId;
  const before = room.state;
  let changes: StateChange[];
  if (m.type === 'UNDO' || m.type === 'REDO') {
    if (role !== 'gm') throw new Error('Only the game master can change this.');
    const source = m.type === 'UNDO' ? undo : redo,
      target = m.type === 'UNDO' ? redo : undo;
    const edit = source.pop();
    if (!edit) throw new Error('No edits to restore.');
    changes = m.type === 'UNDO' ? edit.inverse : edit.forward;
    target.push(edit);
  } else {
    changes = prepareAction(room, identity, m, randomInt, role);
    if (
      changes.length &&
      !['DICE_ROLL_REQUEST', 'MACRO_ROLL_REQUEST', 'CHAT_SEND'].includes(m.type)
    ) {
      const groupId = m.type === 'FOG_APPEND' ? m.groupId : undefined,
        last = undo.at(-1);
      if (groupId && last?.groupId === groupId) last.forward.push(...changes);
      else
        undo.push({
          forward: changes,
          inverse: inverseChanges(before, changes),
          label: m.type.toLowerCase().replaceAll('_', ' '),
          groupId,
        });
      redo = [];
      while (undo.length > 50 || JSON.stringify(undo).length > 1024 * 1024) undo.shift();
    }
  }
  room.state = { ...applyChanges(before, changes), revision: before.revision + 1 };
  publish(before.activeSceneId !== room.state.activeSceneId);
  for (const change of changes)
    if (change.kind === 'roll') {
      const s = useTable.getState();
      if (s.presentation) s.set({ rollQueue: [...s.rollQueue, change.roll].slice(-10) });
      else s.set({ presentation: change.roll });
    }
  return m.actionId;
}
