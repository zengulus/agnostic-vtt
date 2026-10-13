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
      chat: [],
      savedAt: null,
    },
  };
}
