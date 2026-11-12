import type { DurableRoom, Scene, Token } from './model.js';
export function sampleScene(id = 'hollow', name = 'The Whispering Hollow'): Scene {
  const token = (
    id: string,
    name: string,
    image: string,
    x: number,
    y: number,
    color: string,
  ): Token => ({
    id,
    name,
    image: { kind: 'builtin', url: image },
    x,
    y,
    size: 72,
    rotation: 0,
    color,
    owners: ['*'],
    visibility: 'public',
    resource: { label: 'Resolve', value: 8, max: 10 },
  });
  return {
    id,
    name,
    map: { kind: 'builtin', url: id === 'sanctuary' ? 'sanctuary.svg' : 'hollow.svg' },
    width: 1600,
    height: 1200,
    grid: {
      size: 80,
      opacity: 0.16,
      enabled: true,
      snap: true,
      offsetX: 0,
      offsetY: 0,
      units: 'm',
      distance: 5,
    },
    tokens: {
      ranger: token('ranger', 'Kael · Wanderer', 'ranger.svg', 600, 680, '#d8b46c'),
      mage: token('mage', 'Lyra · Wayfinder', 'mage.svg', 760, 600, '#89b8c9'),
      sentinel: token('sentinel', 'The Watcher', 'sentinel.svg', 1000, 440, '#c8786c'),
    },
    zones: {},
    fog: { enabled: false, revealed: [] },
  };
}
/** A self-contained offline lighting demonstration; no uploaded assets or database writes. */
export function torchlitManor(): Scene {
  const base = sampleScene('manor', 'The Lantern House');
  const torch = (id: string, x: number, y: number): Token => ({
    id,
    name: 'Torch',
    hideLabel: true,
    image: { kind: 'builtin', url: 'wisp.svg' },
    x,
    y,
    size: 24,
    rotation: 0,
    color: '#f1b765',
    owners: [],
    visibility: 'public',
    light: { radius: 400, color: '#ffb45e', intensity: 0.95 },
  });
  const wall = (
    id: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    kind: 'wall' | 'door' = 'wall',
  ) => ({
    id,
    a: { x: x1, y: y1 },
    b: { x: x2, y: y2 },
    kind,
    ...(kind === 'door' ? { open: false } : {}),
  });
  return {
    ...base,
    map: { kind: 'builtin', url: 'torchlit-manor.svg' },
    width: 1600,
    height: 1000,
    grid: { ...base.grid, enabled: false },
    lighting: { vision: true, darkness: 0.72 },
    tokens: {
      ranger: { ...base.tokens.ranger, x: 520, y: 695, owners: ['*'], resource: undefined },
      sentinel: {
        ...base.tokens.sentinel,
        name: 'Manor sentry',
        x: 910,
        y: 345,
        owners: [],
        resource: undefined,
        sight: { range: 370, angle: 70, showCone: true, showToPlayers: true },
        rotation: 145,
      },
      'torch-a': torch('torch-a', 215, 185),
      'torch-b': torch('torch-b', 702, 185),
      'torch-c': torch('torch-c', 845, 175),
      'torch-d': torch('torch-d', 1390, 425),
      'torch-e': torch('torch-e', 1365, 815),
      'torch-f': torch('torch-f', 845, 820),
      'torch-g': torch('torch-g', 215, 815),
      'torch-h': torch('torch-h', 702, 815),
    },
    walls: {
      north: wall('north', 125, 110, 1475, 110),
      east: wall('east', 1475, 110, 1475, 890),
      south: wall('south', 1475, 890, 125, 890),
      west: wall('west', 125, 890, 125, 110),
      'hall-north': wall('hall-north', 775, 110, 775, 350),
      'hall-door': wall('hall-door', 775, 350, 775, 500, 'door'),
      'hall-south': wall('hall-south', 775, 500, 775, 890),
      'room-west': wall('room-west', 775, 505, 1050, 505),
      'room-door': wall('room-door', 1050, 505, 1190, 505, 'door'),
      'room-east': wall('room-east', 1190, 505, 1475, 505),
    },
  };
}
export function newRoom(
  id: string,
  ownerId: string,
  ownerName: string,
  name: string,
  inviteCode: string,
): DurableRoom {
  return {
    ownerId,
    inviteCode,
    members: { [ownerId]: { name: ownerName, role: 'gm' } },
    state: {
      version: 1,
      id,
      name,
      revision: 0,
      activeSceneId: 'hollow',
      scenes: {
        hollow: sampleScene(),
        sanctuary: sampleScene('sanctuary', 'The Astral Sanctuary'),
      },
      rolls: [],
      savedAt: null,
    },
  };
}
