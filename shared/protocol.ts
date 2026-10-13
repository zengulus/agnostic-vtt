import { z } from 'zod';
import {
  fogSchema,
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
} from './model.js';
import type { StateChange, Point, Presence, Roll, RoomState } from './model.js';
const base = { v: z.literal(VERSION), actionId: z.string().min(1).max(80) };
const sceneId = idSchema;
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('JOIN_ROOM'),
    roomId: z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/),
    token: z.string().min(1).max(4096),
    inviteCode: z.string().max(64).optional(),
  }),
  z.object({ ...base, type: z.literal('STATE_RESYNC') }),
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
  z.object({ ...base, type: z.literal('TOKEN_UPDATE'), sceneId, token: tokenSchema }),
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
  }),
  z.object({ ...base, type: z.literal('GRID_UPDATE'), sceneId, grid: gridSchema }),
  z.object({ ...base, type: z.literal('SCENE_CHANGE'), sceneId }),
  z.object({
    ...base,
    type: z.literal('DICE_ROLL_REQUEST'),
    expression: z.string().min(1).max(120),
    visibility: z.enum(['public', 'private']),
  }),
  z.object({ ...base, type: z.literal('CHAT_SEND'), text: z.string().trim().min(1).max(1000) }),
  z.object({ ...base, type: z.literal('PING'), position: pointSchema }),
  z.object({ ...base, type: z.literal('FOG_UPDATE'), sceneId, fog: fogSchema }),
  z.object({ ...base, type: z.literal('ZONE_UPDATE'), sceneId, zone: zoneSchema }),
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
  z.object({ ...base, type: z.literal('LIBRARY_SAVE'), token: tokenSchema }),
  z.object({ ...base, type: z.literal('LIBRARY_DELETE'), id: idSchema }),
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
  z.object({ ...base, type: z.literal('INVITE_ROTATE') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type Action = ClientMessage extends infer T
  ? T extends { v: 2; actionId: string }
    ? Omit<T, 'v' | 'actionId'>
    : never
  : never;
export type ServerMessage =
  | ExtraServerMessage
  | {
      v: 2;
      type: 'ROOM_SNAPSHOT';
      state: RoomState;
      self: Presence;
      presence: Presence[];
      inviteCode?: string;
    }
  | { v: 2; type: 'STATE_PATCH'; revision: number; actionId: string; changes: StateChange[] }
  | { v: 2; type: 'PRESENCE_UPDATE'; presence: Presence[] }
  | {
      v: 2;
      type: 'TOKEN_MOVE_PREVIEW';
      sceneId: string;
      tokenId: string;
      position: Point;
      userId: string;
    }
  | { v: 2; type: 'DICE_ROLL_RESULT'; roll: Roll }
  | { v: 2; type: 'PING'; position: Point; userId: string }
  | { v: 2; type: 'SAVED'; savedAt: string; revision: number }
  | { v: 2; type: 'ERROR'; message: string; actionId?: string };
export type HistoryStatus = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
};
export type ExtraServerMessage =
  | { v: 2; type: 'HISTORY_STATUS'; history: HistoryStatus }
  | { v: 2; type: 'MEMBERS_UPDATE'; members: Array<Presence>; ownerId: string }
  | { v: 2; type: 'REVOKED'; message: string }
  | {
      v: 2;
      type: 'TOKEN_MOVE_PREVIEW_BATCH';
      sceneId: string;
      positions: Array<{ tokenId: string; position: Point }>;
      userId: string;
    };
