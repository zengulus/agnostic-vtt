import { create } from 'zustand';
import { z } from 'zod';
import type { Point, Presence, Roll, RoomState } from '../shared/model.js';
import { sampleScene } from '../shared/sample.js';
import type { Camera } from '../shared/geometry.js';
import { dicePreferencesSchema, type DicePreferences } from '../shared/diceThemes.js';
import type { DiscordStatus, HistoryStatus } from '../shared/protocol.js';
export type Tool =
  'select' | 'pan' | 'measure' | 'ping' | 'zone' | 'fog' | 'draw' | 'text' | 'erase';
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
  | null;
export const demoState: RoomState = {
  version: 1,
  id: 'preview',
  name: 'The Hollow Chronicles',
  revision: 0,
  activeSceneId: 'hollow',
  scenes: { hollow: sampleScene(), sanctuary: sampleScene('sanctuary', 'The Astral Sanctuary') },
  rolls: [],
  chat: [],
  savedAt: null,
};
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
  panel: 'chronicle' | 'chat' | 'tracker';
  dialog: Dialog;
  error: string | null;
  previews: Record<string, Point>;
  pings: Array<Point & { at: number }>;
  presentation: Roll | null;
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
  zoneSnap: boolean;
  fogShape: 'circle' | 'rectangle' | 'polygon';
  fogMode: 'reveal' | 'conceal';
  brushSize: number;
  drawColor: string;
  drawWidth: number;
  eraserSize: number;
  annotationText: string;
  annotationVisibility: 'public' | 'gm';
  measurementShape: 'distance' | 'path' | 'radius' | 'cone' | 'area';
  sceneTransition: number;
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
  panel: 'chronicle',
  dialog: null,
  error: null,
  previews: {},
  pings: [],
  presentation: null,
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
  zoneSnap: false,
  fogShape: 'circle',
  fogMode: 'reveal',
  brushSize: 130,
  drawColor: '#d8b46c',
  drawWidth: 4,
  eraserSize: 24,
  annotationText: 'A note for the party',
  annotationVisibility: 'public',
  measurementShape: 'distance',
  sceneTransition: 0,
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
