import { isSharedVisionSource } from './vision.js';
import {
  emptyTracker,
  publicHandout,
  publicTableTool,
  projectScene,
  projectTracker,
  projectAssets,
  macroVisible,
  tokenVisible,
  publicToken,
  publicZone,
  projectedLight,
  projectedLightId,
  type RoomState,
  type StateChange,
  type Token,
} from './model.js';
import { characterVisible } from './characters.js';
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
        case 'pin':
          s.pins = { ...s.pins, [c.pin.id]: c.pin };
          break;
        case 'pin-delete':
          s.pins = { ...s.pins };
          delete s.pins[c.id];
          break;
        case 'wall':
          s.walls = { ...s.walls, [c.wall.id]: c.wall };
          break;
        case 'wall-delete':
          s.walls = { ...s.walls };
          delete s.walls[c.id];
          break;
        case 'lighting':
          s.lighting = c.lighting;
          break;
        case 'light-source':
          s.lightSources = { ...s.lightSources };
          if (c.source) s.lightSources[c.id] = c.source;
          else delete s.lightSources[c.id];
          break;
      }
      continue;
    }
    switch (c.kind) {
      case 'table-tool':
        next.tableTools = { ...next.tableTools };
        if (c.tool) next.tableTools[c.id] = c.tool;
        else delete next.tableTools[c.id];
        break;
      case 'handout':
        next.handouts = { ...next.handouts };
        if (c.handout) next.handouts[c.id] = c.handout;
        else delete next.handouts[c.id];
        break;
      case 'encounter':
        next.encounters = { ...next.encounters };
        if (c.encounter) next.encounters[c.id] = c.encounter;
        else delete next.encounters[c.id];
        break;
      case 'status-preset':
        next.statusPresets = { ...next.statusPresets };
        if (c.preset) next.statusPresets[c.id] = c.preset;
        else delete next.statusPresets[c.id];
        break;
      case 'character':
        next.characters = { ...next.characters };
        if (c.character) next.characters[c.id] = c.character;
        else delete next.characters[c.id];
        break;
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
      case 'table-tool':
        inverse.unshift({ ...c, tool: current.tableTools?.[c.id] || null });
        break;
      case 'handout':
        inverse.unshift({ ...c, handout: current.handouts?.[c.id] || null });
        break;
      case 'encounter':
        inverse.unshift({ ...c, encounter: current.encounters?.[c.id] || null });
        break;
      case 'status-preset':
        inverse.unshift({ ...c, preset: current.statusPresets?.[c.id] || null });
        break;
      case 'character':
        inverse.unshift({ ...c, character: current.characters?.[c.id] || null });
        break;
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
      case 'pin': {
        const old = scene?.pins?.[c.pin.id];
        inverse.unshift(
          old ? { ...c, pin: old } : { kind: 'pin-delete', sceneId: c.sceneId, id: c.pin.id },
        );
        break;
      }
      case 'pin-delete':
        if (scene?.pins?.[c.id])
          inverse.unshift({ kind: 'pin', sceneId: c.sceneId, pin: scene.pins[c.id] });
        break;
      case 'wall': {
        const old = scene?.walls?.[c.wall.id];
        inverse.unshift(
          old ? { ...c, wall: old } : { kind: 'wall-delete', sceneId: c.sceneId, id: c.wall.id },
        );
        break;
      }
      case 'wall-delete':
        if (scene?.walls?.[c.id])
          inverse.unshift({ kind: 'wall', sceneId: c.sceneId, wall: scene.walls[c.id] });
        break;
      case 'lighting':
        inverse.unshift({ ...c, lighting: scene?.lighting });
        break;
      case 'light-source':
        inverse.unshift({ ...c, source: scene?.lightSources?.[c.id] || null });
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
  playerIds: readonly string[] = [userId],
): StateChange[] {
  const projected: StateChange[] = [],
    fogScenes = new Set<string>(),
    changedTokens = new Map<string, Set<string>>();
  const clean = (t: Token, scene?: RoomState['scenes'][string]) =>
    role === 'gm'
      ? t
      : {
          ...publicToken(t),
          ...(scene?.lighting?.vision
            ? { sharedVisionSource: isSharedVisionSource(t, playerIds) }
            : {}),
        };
  for (const c of changes) {
    if (role === 'player') {
      const id = c.kind === 'scene' ? c.scene.id : 'sceneId' in c ? c.sceneId : undefined;
      if (id && c.kind !== 'scene-active') {
        const old = before.scenes[id],
          next = after.scenes[id];
        const was = !!old && (old.visibility !== 'gm' || id === before.activeSceneId);
        const visible = !!next && (next.visibility !== 'gm' || id === after.activeSceneId);
        if (!visible) {
          if (was && (c.kind === 'scene' || c.kind === 'scene-delete'))
            projected.push({ kind: 'scene-delete', sceneId: id });
          continue;
        }
        if (!was && c.kind === 'scene') {
          projected.push({ kind: 'scene', scene: projectScene(next!, role, userId, playerIds) });
          continue;
        }
        if (!was && c.kind !== 'scene') continue;
      }
    }
    if (c.kind === 'table-tool') {
      projected.push(role === 'gm' || !c.tool ? c : { ...c, tool: publicTableTool(c.tool) });
      continue;
    }
    if (c.kind === 'handout') {
      const old = before.handouts?.[c.id];
      if (role === 'gm') projected.push(c);
      else if (c.handout?.shared) projected.push({ ...c, handout: publicHandout(c.handout) });
      else if (old?.shared) projected.push({ ...c, handout: null });
      continue;
    }
    if (c.kind === 'encounter') {
      if (role === 'gm') projected.push(c);
      continue;
    }
    if (c.kind === 'character') {
      const old = before.characters?.[c.id];
      if (c.character && characterVisible(c.character, userId, role)) projected.push(c);
      else if (old && characterVisible(old, userId, role))
        projected.push({ ...c, character: null });
      continue;
    }
    if (c.kind === 'macro') {
      const old = before.macros?.[c.id];
      if (c.macro && macroVisible(c.macro, userId, role)) projected.push(c);
      else if (old && macroVisible(old, userId, role)) projected.push({ ...c, macro: null });
      continue;
    }
    if (c.kind === 'token' || c.kind === 'token-delete') {
      const id = c.kind === 'token' ? c.token.id : c.tokenId;
      if (!changedTokens.has(c.sceneId)) changedTokens.set(c.sceneId, new Set());
      changedTokens.get(c.sceneId)!.add(id);
      if (before.scenes[c.sceneId]?.lighting?.vision || after.scenes[c.sceneId]?.lighting?.vision)
        fogScenes.add(c.sceneId);
    }
    if (c.kind === 'wall' || c.kind === 'wall-delete' || c.kind === 'lighting')
      fogScenes.add(c.sceneId);
    if (c.kind === 'token') {
      const old = before.scenes[c.sceneId]?.tokens[c.token.id],
        s = after.scenes[c.sceneId];
      if (tokenVisible(c.token, s, role, userId, playerIds))
        projected.push({ ...c, token: clean(c.token, s) });
      else if (old && tokenVisible(old, before.scenes[c.sceneId], role, userId, playerIds))
        projected.push({ kind: 'token-delete', sceneId: c.sceneId, tokenId: c.token.id });
      continue;
    }
    if (c.kind === 'token-delete') {
      const old = before.scenes[c.sceneId]?.tokens[c.tokenId];
      if (old && tokenVisible(old, before.scenes[c.sceneId], role, userId, playerIds))
        projected.push(c);
      continue;
    }
    if (c.kind === 'scene') {
      projected.push({ ...c, scene: projectScene(c.scene, role, userId, playerIds) });
      continue;
    }
    if (c.kind === 'fog' || c.kind === 'fog-operation') {
      projected.push(c);
      fogScenes.add(c.sceneId);
      continue;
    }
    if (c.kind === 'zone') {
      const old = before.scenes[c.sceneId]?.zones[c.zone.id];
      if (role === 'gm' || c.zone.visibility !== 'gm')
        projected.push(role === 'gm' ? c : { ...c, zone: publicZone(c.zone) });
      else if (old && old.visibility !== 'gm')
        projected.push({ kind: 'zone-delete', sceneId: c.sceneId, id: c.zone.id });
      continue;
    }
    if (c.kind === 'zone-delete') {
      const old = before.scenes[c.sceneId]?.zones[c.id];
      if (old && (role === 'gm' || old.visibility !== 'gm')) projected.push(c);
      continue;
    }
    if (c.kind === 'annotation') {
      if (role === 'gm' || c.annotation.visibility === 'public') projected.push(c);
      else if (before.scenes[c.sceneId]?.annotations?.[c.annotation.id]?.visibility === 'public')
        projected.push({ kind: 'annotation-delete', sceneId: c.sceneId, id: c.annotation.id });
      continue;
    }
    if (c.kind === 'pin') {
      const old = before.scenes[c.sceneId]?.pins?.[c.pin.id];
      if (role === 'gm') projected.push(c);
      else if (c.pin.visibility === 'public')
        projected.push({
          ...c,
          pin: { ...c.pin, gmNote: undefined, destinationSceneId: undefined, proximity: undefined },
        });
      else if (old?.visibility === 'public')
        projected.push({ kind: 'pin-delete', sceneId: c.sceneId, id: c.pin.id });
      continue;
    }
    if (c.kind === 'pin-delete') {
      const old = before.scenes[c.sceneId]?.pins?.[c.id];
      if (old && (role === 'gm' || old.visibility === 'public')) projected.push(c);
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
      projected.push({ ...c, tracker: projectTracker(c.tracker, role, after, userId, playerIds) });
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
    for (const [sceneId, ids] of changedTokens) {
      const oldScene = before.scenes[sceneId],
        newScene = after.scenes[sceneId];
      if (
        !oldScene ||
        !newScene ||
        (newScene.visibility === 'gm' && sceneId !== after.activeSceneId)
      )
        continue;
      for (const id of ids) {
        const oldLight = oldScene.tokens[id] && projectedLight(oldScene.tokens[id]);
        const newLight = newScene.tokens[id] && projectedLight(newScene.tokens[id]);
        if (JSON.stringify(oldLight) !== JSON.stringify(newLight))
          projected.push({
            kind: 'light-source',
            sceneId,
            id: projectedLightId(sceneId, id),
            source: newLight || null,
          });
      }
    }
  if (role === 'player')
    for (const id of fogScenes) {
      const a = before.scenes[id],
        b = after.scenes[id];
      if (!a || !b || (b.visibility === 'gm' && id !== after.activeSceneId)) continue;
      for (const token of Object.values(b.tokens)) {
        if (changedTokens.get(id)?.has(token.id)) continue;
        const was =
            a.tokens[token.id] && tokenVisible(a.tokens[token.id], a, role, userId, playerIds),
          now = tokenVisible(token, b, role, userId, playerIds);
        if (now && !was) projected.push({ kind: 'token', sceneId: id, token: clean(token, b) });
        if (was && !now) projected.push({ kind: 'token-delete', sceneId: id, tokenId: token.id });
        if (was && now && !!a.lighting?.vision !== !!b.lighting?.vision)
          projected.push({ kind: 'token', sceneId: id, token: clean(token, b) });
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
        'wall',
        'wall-delete',
        'lighting',
        'assets',
      ].includes(c.kind),
    )
  ) {
    const oldAssets = projectAssets(before, false, role, userId, playerIds),
      newAssets = projectAssets(after, false, role, userId, playerIds);
    if (
      JSON.stringify(Object.keys(oldAssets).sort()) !==
      JSON.stringify(Object.keys(newAssets).sort())
    )
      projected.push({ kind: 'assets', assets: newAssets });
  }
  // Fog, token visibility and scene changes can alter linked tracker visibility without a tracker edit.
  if (role === 'player' && !changes.some((c) => c.kind === 'tracker')) {
    const oldTracker = projectTracker(
      before.tracker || emptyTracker(),
      role,
      before,
      userId,
      playerIds,
    );
    const tracker = projectTracker(after.tracker || emptyTracker(), role, after, userId, playerIds);
    if (JSON.stringify(oldTracker) !== JSON.stringify(tracker))
      projected.push({ kind: 'tracker', tracker });
  }
  return projected;
}
