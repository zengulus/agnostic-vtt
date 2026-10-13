import { z } from 'zod';
export const dicePreferencesSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#52694d'),
  ink: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#fff1d1'),
  material: z.enum(['metal', 'glass', 'plastic', 'wood', 'gemstone']).default('metal'),
  opacity: z.number().min(0.2).max(1).default(1),
  toss: z.enum(['scatter', 'cascade', 'orbit']).default('scatter'),
  speed: z.number().min(0.5).max(2).default(1),
  intensity: z.number().min(0.5).max(1.8).default(1),
  tray: z.enum(['velvet', 'stone', 'astral']).default('velvet'),
  presentation: z.enum(['arcane', 'moon', 'ember', 'minimal']).default('arcane'),
  particles: z.boolean().default(true),
  performance: z.enum(['low', 'balanced', 'cinematic']).default('balanced'),
  volume: z.number().min(0).max(1).default(0.35),
});
export type DicePreferences = z.infer<typeof dicePreferencesSchema>;
export const dicePresets: Record<string, DicePreferences> = {
  verdant: dicePreferencesSchema.parse({}),
  moon: dicePreferencesSchema.parse({
    color: '#466779',
    ink: '#e4f4ff',
    material: 'glass',
    opacity: 0.82,
    presentation: 'moon',
    tray: 'astral',
  }),
  ember: dicePreferencesSchema.parse({
    color: '#873e32',
    ink: '#ffdc9b',
    material: 'gemstone',
    opacity: 0.76,
    presentation: 'ember',
    tray: 'stone',
  }),
};
