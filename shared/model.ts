import { z } from 'zod';
import type { Macro, MacroResult } from './macros.js';
import { characterVisible, type CharacterSheet, type CharacterUse } from './characters.js';

export const VERSION = 2 as const;
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
  measurement: z.enum(['real', 'grid']).optional(),
});
export type Grid = z.infer<typeof gridSchema>;
export const tokenSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(48),
  image: assetSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  size: z.number().min(24).max(240),
  rotation: z.number().min(-360).max(360),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  owners: z.array(z.string().max(64)).max(10),
  visibility: z.enum(['public', 'gm']),
  characterId: idSchema.nullable().optional(),
  resource: z
    .object({
      label: z.string().max(16),
      value: z.number().min(0).max(10000),
      max: z.number().min(1).max(10000),
    })
    .optional(),
  note: z.string().max(2000).optional(),
  groupId: idSchema.optional(),
  statuses: z
    .array(
      z.object({
        id: idSchema,
        label: z.string().min(1).max(24),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        icon: z.enum(['star', 'shield', 'flame', 'eye', 'circle']),
      }),
    )
    .max(8)
    .optional(),
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
});
export type Zone = z.infer<typeof zoneSchema>;
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
  map: assetSchema,
  width: z.number().min(200).max(10000),
  height: z.number().min(200).max(10000),
  grid: gridSchema,
  tokens: z.record(idSchema, tokenSchema),
  zones: z.record(idSchema, zoneSchema),
  fog: fogSchema,
  annotations: z.record(idSchema, annotationSchema).optional(),
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
export interface Chat {
  id: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
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
  chat: Chat[];
  savedAt: string | null;
  tokenLibrary?: Record<string, Token>;
  tracker?: Tracker;
  assets?: Record<string, UploadedAsset>;
  macros?: Record<string, Macro>;
  characters?: Record<string, CharacterSheet>;
}
/** Server-only fields are NEVER included in ROOM_SNAPSHOT. */
export interface DurableRoom {
  /** Server-only snapshot CAS counter; independent of gameplay revision. */
  saveVersion?: number;
  /** Private, durable Storage cleanup intents, never included in room projections. */
  assetCleanup?: Record<string, { after: string }>;
  state: RoomState;
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
  | { kind: 'scene-active'; sceneId: string }
  | { kind: 'roll'; roll: Roll }
  | { kind: 'chat'; chat: Chat };
export type TableChange =
  | { kind: 'fog-operation'; sceneId: string; operation: FogOperation }
  | { kind: 'grid'; sceneId: string; grid: Grid }
  | { kind: 'fog'; sceneId: string; fog: Scene['fog'] }
  | { kind: 'zone'; sceneId: string; zone: Zone }
  | { kind: 'zone-delete'; sceneId: string; id: string }
  | { kind: 'annotation'; sceneId: string; annotation: Annotation }
  | { kind: 'annotation-delete'; sceneId: string; id: string }
  | { kind: 'library'; id: string; token: Token | null }
  | { kind: 'tracker'; tracker: Tracker }
  | { kind: 'scene-delete'; sceneId: string }
  | { kind: 'assets'; assets: Record<string, UploadedAsset> };
export type MacroChange = { kind: 'macro'; id: string; macro: Macro | null };
export type StateChange =
  | Change
  | TableChange
  | MacroChange
  | { kind: 'character'; id: string; character: CharacterSheet | null };

export function canControl(token: Token, userId: string, role: 'gm' | 'player') {
  return (
    role === 'gm' ||
    (token.visibility === 'public' && (token.owners.includes(userId) || token.owners.includes('*')))
  );
}
export function tokenVisible(token: Token, scene: Scene, role: 'gm' | 'player'): boolean {
  if (role === 'gm') return true;
  if (token.visibility === 'gm') return false;
  return !scene.fog.enabled || fogAllowsToken(scene.fog, token);
}
export function projectScene(scene: Scene, role: 'gm' | 'player'): Scene {
  return {
    ...scene,
    tokens: Object.fromEntries(
      Object.entries(scene.tokens)
        .filter(([, t]) => tokenVisible(t, scene, role))
        .map(([id, t]) => [id, role === 'gm' ? t : { ...t, note: undefined }]),
    ),
    annotations: Object.fromEntries(
      Object.entries(scene.annotations || {}).filter(
        ([, a]) => role === 'gm' || a.visibility === 'public',
      ),
    ),
  };
}
export function projectRoom(
  room: DurableRoom,
  userId: string,
  role = room.members[userId]?.role || 'player',
): RoomState {
  return {
    ...room.state,
    scenes: Object.fromEntries(
      Object.entries(room.state.scenes).map(([id, s]) => [id, projectScene(s, role)]),
    ),
    rolls: room.state.rolls.filter(
      (r) => r.visibility === 'public' || r.userId === userId || role === 'gm',
    ),
    tokenLibrary: Object.fromEntries(
      Object.entries(room.state.tokenLibrary || {})
        .filter(([, t]) => role === 'gm' || t.visibility === 'public')
        .map(([id, t]) => [id, role === 'gm' ? t : { ...t, note: undefined }]),
    ),
    tracker: projectTracker(room.state.tracker || emptyTracker(), role, room.state),
    assets: projectAssets(room.state, role === 'gm', role),
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
): Tracker {
  const scene = state?.scenes[state.activeSceneId];
  const entries = tracker.entries.filter(
    (e) =>
      role === 'gm' ||
      (!e.hidden &&
        (!e.tokenId ||
          (!!scene?.tokens[e.tokenId] && tokenVisible(scene.tokens[e.tokenId], scene, role)))),
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
export function projectAssets(state: RoomState, gm: boolean, role: 'gm' | 'player') {
  if (gm) return state.assets || {};
  const ids = new Set<string>();
  const add = (a: Asset) => {
    if (a.kind === 'uploaded') ids.add(a.url);
  };
  for (const scene of Object.values(state.scenes)) {
    add(scene.map);
    for (const t of Object.values(scene.tokens)) if (tokenVisible(t, scene, role)) add(t.image);
  }
  for (const t of Object.values(state.tokenLibrary || {}))
    if (t.visibility === 'public') add(t.image);
  return Object.fromEntries(Object.entries(state.assets || {}).filter(([id]) => ids.has(id)));
}
import { fogAllowsToken } from './regions.js';
