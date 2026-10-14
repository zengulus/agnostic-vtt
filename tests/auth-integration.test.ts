import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

class Broadcast {
  static channels: Broadcast[] = [];
  static messages: Array<{ key: string; event: string; session: Session | null }> = [];
  listeners: Array<(event: { data: unknown }) => void> = [];
  closed = false;
  constructor(readonly name: string) {
    Broadcast.channels.push(this);
  }
  addEventListener(_name: string, listener: (event: { data: unknown }) => void) {
    this.listeners.push(listener);
  }
  postMessage(data: { event: string; session: Session | null }) {
    Broadcast.messages.push({ key: this.name, ...data });
    for (const peer of Broadcast.channels)
      if (peer !== this && peer.name === this.name && !peer.closed)
        for (const listener of peer.listeners) listener({ data });
  }
  close() {
    this.closed = true;
  }
}
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  sent: Array<{ token: string }> = [];
  onopen: (() => Promise<void>) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    Socket.instances.push(this);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function sessionFor(id: string, suffix = ''): Session {
  const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, marker: suffix }))}.signature`;
  return {
    access_token: token,
    refresh_token: `refresh-${id}${suffix}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id,
      email: `${id}@example.test`,
      user_metadata: { name: id },
      app_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
  };
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

describe('real Supabase SDK authentication isolation', () => {
  let connection: typeof import('../src/connection.js');
  let auth: typeof import('../src/auth.js');
  let table: typeof import('../src/store.js');
  let values: Map<string, string>;
  const key = 'sb-test-project-auth-token';
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key');
    const location = new URL('http://localhost:5173/');
    vi.stubGlobal('location', location);
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location }));
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.stubGlobal('history', { replaceState: vi.fn() });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    values = new Map([[key, JSON.stringify(sessionFor('original'))]]);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((name: string) => values.get(name) ?? null),
      setItem: vi.fn((name: string, value: string) => values.set(name, value)),
      removeItem: vi.fn((name: string) => values.delete(name)),
    });
    Broadcast.channels = [];
    Broadcast.messages = [];
    Socket.instances = [];
    vi.stubGlobal('BroadcastChannel', Broadcast);
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({})),
    );
    connection = await import('../src/connection.js');
    auth = await import('../src/auth.js');
    table = await import('../src/store.js');
    expect(await connection.currentAccount()).toMatchObject({ name: 'original' });
    table.useTable.getState().set({ dialog: 'launch' });
    vi.mocked(localStorage.setItem).mockClear();
    Broadcast.messages = [];
  });
  afterEach(async () => {
    connection?.disconnect();
    await auth?.authClient().auth.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  for (const signup of [false, true]) {
    it(`does not persist or broadcast abandoned ${signup ? 'signup' : 'password'} credentials`, async () => {
      const response = deferred<Response>();
      vi.mocked(fetch).mockReturnValueOnce(response.promise);
      const attempt = connection.signIn('stale', 'stale@example.test', 'test-password', signup);
      const rejected = expect(attempt).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      table.useTable.getState().set({ dialog: null });
      response.resolve(json(sessionFor('stale')));
      await rejected;
      expect(JSON.parse(values.get(key)!).user.id).toBe('original');
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(Broadcast.messages.filter((event) => event.event === 'SIGNED_IN')).toEqual([]);
      expect(await connection.currentAccount()).toMatchObject({ name: 'original' });
      expect(history.replaceState).not.toHaveBeenCalled();
      expect(Socket.instances).toHaveLength(0);
    });
  }
  it('keeps the newer account when an older password exchange finishes later', async () => {
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);
    const old = connection.signIn('older', 'older@example.test', 'test-password');
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const latest = sessionFor('latest');
    vi.mocked(fetch).mockResolvedValueOnce(json(latest));
    await connection.signIn('latest', 'latest@example.test', 'test-password');
    response.resolve(json(sessionFor('older')));
    await rejected;
    expect(JSON.parse(values.get(key)!).user.id).toBe('latest');
    expect(await connection.currentAccount()).toMatchObject({ name: 'latest' });
    await connection.authorizedFetch('/api/test');
    expect(new Headers(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.headers).get('Authorization')).toBe(
      `Bearer ${latest.access_token}`,
    );
    connection.connect('latest-campaign');
    await Socket.instances[0].onopen?.();
    expect(Socket.instances[0].sent[0].token).toBe(latest.access_token);
    expect(Broadcast.messages.some((event) => event.session?.user.id === 'older')).toBe(false);
  });
  it('prevents an old client refresh from saving or broadcasting after client replacement', async () => {
    const oldClient = auth.authClient();
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);
    const refresh = oldClient.auth.refreshSession();
    const rejected = expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    vi.mocked(fetch).mockResolvedValueOnce(json(sessionFor('latest')));
    await connection.signIn('latest', 'latest@example.test', 'test-password');
    response.resolve(json(sessionFor('original', '-refreshed')));
    await rejected;
    expect(JSON.parse(values.get(key)!).user.id).toBe('latest');
    expect(await connection.currentAccount()).toMatchObject({ name: 'latest' });
    expect(Broadcast.messages.some((event) => event.session?.user.id === 'original')).toBe(false);
  });
  it('retains the canonical cross-tab channel after a successful password exchange', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(sessionFor('latest')));
    await connection.signIn('latest', 'latest@example.test', 'test-password');
    const events: string[] = [];
    auth.authClient().auth.onAuthStateChange((event) => {
      events.push(event);
    });
    const otherTab = new Broadcast(key);
    localStorage.removeItem(key);
    otherTab.postMessage({ event: 'SIGNED_OUT', session: null });
    await vi.waitFor(() => expect(events).toContain('SIGNED_OUT'));
    expect(await connection.currentAccount()).toBeNull();
  });
  it('rejects HTTP requests and socket joins when another tab changes the account', async () => {
    values.set(key, JSON.stringify(sessionFor('other-tab')));
    await expect(connection.authorizedFetch('/api/test')).rejects.toThrow('Your account changed');
    expect(fetch).not.toHaveBeenCalled();
    connection.connect('original-campaign');
    await Socket.instances[0].onopen?.();
    expect(Socket.instances[0].sent).toEqual([]);
    expect(table.useTable.getState()).toMatchObject({
      status: 'offline',
      dialog: 'launch',
      error: 'Your account changed. Sign in again to open this table.',
    });
  });
  it('persists accepted refreshes and uses the refreshed token for the same account', async () => {
    const refreshed = sessionFor('original', '-new-token');
    vi.mocked(fetch).mockResolvedValueOnce(json(refreshed));
    const result = await auth.authClient().auth.refreshSession();
    expect(result.error).toBeNull();
    expect(JSON.parse(values.get(key)!).access_token).toBe(refreshed.access_token);
    await connection.authorizedFetch('/api/test');
    expect(new Headers(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.headers).get('Authorization')).toBe(
      `Bearer ${refreshed.access_token}`,
    );
    expect(
      Broadcast.messages.some((event) => event.key === key && event.event === 'TOKEN_REFRESHED'),
    ).toBe(true);
  });
  it('does not let an old pending sign-out remove a newer sign-in', async () => {
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);
    const signOut = connection.signOut();
    const rejected = expect(signOut).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    vi.mocked(fetch).mockResolvedValueOnce(json(sessionFor('latest')));
    await connection.signIn('latest', 'latest@example.test', 'test-password');
    response.resolve(new Response(null, { status: 204 }));
    await rejected;
    expect(JSON.parse(values.get(key)!).user.id).toBe('latest');
    expect(await connection.currentAccount()).toMatchObject({ name: 'latest' });
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(Broadcast.messages.some((event) => event.event === 'SIGNED_OUT')).toBe(false);
  });
});
