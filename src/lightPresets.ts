import type { Token } from '../shared/model.js';
export type LightDraft = { name: string; light: NonNullable<Token['light']> };
export const lightPresets: Record<string, LightDraft> = {
  torch: { name: 'Torch', light: { radius: 400, color: '#ffb45e', intensity: 0.95 } },
  candle: { name: 'Candle', light: { radius: 160, color: '#ffd28a', intensity: 0.7 } },
  lantern: { name: 'Lantern', light: { radius: 550, color: '#ffd08c', intensity: 0.85 } },
  arcane: { name: 'Arcane light', light: { radius: 400, color: '#8ecfff', intensity: 0.85 } },
  sconce: {
    name: 'Sconce',
    light: { radius: 450, color: '#ffb45e', intensity: 0.95, angle: 100, direction: 0 },
  },
};
