import { prepareAction } from '../shared/actions.js';
import { projectRoom, tokenVisible, type DurableRoom, type StateChange } from '../shared/model.js';
import { clientMessageSchema, type Action } from '../shared/protocol.js';
import { applyChanges, inverseChanges } from '../shared/state.js';
import { newRoom, torchlitManor } from '../shared/sample.js';
import { useTable, presentRoll, enqueueTablePresentation } from './store.js';
import { proximityCues } from '../shared/proximity.js';

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
  const contextChanged =
    s.room.id !== projected.id || s.self?.id !== self.id || s.self?.role !== role;
  const ownCharacter =
    role === 'player'
      ? Object.values(projected.characters || {}).find((c) => c.ownerId === self.id)
      : undefined;
  const viewSceneId =
    !reset && !contextChanged && s.viewSceneId && projected.scenes[s.viewSceneId]
      ? s.viewSceneId
      : null;
  const oldScene =
      s.room.scenes[s.viewSceneId || s.room.activeSceneId] || s.room.scenes[s.room.activeSceneId],
    newScene = projected.scenes[viewSceneId || projected.activeSceneId];
  s.set({
    room: projected,
    viewSceneId,
    ...(contextChanged
      ? {
          panel: ownCharacter ? ('character' as const) : ('chronicle' as const),
          characterId: ownCharacter?.id || null,
          characterEditId: null,
          activityOpen: false,
          focusTable: false,
        }
      : {}),
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
    selected: s.selected && newScene.tokens[s.selected] ? s.selected : null,
    selectedIds: s.selectedIds.filter((id) => newScene.tokens[id]),
    previews: {},
    fitNonce:
      s.fitNonce +
      (reset || oldScene.width !== newScene.width || oldScene.height !== newScene.height ? 1 : 0),
    ...(reset
      ? {
          selected: null,
          selectedIds: [],
          selectedPin: null,
          proximityCues: [],
          presentation: null,
          tablePresentations: [],
          attention: null,
          rollQueue: [],
          pings: [],
          sharedMeasurement: null,
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
  room.state.scenes.manor = torchlitManor();
  role = roleChoice;
  undo = [];
  redo = [];
  const s = useTable.getState();
  s.set({ sessionNonce: s.sessionNonce + 1, focusTable: false });
  publish(true);
}
export function demoAction(action: Action) {
  const m = clientMessageSchema.parse({ ...action, v: 7, actionId: crypto.randomUUID() });
  if (m.type === 'SESSION_ROLE') {
    role = m.role;
    publish(true);
    return m.actionId;
  }
  if (m.type === 'TABLE_TOOL_ROLL') {
    const table = room.state.tableTools?.[m.id];
    if (!table || table.kind !== 'table') throw new Error('Table not found.');
    let choice = randomInt(0, table.entries.reduce((sum, entry) => sum + entry.weight, 0));
    const entry = table.entries.find((row) => (choice -= row.weight) < 0)!;
    enqueueTablePresentation({ kind: 'table', name: table.name, result: entry.text });
    return m.actionId;
  }
  if (m.type === 'MEASUREMENT_SHARE') return m.actionId;
  if (m.type === 'PING') {
    const s = useTable.getState();
    if (
      s.pings.some(
        (p) =>
          p.userId === identity.id &&
          p.x === m.position.x &&
          p.y === m.position.y &&
          Date.now() - p.at < 2000,
      )
    )
      return m.actionId;
    s.set({
      pings: [
        ...s.pings.filter((p) => Date.now() - p.at < 2000),
        { ...m.position, at: Date.now(), userId: identity.id, name: identity.name },
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
      !['DICE_ROLL_REQUEST', 'MACRO_ROLL_REQUEST', 'STAT_ROLL_REQUEST'].includes(m.type)
    ) {
      const edits = changes.filter((change) => change.kind !== 'roll');
      const groupId = m.type === 'FOG_APPEND' ? m.groupId : undefined,
        last = undo.at(-1);
      if (groupId && last?.groupId === groupId) last.forward.push(...edits);
      else
        undo.push({
          forward: edits,
          inverse: inverseChanges(before, edits),
          label: m.type.toLowerCase().replaceAll('_', ' '),
          groupId,
        });
      redo = [];
      while (undo.length > 50 || JSON.stringify(undo).length > 1024 * 1024) undo.shift();
    }
  }
  if (!changes.length) return m.actionId;
  room.state = { ...applyChanges(before, changes), revision: before.revision + 1 };
  publish(before.activeSceneId !== room.state.activeSceneId);
  const cues =
    m.type === 'TOKEN_MOVE_COMMIT'
      ? proximityCues(before, room.state, m.sceneId, [m.tokenId])
      : m.type === 'TOKEN_MOVE_BATCH'
        ? proximityCues(
            before,
            room.state,
            m.sceneId,
            m.positions.map((p) => p.tokenId),
          )
        : [];
  for (const cue of cues) {
    const cueScene = room.state.scenes[room.state.activeSceneId];
    const text =
      role === 'gm'
        ? cue.gm
        : cueScene.tokens[cue.tokenId] &&
            tokenVisible(cueScene.tokens[cue.tokenId], cueScene, 'player', identity.id)
          ? cue.player
          : undefined;
    if (text) {
      const s = useTable.getState();
      s.set({
        proximityCues: [...s.proximityCues, { id: crypto.randomUUID(), message: text }].slice(-20),
      });
    }
  }
  const transition = changes.find((change) => change.kind === 'scene-active');
  if (transition?.kind === 'scene-active')
    useTable
      .getState()
      .set({ sceneTransition: Date.now(), transitionEffect: transition.transition || null });
  for (const change of changes)
    if (change.kind === 'roll') {
      presentRoll(change.roll);
    }
  return m.actionId;
}
