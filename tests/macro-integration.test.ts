import { macroDigest } from '../shared/macroDigest.js';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { FilePersistence } from '../server/persistence.js';
import { LocalAuth } from '../server/auth.js';
import { RoomManager } from '../server/rooms.js';
import { createApp } from '../server/app.js';
import { DiscordDelivery } from '../server/discord.js';
import { applyChanges } from '../shared/state.js';
import { macroText } from '../shared/macros.js';
import {
  serializeClientAction,
  MAX_CLIENT_MESSAGE_BYTES,
  type Action,
  type ServerMessage,
} from '../shared/protocol.js';
import type { RoomState } from '../shared/model.js';

const endpoint =
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_123456';
const example = String.raw`[Attack Name]\([Attack Roll(1d20 + X)],[Damage Roll(1d6 + [Fire(1d6)] + [Akashic(12)])`;
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
  send(action: Action, actionId: string = randomUUID()) {
    this.ws.send(JSON.stringify({ ...action, v: 2, actionId }));
    return actionId;
  }
  async wait<T extends ServerMessage['type']>(
    type: T,
    predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
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
describe('macros and campaign Discord over real HTTP/WebSockets', () => {
  const characterText = readFileSync(
    new URL('../public/examples/character.txt', import.meta.url),
    'utf8',
  );
  let dir: string,
    storage: FilePersistence,
    manager: RoomManager,
    app: ReturnType<typeof createApp>,
    auth: LocalAuth,
    owner: ReturnType<LocalAuth['issue']>,
    player: ReturnType<LocalAuth['issue']>,
    other: ReturnType<LocalAuth['issue']>,
    room: { id: string; inviteCode: string },
    http: string;
  const clients: Client[] = [],
    transport = vi.fn<typeof fetch>();
  async function start() {
    manager = new RoomManager(storage, 60000, 100, new DiscordDelivery(transport, async () => {}));
    app = createApp(manager, auth, new Set(['http://localhost:5173']));
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    http = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }
  async function client(identity = owner) {
    const c = new Client(http.replace('http:', 'ws:') + '/ws');
    clients.push(c);
    await new Promise<void>((resolve, reject) => {
      c.ws.once('open', resolve);
      c.ws.once('error', reject);
    });
    c.send({
      type: 'JOIN_ROOM',
      token: identity.token,
      roomId: room.id,
      inviteCode: room.inviteCode,
    });
    await c.wait('ROOM_SNAPSHOT');
    return c;
  }
  const request = (path = '', identity = owner, init: RequestInit = {}) =>
    fetch(`${http}/api/campaigns/${room.id}/discord${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${identity.token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  const configure = (mode = 'automatic', identity = owner, url = endpoint) =>
    request('', identity, { method: 'PUT', body: JSON.stringify({ url, enabled: true, mode }) });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aether-macros-'));
    storage = new FilePersistence(dir);
    auth = new LocalAuth('macro-test-key');
    owner = auth.issue('Keeper');
    player = auth.issue('Wanderer');
    other = auth.issue('Other');
    transport.mockReset().mockImplementation(async () => new Response('{"id":"message"}'));
    await start();
    room = await manager.create(owner, 'Macro campaign');
  });
  afterEach(async () => {
    clients.forEach((c) => c.ws.terminate());
    clients.length = 0;
    await app.close();
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  it('atomically imports multiple lines, rolls identically for all clients, and does not write per roll', async () => {
    const gm = await client(),
      pc = await client(player),
      save = vi.spyOn(storage, 'save');
    const imported = await gm.commit({
      type: 'MACRO_IMPORT',
      text: `${example}\r\n[Restoration]([Healing Roll(2d6 + [Divine(4)])])`,
      visibility: 'public',
    });
    await pc.wait('STATE_PATCH', (m) => m.actionId === imported.actionId);
    expect(Object.values(pc.state.macros!)).toHaveLength(2);
    const macro = Object.values(pc.state.macros!)[0];
    expect(macro.source.endsWith('])')).toBe(true);
    const variables = { X: 5 },
      action: Action = {
        type: 'MACRO_ROLL_REQUEST',
        id: macro.id,
        variables,
        visibility: 'public',
      },
      patch = await pc.commit(action);
    await gm.wait('STATE_PATCH', (m) => m.actionId === patch.actionId);
    const a = await gm.wait('DICE_ROLL_RESULT'),
      b = await pc.wait('DICE_ROLL_RESULT');
    expect(a).toEqual(b);
    const result = a.roll.macro!;
    expect(result.groups.map((g) => g.name)).toEqual(['Attack Roll', 'Damage Roll']);
    expect(result.groups[0].total).toBe(result.groups[0].terms[0].values[0] + 5);
    expect(result.groups[1].total).toBe(
      result.groups[1].terms[0].values[0] + result.groups[1].terms[1].values[0] + 12,
    );
    expect(macroText(result)).toContain('Fire damage + 12 Akashic damage');
    expect(pc.state.rolls).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    pc.send(action, patch.actionId);
    await pc.wait('ROOM_SNAPSHOT');
    expect(pc.state.rolls).toHaveLength(1);
    const before = pc.state.revision,
      id = pc.send({
        type: 'MACRO_IMPORT',
        text: `[Valid]([Check(1)])\n[Broken]([Check(d7)])`,
        visibility: 'public',
      });
    expect((await pc.wait('ERROR', (m) => m.actionId === id)).message).toContain('Line 2');
    expect(pc.state.revision).toBe(before);
    expect(Object.values(pc.state.macros!)).toHaveLength(2);
  });
  it('replaces a full library of long definitions over the bounded socket and persists reviewed content', async () => {
    const gm = await client();
    const definitions = Array.from(
      { length: 100 },
      (_, i) =>
        `[Roll ${i}](Select(1){${Array.from({ length: 4 }, () => 'x'.repeat(900)).join(',')}})`,
    );
    for (let batch = 0; batch < 10; batch++)
      await gm.commit({
        type: 'MACRO_IMPORT',
        text: definitions.slice(batch * 10, batch * 10 + 10).join('\n'),
        visibility: 'private',
      });
    const saved = Object.values(gm.state.macros!);
    const replacements = saved.map((macro, i) => ({
      line: i + 1,
      id: macro.id,
      digest: macroDigest(macro),
    }));
    const text = saved.map((macro) => `[${macro.name}]([Check(d6)])`).join('\n');
    const action: Action = { type: 'MACRO_IMPORT', text, visibility: 'public', replacements };
    expect(
      Buffer.byteLength(
        JSON.stringify({
          ...action,
          replacements: saved.map((macro, i) => ({
            line: i + 1,
            id: macro.id,
            source: macro.source,
          })),
        }),
      ),
    ).toBeGreaterThan(MAX_CLIENT_MESSAGE_BYTES);
    expect(Buffer.byteLength(serializeClientAction(action, 'replace-all'))).toBeLessThan(
      MAX_CLIENT_MESSAGE_BYTES,
    );
    await gm.commit(action);
    expect(gm.ws.readyState).toBe(WebSocket.OPEN);
    expect(Object.keys(gm.state.macros!)).toEqual(saved.map((macro) => macro.id));
    expect(
      Object.values(gm.state.macros!).every(
        (macro) => macro.visibility === 'private' && macro.source.includes('Check(d6)'),
      ),
    ).toBe(true);
    await manager.flushAll();
    expect((await storage.load(room.id))?.state.macros).toEqual(gm.state.macros);
    const staleId = gm.send(action);
    expect((await gm.wait('ERROR', (message) => message.actionId === staleId)).message).toContain(
      'changed since',
    );
    expect(gm.ws.readyState).toBe(WebSocket.OPEN);
  });
  it('protects private definitions and outcomes, validates variables, and authorizes deletion', async () => {
    const gm = await client(),
      pc = await client(player),
      spectator = await client(other);
    const imported = await pc.commit({
      type: 'MACRO_IMPORT',
      text: '[Secret ritual]([Focus Roll(d6 + X)])',
      visibility: 'private',
    });
    const id = Object.keys(pc.state.macros!)[0];
    expect(
      (await spectator.wait('STATE_PATCH', (m) => m.actionId === imported.actionId)).changes,
    ).toEqual([]);
    await gm.wait('STATE_PATCH', (m) => m.actionId === imported.actionId);
    expect(gm.state.macros![id]).toBeDefined();
    const denied = spectator.send({
      type: 'MACRO_ROLL_REQUEST',
      id,
      variables: { X: 2 },
      visibility: 'public',
    });
    expect((await spectator.wait('ERROR', (m) => m.actionId === denied)).message).toContain(
      'not found',
    );
    const missing = pc.send({
      type: 'MACRO_ROLL_REQUEST',
      id,
      variables: {},
      visibility: 'private',
    });
    expect((await pc.wait('ERROR', (m) => m.actionId === missing)).message).toContain('for X');
    const prototype = gm.send({
      type: 'MACRO_ROLL_REQUEST',
      id: 'toString',
      variables: {},
      visibility: 'public',
    });
    expect((await gm.wait('ERROR', (m) => m.actionId === prototype)).message).toBe(
      'Macro not found.',
    );
    const patch = await pc.commit({
      type: 'MACRO_ROLL_REQUEST',
      id,
      variables: { X: -2 },
      visibility: 'private',
    });
    await gm.wait('DICE_ROLL_RESULT');
    await pc.wait('DICE_ROLL_RESULT');
    expect(
      (await spectator.wait('STATE_PATCH', (m) => m.actionId === patch.actionId)).changes,
    ).toEqual([]);
    expect(spectator.state.rolls).toHaveLength(0);
    await pc.commit({ type: 'MACRO_IMPORT', text: '[Shared]([Check(d20)])', visibility: 'public' });
    await spectator.wait('STATE_PATCH', (m) =>
      m.changes.some((c) => c.kind === 'macro' && c.macro?.name === 'Shared'),
    );
    const shared = Object.values(spectator.state.macros!)[0],
      removal = spectator.send({ type: 'MACRO_DELETE', id: shared.id });
    expect((await spectator.wait('ERROR', (m) => m.actionId === removal)).message).toContain(
      'author',
    );
    await pc.commit({ type: 'MACRO_DELETE', id });
    expect(pc.state.macros![id]).toBeUndefined();
  });
  it('shares table picks, deduplicates requests and persists selections across restart', async () => {
    const gm = await client(),
      pc = await client(player);
    await configure();
    const imported = await gm.commit({
      type: 'MACRO_IMPORT',
      text: String.raw`[Grant Maneuvers]\(Select(3){**Lunge**, *Retreat*, Guard, Riposte, Feint})`,
      visibility: 'public',
    });
    await pc.wait('STATE_PATCH', (m) => m.actionId === imported.actionId);
    const id = Object.keys(pc.state.macros!)[0];
    const action: Action = { type: 'MACRO_ROLL_REQUEST', id, variables: {}, visibility: 'public' };
    const patch = await pc.commit(action);
    await gm.wait('STATE_PATCH', (m) => m.actionId === patch.actionId);
    const a = await gm.wait('DICE_ROLL_RESULT'),
      b = await pc.wait('DICE_ROLL_RESULT');
    expect(a).toEqual(b);
    const picks = a.roll.macro!.groups[0].selections!;
    expect(picks).toHaveLength(3);
    expect(new Set(picks).size).toBe(3);
    expect(
      picks.every((pick) => ['**Lunge**', '*Retreat*', 'Guard', 'Riposte', 'Feint'].includes(pick)),
    ).toBe(true);
    expect(a.roll.terms).toEqual([]);
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).embeds[0].fields[0].value).toBe(
      picks.map((pick) => `• ${pick}`).join('\n'),
    );
    pc.send(action, patch.actionId);
    await pc.wait('ROOM_SNAPSHOT');
    expect(pc.state.rolls).toHaveLength(1);
    expect(pc.state.rolls[0]).toEqual(a.roll);
    await pc.commit({ ...action, visibility: 'private' });
    await pc.wait('DICE_ROLL_RESULT', (m) => m.roll.visibility === 'private');
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(1);
    const before = pc.state.rolls;
    clients.forEach((c) => c.ws.terminate());
    clients.length = 0;
    await app.close();
    await start();
    const restored = await client(player);
    expect(restored.state.rolls).toEqual(before);
    expect(restored.state.macros![id].name).toBe('Grant Maneuvers');
  });
  it('posts public macros and ordinary dice automatically, never private results, and deduplicates clicks', async () => {
    const gm = await client(),
      pc = await client(player);
    expect((await configure()).status).toBe(200);
    await gm.commit({ type: 'MACRO_IMPORT', text: example, visibility: 'public' });
    const id = Object.keys(gm.state.macros!)[0];
    const patch = await gm.commit({
        type: 'MACRO_ROLL_REQUEST',
        id,
        variables: { X: 3 },
        visibility: 'public',
      }),
      result = await gm.wait('DICE_ROLL_RESULT');
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(payload.embeds[0].title).toBe('Attack Name');
    expect(payload.embeds[0].fields).toHaveLength(2);
    gm.send(
      { type: 'MACRO_ROLL_REQUEST', id, variables: { X: 3 }, visibility: 'public' },
      patch.actionId,
    );
    await gm.wait('ROOM_SNAPSHOT');
    expect((await request(`/rolls/${result.roll.id}`, owner, { method: 'POST' })).status).toBe(202);
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(1);
    await pc.commit({ type: 'DICE_ROLL_REQUEST', expression: '2d6 + 4', visibility: 'public' });
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(2);
    await pc.commit({ type: 'MACRO_ROLL_REQUEST', id, variables: { X: 2 }, visibility: 'private' });
    const privateResult = await pc.wait('DICE_ROLL_RESULT', (m) => m.roll.visibility === 'private');
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(2);
    expect((await request(`/rolls/${privateResult.roll.id}`, owner, { method: 'POST' })).ok).toBe(
      false,
    );
  });
  it('shares and persists authoritative keep/drop/reroll outcomes for ordinary dice and macros', async () => {
    const gm = await client(),
      pc = await client(player);
    await configure();
    const expression = '2d20kh1 + 4d6dl1 + 5d6r<2 - 3';
    const imported = await gm.commit({
      type: 'MACRO_IMPORT',
      text: `[Advanced]([Result(${expression})])`,
      visibility: 'public',
    });
    await pc.wait('STATE_PATCH', (m) => m.actionId === imported.actionId);
    const id = Object.keys(pc.state.macros!)[0];
    const actions: Action[] = [
      { type: 'DICE_ROLL_REQUEST', expression, visibility: 'public' },
      { type: 'MACRO_ROLL_REQUEST', id, variables: {}, visibility: 'public' },
    ];
    for (const action of actions) {
      const patch = await pc.commit(action);
      await gm.wait('STATE_PATCH', (m) => m.actionId === patch.actionId);
      const a = await gm.wait('DICE_ROLL_RESULT'),
        b = await pc.wait('DICE_ROLL_RESULT');
      expect(a).toEqual(b);
      const terms = a.roll.terms;
      expect(terms[0].subtotal).toBe(Math.max(...terms[0].values));
      expect(terms[0].kept!.filter(Boolean)).toHaveLength(1);
      expect(terms[1].subtotal).toBe(
        terms[1].values.reduce((n, value) => n + value, 0) - Math.min(...terms[1].values),
      );
      expect(terms[1].kept!.filter(Boolean)).toHaveLength(3);
      expect(terms[2].values.every((value) => value >= 2 && value <= 6)).toBe(true);
      expect(terms[2].rerolls!.every((previous) => previous.every((value) => value === 1))).toBe(
        true,
      );
      expect(a.roll.total).toBe(terms.reduce((n, term) => n + term.subtotal, 0));
      pc.send(action, patch.actionId);
      await pc.wait('ROOM_SNAPSHOT');
      expect(pc.state.rolls.at(-1)).toEqual(a.roll);
    }
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(2);
    for (const call of transport.mock.calls)
      expect(JSON.parse(String(call[1]?.body)).embeds[0].fields[0].value).toContain('(dropped)');
    const before = pc.state.rolls;
    clients.forEach((c) => c.ws.terminate());
    clients.length = 0;
    await app.close();
    await start();
    expect((await client(player)).state.rolls).toEqual(before);
  });
  it('keeps the webhook secret in durable server storage and restricts management to the owner', async () => {
    const gm = await client(),
      pc = await client(player);
    expect((await configure('automatic', player)).ok).toBe(false);
    await gm.commit({ type: 'MACRO_IMPORT', text: example, visibility: 'public' });
    expect((await configure()).ok).toBe(true);
    const status = await (await request('', player)).json();
    expect(status).toEqual({
      configured: true,
      enabled: true,
      mode: 'automatic',
      canManage: false,
    });
    gm.send({ type: 'STATE_RESYNC' });
    pc.send({ type: 'STATE_RESYNC' });
    const a = await gm.wait('ROOM_SNAPSHOT'),
      b = await pc.wait('ROOM_SNAPSHOT');
    expect(JSON.stringify([a, b, ...gm.messages, ...pc.messages, status])).not.toContain(
      'abcdefghijklmnopqrstuvwxyz',
    );
    expect((await storage.load(room.id))?.discord?.url).toContain('abcdefghijklmnopqrstuvwxyz');
    expect((await configure('automatic', owner, 'http://localhost/secrets')).ok).toBe(false);
    gm.send({ type: 'MEMBER_UPDATE', userId: player.id, role: 'gm' });
    await pc.wait('MEMBERS_UPDATE', (message) =>
      message.members.some((member) => member.id === player.id && member.role === 'gm'),
    );
    expect((await configure('automatic', player)).ok).toBe(false);
  });
  it('uses manual mode only when clicked and rejects attempts to send another player’s results', async () => {
    const gm = await client(),
      pc = await client(player),
      spectator = await client(other);
    expect((await configure('manual')).ok).toBe(true);
    await pc.commit({ type: 'DICE_ROLL_REQUEST', expression: 'd6', visibility: 'public' });
    const result = await pc.wait('DICE_ROLL_RESULT');
    await manager.discordDelivery.idle();
    expect(transport).not.toHaveBeenCalled();
    expect((await request(`/rolls/${result.roll.id}`, other, { method: 'POST' })).ok).toBe(false);
    expect((await request(`/rolls/${result.roll.id}`, player, { method: 'POST' })).status).toBe(
      202,
    );
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(spectator.state.rolls).toHaveLength(1);
    expect((await request('', owner, { method: 'DELETE' })).ok).toBe(true);
    expect((await manager.discordStatus(room.id, owner.id)).configured).toBe(false);
    await gm.commit({ type: 'DICE_ROLL_REQUEST', expression: 'd20', visibility: 'public' });
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('retains authoritative results when Discord fails and allows an explicit retry', async () => {
    const gm = await client();
    await configure();
    transport.mockRejectedValueOnce(new Error(`URL secret: ${endpoint}`));
    await gm.commit({ type: 'DICE_ROLL_REQUEST', expression: 'd20', visibility: 'public' });
    const result = await gm.wait('DICE_ROLL_RESULT');
    expect((await gm.wait('DISCORD_DELIVERY', (m) => m.status === 'failed')).message).not.toContain(
      endpoint,
    );
    expect(gm.state.rolls[0].id).toBe(result.roll.id);
    expect((await request(`/rolls/${result.roll.id}`, owner, { method: 'POST' })).ok).toBe(true);
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('recovers imported macros, result groups and webhook configuration after restart', async () => {
    const gm = await client();
    await configure('manual');
    await gm.commit({ type: 'MACRO_IMPORT', text: example, visibility: 'public' });
    const id = Object.keys(gm.state.macros!)[0];
    const patch = await gm.commit({
      type: 'MACRO_ROLL_REQUEST',
      id,
      variables: { X: 3 },
      visibility: 'public',
    });
    const previous = gm.state.rolls[0];
    clients.forEach((c) => c.ws.terminate());
    clients.length = 0;
    await app.close();
    await start();
    const restored = await client();
    expect(restored.state.macros![id].name).toBe('Attack Name');
    expect(restored.state.rolls[0]).toEqual(previous);
    expect(await manager.discordStatus(room.id, owner.id)).toMatchObject({
      configured: true,
      mode: 'manual',
    });
    restored.send(
      { type: 'MACRO_ROLL_REQUEST', id, variables: { X: 3 }, visibility: 'public' },
      patch.actionId,
    );
    await restored.wait('ROOM_SNAPSHOT');
    expect(restored.state.rolls).toHaveLength(1);
    expect(transport).not.toHaveBeenCalled();
  });
  it('spends character resources atomically, shares macro effects, protects private sheets and deduplicates after restart', async () => {
    const gm = await client(),
      pc = await client(player),
      spectator = await client(other);
    await configure();
    const imported = await pc.commit({
      type: 'CHARACTER_IMPORT',
      id: 'kael',
      text: characterText,
      visibility: 'private',
    });
    await gm.wait('STATE_PATCH', (m) => m.actionId === imported.actionId);
    await spectator.wait('STATE_PATCH', (m) => m.actionId === imported.actionId);
    expect(gm.state.characters!.kael.ownerId).toBe(player.id);
    expect(spectator.state.characters).toEqual({});
    const denied = spectator.send({
      type: 'CHARACTER_ABILITY_USE',
      id: 'kael',
      abilityId: 'ward',
      variables: {},
      visibility: 'public',
    });
    await spectator.wait('ERROR', (m) => m.actionId === denied);
    const action: Action = {
      type: 'CHARACTER_ABILITY_USE',
      id: 'kael',
      abilityId: 'ward',
      variables: {},
      visibility: 'public',
    };
    const patch = await pc.commit(action);
    await gm.wait('STATE_PATCH', (m) => m.actionId === patch.actionId);
    const result = await pc.wait('DICE_ROLL_RESULT');
    await spectator.wait('DICE_ROLL_RESULT');
    expect(pc.state.characters!.kael.resources[1].current).toBe(1);
    expect(pc.state.characters!.kael.abilities[1].remainingUses).toBe(1);
    expect(spectator.state.characters).toEqual({});
    expect(spectator.state.rolls[0].character).toMatchObject({ name: 'Kael', remainingUses: 1 });
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(transport.mock.calls[0][1]!.body as string);
    expect(payload.embeds[0].fields[0].value).toContain('Spell slots: 1 / 2');
    expect(payload.embeds[0].fields[1].value).toContain('protective ward');
    const privatePatch = await pc.commit({ ...action, visibility: 'private' });
    await pc.wait('DICE_ROLL_RESULT', (m) => m.roll.visibility === 'private');
    await spectator.wait('STATE_PATCH', (m) => m.actionId === privatePatch.actionId);
    expect(spectator.state.rolls).toHaveLength(1);
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(1);
    await gm.commit({ type: 'UNDO' });
    expect(gm.state.characters!.kael.resources[1].current).toBe(1);
    expect(gm.state.rolls).toHaveLength(2);
    const redo = await gm.commit({ type: 'REDO' });
    await pc.wait('STATE_PATCH', (m) => m.actionId === redo.actionId);
    expect(pc.state.characters!.kael.resources[1].current).toBe(0);
    expect(pc.state.rolls).toHaveLength(2);
    await manager.discordDelivery.idle();
    expect(transport).toHaveBeenCalledTimes(1);
    const depleted = pc.send(action);
    await pc.wait('ERROR', (m) => m.actionId === depleted && /Expended/.test(m.message));
    clients.forEach((c) => c.ws.terminate());
    clients.length = 0;
    await app.close();
    await start();
    const restored = await client(player);
    expect(restored.state.characters!.kael.resources[1].current).toBe(0);
    expect(restored.state.characters!.kael.abilities[1].remainingUses).toBe(0);
    expect(restored.state.rolls[0]).toEqual(result.roll);
    restored.send(action, patch.actionId);
    await restored.wait('ROOM_SNAPSHOT');
    expect(restored.state.rolls).toHaveLength(2);
    expect(restored.state.characters!.kael.resources[1].current).toBe(0);
    expect(transport).toHaveBeenCalledTimes(1);
    await restored.commit({ type: 'CHARACTER_REFRESH', id: 'kael', refresh: 'rest' });
    expect(restored.state.characters!.kael.abilities[1].remainingUses).toBe(2);
    expect(restored.state.characters!.kael.resources[1].current).toBe(2);
  });
  it('rolls back failed settings persistence', async () => {
    await client();
    const save = vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('Unavailable')),
      log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await configure()).ok).toBe(false);
    expect((await manager.discordStatus(room.id, owner.id)).configured).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    save.mockRestore();
    log.mockRestore();
  });
});
