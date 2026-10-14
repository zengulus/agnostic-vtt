import { z } from 'zod';
const schema = z.object({
  favorites: z.array(z.string()).max(200).default([]),
  recent: z.array(z.string()).max(20).default([]),
  inputs: z.record(z.record(z.string().max(100))).default({}),
});
export type MacroPreferences = z.infer<typeof schema>;
export const macroPreferencesKey = (roomId: string, userId?: string) =>
  `aether-macros:${roomId}:${userId || 'guest'}`;
export function readMacroPreferences(key: string): MacroPreferences {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(key) || '{}'));
  } catch {
    return schema.parse({});
  }
}
export function writeMacroPreferences(key: string, preferences: MacroPreferences) {
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    /* Preferences are optional when browser storage is full. */
  }
}
