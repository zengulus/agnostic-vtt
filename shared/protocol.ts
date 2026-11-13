import { z } from 'zod';
import {
  fogSchema,
  handoutSchema,
  tableToolSchema,
  gridSchema,
  idSchema,
  pointSchema,
  sceneSchema,
  tokenSchema,
  VERSION,
  zoneSchema,
  fogOperationSchema,
  annotationSchema,
  trackerSchema,
  tokenStatusSchema,
  statusPresetSchema,
  transitionSchema,
  pinSchema,
  wallSchema,
  lightingSchema,
} from './model.js';
import type { StateChange, Point, Presence, Roll, RoomState } from './model.js';
import { tokenEditSchema } from './tokenEdits.js';
import { characterAbilitySchema, refreshSchema } from './characters.js';
export const MAX_CLIENT_MESSAGE_BYTES = 256 * 1024;
const base = { v: z.literal(VERSION), actionId: z.string().min(1).max(80) };
const sceneId = idSchema;
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('CHARACTER_IMPORT'),
    id: idSchema,
    text: z.string().min(1).max(65536),
    visibility: z.enum(['public', 'private']),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.object({
    ...base,
    type: z.literal('CHARACTER_DELETE'),
    id: idSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    ...base,
    type: z.literal('CHARACTER_ASSIGN'),
    id: idSchema,
    ownerId: z.string().min(1).max(64),
  }),
  z.object({
    ...base,
    type: z.literal('CHARACTER_RESOURCE_ADJUST'),
    id: idSchema,
    resourceId: idSchema,
    delta: z.number().int().min(-10000).max(10000),
  }),
  z.object({ ...base, type: z.literal('CHARACTER_REFRESH'), id: idSchema, refresh: refreshSchema }),
  z.object({
    ...base,
    type: z.literal('CHARACTER_ABILITY_SAVE'),
    id: idSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    ability: characterAbilitySchema,
  }),
  z.object({
    ...base,
    type: z.literal('CHARACTER_ABILITY_STATE'),
    id: idSchema,
    abilityId: idSchema,
    operation: z.enum(['prepare', 'unprepare', 'recover']),
  }),
  z.object({
    ...base,
    type: z.literal('CHARACTER_ABILITY_USE'),
    id: idSchema,
    abilityId: idSchema,
    variables: z.record(
      z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/),
      z.number().finite().min(-10000).max(10000),
    ),
    visibility: z.enum(['public', 'private']),
  }),
  z.object({
    ...base,
    type: z.literal('JOIN_ROOM'),
    roomId: z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/),
    token: z.string().min(1).max(4096),
    inviteCode: z.string().max(64).optional(),
    role: z.enum(['gm', 'player']).optional(),
  }),
  z.object({ ...base, type: z.literal('STATE_RESYNC') }),
  z.object({
    ...base,
    type: z.literal('MEASUREMENT_SHARE'),
    sceneId,
    mode: z.enum(['distance', 'path', 'radius', 'cone', 'area']),
    start: pointSchema,
    end: pointSchema,
    points: z.array(pointSchema).max(100),
  }),
  z.object({ ...base, type: z.literal('SESSION_ROLE'), role: z.enum(['gm', 'player']) }),
  z.object({
    ...base,
    type: z.literal('TOKEN_MOVE_PREVIEW'),
    sceneId,
    tokenId: idSchema,
    position: pointSchema,
  }),
  z.object({
    ...base,
    type: z.literal('TOKEN_MOVE_COMMIT'),
    sceneId,
    tokenId: idSchema,
    position: pointSchema,
  }),
  z.object({
    ...base,
    type: z.literal('TOKEN_ROTATE'),
    sceneId,
    tokenId: idSchema,
    delta: z.union([z.literal(45), z.literal(-45)]),
  }),
  z.object({
    ...base,
    type: z.literal('TOKEN_UPDATE'),
    sceneId,
    token: tokenSchema,
    createOnly: z.boolean().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('TOKEN_PATCH'),
    sceneId,
    tokenId: idSchema,
    edits: z.array(tokenEditSchema).min(1).max(19),
  }),
  z.object({
    ...base,
    type: z.literal('TOKEN_STATUS_SET'),
    sceneId,
    tokenId: idSchema,
    status: tokenStatusSchema,
    expected: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.object({
    ...base,
    type: z.literal('HANDOUT_SAVE'),
    handout: handoutSchema,
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.object({
    ...base,
    type: z.literal('HANDOUT_DELETE'),
    id: idSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    ...base,
    type: z.literal('TABLE_TOOL_SAVE'),
    tool: tableToolSchema,
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.object({ ...base, type: z.literal('TABLE_TOOL_DELETE'), id: idSchema }),
  z.object({
    ...base,
    type: z.literal('TABLE_TOOL_ADJUST'),
    id: idSchema,
    delta: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.object({ ...base, type: z.literal('HANDOUT_PRESENT'), id: idSchema }),
  z.object({ ...base, type: z.literal('TABLE_TOOL_ROLL'), id: idSchema }),
  z.object({ ...base, type: z.literal('STATUS_PRESET_SET'), preset: statusPresetSchema }),
  z.object({ ...base, type: z.literal('STATUS_PRESET_DELETE'), id: idSchema }),
  z.object({
    ...base,
    type: z.literal('TOKEN_STATUS_REMOVE'),
    sceneId,
    tokenId: idSchema,
    statusId: idSchema,
  }),
  z.object({
    ...base,
    type: z.literal('TOKEN_RESOURCE_ADJUST'),
    sceneId,
    tokenId: idSchema,
    delta: z.number().finite().min(-10000).max(10000),
    expected: z
      .object({
        characterId: idSchema.nullable(),
        resourceId: idSchema.nullable(),
        label: z.string().max(16).nullable(),
      })
      .optional(),
  }),
  z.object({
    ...base,
    type: z.literal('TOKEN_BATCH_ACTION'),
    sceneId,
    tokenIds: z.array(idSchema).min(1).max(50),
    operation: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('add-status'), status: tokenStatusSchema }),
      z.object({ kind: z.literal('remove-status'), label: z.string().trim().min(1).max(24) }),
      z.object({
        kind: z.literal('adjust-resource'),
        delta: z.number().int().min(-10000).max(10000),
      }),
    ]),
  }),
  z.object({ ...base, type: z.literal('TOKEN_DELETE'), sceneId, tokenId: idSchema }),
  z.object({ ...base, type: z.literal('SCENE_UPDATE'), scene: sceneSchema }),
  z.object({
    ...base,
    type: z.literal('SCENE_CONFIG'),
    sceneId,
    name: z.string().min(1).max(60),
    map: sceneSchema.shape.map,
    width: sceneSchema.shape.width,
    height: sceneSchema.shape.height,
    create: z.boolean(),
    visibility: z.enum(['public', 'gm']).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('SCENE_VISIBILITY'),
    sceneId,
    visibility: z.enum(['public', 'gm']),
  }),
  z.object({
    ...base,
    type: z.literal('PIN_SET'),
    sceneId,
    pin: pinSchema,
    expected: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.object({ ...base, type: z.literal('PIN_DELETE'), sceneId, id: idSchema }),
  z.object({ ...base, type: z.literal('GRID_UPDATE'), sceneId, grid: gridSchema }),
  z.object({ ...base, type: z.literal('WALL_SET'), sceneId, wall: wallSchema }),
  z.object({ ...base, type: z.literal('WALL_DELETE'), sceneId, id: idSchema }),
  z.object({
    ...base,
    type: z.literal('LIGHTING_SET'),
    sceneId,
    lighting: lightingSchema,
    expected: lightingSchema.nullable().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('SCENE_CHANGE'),
    sceneId,
    transition: transitionSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('DICE_ROLL_REQUEST'),
    expression: z.string().min(1).max(120),
    visibility: z.enum(['public', 'private']),
  }),
  z.object({
    ...base,
    type: z.literal('STAT_ROLL_REQUEST'),
    characterIds: z.array(idSchema).min(1).max(20),
    stat: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/),
    expression: z.string().min(1).max(80),
    modifier: z.number().finite().min(-10000).max(10000),
    visibility: z.enum(['public', 'private']),
  }),
  z.object({ ...base, type: z.literal('PING'), position: pointSchema }),
  z.object({ ...base, type: z.literal('DRAMATIC_CUE'), text: z.string().trim().min(1).max(80) }),
  z.object({
    ...base,
    type: z.literal('BOSS_SET'),
    sceneId,
    tokenId: idSchema,
    boss: z
      .object({ title: z.string().trim().min(1).max(80), phase: z.string().max(48) })
      .nullable(),
  }),
  z.object({
    ...base,
    type: z.literal('DEFEAT_SELECTED'),
    sceneId,
    tokenIds: z.array(idSchema).min(1).max(50),
  }),
  z.object({ ...base, type: z.literal('FOG_UPDATE'), sceneId, fog: fogSchema }),
  z.object({
    ...base,
    type: z.literal('ZONE_UPDATE'),
    sceneId,
    zone: zoneSchema,
    expected: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.object({ ...base, type: z.literal('ZONE_DELETE'), sceneId, id: idSchema }),
  z.object({
    ...base,
    type: z.literal('FOG_APPEND'),
    sceneId,
    operation: fogOperationSchema,
    groupId: idSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('ANNOTATION_UPDATE'),
    sceneId,
    annotation: annotationSchema,
  }),
  z.object({ ...base, type: z.literal('ANNOTATION_DELETE'), sceneId, id: idSchema }),
  z.object({
    ...base,
    type: z.literal('ANNOTATIONS_DELETE'),
    sceneId,
    ids: z.array(idSchema).min(1).max(100),
  }),
  z.object({
    ...base,
    type: z.literal('OBJECTS_DELETE'),
    sceneId,
    annotationIds: z.array(idSchema).max(100),
    zoneIds: z.array(idSchema).max(100),
  }),
  z.object({ ...base, type: z.literal('LIBRARY_SAVE'), token: tokenSchema }),
  z.object({ ...base, type: z.literal('LIBRARY_DELETE'), id: idSchema }),
  z.object({
    ...base,
    type: z.literal('ENCOUNTER_SAVE'),
    id: idSchema,
    name: z.string().trim().min(1).max(64),
    sceneId,
    tokenIds: z.array(idSchema).min(1).max(50),
  }),
  z.object({
    ...base,
    type: z.literal('ENCOUNTER_PLACE'),
    id: idSchema,
    sceneId,
    independent: z.boolean().optional(),
  }),
  z.object({ ...base, type: z.literal('ENCOUNTER_DELETE'), id: idSchema }),
  z.object({
    ...base,
    type: z.literal('ENCOUNTER_REPAIR'),
    id: idSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    from: idSchema,
    to: idSchema.nullable(),
  }),
  z.object({
    ...base,
    type: z.literal('ENCOUNTER_REFRESH'),
    id: idSchema,
    sceneId,
    placementId: idSchema,
  }),
  z.object({ ...base, type: z.literal('TRACKER_UPDATE'), tracker: trackerSchema }),
  z.object({
    ...base,
    type: z.literal('TRACKER_ADVANCE'),
    direction: z.union([z.literal(1), z.literal(-1)]),
  }),
  z.object({ ...base, type: z.literal('UNDO') }),
  z.object({ ...base, type: z.literal('REDO') }),
  z.object({
    ...base,
    type: z.literal('TOKEN_MOVE_BATCH'),
    sceneId,
    positions: z
      .array(z.object({ tokenId: idSchema, position: pointSchema }))
      .min(1)
      .max(50),
  }),
  z.object({
    ...base,
    type: z.literal('TOKEN_MOVE_PREVIEW_BATCH'),
    sceneId,
    positions: z
      .array(z.object({ tokenId: idSchema, position: pointSchema }))
      .min(1)
      .max(50),
  }),
  z.object({
    ...base,
    type: z.literal('TOKENS_DELETE'),
    sceneId,
    ids: z.array(idSchema).min(1).max(50),
  }),
  z.object({
    ...base,
    type: z.literal('TOKENS_UPDATE'),
    sceneId,
    tokens: z.array(tokenSchema).min(1).max(50),
  }),
  z.object({
    ...base,
    type: z.literal('MEMBER_UPDATE'),
    userId: z.string().uuid(),
    role: z.enum(['gm', 'player', 'remove']),
  }),
  z.object({ ...base, type: z.literal('MEMBER_RESTORE'), userId: z.string().uuid() }),
  z.object({ ...base, type: z.literal('INVITE_ROTATE') }),
  z.object({
    ...base,
    type: z.literal('MACRO_IMPORT'),
    replacements: z
      .array(
        z.object({
          line: z.number().int().min(1),
          id: idSchema,
          digest: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .max(100)
      .optional(),
    text: z.string().min(1).max(65536),
    visibility: z.enum(['public', 'private']),
  }),
  z.object({ ...base, type: z.literal('MACRO_DELETE'), id: idSchema }),
  z.object({
    ...base,
    type: z.literal('MACRO_ROLL_REQUEST'),
    id: idSchema,
    variables: z.record(
      z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/),
      z.number().finite().min(-10000).max(10000),
    ),
    visibility: z.enum(['public', 'private']),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type Action = ClientMessage extends infer T
  ? T extends { v: 7; actionId: string }
    ? Omit<T, 'v' | 'actionId'>
    : never
  : never;
/** Measure the actual UTF-8 JSON frame, including escaped text and replacement guards. */
export function serializeClientAction(action: Action, actionId: string): string {
  const payload = JSON.stringify({ ...action, v: 7, actionId });
  if (new TextEncoder().encode(payload).byteLength > MAX_CLIENT_MESSAGE_BYTES)
    throw new Error(
      action.type === 'MACRO_IMPORT'
        ? 'This macro import is too large to send. Import fewer definitions at a time.'
        : 'This action is too large to send. Save smaller groups of changes.',
    );
  return payload;
}
export type ServerMessage =
  | ExtraServerMessage
  | {
      v: 7;
      type: 'ROOM_SNAPSHOT';
      state: RoomState;
      self: Presence;
      presence: Presence[];
      inviteCode?: string;
      canGM?: boolean;
      savedRevision?: number;
      savePending?: boolean;
    }
  | { v: 7; type: 'STATE_PATCH'; revision: number; actionId: string; changes: StateChange[] }
  | { v: 7; type: 'PRESENCE_UPDATE'; presence: Presence[] }
  | {
      v: 7;
      type: 'TOKEN_MOVE_PREVIEW';
      sceneId: string;
      tokenId: string;
      position: Point;
      userId: string;
    }
  | {
      v: 7;
      type: 'MEASUREMENT_SHARE';
      sceneId: string;
      mode: 'distance' | 'path' | 'radius' | 'cone' | 'area';
      start: Point;
      end: Point;
      points: Point[];
      userId: string;
    }
  | { v: 7; type: 'DICE_ROLL_RESULT'; roll: Roll }
  | { v: 7; type: 'DRAMATIC_CUE'; text: string }
  | { v: 7; type: 'PING'; position: Point; userId: string; sceneId?: string; attention?: boolean }
  | { v: 7; type: 'HANDOUT_PRESENT'; handout: import('./model.js').Handout }
  | { v: 7; type: 'TABLE_TOOL_RESULT'; name: string; result: string }
  | { v: 7; type: 'PROXIMITY_CUE'; message: string }
  | { v: 7; type: 'SAVED'; savedAt: string; revision: number; pending?: boolean }
  | { v: 7; type: 'ERROR'; message: string; actionId?: string };
export type HistoryStatus = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
};
export type ExtraServerMessage =
  | { v: 7; type: 'DISCORD_STATUS'; discord: DiscordStatus }
  | {
      v: 7;
      type: 'DISCORD_DELIVERY';
      rollId: string;
      status: 'queued' | 'sent' | 'failed';
      message: string;
    }
  | { v: 7; type: 'HISTORY_STATUS'; history: HistoryStatus }
  | {
      v: 7;
      type: 'MEMBERS_UPDATE';
      members: Array<Presence>;
      ownerId: string;
      removedMembers?: Array<{ id: string; name: string }>;
    }
  | { v: 7; type: 'REVOKED'; message: string }
  | {
      v: 7;
      type: 'TOKEN_MOVE_PREVIEW_BATCH';
      sceneId: string;
      positions: Array<{ tokenId: string; position: Point }>;
      userId: string;
    };
export interface DiscordStatus {
  configured: boolean;
  enabled: boolean;
  mode: 'automatic' | 'manual';
  canManage: boolean;
}
