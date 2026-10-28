import { expect, it } from 'vitest';
import { frameTokens } from '../src/camera.js';
import { worldToScreen } from '../shared/geometry.js';

it('frames a compact party at a readable scale with its members on screen', () => {
  const tokens = [
    { x: 600, y: 680, size: 72 },
    { x: 760, y: 600, size: 72 },
    { x: 1000, y: 440, size: 72 },
  ];
  const camera = frameTokens(tokens, 346, 768)!;
  expect(camera.zoom * 72).toBeGreaterThan(36);
  for (const token of tokens) {
    const point = worldToScreen(token, camera),
      radius = (token.size * camera.zoom) / 2;
    expect(point.x - radius).toBeGreaterThan(0);
    expect(point.x + radius).toBeLessThan(346);
    expect(point.y - radius).toBeGreaterThan(0);
    expect(point.y + radius).toBeLessThan(768);
  }
});
it('returns no frame for an empty scene or an unavailable viewport', () => {
  expect(frameTokens([], 300, 600)).toBeNull();
  expect(frameTokens([{ x: 10, y: 10, size: 72 }], 0, 600)).toBeNull();
});
it('limits close framing and centres tokens away from the map origin', () => {
  const camera = frameTokens([{ x: 8000, y: 6500, size: 72 }], 1440, 960)!;
  expect(camera.zoom).toBe(1.5);
  expect(worldToScreen({ x: 8000, y: 6508 }, camera)).toEqual({ x: 720, y: 480 });
});
