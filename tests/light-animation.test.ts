import { describe, expect, it } from 'vitest';
import { hasLightAnimation, lightAnimationFrame, LIGHT_FRAME_MS } from '../shared/lightFalloff.js';
const base = { radius: 400, color: '#ff8833', intensity: 0.8 };
describe('cosmetic light animation', () => {
  it('uses frequency in hertz for each effect', () => {
    const light = {
      ...base,
      effects: { dimming: true, dimmingHz: 0.5, hueShift: true, hueHz: 0.25, jitter: 0 },
    };
    const at = (seconds: number) => lightAnimationFrame(light, 0, 0, seconds * 30);
    expect(at(2).brightness).toBeCloseTo(at(0).brightness);
    expect(at(1).brightness).not.toBeCloseTo(at(0.5).brightness);
    expect(at(4).color).toBe(at(0).color);
    expect(at(1).color).not.toBe(at(0).color);
  });
  it('advances at 30 frames per second without changing effect speed', () => {
    expect(LIGHT_FRAME_MS * 30).toBeCloseTo(1000);
    const light = { ...base, effects: { hueShift: true } };
    expect(lightAnimationFrame(light, 0, 0, 30).color).not.toBe(base.color);
  });
  it('flickers between zero and the configured brightness', () => {
    const light = { ...base, effects: { onOff: true } };
    const frames = Array.from({ length: 600 }, (_, tick) =>
      lightAnimationFrame(light, 50, 80, tick),
    );
    expect(frames.some((frame) => frame.brightness === 0 && frame.radius === 0)).toBe(true);
    expect(frames.some((frame) => frame.brightness === 0.8 && frame.radius === 400)).toBe(true);
  });
  it('varies brightness between nonzero levels and scales radius with it', () => {
    const light = { ...base, effects: { dimming: true, minBrightness: 0.4 } };
    const frames = Array.from({ length: 600 }, (_, tick) =>
      lightAnimationFrame(light, 50, 80, tick),
    );
    expect(Math.min(...frames.map((f) => f.brightness))).toBeGreaterThanOrEqual(0.8 * 0.4);
    expect(Math.max(...frames.map((f) => f.brightness))).toBeLessThanOrEqual(0.8);
    expect(new Set(frames.map((f) => f.radius)).size).toBeGreaterThan(5);
    for (const frame of frames)
      expect(frame.radius / 400).toBeCloseTo(Math.sqrt(frame.brightness / 0.8));
  });
  it('shifts hue independently and disables animation with reduced motion', () => {
    const light = { ...base, effects: { hueShift: true, onOff: true, dimming: true } };
    expect(hasLightAnimation(light)).toBe(true);
    expect(lightAnimationFrame(light, 5, 8, 30).color).not.toBe(base.color);
    expect(lightAnimationFrame(light, 5, 8, 30, true)).toEqual({
      brightness: base.intensity,
      radius: base.radius,
      color: base.color,
    });
  });
  it('allows regular or irregular flicker timing without changing brightness bounds', () => {
    const regular = { ...base, effects: { onOff: true, jitter: 0 } };
    const jittered = { ...base, effects: { onOff: true, jitter: 1 } };
    const transitions = (light: typeof regular) => {
      const frames = Array.from(
        { length: 1800 },
        (_, tick) => lightAnimationFrame(light, 50, 80, tick).brightness,
      );
      return frames.flatMap((frame, i) => (i && frame !== frames[i - 1] ? [i] : []));
    };
    const regularTimes = transitions(regular),
      jitteredTimes = transitions(jittered);
    expect(regularTimes.length).toBeGreaterThan(5);
    expect(jitteredTimes.length).toBeGreaterThan(5);
    expect(jitteredTimes).not.toEqual(regularTimes);
    expect(lightAnimationFrame(jittered, 50, 80, 42)).toEqual(
      lightAnimationFrame(jittered, 50, 80, 42),
    );
  });
});
