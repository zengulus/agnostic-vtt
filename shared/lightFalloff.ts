/** Normalized truncated Gaussian: full brightness at the source, zero at its radius. */
export function gaussianLightFalloff(distance: number): number {
  const t = Math.max(0, Math.min(1, distance));
  const edge = Math.exp(-4.5);
  return (Math.exp(-4.5 * t * t) - edge) / (1 - edge);
}
/** A fixed small number of stops keeps gradients smooth and cheap to cache. */
export function gaussianLightStops(intensity: number): Array<{ offset: number; alpha: number }> {
  const strength = Math.max(0, Math.min(1, intensity));
  return Array.from({ length: 13 }, (_, index) => ({
    offset: index / 12,
    alpha: strength * gaussianLightFalloff(index / 12),
  }));
}

import type { Token } from './model.js';
type Light = NonNullable<Token['light']>;
export const LIGHT_FRAME_MS = 1000 / 30;
export function hasLightAnimation(light: Light): boolean {
  return !!(light.effects?.hueShift || light.effects?.onOff || light.effects?.dimming);
}
function shiftHue(hex: string, degrees: number): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const hi = Math.max(...rgb),
    lo = Math.min(...rgb),
    delta = hi - lo;
  if (delta < 1e-8) return hex;
  let h =
    hi === rgb[0]
      ? (rgb[1] - rgb[2]) / delta
      : hi === rgb[1]
        ? (rgb[2] - rgb[0]) / delta + 2
        : (rgb[0] - rgb[1]) / delta + 4;
  h = (((h * 60 + degrees) % 360) + 360) % 360;
  const l = (hi + lo) / 2,
    sat = delta / (1 - Math.abs(2 * l - 1)),
    chroma = (1 - Math.abs(2 * l - 1)) * sat,
    x = chroma * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - chroma / 2;
  const parts =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return `#${parts
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
/** Cosmetic, deterministic frames. Dimming changes brightness and its effective radius together. */
export function lightAnimationFrame(
  light: Light,
  x: number,
  y: number,
  tick: number,
  reducedMotion = false,
) {
  if (reducedMotion || !hasLightAnimation(light))
    return { brightness: light.intensity, radius: light.radius, color: light.color };
  const effects = light.effects!,
    speed = effects.speed ?? 1,
    phase = x * 0.017 + y * 0.013,
    t = ((tick * LIGHT_FRAME_MS) / 1000) * speed;
  const seconds = t / speed;
  // Integrate a smoothly varying frequency so the instantaneous rate stays
  // within base ± jitter Hz and the phase remains continuous across frames.
  const jitterHz = effects.jitterHz ?? (effects.jitter ?? 0.5) * 0.1;
  const flickerPhase = (frequency: number) => {
    const deviation = Math.min(frequency, jitterHz);
    const cycles =
      frequency * seconds +
      (deviation / 0.47) * (Math.sin(seconds * 0.47 + phase) - Math.sin(phase));
    return cycles * 2 * Math.PI + phase;
  };
  const switchedOn =
    !effects.onOff ||
    Math.sin(flickerPhase(effects.onOffHz ?? (1.3 * speed) / (2 * Math.PI))) > -0.35;
  const min = effects.minBrightness ?? 0.35;
  const dim = effects.dimming
    ? min +
      (1 - min) *
        (0.5 + 0.5 * Math.sin(flickerPhase(effects.dimmingHz ?? (0.8 * speed) / (2 * Math.PI))))
    : 1;
  const factor = switchedOn ? dim : 0;
  return {
    brightness: light.intensity * factor,
    radius: light.radius * Math.sqrt(factor),
    color: effects.hueShift
      ? shiftHue(
          light.color,
          effects.hueHz === undefined ? t * 12 : (t / speed) * effects.hueHz * 360,
        )
      : light.color,
  };
}
