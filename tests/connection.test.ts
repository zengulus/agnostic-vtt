import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../shared/protocol.js';
import type { Roll } from '../shared/model.js';

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
    vi.stubGlobal('window', { addEventListener: vi.fn() });
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173' });
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
});
