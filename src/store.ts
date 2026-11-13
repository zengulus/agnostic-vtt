import { create } from 'zustand';
import { z } from 'zod';
import type { Point, Presence, Roll, RoomState, SceneTransition } from '../shared/model.js';
import { sampleScene } from '../shared/sample.js';
import type { Camera } from '../shared/geometry.js';
import { dicePreferencesSchema, type DicePreferences } from '../shared/diceThemes.js';
import type { DiscordStatus, HistoryStatus } from '../shared/protocol.js';
import { lightPresets, type LightDraft } from './lightPresets.js';
export type Tool =
  | 'select'
  | 'pan'
  | 'measure'
  | 'ping'
  | 'pin'
  | 'light'
  | 'wall'
  | 'zone'
  | 'fog'
  | 'draw'
  | 'text'
  | 'erase';
export type Dialog =
  | 'launch'
  | 'map'
  | 'new-scene'
  | 'token'
  | 'grid'
  | 'invite'
  | 'settings'
  | 'help'
  | 'library'
  | 'assets'
  | 'objects'
  | 'macros'
  | 'discord'
  | 'character-import'
  | null;
export const demoState: RoomState = {
  version: 1,
  id: 'preview',
  name: 'The Hollow Chronicles',
  revision: 0,
  activeSceneId: 'hollow',
  scenes: { hollow: sampleScene(), sanctuary: sampleScene('sanctuary', 'The Astral Sanctuary') },
  rolls: [],
  savedAt: null,
};
export type TablePresentation = { kind: 'handout'; handout: import('../shared/model.js').Handout } | { kind: 'table'; name: string; result: string };
interface UIState {
  room: RoomState;
  self: Presence | null;
  presence: Presence[];
  status: 'offline' | 'demo' | 'connecting' | 'live' | 'reconnecting';
  canGM: boolean;
  savedRevision: number | null;
  savePending: boolean;
  pendingDurableActions: number;
  inviteCode?: string;
  tool: Tool;
  selected: string | null;
  selectedIds: string[];
  camera: Camera;
  fitNonce: number;
  frameTokensNonce: number;
  panel: 'chronicle' | 'tracker' | 'character';
  characterId: string | null;
  characterEditId: string | null;
  activityOpen: boolean;
  focusTable: boolean;
  sessionNonce: number;
  dialog: Dialog;
  error: string | null;
  previews: Record<string, Point>;
  pings: Array<Point & { at: number; userId?: string; name?: string }>;
  attention: { position: Point; sceneId: string; name: string } | null;
  presentation: Roll | null;
  tablePresentations: TablePresentation[];
  rollQueue: Roll[];
  reducedMotion: boolean;
  sound: boolean;
  diceTheme: 'gold' | 'moon';
  dice: DicePreferences;
  history: HistoryStatus;
  members: Presence[];
  removedMembers: Array<{ id: string; name: string }>;
  ownerId: string | null;
  discord: DiscordStatus;
  deliveries: Record<string, { status: 'queued' | 'sent' | 'failed'; message: string }>;
  zoneShape: 'rectangle' | 'circle' | 'polygon' | 'line' | 'cone';
  wallKind: 'wall' | 'door' | 'window';
  lightDraft: LightDraft;
  zoneSnap: boolean;
  zoneLabel: string;
  zoneVisibility: 'public' | 'gm';
  fogShape: 'circle' | 'rectangle' | 'polygon';
  fogMode: 'reveal' | 'conceal';
  brushSize: number;
  drawColor: string;
  drawWidth: number;
  eraserSize: number;
  annotationText: string;
  annotationVisibility: 'public' | 'gm';
  shareMeasurement: boolean;
  sharedMeasurement: {
    sceneId: string;
    mode: 'distance' | 'path' | 'radius' | 'cone' | 'area';
    start: Point;
    end: Point;
    points: Point[];
  } | null;
  measurementShape: 'distance' | 'path' | 'radius' | 'cone' | 'area';
  sceneTransition: number;
  selectedPin: string | null;
  viewSceneId: string | null;
  pinDraftPoint: Point | null;
  proximityCues: Array<{ id: string; message: string }>;
  transitionSettings: SceneTransition;
  transitionEffect: SceneTransition | null;
  set: (value: Partial<UIState>) => void;
  finishRoll: () => void;
}
const settingsSchema = z.object({
  reducedMotion: z.boolean().optional().catch(undefined),
  sound: z.boolean().optional().catch(undefined),
  diceTheme: z.enum(['gold', 'moon']).optional().catch(undefined),
  dice: dicePreferencesSchema.optional().catch(undefined),
});
let settings: z.infer<typeof settingsSchema> = {};
try {
  const parsed = settingsSchema.safeParse(
    JSON.parse(localStorage.getItem('aether-settings') || '{}'),
  );
  if (parsed.success) settings = parsed.data;
} catch {
  /* Recover from damaged preferences. */
}
export const useTable = create<UIState>((set, get) => ({
  room: demoState,
  self: null,
  presence: [],
  status: 'offline',
  canGM: false,
  savedRevision: null,
  savePending: false,
  pendingDurableActions: 0,
  tool: 'select',
  selected: null,
  selectedIds: [],
  camera: { x: 0, y: 0, zoom: 1 },
  fitNonce: 0,
  frameTokensNonce: 0,
  panel: 'chronicle',
  characterId: null,
  characterEditId: null,
  activityOpen: false,
  focusTable: false,
  sessionNonce: 0,
  dialog: null,
  error: null,
  previews: {},
  pings: [],
  attention: null,
  presentation: null,
  tablePresentations: [],
  rollQueue: [],
  reducedMotion: settings.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
  sound: settings.sound ?? false,
  diceTheme: settings.diceTheme ?? 'gold',
  dice: settings.dice || dicePreferencesSchema.parse({}),
  history: { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' },
  members: [],
  removedMembers: [],
  ownerId: null,
  discord: { configured: false, enabled: false, mode: 'automatic', canManage: false },
  deliveries: {},
  zoneShape: 'rectangle',
  wallKind: 'wall',
  lightDraft: structuredClone(lightPresets.torch),
  zoneSnap: false,
  zoneLabel: '',
  zoneVisibility: 'public',
  fogShape: 'circle',
  fogMode: 'reveal',
  brushSize: 130,
  drawColor: '#d8b46c',
  drawWidth: 4,
  eraserSize: 24,
  annotationText: 'A note for the party',
  annotationVisibility: 'public',
  measurementShape: 'distance',
  shareMeasurement: false,
  sharedMeasurement: null,
  sceneTransition: 0,
  selectedPin: null,
  viewSceneId: null,
  pinDraftPoint: null,
  proximityCues: [],
  transitionSettings: {
    style: 'chapter',
    title: '',
    subtitle: 'A NEW CHAPTER',
    duration: 1800,
    color: '#08140d',
  },
  transitionEffect: null,
  set,
  finishRoll: () => {
    const [presentation, ...rollQueue] = get().rollQueue;
    set({ presentation: presentation || null, rollQueue });
  },
}));
useTable.subscribe((state, previous) => {
  if (
    state.dice !== previous.dice ||
    state.reducedMotion !== previous.reducedMotion ||
    state.sound !== previous.sound ||
    state.diceTheme !== previous.diceTheme
  ) {
    try {
      localStorage.setItem(
        'aether-settings',
        JSON.stringify({
          dice: state.dice,
          reducedMotion: state.reducedMotion,
          sound: state.sound,
          diceTheme: state.diceTheme,
        }),
      );
    } catch {
      /* Playing does not require storing preferences. */
    }
  }
});
export function notify(message: string) {
  useTable.getState().set({ error: message });
}
/** Compact sheets report their actions inline; their drawer would cover a map presentation. */
export function presentRoll(roll: Roll) {
  const s = useTable.getState();
  if (
    roll.character &&
    s.panel === 'character' &&
    s.activityOpen &&
    typeof window !== 'undefined' &&
    window.innerWidth <= 1000
  )
    return;
  if (typeof window !== 'undefined' && window.innerWidth <= 1000 && roll.userId === s.self?.id)
    s.set({ activityOpen: false });
  if (s.presentation) s.set({ rollQueue: [...s.rollQueue, roll].slice(-10) });
  else s.set({ presentation: roll });
}

/** Present transient events in arrival order; bound memory and report overflow. */
export function enqueueTablePresentation(presentation: TablePresentation) {
  const state = useTable.getState();
  if (state.tablePresentations.length >= 50) {
    notify('Presentation queue is full. Dismiss a presentation before receiving more.');
    return;
  }
  state.set({ tablePresentations: [...state.tablePresentations, presentation] });
}
