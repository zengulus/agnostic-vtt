import { describe, expect, it } from 'vitest';
import { torchlitManor } from '../shared/sample.js';
import { sceneSchema } from '../shared/model.js';
import { gaussianLightFalloff, gaussianLightStops } from '../shared/lightFalloff.js';
import { validateAsset } from '../shared/assets.js';

describe('torchlit building example', () => {
  it('is a valid, compact scene with doors and multiple light sources', () => {
    const scene = sceneSchema.parse(torchlitManor());
    expect(() => validateAsset(scene.map)).not.toThrow();
    expect(Object.values(scene.walls || {}).filter((wall) => wall.kind === 'door')).toHaveLength(2);
    expect(Object.values(scene.tokens).filter((token) => token.light)).toHaveLength(8);
    expect(JSON.stringify(scene).length).toBeLessThan(6000);
  });
  it('fades smoothly and monotonically to zero at the light radius', () => {
    const stops = gaussianLightStops(0.8);
    expect(stops[0].alpha).toBeCloseTo(0.8);
    expect(stops.at(-1)!.alpha).toBeCloseTo(0);
    expect(stops.every((stop, index) => index === 0 || stop.alpha < stops[index - 1].alpha)).toBe(
      true,
    );
    expect(gaussianLightFalloff(0.5)).toBeLessThan(0.5);
  });
});
