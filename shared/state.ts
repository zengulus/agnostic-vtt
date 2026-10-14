import {
  emptyTracker,
  projectScene,
  projectTracker,
  projectAssets,
  macroVisible,
  tokenVisible,
  type RoomState,
  type StateChange,
  type Token,
} from './model.js';
/** Structural sharing keeps token commits independent of history size and scene size. */
export function applyChanges(state: RoomState, changes: StateChange[]): RoomState {
  let next = state;
  for (const c of changes) {
    next = { ...next };
    if ('sceneId' in c && !['scene-active', 'scene-delete'].includes(c.kind)) {
      const scene = next.scenes[c.sceneId];
      if (!scene) continue;
      const s = { ...scene };
      next.scenes = { ...next.scenes, [c.sceneId]: s };
      switch (c.kind) {
        case 'token':
          s.tokens = { ...s.tokens, [c.token.id]: c.token };
          break;
        case 'token-delete':
          s.tokens = { ...s.tokens };
          delete s.tokens[c.tokenId];
          break;
        case 'grid':
          s.grid = c.grid;
          break;
        case 'fog':
          s.fog = c.fog;
          break;
        case 'fog-operation':
          s.fog = {
            ...s.fog,
            enabled: true,
            operations: [...(s.fog.operations || []), c.operation],
          };
          break;
        case 'zone':
          s.zones = { ...s.zones, [c.zone.id]: c.zone };
          break;
        case 'zone-delete':
          s.zones = { ...s.zones };
          delete s.zones[c.id];
          break;
        case 'annotation':
          s.annotations = { ...s.annotations, [c.annotation.id]: c.annotation };
          break;
        case 'annotation-delete':
          s.annotations = { ...s.annotations };
          delete s.annotations[c.id];
          break;
      }
      continue;
    }
    switch (c.kind) {
      case 'macro':
        next.macros = { ...next.macros };
        if (c.macro) next.macros[c.id] = c.macro;
        else delete next.macros[c.id];
        break;
      case 'scene':
        next.scenes = { ...next.scenes, [c.scene.id]: c.scene };
        break;
      case 'scene-delete':
        next.scenes = { ...next.scenes };
        delete next.scenes[c.sceneId];
        break;
      case 'scene-active':
        next.activeSceneId = c.sceneId;
        break;
      case 'library':
        next.tokenLibrary = { ...next.tokenLibrary };
        if (c.token) next.tokenLibrary[c.id] = c.token;
        else delete next.tokenLibrary[c.id];
        break;
      case 'tracker':
        next.tracker = c.tracker;
        break;
      case 'assets':
        next.assets = c.assets;
        break;
      case 'roll':
        next.rolls = [...next.rolls, c.roll].slice(-100);
        break;
      case 'chat':
        next.chat = [...next.chat, c.chat].slice(-100);
        break;
    }
  }
  return next;
}
export function inverseChanges(state: RoomState, changes: StateChange[]): StateChange[] {
  const inverse: StateChange[] = [];
  let current = state;
  for (const c of changes) {
    const scene = 'sceneId' in c ? current.scenes[c.sceneId] : undefined;
    switch (c.kind) {
      case 'macro':
        inverse.unshift({ ...c, macro: current.macros?.[c.id] || null });
        break;
      case 'token': {
        const old = scene?.tokens[c.token.id];
        inverse.unshift(
          old
            ? { ...c, token: old }
            : { kind: 'token-delete', sceneId: c.sceneId, tokenId: c.token.id },
        );
        break;
      }
      case 'token-delete':
        if (scene?.tokens[c.tokenId])
          inverse.unshift({ kind: 'token', sceneId: c.sceneId, token: scene.tokens[c.tokenId] });
        break;
      case 'grid':
        inverse.unshift({ ...c, grid: scene!.grid });
        break;
      case 'fog':
        inverse.unshift({ ...c, fog: scene!.fog });
        break;
      case 'fog-operation':
        inverse.unshift({ kind: 'fog', sceneId: c.sceneId, fog: scene!.fog });
        break;
      case 'zone': {
        const old = scene?.zones[c.zone.id];
        inverse.unshift(
          old ? { ...c, zone: old } : { kind: 'zone-delete', sceneId: c.sceneId, id: c.zone.id },
        );
        break;
      }
      case 'zone-delete':
        if (scene?.zones[c.id])
          inverse.unshift({ kind: 'zone', sceneId: c.sceneId, zone: scene.zones[c.id] });
        break;
      case 'annotation': {
        const old = scene?.annotations?.[c.annotation.id];
        inverse.unshift(
          old
            ? { ...c, annotation: old }
            : { kind: 'annotation-delete', sceneId: c.sceneId, id: c.annotation.id },
        );
        break;
      }
      case 'annotation-delete':
        if (scene?.annotations?.[c.id])
          inverse.unshift({
            kind: 'annotation',
            sceneId: c.sceneId,
            annotation: scene.annotations[c.id],
          });
        break;
      case 'scene': {
        const old = current.scenes[c.scene.id];
        inverse.unshift(old ? { ...c, scene: old } : { kind: 'scene-delete', sceneId: c.scene.id });
        break;
      }
      case 'scene-active':
        inverse.unshift({ ...c, sceneId: current.activeSceneId });
        break;
      case 'scene-delete':
        if (current.scenes[c.sceneId])
          inverse.unshift({ kind: 'scene', scene: current.scenes[c.sceneId] });
        break;
      case 'library':
        inverse.unshift({ ...c, token: current.tokenLibrary?.[c.id] || null });
        break;
      case 'tracker':
        inverse.unshift({ ...c, tracker: current.tracker || emptyTracker() });
        break;
    }
    current = applyChanges(current, [c]);
  }
  return inverse;
}
/** Projection applies equally to live actions and undo/redo; hidden identifiers stay private. */
export function projectChanges(
  changes: StateChange[],
  before: RoomState,
  after: RoomState,
  role: 'gm' | 'player',
  userId: string,
): StateChange[] {
  const projected: StateChange[] = [],
    fogScenes = new Set<string>();
  const clean = (t: Token) => (role === 'gm' ? t : { ...t, note: undefined });
  for (const c of changes) {
    if (c.kind === 'macro') {
      const old = before.macros?.[c.id];
      if (c.macro && macroVisible(c.macro, userId, role)) projected.push(c);
      else if (old && macroVisible(old, userId, role)) projected.push({ ...c, macro: null });
      continue;
    }
    if (c.kind === 'token') {
      const old = before.scenes[c.sceneId]?.tokens[c.token.id],
        s = after.scenes[c.sceneId];
      if (tokenVisible(c.token, s, role)) projected.push({ ...c, token: clean(c.token) });
      else if (old && tokenVisible(old, before.scenes[c.sceneId], role))
        projected.push({ kind: 'token-delete', sceneId: c.sceneId, tokenId: c.token.id });
      continue;
    }
    if (c.kind === 'token-delete') {
      const old = before.scenes[c.sceneId]?.tokens[c.tokenId];
      if (old && tokenVisible(old, before.scenes[c.sceneId], role)) projected.push(c);
      continue;
    }
    if (c.kind === 'scene') {
      projected.push({ ...c, scene: projectScene(c.scene, role) });
      continue;
    }
    if (c.kind === 'fog' || c.kind === 'fog-operation') {
      projected.push(c);
      fogScenes.add(c.sceneId);
      continue;
    }
    if (c.kind === 'annotation') {
      if (role === 'gm' || c.annotation.visibility === 'public') projected.push(c);
      else if (before.scenes[c.sceneId]?.annotations?.[c.annotation.id]?.visibility === 'public')
        projected.push({ kind: 'annotation-delete', sceneId: c.sceneId, id: c.annotation.id });
      continue;
    }
    if (c.kind === 'annotation-delete') {
      const a = before.scenes[c.sceneId]?.annotations?.[c.id];
      if (a && (role === 'gm' || a.visibility === 'public')) projected.push(c);
      continue;
    }
    if (c.kind === 'library') {
      const old = before.tokenLibrary?.[c.id];
      if (role === 'gm' || c.token?.visibility === 'public')
        projected.push({ ...c, token: c.token ? clean(c.token) : null });
      else if (old?.visibility === 'public') projected.push({ ...c, token: null });
      continue;
    }
    if (c.kind === 'tracker') {
      projected.push({ ...c, tracker: projectTracker(c.tracker, role, after) });
      continue;
    }
    if (
      c.kind === 'roll' &&
      c.roll.visibility === 'private' &&
      c.roll.userId !== userId &&
      role !== 'gm'
    )
      continue;
    if (c.kind === 'assets' && role !== 'gm') continue;
    projected.push(c);
  }
  if (role === 'player')
    for (const id of fogScenes) {
      const a = before.scenes[id],
        b = after.scenes[id];
      for (const token of Object.values(b.tokens)) {
        const was = a.tokens[token.id] && tokenVisible(a.tokens[token.id], a, role),
          now = tokenVisible(token, b, role);
        if (now && !was) projected.push({ kind: 'token', sceneId: id, token: clean(token) });
        if (was && !now) projected.push({ kind: 'token-delete', sceneId: id, tokenId: token.id });
      }
    }
  if (
    role === 'player' &&
    before.assets &&
    changes.some((c) =>
      [
        'token',
        'token-delete',
        'scene',
        'scene-delete',
        'library',
        'fog',
        'fog-operation',
        'assets',
      ].includes(c.kind),
    )
  ) {
    const oldAssets = projectAssets(before, false, role),
      newAssets = projectAssets(after, false, role);
    if (
      JSON.stringify(Object.keys(oldAssets).sort()) !==
      JSON.stringify(Object.keys(newAssets).sort())
    )
      projected.push({ kind: 'assets', assets: newAssets });
  }
  // Fog, token visibility and scene changes can alter linked tracker visibility without a tracker edit.
  if (role === 'player' && !changes.some((c) => c.kind === 'tracker')) {
    const oldTracker = projectTracker(before.tracker || emptyTracker(), role, before);
    const tracker = projectTracker(after.tracker || emptyTracker(), role, after);
    if (JSON.stringify(oldTracker) !== JSON.stringify(tracker))
      projected.push({ kind: 'tracker', tracker });
  }
  return projected;
}
