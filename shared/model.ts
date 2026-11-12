import { z } from 'zod';
import type { Macro, MacroResult } from './macros.js';
import { characterVisible, type CharacterSheet, type CharacterUse } from './characters.js';
import { sha256 } from './macroDigest.js';

export const VERSION = 7 as const;
export const idSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/)
  .refine((id) => !['__proto__', 'prototype', 'constructor'].includes(id));
export const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export type Point = z.infer<typeof pointSchema>;
export const assetSchema = z.object({
  kind: z.enum(['builtin', 'external', 'uploaded']),
  url: z.string().max(2048),
});
export type Asset = z.infer<typeof assetSchema>;
export const gridSchema = z.object({
  size: z.number().min(16).max(200),
  opacity: z.number().min(0).max(1),
  enabled: z.boolean(),
  snap: z.boolean(),
  offsetX: z.number().min(-200).max(200),
  offsetY: z.number().min(-200).max(200),
  units: z.string().min(1).max(12),
  distance: z.number().positive().max(1000),
  type: z.enum(['square', 'hex']).optional(),
  measurement: z.enum(['real', 'grid', 'alternating']).optional(),
});
export type Grid = z.infer<typeof gridSchema>;
export const effectDurationSchema = z.object({
  remaining: z.number().int().min(1).max(10000),
  participantId: idSchema,
  phase: z.enum(['start', 'end']),
});
export const tokenStatusSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(24),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.enum(['star', 'shield', 'flame', 'eye', 'circle']),
  note: z.string().max(120).optional(),
  counter: z.number().int().min(-10000).max(10000).optional(),
  duration: effectDurationSchema.optional(),
});
export type TokenStatus = z.infer<typeof tokenStatusSchema>;
export const statusDigest = (status: TokenStatus) =>
  sha256(JSON.stringify(tokenStatusSchema.parse(status)));
export const REDACTED_TURN_ID = 'hidden-turn';
export function publicToken(token: Token): Token {
  return {
    ...token,
    note: undefined,
    encounterId: undefined,
    encounterTokenId: undefined,
    encounterPlacementId: undefined,
    proximity: undefined,
    sight: token.sight?.showToPlayers ? token.sight : undefined,
    statuses: token.statuses?.map((status) => ({
      ...status,
      duration: status.duration && { ...status.duration, participantId: REDACTED_TURN_ID },
    })),
  };
}
export function publicZone(zone: Zone): Zone {
  return {
    ...zone,
    anchorTokenId: undefined,
    proximity: undefined,
    duration: zone.duration && { ...zone.duration, participantId: REDACTED_TURN_ID },
  };
}
export const statusPresetSchema = tokenStatusSchema.omit({ duration: true });
export type StatusPreset = z.infer<typeof statusPresetSchema>;
export const transitionSchema = z.object({
  style: z.enum(['chapter', 'fade', 'curtain', 'flash', 'none']),
  title: z.string().max(80),
  subtitle: z.string().max(100),
  duration: z.number().int().min(500).max(6000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type SceneTransition = z.infer<typeof transitionSchema>;
export const proximitySchema = z.object({
  distance: z.number().min(0).max(5000),
  when: z.enum(['enter', 'leave', 'both']),
  playerMessage: z.string().max(160).optional(),
});
export type ProximityRule = z.infer<typeof proximitySchema>;
export const pinSchema = z.object({
  id: idSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  label: z.string().min(1).max(60),
  description: z.string().max(1000),
  gmNote: z.string().max(1000).optional(),
  visibility: z.enum(['public', 'gm']),
  destinationSceneId: idSchema.optional(),
  proximity: proximitySchema.optional(),
});
export type ScenePin = z.infer<typeof pinSchema>;
export const wallSchema = z
  .object({
    id: idSchema,
    a: pointSchema,
    b: pointSchema,
    kind: z.enum(['wall', 'door', 'window']),
    open: z.boolean().optional(),
  })
  .refine((w) => w.a.x !== w.b.x || w.a.y !== w.b.y, 'Wall must have length.');
export type Wall = z.infer<typeof wallSchema>;
export const sightSchema = z.object({
  range: z.number().min(0).max(10000),
  angle: z.number().min(1).max(360),
  showCone: z.boolean().optional(),
  showToPlayers: z.boolean().optional(),
});
export const lightSchema = z.object({
  radius: z.number().min(0).max(5000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  intensity: z.number().min(0).max(1),
  angle: z.number().min(1).max(360).optional(),
  direction: z.number().min(-360).max(360).optional(),
  effects: z
    .object({
      hueShift: z.boolean().optional(),
      onOff: z.boolean().optional(),
      dimming: z.boolean().optional(),
      minBrightness: z.number().min(0.05).max(1).optional(),
      speed: z.number().min(0.25).max(3).optional(),
      jitter: z.number().min(0).max(1).optional(),
      jitterHz: z.number().min(0).max(3).optional(),
      onOffHz: z.number().min(0.01).max(3).optional(),
      dimmingHz: z.number().min(0.01).max(3).optional(),
      hueHz: z.number().min(0.01).max(3).optional(),
    })
    .optional(),
});
export const projectedLightSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().min(-360).max(360),
  light: lightSchema,
});
export type ProjectedLight = z.infer<typeof projectedLightSchema>;
export function projectedLightId(sceneId: string, tokenId: string) {
  return sha256(`${sceneId}/${tokenId}`);
}
export function projectedLight(token: Token): ProjectedLight | undefined {
  return token.visibility === 'public' && token.light
    ? { x: token.x, y: token.y, rotation: token.rotation, light: token.light }
    : undefined;
}
export const lightingSchema = z.object({ vision: z.boolean(), darkness: z.number().min(0).max(1) });
export const pinDigest = (pin: ScenePin) => sha256(JSON.stringify(pinSchema.parse(pin)));
export const tokenSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(48),
  hideLabel: z.boolean().optional(),
  image: assetSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  size: z.number().min(24).max(240),
  rotation: z.number().min(-360).max(360),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  owners: z.array(z.string().max(64)).max(10),
  visibility: z.enum(['public', 'gm']),
  characterId: idSchema.nullable().optional(),
  resourceId: idSchema.nullable().optional(),
  encounterId: idSchema.optional(),
  encounterTokenId: idSchema.optional(),
  encounterPlacementId: idSchema.optional(),
  proximity: proximitySchema.optional(),
  sight: sightSchema.optional(),
  sharedVisionSource: z.boolean().optional(),
  light: lightSchema.optional(),
  resource: z
    .object({
      label: z.string().max(16),
      value: z.number().min(-10000).max(10000),
      max: z.number().min(1).max(10000),
      min: z.number().min(-10000).max(0).optional(),
    })
    .superRefine((r, ctx) => {
      if (r.value < (r.min ?? 0) || r.value > r.max)
        ctx.addIssue({
          code: 'custom',
          message: 'Resource value must be between minimum and maximum.',
        });
    })
    .optional(),
  note: z.string().max(2000).optional(),
  groupId: idSchema.optional(),
  statuses: z.array(tokenStatusSchema).max(16).optional(),
});
export type Token = z.infer<typeof tokenSchema>;
export const zoneSchema = z.object({
  id: idSchema,
  shape: z.enum(['circle', 'rectangle', 'polygon', 'line', 'cone']),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().min(1).max(5000),
  height: z.number().min(1).max(5000),
  label: z.string().max(48),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  points: z.array(pointSchema).min(2).max(100).optional(),
  opacity: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().max(24)).max(10).optional(),
  note: z.string().max(120).optional(),
  duration: effectDurationSchema.optional(),
  visibility: z.enum(['public', 'gm']).optional(),
  anchorTokenId: idSchema.optional(),
  proximity: proximitySchema.optional(),
});
export type Zone = z.infer<typeof zoneSchema>;
export const zoneDigest = (zone: Zone) => sha256(JSON.stringify(zoneSchema.parse(zone)));
export const fogOperationSchema = z
  .object({
    id: idSchema,
    mode: z.enum(['reveal', 'conceal']),
    shape: z.enum(['circle', 'rectangle', 'polygon']),
    x: z.number().finite(),
    y: z.number().finite(),
    radius: z.number().min(1).max(2000).optional(),
    width: z.number().min(1).max(10000).optional(),
    height: z.number().min(1).max(10000).optional(),
    points: z.array(pointSchema).min(3).max(100).optional(),
  })
  .superRefine((s, ctx) => {
    if (
      (s.shape === 'circle' && !s.radius) ||
      (s.shape === 'rectangle' && (!s.width || !s.height)) ||
      (s.shape === 'polygon' && !s.points)
    )
      ctx.addIssue({ code: 'custom', message: 'Fog geometry is incomplete.' });
  });
export type FogOperation = z.infer<typeof fogOperationSchema>;
export const annotationSchema = z.object({
  id: idSchema,
  kind: z.enum(['stroke', 'text']),
  points: z.array(pointSchema).min(1).max(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.number().min(1).max(40),
  text: z.string().max(300),
  visibility: z.enum(['public', 'gm']),
});
export type Annotation = z.infer<typeof annotationSchema>;
export const trackerSchema = z.object({
  entries: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().min(1).max(48),
        value: z.number().finite().min(-10000).max(10000),
        hidden: z.boolean(),
        tokenId: idSchema.optional(),
        encounterEntryId: idSchema.optional(),
        encounterPlacementId: idSchema.optional(),
      }),
    )
    .max(50),
  activeId: idSchema.nullable(),
  round: z.number().int().min(1).max(10000),
  order: z.enum(['manual', 'ascending', 'descending']),
});
export type Tracker = z.infer<typeof trackerSchema> & { nextId?: string | null };
export const emptyTracker = (): Tracker => ({
  entries: [],
  activeId: null,
  round: 1,
  order: 'manual',
});
export interface Encounter {
  id: string;
  name: string;
  tokens: Token[];
  entries: Tracker['entries'];
  characters?: Record<string, CharacterSheet>;
}
export const encounterDigest = (encounter: Encounter) => sha256(JSON.stringify(encounter));
export interface UploadedAsset {
  id: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: string;
  createdBy: string;
}
export const fogSchema = z.object({
  enabled: z.boolean(),
  operations: z.array(fogOperationSchema).max(500).optional(),
  revealed: z
    .array(
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        radius: z.number().min(1).max(2000),
      }),
    )
    .max(500),
});
export const sceneSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(60),
  visibility: z.enum(['public', 'gm']).optional(),
  map: assetSchema,
  width: z.number().min(200).max(10000),
  height: z.number().min(200).max(10000),
  grid: gridSchema,
  tokens: z.record(idSchema, tokenSchema),
  zones: z.record(idSchema, zoneSchema),
  fog: fogSchema,
  annotations: z.record(idSchema, annotationSchema).optional(),
  pins: z.record(idSchema, pinSchema).optional(),
  walls: z.record(idSchema, wallSchema).optional(),
  lighting: lightingSchema.optional(),
  lightSources: z.record(idSchema, projectedLightSchema).optional(),
});
export type Scene = z.infer<typeof sceneSchema>;
export interface RollTerm {
  kind: 'dice' | 'modifier';
  sign: 1 | -1;
  sides?: number;
  values: number[];
  /** Final faces remain in roll order, including discarded dice. */
  kept?: boolean[];
  /** Previous faces for each die, before its final value. */
  rerolls?: number[][];
  /** Marks extra faces generated by exploding dice. */
  explosions?: boolean[];
  label: string;
  subtotal: number;
}
export interface Roll {
  id: string;
  actionId: string;
  userId: string;
  userName: string;
  expression: string;
  terms: RollTerm[];
  total: number;
  visibility: 'public' | 'private';
  createdAt: string;
  macro?: MacroResult;
  character?: CharacterUse;
}
export interface Presence {
  id: string;
  name: string;
  role: 'gm' | 'player';
  color: string;
}
export interface RoomState {
  version: 1;
  id: string;
  name: string;
  revision: number;
  activeSceneId: string;
  scenes: Record<string, Scene>;
  rolls: Roll[];
  savedAt: string | null;
  tokenLibrary?: Record<string, Token>;
  tracker?: Tracker;
  assets?: Record<string, UploadedAsset>;
  macros?: Record<string, Macro>;
  characters?: Record<string, CharacterSheet>;
  statusPresets?: Record<string, StatusPreset>;
  encounters?: Record<string, Encounter>;
}
/** Server-only fields are NEVER included in ROOM_SNAPSHOT. */
export interface DurableRoom {
  /** Server-only snapshot CAS counter; independent of gameplay revision. */
  saveVersion?: number;
  /** Private, durable Storage cleanup intents, never included in room projections. */
  assetCleanup?: Record<string, { after: string }>;
  state: RoomState & {
    /** Retained only in pre-removal snapshots; never projected to clients. */
    chat?: unknown[];
  };
  ownerId: string;
  inviteCode: string;
  members: Record<string, { name: string; role: 'gm' | 'player' }>;
  revokedMembers?: string[];
  revokedMemberNames?: Record<string, string>;
  discord?: { url: string; enabled: boolean; mode: 'automatic' | 'manual' };
}
export type Change =
  | { kind: 'token'; sceneId: string; token: Token }
  | { kind: 'token-delete'; sceneId: string; tokenId: string }
  | { kind: 'scene'; scene: Scene }
  | { kind: 'scene-active'; sceneId: string; transition?: SceneTransition }
  | { kind: 'roll'; roll: Roll };
export type TableChange =
  | { kind: 'fog-operation'; sceneId: string; operation: FogOperation }
  | { kind: 'grid'; sceneId: string; grid: Grid }
  | { kind: 'fog'; sceneId: string; fog: Scene['fog'] }
  | { kind: 'zone'; sceneId: string; zone: Zone }
  | { kind: 'zone-delete'; sceneId: string; id: string }
  | { kind: 'annotation'; sceneId: string; annotation: Annotation }
  | { kind: 'annotation-delete'; sceneId: string; id: string }
  | { kind: 'pin'; sceneId: string; pin: ScenePin }
  | { kind: 'pin-delete'; sceneId: string; id: string }
  | { kind: 'wall'; sceneId: string; wall: Wall }
  | { kind: 'wall-delete'; sceneId: string; id: string }
  | { kind: 'lighting'; sceneId: string; lighting?: z.infer<typeof lightingSchema> }
  | { kind: 'light-source'; sceneId: string; id: string; source: ProjectedLight | null }
  | { kind: 'library'; id: string; token: Token | null }
  | { kind: 'tracker'; tracker: Tracker }
  | { kind: 'scene-delete'; sceneId: string }
  | { kind: 'assets'; assets: Record<string, UploadedAsset> };
export type MacroChange = { kind: 'macro'; id: string; macro: Macro | null };
export type StateChange =
  | Change
  | TableChange
  | MacroChange
  | { kind: 'status-preset'; id: string; preset: StatusPreset | null }
  | { kind: 'encounter'; id: string; encounter: Encounter | null }
  | { kind: 'character'; id: string; character: CharacterSheet | null };

export function canControl(token: Token, userId: string, role: 'gm' | 'player') {
  return (
    role === 'gm' ||
    (token.visibility === 'public' && (token.owners.includes(userId) || token.owners.includes('*')))
  );
}
export function tokenVisible(
  token: Token,
  scene: Scene,
  role: 'gm' | 'player',
  userId = '',
  playerIds: readonly string[] = [userId],
): boolean {
  if (role === 'gm') return true;
  if (token.visibility === 'gm') return false;
  return (
    (!scene.fog.enabled || fogAllowsToken(scene.fog, token)) &&
    visibleTo(scene, userId, token, playerIds)
  );
}
export function projectScene(
  scene: Scene,
  role: 'gm' | 'player',
  userId = '',
  playerIds: readonly string[] = [userId],
): Scene {
  return {
    ...scene,
    lightSources:
      role === 'gm'
        ? undefined
        : Object.fromEntries(
            Object.values(scene.tokens).flatMap((token) => {
              const source = projectedLight(token);
              return source ? [[projectedLightId(scene.id, token.id), source]] : [];
            }),
          ),
    zones: Object.fromEntries(
      Object.entries(scene.zones)
        .filter(([, z]) => role === 'gm' || z.visibility !== 'gm')
        .map(([id, z]) => [id, role === 'gm' ? z : publicZone(z)]),
    ),
    tokens: Object.fromEntries(
      Object.entries(scene.tokens)
        .filter(([, t]) => tokenVisible(t, scene, role, userId, playerIds))
        .map(([id, t]) => [
          id,
          role === 'gm'
            ? t
            : {
                ...publicToken(t),
                ...(scene.lighting?.vision
                  ? { sharedVisionSource: isSharedVisionSource(t, playerIds) }
                  : {}),
              },
        ]),
    ),
    annotations: Object.fromEntries(
      Object.entries(scene.annotations || {}).filter(
        ([, a]) => role === 'gm' || a.visibility === 'public',
      ),
    ),
    pins: Object.fromEntries(
      Object.entries(scene.pins || {})
        .filter(([, p]) => role === 'gm' || p.visibility === 'public')
        .map(([id, p]) => [
          id,
          role === 'gm'
            ? p
            : { ...p, gmNote: undefined, destinationSceneId: undefined, proximity: undefined },
        ]),
    ),
  };
}
export function projectRoom(
  room: DurableRoom,
  userId: string,
  role = room.members[userId]?.role || 'player',
): RoomState {
  const { chat: _legacyChat, ...state } = room.state;
  const playerIds = Object.entries(room.members)
    .filter(([, member]) => member.role === 'player')
    .map(([id]) => id);
  return {
    ...state,
    encounters: role === 'gm' ? state.encounters : undefined,
    scenes: Object.fromEntries(
      Object.entries(room.state.scenes)
        .filter(
          ([id, s]) => role === 'gm' || s.visibility !== 'gm' || id === room.state.activeSceneId,
        )
        .map(([id, s]) => [id, projectScene(s, role, userId, playerIds)]),
    ),
    rolls: room.state.rolls.filter(
      (r) => r.visibility === 'public' || r.userId === userId || role === 'gm',
    ),
    tokenLibrary: Object.fromEntries(
      Object.entries(room.state.tokenLibrary || {})
        .filter(([, t]) => role === 'gm' || t.visibility === 'public')
        .map(([id, t]) => [id, role === 'gm' ? t : publicToken(t)]),
    ),
    tracker: projectTracker(
      room.state.tracker || emptyTracker(),
      role,
      room.state,
      userId,
      playerIds,
    ),
    assets: projectAssets(room.state, role === 'gm', role, userId, playerIds),
    macros: Object.fromEntries(
      Object.entries(room.state.macros || {}).filter(([, m]) => macroVisible(m, userId, role)),
    ),
    characters: Object.fromEntries(
      Object.entries(room.state.characters || {}).filter(([, sheet]) =>
        characterVisible(sheet, userId, role),
      ),
    ),
  };
}
export function macroVisible(macro: Macro, userId: string, role: 'gm' | 'player') {
  return macro.visibility === 'public' || macro.ownerId === userId || role === 'gm';
}
/** Only the immediate visible successor is projected; hidden turns are never skipped in Up next. */
export function projectTracker(
  tracker: Tracker,
  role: 'gm' | 'player',
  state?: RoomState,
  userId = '',
  playerIds: readonly string[] = [userId],
): Tracker {
  const scene = state?.scenes[state.activeSceneId];
  const entries = tracker.entries
    .filter(
      (e) =>
        role === 'gm' ||
        (!e.hidden &&
          (!e.tokenId ||
            (!!scene?.tokens[e.tokenId] &&
              tokenVisible(scene.tokens[e.tokenId], scene, role, userId, playerIds)))),
    )
    .map((entry) =>
      role === 'gm'
        ? entry
        : { ...entry, encounterEntryId: undefined, encounterPlacementId: undefined },
    );
  const activeId = entries.some((e) => e.id === tracker.activeId) ? tracker.activeId : null;
  const index = tracker.entries.findIndex((e) => e.id === activeId);
  const next =
    index >= 0 && tracker.entries.length > 1
      ? tracker.entries[(index + 1) % tracker.entries.length]
      : undefined;
  return {
    ...tracker,
    entries,
    activeId,
    nextId: next && entries.some((e) => e.id === next.id) ? next.id : null,
  };
}
export function projectAssets(
  state: RoomState,
  gm: boolean,
  role: 'gm' | 'player',
  userId = '',
  playerIds: readonly string[] = [userId],
) {
  if (gm) return state.assets || {};
  const ids = new Set<string>();
  const add = (a: Asset) => {
    if (a.kind === 'uploaded') ids.add(a.url);
  };
  for (const scene of Object.values(state.scenes)) {
    if (scene.visibility === 'gm' && scene.id !== state.activeSceneId) continue;
    add(scene.map);
    for (const t of Object.values(scene.tokens))
      if (tokenVisible(t, scene, role, userId, playerIds)) add(t.image);
  }
  for (const t of Object.values(state.tokenLibrary || {}))
    if (t.visibility === 'public') add(t.image);
  return Object.fromEntries(Object.entries(state.assets || {}).filter(([id]) => ids.has(id)));
}
import { fogAllowsToken } from './regions.js';
import { isSharedVisionSource, visibleTo } from './vision.js';
