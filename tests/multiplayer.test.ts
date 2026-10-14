import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { FilePersistence, metrics } from '../server/persistence.js';
import { LocalAuth } from '../server/auth.js';
import { RoomManager } from '../server/rooms.js';
import { createApp } from '../server/app.js';
import type { Action, ServerMessage } from '../shared/protocol.js';
import type { Token } from '../shared/model.js';
class Client {
  messages: ServerMessage[] = [];
  ws: WebSocket;
  constructor(url: string) {
    this.ws = new WebSocket(url, { origin: 'http://localhost:5173' });
    this.ws.on('message', (data) => this.messages.push(JSON.parse(data.toString())));
  }
  async open() {
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    return this;
  }
  send(action: Action, id = randomUUID()) {
    this.ws.send(JSON.stringify({ ...action, v: 2, actionId: id }));
    return id;
  }
  async wait<T extends ServerMessage['type']>(
    type: T,
    predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const index = this.messages.findIndex(
        (m) => m.type === type && predicate(m as Extract<ServerMessage, { type: T }>),
      );
      if (index >= 0)
        return this.messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`No ${type} response: ${JSON.stringify(this.messages)}`);
  }
}
describe('real authoritative WebSocket server', () => {
  let dir: string,
    storage: FilePersistence,
    auth: LocalAuth,
    manager: RoomManager,
    app: ReturnType<typeof createApp>,
    url: string,
    owner: ReturnType<LocalAuth['issue']>,
    player: ReturnType<LocalAuth['issue']>,
    room: { id: string; inviteCode: string };
  const clients: Client[] = [];
  async function start() {
    manager = new RoomManager(storage, 60000, 100);
    app = createApp(manager, auth, new Set(['http://localhost:5173']));
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
  }
  async function client(identity: ReturnType<LocalAuth['issue']>, invite = room.inviteCode) {
    const c = await new Client(url).open();
    clients.push(c);
    c.send({ type: 'JOIN_ROOM', roomId: room.id, token: identity.token, inviteCode: invite });
    return c;
  }
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aether-test-'));
    storage = new FilePersistence(dir);
    auth = new LocalAuth('test-only-signing-key');
    owner = auth.issue('GM');
    player = auth.issue('Player');
    await start();
    room = await manager.create(owner, 'Testing Table');
  });
  afterEach(async () => {
    clients.forEach((c) => c.ws.terminate());
    clients.length = 0;
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  it('lets one GM account enter as a player without demotion and enforces that connection role', async () => {
    const gm = await client(owner);
    const initial = await gm.wait('ROOM_SNAPSHOT');
    const playerMode = await new Client(url).open();
    clients.push(playerMode);
    playerMode.send({ type: 'JOIN_ROOM', roomId: room.id, token: owner.token, role: 'player' });
    expect(await playerMode.wait('ROOM_SNAPSHOT')).toMatchObject({
      self: { role: 'player' },
      canGM: true,
    });
    const secret = {
      ...initial.state.scenes.hollow.tokens.sentinel,
      visibility: 'gm' as const,
      note: 'Hidden clue',
    };
    const edit = gm.send({ type: 'TOKEN_UPDATE', sceneId: 'hollow', token: secret });
    await gm.wait('STATE_PATCH', (m) => m.actionId === edit);
    const hiddenPatch = await playerMode.wait('STATE_PATCH', (m) => m.actionId === edit);
    expect(JSON.stringify(hiddenPatch)).not.toContain('Hidden clue');
    const denied = playerMode.send({
      type: 'FOG_UPDATE',
      sceneId: 'hollow',
      fog: { enabled: true, revealed: [] },
    });
    expect((await playerMode.wait('ERROR', (m) => m.actionId === denied)).message).toContain(
      'game master',
    );
    const deniedInvite = playerMode.send({ type: 'INVITE_ROTATE' });
    await playerMode.wait('ERROR', (m) => m.actionId === deniedInvite);
    const move = playerMode.send({
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 400, y: 400 },
    });
    await playerMode.wait('STATE_PATCH', (m) => m.actionId === move);
    playerMode.send({ type: 'STATE_RESYNC' });
    const projected = await playerMode.wait('ROOM_SNAPSHOT');
    expect(projected.state.scenes.hollow.tokens.sentinel).toBeUndefined();
    expect(projected.inviteCode).toBeUndefined();
    playerMode.send({ type: 'SESSION_ROLE', role: 'gm' });
    expect(await playerMode.wait('ROOM_SNAPSHOT')).toMatchObject({
      self: { role: 'gm' },
      canGM: true,
      state: { scenes: { hollow: { tokens: { sentinel: { note: 'Hidden clue' } } } } },
    });
    playerMode.send({ type: 'SESSION_ROLE', role: 'player' });
    await playerMode.wait('ROOM_SNAPSHOT');
    gm.send({ type: 'STATE_RESYNC' });
    expect(await gm.wait('ROOM_SNAPSHOT')).toMatchObject({ self: { role: 'gm' } });
    const pc = await client(player);
    await pc.wait('ROOM_SNAPSHOT');
    const escalate = pc.send({ type: 'SESSION_ROLE', role: 'gm' });
    expect((await pc.wait('ERROR', (m) => m.actionId === escalate)).message).toContain(
      'campaign GM',
    );
  });
  it('two independent clients move tokens, receive identical rolls, and gameplay does not write snapshots', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const pc = await client(player);
    const joined = await pc.wait('ROOM_SNAPSHOT');
    expect(joined.self.role).toBe('player');
    const writes = metrics.writes;
    const id = pc.send({
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 777, y: 333 },
    });
    const a = await gm.wait('STATE_PATCH', (m) => m.actionId === id),
      b = await pc.wait('STATE_PATCH', (m) => m.actionId === id);
    expect(a).toEqual(b);
    expect(a.changes[0]).toMatchObject({ kind: 'token', token: { x: 760, y: 360 } });
    const rollId = pc.send({
      type: 'DICE_ROLL_REQUEST',
      expression: '1d20+5-2',
      visibility: 'public',
    });
    const ar = await gm.wait('DICE_ROLL_RESULT', (m) => m.roll.actionId === rollId),
      br = await pc.wait('DICE_ROLL_RESULT', (m) => m.roll.actionId === rollId);
    expect(ar).toEqual(br);
    expect(ar.roll.total).toBe(ar.roll.terms[0].values[0] + 3);
    expect(metrics.writes).toBe(writes);
    await manager.flushAll();
    expect(metrics.writes).toBe(writes + 1);
  });
  it('filters private rolls, GM token previews, notes, and snapshots server-side', async () => {
    const gm = await client(owner),
      snap = await gm.wait('ROOM_SNAPSHOT');
    const pc = await client(player);
    await pc.wait('ROOM_SNAPSHOT');
    const hidden: Token = {
      ...snap.state.scenes.hollow.tokens.mage,
      visibility: 'gm',
      note: 'secret spell',
    };
    const tid = gm.send({ type: 'TOKEN_UPDATE', sceneId: 'hollow', token: hidden });
    expect((await pc.wait('STATE_PATCH', (m) => m.actionId === tid)).changes).toEqual([
      { kind: 'token-delete', sceneId: 'hollow', tokenId: 'mage' },
    ]);
    gm.send({
      type: 'TOKEN_MOVE_PREVIEW',
      sceneId: 'hollow',
      tokenId: 'mage',
      position: { x: 500, y: 500 },
    });
    const newHidden = gm.send({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...hidden, id: 'unseen-secret' },
    });
    expect((await pc.wait('STATE_PATCH', (m) => m.actionId === newHidden)).changes).toEqual([]);
    const deleteHidden = gm.send({
      type: 'TOKEN_DELETE',
      sceneId: 'hollow',
      tokenId: 'unseen-secret',
    });
    expect((await pc.wait('STATE_PATCH', (m) => m.actionId === deleteHidden)).changes).toEqual([]);
    const rid = gm.send({ type: 'DICE_ROLL_REQUEST', expression: 'd20', visibility: 'private' });
    await gm.wait('DICE_ROLL_RESULT', (m) => m.roll.actionId === rid);
    expect((await pc.wait('STATE_PATCH', (m) => m.actionId === rid)).changes).toEqual([]);
    pc.send({ type: 'STATE_RESYNC' });
    const projected = await pc.wait('ROOM_SNAPSHOT');
    expect(projected.state.scenes.hollow.tokens.mage).toBeUndefined();
    expect(projected.state.rolls).toHaveLength(0);
    expect(projected.inviteCode).toBeUndefined();
    expect(
      pc.messages.some((m) => m.type === 'DICE_ROLL_RESULT' || m.type === 'TOKEN_MOVE_PREVIEW'),
    ).toBe(false);
  });
  it('rejects forged identity, missing invitations, and unauthorised edits', async () => {
    const bad = await client({ ...player, token: `${player.token.slice(0, -1)}!` });
    expect((await bad.wait('ERROR')).message).toContain('Invalid');
    const stranger = await client(auth.issue('Stranger'), 'wrong');
    expect((await stranger.wait('ERROR')).message).toContain('invitation');
    const pc = await client(player);
    const s = await pc.wait('ROOM_SNAPSHOT');
    const id = pc.send({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...s.state.scenes.hollow.tokens.ranger, owners: [player.id] },
    });
    expect((await pc.wait('ERROR', (m) => m.actionId === id)).message).toContain('game master');
    const gm = await client(owner);
    const snap = await gm.wait('ROOM_SNAPSHOT');
    const change = gm.send({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...snap.state.scenes.hollow.tokens.ranger, owners: [] },
    });
    await pc.wait('STATE_PATCH', (m) => m.actionId === change);
    const move = pc.send({
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 1, y: 1 },
    });
    expect((await pc.wait('ERROR', (m) => m.actionId === move)).message).toContain(
      'do not control',
    );
  });
  it('withholds fogged tokens and reveals their data only after GM reveal', async () => {
    const gm = await client(owner),
      snap = await gm.wait('ROOM_SNAPSHOT');
    const pc = await client(player);
    await pc.wait('ROOM_SNAPSHOT');
    const cover = gm.send({
      type: 'FOG_UPDATE',
      sceneId: 'hollow',
      fog: { enabled: true, revealed: [] },
    });
    const covered = await pc.wait('STATE_PATCH', (m) => m.actionId === cover);
    expect(covered.changes[0].kind).toBe('scene');
    if (covered.changes[0].kind === 'scene')
      expect(Object.keys(covered.changes[0].scene.tokens)).toEqual([]);
    const t = snap.state.scenes.hollow.tokens.ranger;
    const reveal = gm.send({
      type: 'FOG_UPDATE',
      sceneId: 'hollow',
      fog: { enabled: true, revealed: [{ x: t.x, y: t.y, radius: 100 }] },
    });
    const revealed = await pc.wait('STATE_PATCH', (m) => m.actionId === reveal);
    expect(revealed.changes[0]).toMatchObject({
      kind: 'scene',
      scene: { tokens: { ranger: { id: 'ranger' } } },
    });
  });
  it('restores persisted state and private history on a fresh server, and deduplicates roll actions', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const move = gm.send({
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 350, y: 350 },
    });
    await gm.wait('STATE_PATCH', (m) => m.actionId === move);
    const rid = gm.send({ type: 'DICE_ROLL_REQUEST', expression: '2d6-2', visibility: 'private' });
    const rolled = await gm.wait('DICE_ROLL_RESULT', (m) => m.roll.actionId === rid);
    await manager.flushAll();
    await app.close();
    await start();
    const rejoined = await client(owner);
    const recovered = await rejoined.wait('ROOM_SNAPSHOT');
    expect(recovered.state.scenes.hollow.tokens.ranger).toMatchObject({ x: 360, y: 360 });
    expect(recovered.state.rolls[0]).toEqual(rolled.roll);
    const writes = metrics.writes;
    rejoined.send({ type: 'DICE_ROLL_REQUEST', expression: '2d6-2', visibility: 'private' }, rid);
    const deduped = await rejoined.wait('ROOM_SNAPSHOT');
    expect(deduped.state.rolls).toHaveLength(1);
    expect(metrics.writes).toBe(writes);
  });
  it('persists on configured dirty interval without flushing every action', async () => {
    await app.close();
    manager = new RoomManager(storage, 80, 20);
    app = createApp(manager, auth, new Set(['http://localhost:5173']));
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const writes = metrics.writes;
    for (let i = 0; i < 10; i++)
      gm.send({
        type: 'TOKEN_MOVE_COMMIT',
        sceneId: 'hollow',
        tokenId: 'ranger',
        position: { x: 400 + i, y: 400 },
      });
    await gm.wait('SAVED');
    expect(metrics.writes).toBe(writes + 1);
    const saved = await storage.load(room.id);
    expect(saved?.state.revision).toBe(10);
  });
  it('retains concurrent membership changes and gameplay while a snapshot is in flight', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const originalSave = storage.save.bind(storage);
    vi.spyOn(storage, 'save').mockImplementation(async (snapshot, version) => {
      await new Promise((r) => setTimeout(r, 60));
      return originalSave(snapshot, version);
    });
    const second = auth.issue('Another player'),
      [a, b] = await Promise.all([client(player), client(second)]);
    const id = gm.send({
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 840, y: 840 },
    });
    await gm.wait('STATE_PATCH', (m) => m.actionId === id);
    await Promise.all([a.wait('ROOM_SNAPSHOT'), b.wait('ROOM_SNAPSHOT')]);
    await manager.flushAll();
    const persisted = await storage.load(room.id);
    expect(Object.keys(persisted!.members).sort()).toEqual([owner.id, player.id, second.id].sort());
    expect(persisted!.state.scenes.hollow.tokens.ranger).toMatchObject({ x: 840, y: 840 });
  });
  it('keeps changed state dirty after a failed write so a later flush recovers it', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const id = gm.send({
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 920, y: 520 },
    });
    await gm.wait('STATE_PATCH', (m) => m.actionId === id);
    const originalSave = storage.save.bind(storage);
    vi.spyOn(storage, 'save')
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockImplementation(originalSave);
    await expect(manager.flushAll()).rejects.toThrow('Storage unavailable');
    expect((await storage.load(room.id))!.state.revision).toBe(0);
    await manager.flushAll();
    expect((await storage.load(room.id))!.state.scenes.hollow.tokens.ranger).toMatchObject({
      x: 920,
      y: 520,
    });
  });
});
