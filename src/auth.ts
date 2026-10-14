import { AuthClient, type Session } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Keep Supabase's existing key and cross-tab channel so saved sign-ins still restore.
const storageKey = () => `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
const memory = new Map<string, string>();
let memoryOnly = false;
const storage = {
  getItem(name: string) {
    if (!memoryOnly) {
      try {
        const value = localStorage.getItem(name);
        if (value !== null) memory.set(name, value);
        else memory.delete(name);
        return value;
      } catch {
        memoryOnly = true;
      }
    }
    return memory.get(name) ?? null;
  },
  setItem(name: string, value: string) {
    memory.set(name, value);
    if (memoryOnly) return;
    try {
      localStorage.setItem(name, value);
    } catch {
      memoryOnly = true;
      // Sign-in may remain in this tab when browser storage is unavailable.
    }
  },
  removeItem(name: string) {
    memory.delete(name);
    if (memoryOnly) return;
    try {
      localStorage.removeItem(name);
    } catch {
      memoryOnly = true;
    }
  },
};
let current: ReturnType<typeof createPersistentClient> | undefined;
function createPersistentClient(detectSessionInUrl: boolean) {
  let retired = false;
  const check = () => {
    if (retired) throw new DOMException('This authentication context was replaced.', 'AbortError');
  };
  const client = {
    auth: new AuthClient({
      url: `${url.replace(/\/$/, '')}/auth/v1`,
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      storageKey: storageKey(),
      detectSessionInUrl,
      storage: {
        getItem(name) {
          check();
          return storage.getItem(name);
        },
        setItem(name, value) {
          check();
          storage.setItem(name, value);
        },
        removeItem(name) {
          check();
          storage.removeItem(name);
        },
      },
    }),
  };
  return {
    client,
    retire() {
      // dispose() alone cannot stop an already-running SDK refresh from saving later.
      retired = true;
      void client.auth.dispose();
    },
  };
}
export function authClient() {
  current ||= createPersistentClient(true);
  return current.client;
}
export function isolatedAuthClient() {
  return {
    auth: new AuthClient({
      url: `${url.replace(/\/$/, '')}/auth/v1`,
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      storageKey: `${storageKey()}-attempt-${crypto.randomUUID()}`,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    }),
  };
}
export function commitAuthSession(session: Session) {
  // The caller checks its intent immediately before this synchronous promotion.
  // No setSession await (or SDK /user request) may race a newer sign-in here.
  current?.retire();
  storage.setItem(storageKey(), JSON.stringify(session));
  current = createPersistentClient(false);
}
