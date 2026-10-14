import { useEffect, useState } from 'react';
import { useTable } from './store.js';
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
    window.dispatchEvent(new Event('aether-macro-preferences'));
  } catch {
    /* Preferences are optional when browser storage is full. */
  }
}

export function useMacroPreferences() {
  const roomId = useTable((s) => s.room.id),
    userId = useTable((s) => s.self?.id);
  const key = macroPreferencesKey(roomId, userId);
  const [preferences, setPreferences] = useState(() => readMacroPreferences(key));
  useEffect(() => {
    const refresh = () => setPreferences(readMacroPreferences(key));
    refresh();
    window.addEventListener('aether-macro-preferences', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('aether-macro-preferences', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [key]);
  const remember = (update: (p: MacroPreferences) => MacroPreferences) => {
    const next = update(readMacroPreferences(key));
    writeMacroPreferences(key, next);
    setPreferences(next);
  };
  return [preferences, remember] as const;
}
