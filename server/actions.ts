import { randomInt, randomUUID } from 'node:crypto';
import {
  canControl,
  emptyTracker,
  sceneSchema,
  tokenVisible,
  macroVisible,
  type DurableRoom,
  type StateChange,
  type Token,
} from '../shared/model.js';
import type { ClientMessage } from '../shared/protocol.js';
import { validateAsset } from '../shared/assets.js';
import { clampPoint, snapPoint } from '../shared/geometry.js';
import { evaluateDice } from '../shared/dice.js';
import { sampleScene } from '../shared/sample.js';
import type { Identity } from './auth.js';
import { importMacros, parseMacro, evaluateMacro } from '../shared/macros.js';
export function assertAsset(room: DurableRoom, asset: Token['image']) {
  validateAsset(asset);
  if (asset.kind === 'uploaded' && !room.state.assets?.[asset.url])
    throw new Error('That image is not part of this campaign.');
}
/** All validation happens before applying any member of a batch. */
export function prepareAction(room: DurableRoom, user: Identity, m: ClientMessage): StateChange[] {
  const state = room.state,
    role = room.members[user.id]?.role;
  if (!role) throw new Error('You are no longer a member of this campaign.');
  const gm = () => {
    if (role !== 'gm') throw new Error('Only the game master can change this.');
  };
  const scene = (id: string) => {
    const s = state.scenes[id];
    if (!s) throw new Error('Scene not found.');
    return s;
  };
  const controlled = (sceneId: string, id: string) => {
    const s = scene(sceneId),
      t = s.tokens[id];
    if (!t || !canControl(t, user.id, role) || !tokenVisible(t, s, role))
      throw new Error('You do not control that token.');
    return { s, t };
  };
  const move = (
    sceneId: string,
    tokenId: string,
    position: { x: number; y: number },
  ): StateChange => {
    const { s, t } = controlled(sceneId, tokenId);
    return {
      kind: 'token',
      sceneId,
      token: { ...t, ...clampPoint(snapPoint(position, s.grid), s.width, s.height, t.size) },
    };
  };
  const update = (sceneId: string, tokens: Token[]): StateChange[] => {
    gm();
    const s = scene(sceneId);
    const ids = new Set([...Object.keys(s.tokens), ...tokens.map((t) => t.id)]);
    if (ids.size > 100) throw new Error('A scene supports up to 100 tokens.');
    if (new Set(tokens.map((t) => t.id)).size !== tokens.length)
      throw new Error('Duplicate token identifiers in batch.');
    return tokens.map((token) => {
      assertAsset(room, token.image);
      return {
        kind: 'token',
        sceneId,
        token: { ...token, ...clampPoint(token, s.width, s.height, token.size) },
      };
    });
  };
  switch (m.type) {
    case 'MACRO_IMPORT': {
      const imported = importMacros(m.text);
      if (imported.errors.length)
        throw new Error(`Line ${imported.errors[0].line}: ${imported.errors[0].message}`);
      const existing = Object.values(state.macros || {});
      if (
        existing.length + imported.macros.length > 200 ||
        existing.filter((macro) => macro.ownerId === user.id).length + imported.macros.length > 100
      )
        throw new Error('Save at most 100 macros per person and 200 per campaign.');
      return imported.macros.map((definition) => {
        const id = randomUUID();
        return {
          kind: 'macro',
          id,
          macro: {
            id,
            name: definition.name,
            source: definition.source,
            ownerId: user.id,
            visibility: m.visibility,
          },
        };
      });
    }
    case 'MACRO_DELETE': {
      const macro =
        state.macros && Object.hasOwn(state.macros, m.id) ? state.macros[m.id] : undefined;
      if (!macro || !macroVisible(macro, user.id, role)) throw new Error('Macro not found.');
      if (macro.ownerId !== user.id && role !== 'gm')
        throw new Error('Only its author or a game master can remove this macro.');
      return [{ kind: 'macro', id: m.id, macro: null }];
    }
    case 'MACRO_ROLL_REQUEST': {
      const macro =
        state.macros && Object.hasOwn(state.macros, m.id) ? state.macros[m.id] : undefined;
      if (!macro || !macroVisible(macro, user.id, role)) throw new Error('Macro not found.');
      const result = evaluateMacro(parseMacro(macro.source), m.variables, randomInt);
      return [
        {
          kind: 'roll',
          roll: {
            id: randomUUID(),
            actionId: m.actionId,
            userId: user.id,
            userName: user.name,
            expression: macro.name,
            terms: result.groups.flatMap((group) => group.terms),
            total: result.groups[0].total,
            macro: result,
            visibility: m.visibility,
            createdAt: new Date().toISOString(),
          },
        },
      ];
    }
    case 'TOKEN_MOVE_COMMIT':
      return [move(m.sceneId, m.tokenId, m.position)];
    case 'TOKEN_MOVE_BATCH':
      if (new Set(m.positions.map((p) => p.tokenId)).size !== m.positions.length)
        throw new Error('Duplicate token identifiers in batch.');
      return m.positions.map((p) => move(m.sceneId, p.tokenId, p.position));
    case 'TOKEN_UPDATE':
      return update(m.sceneId, [m.token]);
    case 'TOKENS_UPDATE':
      return update(m.sceneId, m.tokens);
    case 'TOKENS_DELETE':
      gm();
      scene(m.sceneId);
      return m.ids.map((tokenId) => ({ kind: 'token-delete', sceneId: m.sceneId, tokenId }));
    case 'TOKEN_DELETE':
      gm();
      scene(m.sceneId);
      return [{ kind: 'token-delete', sceneId: m.sceneId, tokenId: m.tokenId }];
    case 'SCENE_CONFIG': {
      gm();
      assertAsset(room, m.map);
      if (m.create && Object.keys(state.scenes).length >= 10)
        throw new Error('A campaign supports up to ten scenes.');
      if (m.create && state.scenes[m.sceneId]) throw new Error('Scene already exists.');
      const original = m.create
          ? {
              ...sampleScene(m.sceneId, m.name),
              tokens: {},
              zones: {},
              annotations: {},
              fog: { enabled: false, revealed: [] },
            }
          : scene(m.sceneId),
        tokens = Object.fromEntries(
          Object.entries(original.tokens).map(([id, t]) => {
            const size = Math.min(t.size, m.width, m.height);
            return [id, { ...t, size, ...clampPoint(t, m.width, m.height, size) }];
          }),
        );
      return [
        {
          kind: 'scene',
          scene: {
            ...original,
            name: m.name,
            map: m.map,
            width: m.width,
            height: m.height,
            tokens,
          },
        },
      ];
    }
    case 'SCENE_UPDATE': {
      gm();
      const parsed = sceneSchema.parse(m.scene),
        next = {
          ...parsed,
          tokens: Object.fromEntries(
            Object.entries(parsed.tokens).map(([id, t]) => {
              const size = Math.min(t.size, parsed.width, parsed.height);
              return [id, { ...t, size, ...clampPoint(t, parsed.width, parsed.height, size) }];
            }),
          ),
        };
      assertAsset(room, next.map);
      for (const t of Object.values(next.tokens)) assertAsset(room, t.image);
      if (
        Object.keys(next.tokens).length > 100 ||
        Object.keys(next.zones).length > 100 ||
        Object.keys(next.annotations || {}).length > 100
      )
        throw new Error('Scene limit exceeded.');
      for (const [key, t] of Object.entries(next.tokens))
        if (key !== t.id) throw new Error('Token identifiers must match their keys.');
      if (!state.scenes[next.id] && Object.keys(state.scenes).length >= 10)
        throw new Error('A campaign supports up to ten scenes.');
      return [{ kind: 'scene', scene: next }];
    }
    case 'GRID_UPDATE':
      gm();
      scene(m.sceneId);
      return [{ kind: 'grid', sceneId: m.sceneId, grid: m.grid }];
    case 'SCENE_CHANGE':
      gm();
      scene(m.sceneId);
      return [{ kind: 'scene-active', sceneId: m.sceneId }];
    case 'FOG_UPDATE':
      gm();
      return [{ kind: 'scene', scene: { ...scene(m.sceneId), fog: m.fog } }];
    case 'FOG_APPEND': {
      gm();
      const s = scene(m.sceneId),
        operations = s.fog.operations || [];
      if (operations.length >= 500)
        throw new Error('Fog mask is full. Reset it or undo recent strokes.');
      return [{ kind: 'fog-operation', sceneId: s.id, operation: m.operation }];
    }
    case 'ZONE_UPDATE': {
      gm();
      const s = scene(m.sceneId);
      if (!s.zones[m.zone.id] && Object.keys(s.zones).length >= 100)
        throw new Error('Zone limit reached.');
      if (
        ['polygon', 'cone', 'line'].includes(m.zone.shape) &&
        (!m.zone.points || m.zone.points.length < (m.zone.shape === 'line' ? 2 : 3))
      )
        throw new Error('Zone geometry is incomplete.');
      return [{ kind: 'zone', sceneId: s.id, zone: m.zone }];
    }
    case 'ZONE_DELETE':
      gm();
      scene(m.sceneId);
      return [{ kind: 'zone-delete', sceneId: m.sceneId, id: m.id }];
    case 'ANNOTATION_UPDATE': {
      gm();
      const s = scene(m.sceneId);
      if (!s.annotations?.[m.annotation.id] && Object.keys(s.annotations || {}).length >= 100)
        throw new Error('Drawing limit reached.');
      return [{ kind: 'annotation', sceneId: s.id, annotation: m.annotation }];
    }
    case 'ANNOTATION_DELETE':
      gm();
      scene(m.sceneId);
      return [{ kind: 'annotation-delete', sceneId: m.sceneId, id: m.id }];
    case 'LIBRARY_SAVE':
      gm();
      assertAsset(room, m.token.image);
      if (!state.tokenLibrary?.[m.token.id] && Object.keys(state.tokenLibrary || {}).length >= 100)
        throw new Error('Library limit reached.');
      return [{ kind: 'library', id: m.token.id, token: m.token }];
    case 'LIBRARY_DELETE':
      gm();
      return [{ kind: 'library', id: m.id, token: null }];
    case 'TRACKER_UPDATE': {
      gm();
      const tracker = { ...m.tracker, entries: [...m.tracker.entries] };
      if (new Set(tracker.entries.map((e) => e.id)).size !== tracker.entries.length)
        throw new Error('Duplicate tracker participants.');
      if (tracker.activeId && !tracker.entries.some((e) => e.id === tracker.activeId))
        throw new Error('Choose an existing participant.');
      if (tracker.order !== 'manual')
        tracker.entries.sort((a, b) =>
          tracker.order === 'descending' ? b.value - a.value : a.value - b.value,
        );
      return [{ kind: 'tracker', tracker }];
    }
    case 'TRACKER_ADVANCE': {
      gm();
      const tracker = state.tracker || emptyTracker(),
        entries = tracker.entries;
      if (!entries.length) throw new Error('Add a participant first.');
      const index = entries.findIndex((e) => e.id === tracker.activeId),
        next = index < 0 ? 0 : (index + m.direction + entries.length) % entries.length;
      const round = Math.min(
        10000,
        Math.max(
          1,
          tracker.round +
            (index >= 0 && m.direction === 1 && next === 0
              ? 1
              : index === 0 && m.direction === -1
                ? -1
                : 0),
        ),
      );
      return [{ kind: 'tracker', tracker: { ...tracker, activeId: entries[next].id, round } }];
    }
    case 'DICE_ROLL_REQUEST':
      return [
        {
          kind: 'roll',
          roll: {
            ...evaluateDice(m.expression, randomInt),
            id: randomUUID(),
            actionId: m.actionId,
            userId: user.id,
            userName: user.name,
            expression: m.expression,
            visibility: m.visibility,
            createdAt: new Date().toISOString(),
          },
        },
      ];
    case 'CHAT_SEND':
      return [
        {
          kind: 'chat',
          chat: {
            id: randomUUID(),
            userId: user.id,
            userName: user.name,
            text: m.text,
            createdAt: new Date().toISOString(),
          },
        },
      ];
    default:
      throw new Error('Unsupported state action.');
  }
}
