import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import sharp from 'sharp';
import { FilePersistence } from '../server/persistence.js';
import { FileAssetStorage, normalizeImage, UPLOAD_LIMIT } from '../server/assets.js';
import { LocalAuth } from '../server/auth.js';
import { RoomManager } from '../server/rooms.js';
import { createApp } from '../server/app.js';
import { applyChanges } from '../shared/state.js';
import { hexToWorld, snapPoint, distance } from '../shared/geometry.js';
import { containsDisk, intersectsDisk, fogAllowsToken } from '../shared/regions.js';
import { newRoom } from '../shared/sample.js';
import { dicePreferencesSchema } from '../shared/diceThemes.js';
import type { Action, ServerMessage } from '../shared/protocol.js';
import type { FogOperation, RoomState, Token } from '../shared/model.js';

class Client {
  messages: ServerMessage[] = [];
  state!: RoomState;
  ws: WebSocket;
  constructor(url: string) {
    this.ws = new WebSocket(url, { origin: 'http://localhost:5173' });
    this.ws.on('message', (data) => {
      const message: ServerMessage = JSON.parse(data.toString());
      this.messages.push(message);
      if (message.type === 'ROOM_SNAPSHOT') this.state = message.state;
      if (message.type === 'STATE_PATCH')
        this.state = { ...applyChanges(this.state, message.changes), revision: message.revision };
    });
  }
  send(action: Action) {
    const actionId = randomUUID();
    this.ws.send(JSON.stringify({ ...action, v: 2, actionId }));
    return actionId;
  }
  async wait<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      const index = this.messages.findIndex(
        (m) => m.type === type && predicate(m as Extract<ServerMessage, { type: T }>),
      );
      if (index >= 0)
        return this.messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`Missing ${type}: ${JSON.stringify(this.messages)}`);
  }
  async commit(action: Action) {
    const id = this.send(action);
    return this.wait('STATE_PATCH', (m) => m.actionId === id);
  }
}

describe('campaign workshop over real HTTP and WebSockets', () => {
  let dir: string,
    storage: FilePersistence,
    manager: RoomManager,
    app: ReturnType<typeof createApp>,
    auth: LocalAuth,
    owner: ReturnType<LocalAuth['issue']>,
    player: ReturnType<LocalAuth['issue']>,
    room: { id: string; inviteCode: string },
    url: string,
    http: string;
  const clients: Client[] = [];
  async function start() {
    manager = new RoomManager(storage, 60000, 100);
    app = createApp(manager, auth, new Set(['http://localhost:5173']), new FileAssetStorage(dir));
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    http = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    url = http.replace('http:', 'ws:') + '/ws';
  }
  async function client(identity: ReturnType<LocalAuth['issue']>, invite = room.inviteCode) {
    const c = new Client(url);
    clients.push(c);
    await new Promise<void>((resolve, reject) => {
      c.ws.once('open', resolve);
      c.ws.once('error', reject);
    });
    c.send({ type: 'JOIN_ROOM', token: identity.token, roomId: room.id, inviteCode: invite });
    return c;
  }
  const request = (path: string, token = owner.token, init?: RequestInit) =>
    fetch(http + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init?.headers },
    });
  async function upload(purpose = 'map') {
    const png = await sharp({
      create: { width: 900, height: 700, channels: 4, background: '#46a07880' },
    })
      .png()
      .toBuffer();
    const response = await request(`/api/assets/${room.id}`, owner.token, {
      method: 'POST',
      body: new Uint8Array(png),
      headers: { 'X-Image-Name': 'test%20portrait.png', 'X-Image-Purpose': purpose },
    });
    expect(response.status).toBe(201);
    return response.json() as Promise<{
      id: string;
      asset: Token['image'];
      width: number;
      height: number;
    }>;
  }
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aether-workshop-'));
    storage = new FilePersistence(dir);
    auth = new LocalAuth('workshop-test-key');
    owner = auth.issue('Keeper');
    player = auth.issue('Wanderer');
    await start();
    room = await manager.create(owner, 'Workshop');
  });
  afterEach(async () => {
    clients.forEach((c) => c.ws.terminate());
    clients.length = 0;
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  it('protects uploaded portraits until referenced by visible content, and rechecks access after conceal', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const pc = await client(player);
    await pc.wait('ROOM_SNAPSHOT');
    const image = await upload('token');
    expect(image.width).toBe(512);
    expect(image.height).toBeLessThan(512);
    await gm.wait('ROOM_SNAPSHOT');
    await pc.wait('ROOM_SNAPSHOT');
    const path = `/api/assets/${room.id}/${image.id}`;
    expect((await request(path, player.token)).ok).toBe(false);
    expect((await fetch(http + path)).ok).toBe(false);
    const token = {
      ...gm.state.scenes.hollow.tokens.ranger,
      image: image.asset,
      note: 'GM secret',
    };
    const update = await gm.commit({ type: 'TOKEN_UPDATE', sceneId: 'hollow', token });
    await pc.wait('STATE_PATCH', (m) => m.actionId === update.actionId);
    expect(pc.state.assets?.[image.id]).toBeDefined();
    expect(pc.state.scenes.hollow.tokens.ranger.note).toBeUndefined();
    const read = await request(path, player.token);
    expect(read.headers.get('content-type')).toBe('image/webp');
    expect(read.headers.get('cache-control')).toContain('no-store');
    expect((await sharp(Buffer.from(await read.arrayBuffer())).metadata()).hasAlpha).toBe(true);
    const conceal = await gm.commit({
      type: 'FOG_APPEND',
      sceneId: 'hollow',
      operation: {
        id: 'cover',
        mode: 'conceal',
        shape: 'rectangle',
        x: 0,
        y: 0,
        width: 1600,
        height: 1200,
      },
    });
    await pc.wait('STATE_PATCH', (m) => m.actionId === conceal.actionId);
    expect(pc.state.scenes.hollow.tokens.ranger).toBeUndefined();
    expect(pc.state.assets?.[image.id]).toBeUndefined();
    expect((await request(path, player.token)).ok).toBe(false);
    expect((await request(path, owner.token)).ok).toBe(true);
    expect((await request(`/api/assets/${room.id}/constructor`)).ok).toBe(false);
  });
  it('rejects foreign image references and deletion of images still in use', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const image = await upload();
    await gm.wait('ROOM_SNAPSHOT');
    const scene = gm.state.scenes.hollow;
    await gm.commit({
      type: 'SCENE_CONFIG',
      sceneId: scene.id,
      name: scene.name,
      width: scene.width,
      height: scene.height,
      map: image.asset,
      create: false,
    });
    const used = await request(`/api/assets/${room.id}/${image.id}`, owner.token, {
      method: 'DELETE',
    });
    expect(await used.json()).toMatchObject({ error: expect.stringContaining('still used') });
    const other = await manager.create(owner, 'Other');
    const otherClient = new Client(url);
    clients.push(otherClient);
    await new Promise<void>((r) => otherClient.ws.once('open', r));
    otherClient.send({ type: 'JOIN_ROOM', roomId: other.id, token: owner.token });
    await otherClient.wait('ROOM_SNAPSHOT');
    const invalid = otherClient.send({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...scene.tokens.ranger, image: image.asset },
    });
    expect((await otherClient.wait('ERROR', (m) => m.actionId === invalid)).message).toContain(
      'not part',
    );
    await gm.commit({
      type: 'SCENE_CONFIG',
      sceneId: scene.id,
      name: scene.name,
      width: scene.width,
      height: scene.height,
      map: scene.map,
      create: false,
    });
    expect(
      (await request(`/api/assets/${room.id}/${image.id}`, owner.token, { method: 'DELETE' })).ok,
    ).toBe(true);
    expect((await request(`/api/assets/${room.id}/${image.id}`)).ok).toBe(false);
    expect(await readdir(join(dir, 'assets', room.id))).toEqual([]);
  });
  it('rolls back the image manifest and stored file when persistence fails', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const originalSave = storage.save.bind(storage);
    const save = vi
      .spyOn(storage, 'save')
      .mockImplementationOnce(originalSave) // durable pre-upload cleanup intent
      .mockRejectedValueOnce(new Error('Offline storage'));
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#338844' },
    })
      .png()
      .toBuffer();
    const failed = await request(`/api/assets/${room.id}`, owner.token, {
      method: 'POST',
      body: new Uint8Array(png),
    });
    expect(failed.ok).toBe(false);
    save.mockRestore();
    gm.send({ type: 'STATE_RESYNC' });
    const snapshot = await gm.wait('ROOM_SNAPSHOT');
    expect(snapshot.state.assets).toEqual({});
    expect(await readdir(join(dir, 'assets', room.id))).toEqual([]);
    await manager.flushAll();
    expect((await storage.load(room.id))?.state.assets).toEqual({});
  });
  it('rejects player uploads and filters mixed public/private group previews', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const pc = await client(player);
    await pc.wait('ROOM_SNAPSHOT');
    const response = await request(`/api/assets/${room.id}`, player.token, {
      method: 'POST',
      body: new Uint8Array([1, 2, 3]),
    });
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('game master') });
    await gm.commit({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...gm.state.scenes.hollow.tokens.mage, visibility: 'gm' },
    });
    gm.send({
      type: 'TOKEN_MOVE_PREVIEW_BATCH',
      sceneId: 'hollow',
      positions: [
        { tokenId: 'ranger', position: { x: 300, y: 300 } },
        { tokenId: 'mage', position: { x: 400, y: 300 } },
      ],
    });
    const preview = await pc.wait('TOKEN_MOVE_PREVIEW_BATCH');
    expect(preview.positions).toEqual([{ tokenId: 'ranger', position: { x: 300, y: 300 } }]);
    expect(gm.state.scenes.hollow.tokens.ranger.x).toBe(600);
  });
  it('bounds shared undo history and discards redo after a new edit', async () => {
    const messages: ServerMessage[] = [],
      peer = { identity: owner, send: (m: ServerMessage) => messages.push(m) };
    await manager.join(peer, room.id);
    const token = (await manager.authorize(room.id, owner.id)).state.scenes.hollow.tokens.ranger;
    const action = (a: Action) =>
      manager.handle(peer, room.id, { ...a, v: 2, actionId: randomUUID() });
    for (let i = 0; i < 55; i++)
      action({ type: 'TOKEN_UPDATE', sceneId: 'hollow', token: { ...token, name: `Edit ${i}` } });
    for (let i = 0; i < 50; i++) action({ type: 'UNDO' });
    expect(
      (await manager.authorize(room.id, owner.id)).state.scenes.hollow.tokens.ranger.name,
    ).toBe('Edit 4');
    expect(() => action({ type: 'UNDO' })).toThrow('Nothing to undo');
    action({ type: 'REDO' });
    action({
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 300, y: 300 },
    });
    expect(() => action({ type: 'REDO' })).toThrow('Nothing to redo');
    expect(messages.filter((m) => m.type === 'HISTORY_STATUS').at(-1)).toMatchObject({
      history: { canUndo: true, canRedo: false },
    });
  });
  it('filters GM drawings, templates, hidden participants and their deletions', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const pc = await client(player);
    await pc.wait('ROOM_SNAPSHOT');
    const annotation = {
      id: 'secret-label',
      kind: 'text' as const,
      points: [{ x: 100, y: 100 }],
      color: '#ffffff',
      width: 2,
      text: 'Hidden passage',
      visibility: 'gm' as const,
    };
    const a = await gm.commit({ type: 'ANNOTATION_UPDATE', sceneId: 'hollow', annotation });
    expect((await pc.wait('STATE_PATCH', (m) => m.actionId === a.actionId)).changes).toEqual([]);
    const l = await gm.commit({
      type: 'LIBRARY_SAVE',
      token: { ...gm.state.scenes.hollow.tokens.mage, id: 'hidden-template', visibility: 'gm' },
    });
    expect((await pc.wait('STATE_PATCH', (m) => m.actionId === l.actionId)).changes).toEqual([]);
    const t = await gm.commit({
      type: 'TRACKER_UPDATE',
      tracker: {
        round: 3,
        activeId: 'shadow',
        order: 'manual',
        entries: [
          { id: 'shadow', name: 'Unseen watcher', value: 12, hidden: true },
          { id: 'public', name: 'Guide', value: 8, hidden: false },
        ],
      },
    });
    await pc.wait('STATE_PATCH', (m) => m.actionId === t.actionId);
    expect(pc.state.tracker).toEqual({
      round: 3,
      activeId: null,
      order: 'manual',
      entries: [{ id: 'public', name: 'Guide', value: 8, hidden: false }],
    });
    const d = await gm.commit({ type: 'ANNOTATION_DELETE', sceneId: 'hollow', id: annotation.id });
    expect((await pc.wait('STATE_PATCH', (m) => m.actionId === d.actionId)).changes).toEqual([]);
    expect(JSON.stringify(pc.state)).not.toMatch(
      /Hidden passage|hidden-template|Unseen watcher|shadow/,
    );
  });
  it('groups a complete fog stroke into one undo, replays every dot, and projects polygon/rectangle visibility', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const pc = await client(player);
    await pc.wait('ROOM_SNAPSHOT');
    await gm.commit({
      type: 'FOG_UPDATE',
      sceneId: 'hollow',
      fog: { enabled: true, revealed: [] },
    });
    for (const [i, x] of [600, 720, 840].entries())
      await gm.commit({
        type: 'FOG_APPEND',
        sceneId: 'hollow',
        groupId: 'one-stroke',
        operation: { id: `dot-${i}`, mode: 'reveal', shape: 'circle', x, y: 680, radius: 100 },
      });
    expect(gm.state.scenes.hollow.fog.operations).toHaveLength(3);
    const undo = await gm.commit({ type: 'UNDO' });
    await pc.wait('STATE_PATCH', (m) => m.actionId === undo.actionId);
    expect(gm.state.scenes.hollow.fog.operations || []).toHaveLength(0);
    expect(pc.state.scenes.hollow.tokens.ranger).toBeUndefined();
    const redo = await gm.commit({ type: 'REDO' });
    await pc.wait('STATE_PATCH', (m) => m.actionId === redo.actionId);
    expect(gm.state.scenes.hollow.fog.operations).toHaveLength(3);
    expect(pc.state.scenes.hollow.tokens.ranger).toBeDefined();
    const hide = await gm.commit({
      type: 'FOG_APPEND',
      sceneId: 'hollow',
      operation: {
        id: 'rectangle',
        mode: 'conceal',
        shape: 'rectangle',
        x: 550,
        y: 630,
        width: 100,
        height: 100,
      },
    });
    await pc.wait('STATE_PATCH', (m) => m.actionId === hide.actionId);
    expect(pc.state.scenes.hollow.tokens.ranger).toBeUndefined();
    const reveal = await gm.commit({
      type: 'FOG_APPEND',
      sceneId: 'hollow',
      operation: {
        id: 'polygon',
        mode: 'reveal',
        shape: 'polygon',
        x: 500,
        y: 580,
        points: [
          { x: 500, y: 580 },
          { x: 700, y: 580 },
          { x: 700, y: 780 },
          { x: 500, y: 780 },
        ],
      },
    });
    await pc.wait('STATE_PATCH', (m) => m.actionId === reveal.actionId);
    expect(pc.state.scenes.hollow.tokens.ranger).toBeDefined();
  });
  it('undoes and redoes a complete erase gesture without revealing private annotations', async () => {
    const gm = await client(owner),
      pc = await client(player);
    await gm.wait('ROOM_SNAPSHOT');
    await pc.wait('ROOM_SNAPSHOT');
    const annotation = {
      kind: 'stroke' as const,
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      color: '#ffffff',
      width: 4,
      text: '',
    };
    for (const visibility of ['public', 'gm'] as const) {
      const patch = await gm.commit({
        type: 'ANNOTATION_UPDATE',
        sceneId: 'hollow',
        annotation: { ...annotation, id: visibility, visibility },
      });
      await pc.wait('STATE_PATCH', (m) => m.actionId === patch.actionId);
    }
    const before = structuredClone(gm.state.scenes.hollow.annotations);
    const addedZone = await gm.commit({
      type: 'ZONE_UPDATE',
      sceneId: 'hollow',
      zone: {
        id: 'zone',
        shape: 'rectangle',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        color: '#ffffff',
        label: 'Zone',
      },
    });
    await pc.wait('STATE_PATCH', (m) => m.actionId === addedZone.actionId);
    const zonesBefore = structuredClone(gm.state.scenes.hollow.zones);
    const erased = await gm.commit({
      type: 'OBJECTS_DELETE',
      sceneId: 'hollow',
      annotationIds: ['public', 'gm'],
      zoneIds: ['zone'],
    });
    const publicPatch = await pc.wait('STATE_PATCH', (m) => m.actionId === erased.actionId);
    expect(publicPatch.changes).toEqual([
      { kind: 'annotation-delete', sceneId: 'hollow', id: 'public' },
      { kind: 'zone-delete', sceneId: 'hollow', id: 'zone' },
    ]);
    expect(gm.state.scenes.hollow.annotations).toEqual({});
    expect(gm.state.scenes.hollow.zones).toEqual({});
    const undone = await gm.commit({ type: 'UNDO' });
    const restorePatch = await pc.wait('STATE_PATCH', (m) => m.actionId === undone.actionId);
    expect(gm.state.scenes.hollow.annotations).toEqual(before);
    expect(restorePatch.changes).toHaveLength(2);
    expect(gm.state.scenes.hollow.zones).toEqual(zonesBefore);
    expect(pc.state.scenes.hollow.zones).toEqual(zonesBefore);
    expect(Object.keys(pc.state.scenes.hollow.annotations!)).toEqual(['public']);
    const redone = await gm.commit({ type: 'REDO' });
    await pc.wait('STATE_PATCH', (m) => m.actionId === redone.actionId);
    expect(gm.state.scenes.hollow.annotations).toEqual({});
    expect(pc.state.scenes.hollow.annotations).toEqual({});
    expect(pc.state.scenes.hollow.zones).toEqual({});
  });
  it('rejects a mixed-permission batch atomically and lets only GMs undo committed movement', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const pc = await client(player);
    await pc.wait('ROOM_SNAPSHOT');
    const original = gm.state.scenes.hollow.tokens.ranger;
    await gm.commit({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...gm.state.scenes.hollow.tokens.mage, owners: [owner.id] },
    });
    const invalid = pc.send({
      type: 'TOKEN_MOVE_BATCH',
      sceneId: 'hollow',
      positions: [
        { tokenId: 'ranger', position: { x: 100, y: 100 } },
        { tokenId: 'mage', position: { x: 100, y: 100 } },
      ],
    });
    await pc.wait('ERROR', (m) => m.actionId === invalid);
    expect(gm.state.scenes.hollow.tokens.ranger).toEqual(original);
    await pc.commit({
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 400, y: 400 },
    });
    const invalidUndo = pc.send({ type: 'UNDO' });
    await pc.wait('ERROR', (m) => m.actionId === invalidUndo);
    await gm.commit({ type: 'CHAT_SEND', text: 'We remember this message.' });
    await gm.commit({ type: 'DICE_ROLL_REQUEST', expression: '2d6+3', visibility: 'public' });
    await gm.commit({ type: 'UNDO' });
    expect(gm.state.scenes.hollow.tokens.ranger).toEqual(original);
    expect(gm.state.chat.at(-1)?.text).toBe('We remember this message.');
    expect(gm.state.rolls).toHaveLength(1);
  });
  it('retains new scene objects, templates, statuses and tracker across a server restart', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    await gm.commit({
      type: 'LIBRARY_SAVE',
      token: {
        ...gm.state.scenes.hollow.tokens.ranger,
        id: 'traveller',
        statuses: [{ id: 'mark', label: 'Marked', color: '#ffeebb', icon: 'star' }],
      },
    });
    await gm.commit({
      type: 'ANNOTATION_UPDATE',
      sceneId: 'hollow',
      annotation: {
        id: 'route',
        kind: 'stroke',
        points: [
          { x: 10, y: 20 },
          { x: 40, y: 80 },
        ],
        color: '#ffffff',
        width: 3,
        text: '',
        visibility: 'public',
      },
    });
    await gm.commit({
      type: 'ZONE_UPDATE',
      sceneId: 'hollow',
      zone: {
        id: 'cone',
        shape: 'cone',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        label: 'Signal',
        color: '#aabbcc',
        tags: ['custom'],
        opacity: 0.35,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
          { x: 60, y: 110 },
        ],
      },
    });
    await gm.commit({
      type: 'GRID_UPDATE',
      sceneId: 'hollow',
      grid: { ...gm.state.scenes.hollow.grid, type: 'hex', measurement: 'grid' },
    });
    await gm.commit({
      type: 'TRACKER_UPDATE',
      tracker: {
        entries: [{ id: 'one', name: 'Traveller', value: -2, hidden: false }],
        activeId: 'one',
        round: 7,
        order: 'manual',
      },
    });
    const before = structuredClone(gm.state);
    await manager.flushAll();
    clients.forEach((c) => c.ws.terminate());
    await app.close();
    await start();
    const fresh = await client(owner);
    const snapshot = await fresh.wait('ROOM_SNAPSHOT');
    expect(snapshot.state.scenes).toEqual(before.scenes);
    expect(snapshot.state.tokenLibrary).toEqual(before.tokenLibrary);
    expect(snapshot.state.tracker).toEqual(before.tracker);
    expect((await fresh.wait('HISTORY_STATUS')).history.canUndo).toBe(false);
  });
  it('promotes/demotes immediately, rotates invitations, revokes access, and lists only member campaigns', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    const pc = await client(player);
    await pc.wait('ROOM_SNAPSHOT');
    await gm.commit({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...gm.state.scenes.hollow.tokens.mage, visibility: 'gm', note: 'Secret' },
    });
    gm.send({ type: 'MEMBER_UPDATE', userId: player.id, role: 'gm' });
    expect(
      (await pc.wait('ROOM_SNAPSHOT', (m) => m.self.role === 'gm')).state.scenes.hollow.tokens.mage
        .note,
    ).toBe('Secret');
    gm.send({ type: 'MEMBER_UPDATE', userId: player.id, role: 'player' });
    expect(
      (await pc.wait('ROOM_SNAPSHOT', (m) => m.self.role === 'player')).state.scenes.hollow.tokens
        .mage,
    ).toBeUndefined();
    gm.send({ type: 'INVITE_ROTATE' });
    const rotated = await gm.wait('ROOM_SNAPSHOT', (m) => m.inviteCode !== room.inviteCode);
    expect(rotated.inviteCode).toBeTruthy();
    const stranger = auth.issue('Stranger');
    const denied = await client(stranger);
    expect((await denied.wait('ERROR')).message).toContain('invitation');
    const outsiderRoom = await manager.create(stranger, 'Private outsider table');
    await manager.flushAll();
    const listed = await (await request('/api/campaigns', player.token)).json();
    expect(listed.map((r: { id: string }) => r.id)).toContain(room.id);
    expect(listed.map((r: { id: string }) => r.id)).not.toContain(outsiderRoom.id);
    gm.send({ type: 'MEMBER_UPDATE', userId: player.id, role: 'remove' });
    await pc.wait('REVOKED');
    expect((await request(`/api/assets/${room.id}/anything`, player.token)).ok).toBe(false);
    const rejoin = await client(player, rotated.inviteCode);
    expect((await rejoin.wait('ERROR')).message).toContain('membership was removed');
    await manager.flushAll();
    expect(await (await request('/api/campaigns', player.token)).json()).toEqual([]);
  });
  it('advances through hidden turns and wraps rounds, with undo restoring the prior tracker', async () => {
    const gm = await client(owner);
    await gm.wait('ROOM_SNAPSHOT');
    await gm.commit({
      type: 'TRACKER_UPDATE',
      tracker: {
        entries: [
          { id: 'a', name: 'A', value: 4, hidden: false },
          { id: 'b', name: 'B', value: 2, hidden: true },
        ],
        activeId: 'b',
        round: 1,
        order: 'descending',
      },
    });
    await gm.commit({ type: 'TRACKER_ADVANCE', direction: 1 });
    expect(gm.state.tracker).toMatchObject({ activeId: 'a', round: 2 });
    await gm.commit({ type: 'UNDO' });
    expect(gm.state.tracker).toMatchObject({ activeId: 'b', round: 1 });
    await gm.commit({ type: 'TRACKER_ADVANCE', direction: -1 });
    expect(gm.state.tracker?.activeId).toBe('a');
  });
});

describe('geometry, image validation and visual preferences', () => {
  const scene = newRoom('testing', 'gm', 'GM', 'Table', 'invite').state.scenes.hollow;
  it('roundtrips aligned hex cells and measures square/hex and Euclidean distance', () => {
    const grid = {
      ...scene.grid,
      type: 'hex' as const,
      offsetX: 19,
      offsetY: -17,
      measurement: 'grid' as const,
    };
    const a = hexToWorld(-2, 3, grid),
      b = hexToWorld(1, 4, grid);
    expect(snapPoint({ x: a.x + 1, y: a.y - 1 }, grid)).toEqual(a);
    expect(distance(a, b, grid)).toBe(20);
    expect(distance({ x: 0, y: 0 }, { x: 80, y: 80 }, { ...scene.grid, measurement: 'grid' })).toBe(
      5,
    );
    expect(
      distance({ x: 0, y: 0 }, { x: 80, y: 80 }, { ...scene.grid, measurement: 'real' }),
    ).toBeCloseTo(Math.sqrt(2) * 5);
  });
  it('withholds footprints crossing concave polygon edges or a later conceal operation', () => {
    const reveal: FogOperation = {
      id: 'p',
      mode: 'reveal',
      shape: 'polygon',
      x: 0,
      y: 0,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 80 },
        { x: 80, y: 80 },
        { x: 80, y: 200 },
        { x: 0, y: 200 },
      ],
    };
    expect(containsDisk(reveal, { x: 50, y: 50 }, 10)).toBe(true);
    expect(containsDisk(reveal, { x: 75, y: 75 }, 20)).toBe(false);
    expect(intersectsDisk(reveal, { x: 100, y: 100 }, 25)).toBe(true);
    const token = { ...scene.tokens.ranger, x: 50, y: 50, size: 24 };
    const conceal: FogOperation = {
      id: 'c',
      mode: 'conceal',
      shape: 'circle',
      x: 65,
      y: 50,
      radius: 5,
    };
    expect(fogAllowsToken({ enabled: true, revealed: [], operations: [reveal] }, token)).toBe(true);
    expect(
      fogAllowsToken({ enabled: true, revealed: [], operations: [reveal, conceal] }, token),
    ).toBe(false);
    expect(
      fogAllowsToken({ enabled: true, revealed: [], operations: [reveal, conceal, reveal] }, token),
    ).toBe(true);
  });
  it('changes a single token without copying unrelated scenes, annotations or roll history', () => {
    const state = newRoom('testing', 'gm', 'GM', 'Table', 'invite').state;
    const next = applyChanges(state, [
      { kind: 'token', sceneId: 'hollow', token: { ...scene.tokens.ranger, x: 420 } },
    ]);
    expect(next.scenes.hollow.tokens.ranger.x).toBe(420);
    expect(state.scenes.hollow.tokens.ranger.x).toBe(600);
    expect(next.rolls).toBe(state.rolls);
    expect(next.scenes.sanctum).toBe(state.scenes.sanctum);
    expect(next.scenes.hollow.zones).toBe(state.scenes.hollow.zones);
  });
  it('validates preferences and supplies bounded backwards-compatible defaults', () => {
    expect(dicePreferencesSchema.parse({})).toMatchObject({
      opacity: 1,
      speed: 1,
      performance: 'balanced',
    });
    expect(dicePreferencesSchema.safeParse({ speed: 100, opacity: 2 }).success).toBe(false);
  });
  it('strips metadata, preserves alpha and bounds large uploaded images', async () => {
    const png = await sharp({
      create: { width: 4200, height: 100, channels: 4, background: '#44668880' },
    })
      .withMetadata()
      .png()
      .toBuffer();
    const image = await normalizeImage(png);
    const metadata = await sharp(image.data).metadata();
    expect(image.width).toBe(4096);
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.format).toBe('webp');
  });
  it('rejects SVG, corrupt, truncated, excessive-pixel and oversized image bodies', async () => {
    await expect(
      normalizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).rejects.toThrow('real PNG');
    await expect(
      normalizeImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])),
    ).rejects.toThrow('decoded');
    const huge = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#112233' },
    })
      .png()
      .toBuffer();
    await expect(normalizeImage(huge)).rejects.toThrow('20-megapixel');
    await expect(normalizeImage(huge.subarray(0, 200))).rejects.toThrow();
    await expect(normalizeImage(Buffer.alloc(UPLOAD_LIMIT + 1))).rejects.toThrow('10 MiB');
  });
});
