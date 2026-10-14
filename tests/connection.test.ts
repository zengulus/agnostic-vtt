import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../shared/protocol.js';
import type { Roll } from '../shared/model.js';

const { auth } = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  AuthClient: class {
    getSession = auth.getSession;
    signInWithPassword = auth.signInWithPassword;
    signUp = auth.signUp;
    signOut = auth.signOut;
    dispose = auth.dispose;
  },
}));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  sent: Array<{ actionId: string }> = [];
  onopen: (() => Promise<void>) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  message(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe('client connection transitions', () => {
  let connection: typeof import('../src/connection.js');
  let table: typeof import('../src/store.js');
  const self = { id: 'tester', name: 'Tester', role: 'gm' as const, color: '#d8b46c' };
  const roll: Roll = {
    id: 'private-roll',
    actionId: 'roll',
    userId: 'another-gm',
    userName: 'GM',
    expression: 'd20',
    terms: [],
    total: 14,
    visibility: 'private',
    createdAt: new Date().toISOString(),
  };
  function snapshot(socket: Socket, roomId = 'campaign-a', role: 'gm' | 'player' = 'gm') {
    socket.message({
      v: 2,
      type: 'ROOM_SNAPSHOT',
      state: { ...structuredClone(table.demoState), id: roomId },
      self: { ...self, role },
      presence: [{ ...self, role }],
    });
  }
  async function connect(roomId = 'campaign-a') {
    connection.connect(roomId);
    const socket = Socket.instances.at(-1)!;
    socket.readyState = Socket.OPEN;
    await socket.onopen?.();
    snapshot(socket, roomId);
    return socket;
  }
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    Socket.instances = [];
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('location', new URL('http://localhost:5173/'));
    vi.stubGlobal('history', {
      replaceState: vi.fn((_state: unknown, _title: string, url: string | URL) => {
        location.href = String(url);
      }),
    });
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              token: 'test-session',
              id: self.id,
              name: self.name,
            }),
          ),
      ),
    );
    connection = await import('../src/connection.js');
    table = await import('../src/store.js');
    await connection.signIn(self.name);
  });
  afterEach(() => {
    connection?.disconnect();
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
  it('ignores late snapshots and results from a replaced socket', async () => {
    const old = await connect();
    await connect('campaign-b');
    snapshot(old);
    old.message({ v: 2, type: 'DICE_ROLL_RESULT', roll });
    expect(table.useTable.getState().room.id).toBe('campaign-b');
    expect(table.useTable.getState().presentation).toBeNull();
  });
  it('clears presentations and queued private rolls after a role change', async () => {
    const socket = await connect();
    table.useTable
      .getState()
      .set({ presentation: roll, rollQueue: [roll], tool: 'fog', dialog: 'token' });
    snapshot(socket, 'campaign-a', 'player');
    expect(table.useTable.getState()).toMatchObject({
      presentation: null,
      rollQueue: [],
      tool: 'select',
      dialog: null,
    });
  });
  it('clears previews and pings when switching scenes with reused token identifiers', async () => {
    const socket = await connect();
    table.useTable.getState().set({
      previews: { ranger: { x: 200, y: 300 } },
      pings: [{ x: 100, y: 100, at: Date.now() }],
    });
    socket.message({
      v: 2,
      type: 'STATE_PATCH',
      revision: 1,
      actionId: 'scene',
      changes: [{ kind: 'scene-active', sceneId: 'sanctuary' }],
    });
    expect(table.useTable.getState()).toMatchObject({ previews: {}, pings: [] });
  });
  it('rejects pending confirmations immediately when a connection closes', async () => {
    const socket = await connect();
    const pending = connection.sendAndWait({ type: 'MACRO_DELETE', id: 'macro' });
    const rejected = expect(pending).rejects.toThrow('connection closed');
    socket.close();
    await rejected;
    expect(table.useTable.getState().status).toBe('reconnecting');
  });
  it('rejects pending confirmations when opening another campaign', async () => {
    await connect();
    const pending = connection.sendAndWait({ type: 'MACRO_DELETE', id: 'macro' });
    const rejected = expect(pending).rejects.toThrow('campaign changed');
    connection.connect('campaign-b');
    await rejected;
  });
  it('rejects oversized escaped macro payloads with feedback before touching the socket', async () => {
    const socket = await connect(),
      before = socket.sent.length;
    // This fits the text character limit, but JSON escaping exceeds the UTF-8 frame limit.
    await expect(
      connection.sendAndWait({
        type: 'MACRO_IMPORT',
        text: '#' + '\x00'.repeat(65000) + '\n[Roll]([Check(d6)])',
        visibility: 'public',
      }),
    ).rejects.toThrow('Import fewer definitions');
    expect(socket.sent).toHaveLength(before);
    expect(socket.readyState).toBe(Socket.OPEN);
    expect(table.useTable.getState().status).toBe('live');
    expect(table.useTable.getState().error).toContain('too large to send');
  });
  it('preserves Headers instances while adding bearer authentication', async () => {
    await connection.authorizedFetch('/api/test', {
      headers: new Headers({ 'Content-Type': 'application/json', 'X-Image-Purpose': 'token' }),
    });
    const init = vi.mocked(fetch).mock.calls.at(-1)?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Image-Purpose')).toBe('token');
    expect(headers.get('Authorization')).toBe('Bearer test-session');
  });
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  }
  const response = (value: unknown) => new Response(JSON.stringify(value));
  async function pendingLaunch(stage: 'authentication' | 'campaign') {
    connection.launchDemo();
    table.useTable.getState().set({ dialog: 'launch' });
    vi.mocked(fetch).mockClear();
    vi.mocked(localStorage.setItem).mockClear();
    vi.mocked(history.replaceState).mockClear();
    const pending = deferred<Response>();
    if (stage === 'campaign')
      vi.mocked(fetch).mockResolvedValueOnce(
        response({ id: 'new-user', name: 'New', token: 'new-token' }),
      );
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const launched = connection.launch('New', 'Stale campaign');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(stage === 'campaign' ? 2 : 1));
    return { pending, launched, signal: vi.mocked(fetch).mock.calls.at(-1)![1]!.signal! };
  }
  for (const stage of ['authentication', 'campaign'] as const) {
    for (const settle of ['resolve', 'reject'] as const) {
      it(`ignores ${stage} ${settle} after closing the launch dialog`, async () => {
        const { pending, launched, signal } = await pendingLaunch(stage);
        table.useTable.getState().set({ dialog: null });
        const screen = table.useTable.getState();
        expect(screen.status).toBe('demo');
        expect(signal.aborted).toBe(true);
        if (settle === 'resolve') pending.resolve(response({ id: 'stale', token: 'stale-token' }));
        else pending.reject(new Error('Late failure'));
        await launched;
        expect(table.useTable.getState()).toBe(screen);
        expect(location.href).toBe('http://localhost:5173/');
        expect(history.replaceState).not.toHaveBeenCalled();
        expect(Socket.instances).toHaveLength(0);
        expect(localStorage.setItem).toHaveBeenCalledTimes(stage === 'campaign' ? 1 : 0);
        expect(fetch).toHaveBeenCalledTimes(stage === 'campaign' ? 2 : 1);
      });
    }
  }
  it('keeps a newly selected player demo after an abandoned campaign completes', async () => {
    const { pending, launched } = await pendingLaunch('campaign');
    connection.launchDemo('player');
    const screen = table.useTable.getState();
    const historyCalls = vi.mocked(history.replaceState).mock.calls.length;
    pending.resolve(response({ id: 'stale-campaign', inviteCode: 'stale-invite' }));
    await launched;
    expect(table.useTable.getState()).toBe(screen);
    expect(screen.self?.role).toBe('player');
    expect(location.search).toBe('');
    expect(history.replaceState).toHaveBeenCalledTimes(historyCalls);
    expect(Socket.instances).toHaveLength(0);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
  });
  it('does not let an older authentication replace a superseding launch or its session', async () => {
    const { pending, launched, signal } = await pendingLaunch('authentication');
    vi.mocked(fetch).mockResolvedValueOnce(
      response({ id: 'latest-user', name: 'Latest', token: 'latest-token' }),
    );
    const latest = connection.launch('Latest', 'Latest campaign', 'latest-room', 'latest-invite');
    await latest;
    expect(signal.aborted).toBe(true);
    const screen = table.useTable.getState();
    pending.resolve(response({ id: 'stale-user', name: 'Stale', token: 'stale-token' }));
    await launched;
    expect(table.useTable.getState()).toBe(screen);
    expect(location.search).toBe('?room=latest-room&invite=latest-invite');
    expect(Socket.instances).toHaveLength(1);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    const socket = Socket.instances[0];
    socket.readyState = Socket.OPEN;
    await socket.onopen?.();
    expect(socket.sent[0]).toMatchObject({ roomId: 'latest-room', token: 'latest-token' });
  });
  it('keeps a resumed campaign when an older creation request rejects', async () => {
    const { pending, launched } = await pendingLaunch('campaign');
    connection.resumeCampaign('resumed-room', 'player');
    const screen = table.useTable.getState();
    pending.reject(new Error('Old campaign creation failed'));
    await launched;
    expect(table.useTable.getState()).toBe(screen);
    expect(location.search).toBe('?room=resumed-room');
    expect(Socket.instances).toHaveLength(1);
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    const socket = Socket.instances[0];
    socket.readyState = Socket.OPEN;
    await socket.onopen?.();
    expect(socket.sent[0]).toMatchObject({
      roomId: 'resumed-room',
      role: 'player',
      token: 'new-token',
    });
  });
  for (const event of ['popstate', 'pagehide']) {
    it(`cancels pending launch on ${event} without rewriting navigation`, async () => {
      const { pending, launched, signal } = await pendingLaunch('campaign');
      location.href = 'http://localhost:5173/?room=back-forward-target';
      window.dispatchEvent(new Event(event));
      const screen = table.useTable.getState();
      pending.resolve(response({ id: 'stale-room' }));
      await launched;
      expect(signal.aborted).toBe(true);
      expect(table.useTable.getState()).toBe(screen);
      expect(location.search).toBe('?room=back-forward-target');
      expect(history.replaceState).not.toHaveBeenCalled();
      expect(Socket.instances).toHaveLength(0);
    });
  }
  it('detects history navigation even without a popstate event', async () => {
    const { pending, launched } = await pendingLaunch('campaign');
    location.href = 'http://localhost:5173/?room=newer-navigation';
    pending.resolve(response({ id: 'stale-room' }));
    await launched;
    expect(location.search).toBe('?room=newer-navigation');
    expect(table.useTable.getState().status).toBe('demo');
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(Socket.instances).toHaveLength(0);
  });
  it('restores the demo and reports a current launch failure', async () => {
    const { pending, launched } = await pendingLaunch('campaign');
    const rejected = expect(launched).rejects.toThrow('Current failure');
    pending.reject(new Error('Current failure'));
    await rejected;
    expect(table.useTable.getState()).toMatchObject({ status: 'demo', dialog: 'launch' });
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(Socket.instances).toHaveLength(0);
  });
  it('ignores deferred response JSON after closing the launch dialog', async () => {
    connection.launchDemo();
    table.useTable.getState().set({ dialog: 'launch' });
    const body = deferred<{ id: string; inviteCode: string }>();
    const json = vi.fn(() => body.promise);
    vi.mocked(fetch).mockResolvedValueOnce(
      response({ id: 'new-user', name: 'New', token: 'new-token' }),
    );
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json } as unknown as Response);
    const launched = connection.launch('New', 'Stale campaign');
    await vi.waitFor(() => expect(json).toHaveBeenCalled());
    table.useTable.getState().set({ dialog: null });
    const screen = table.useTable.getState();
    body.resolve({ id: 'stale-room', inviteCode: 'stale-code' });
    await launched;
    expect(table.useTable.getState()).toBe(screen);
    expect(location.search).toBe('');
    expect(Socket.instances).toHaveLength(0);
  });

  describe('hosted authentication cancellation', () => {
    const signedIn = {
      data: {
        session: {
          access_token: 'hosted-token',
          user: {
            id: 'hosted-user',
            email: 'user@example.test',
            user_metadata: { name: 'Hosted' },
          },
        },
      },
      error: null,
    };
    beforeEach(async () => {
      vi.resetModules();
      vi.stubEnv('VITE_SUPABASE_URL', 'https://supabase.example.test');
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-key');
      auth.getSession.mockReset().mockResolvedValue(signedIn);
      auth.signInWithPassword.mockReset();
      connection = await import('../src/connection.js');
      table = await import('../src/store.js');
      await connection.currentAccount();
      table.useTable.getState().set({ dialog: 'launch' });
      vi.mocked(fetch).mockClear();
      vi.mocked(localStorage.setItem).mockClear();
    });
    for (const settle of ['resolve', 'reject'] as const) {
      it(`ignores a hosted sign-in ${settle} after cancellation`, async () => {
        const pending = deferred<typeof signedIn>();
        auth.signInWithPassword.mockReturnValueOnce(pending.promise);
        const launched = connection.launch(
          'New',
          'Cancelled campaign',
          undefined,
          undefined,
          'user@example.test',
          'password',
        );
        table.useTable.getState().set({ dialog: null });
        const screen = table.useTable.getState();
        if (settle === 'resolve') pending.resolve(signedIn);
        else pending.reject(new Error('Late hosted failure'));
        await launched;
        expect(table.useTable.getState()).toBe(screen);
        expect(fetch).not.toHaveBeenCalled();
        expect(history.replaceState).not.toHaveBeenCalled();
        expect(Socket.instances).toHaveLength(0);
        expect(auth.getSession).toHaveBeenCalledTimes(1);
      });
    }
    it('does not restore a late account into a dismissed flow', async () => {
      const pending = deferred<typeof signedIn>();
      auth.getSession.mockReturnValueOnce(pending.promise);
      const account = connection.currentAccount();
      table.useTable.getState().set({ dialog: null });
      pending.resolve({
        data: { session: { ...signedIn.data.session, access_token: 'stale-token' } },
        error: null,
      });
      expect(await account).toBeNull();
      auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
      await connection.authorizedFetch('/api/test');
      expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('Authorization')).toBe(
        'Bearer hosted-token',
      );
    });
    it('does not refresh a launch token after navigation while preparing campaign creation', async () => {
      const pending = deferred<typeof signedIn>();
      auth.getSession.mockResolvedValueOnce(signedIn).mockReturnValueOnce(pending.promise);
      const launched = connection.launch('New', 'Cancelled campaign');
      await vi.waitFor(() => expect(auth.getSession).toHaveBeenCalledTimes(3));
      window.dispatchEvent(new Event('popstate'));
      const screen = table.useTable.getState();
      pending.resolve(signedIn);
      await launched;
      expect(table.useTable.getState()).toBe(screen);
      expect(fetch).not.toHaveBeenCalled();
      expect(history.replaceState).not.toHaveBeenCalled();
      expect(Socket.instances).toHaveLength(0);
    });
  });
});
