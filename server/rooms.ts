import { randomBytes } from 'node:crypto';
import {
  canControl,
  projectRoom,
  tokenVisible,
  type StateChange,
  type DurableRoom,
  type Presence,
  type UploadedAsset,
} from '../shared/model.js';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';
import { clampPoint } from '../shared/geometry.js';
import { applyChanges, inverseChanges, projectChanges } from '../shared/state.js';
import { prepareAction } from './actions.js';
import { newRoom } from '../shared/sample.js';
import type { Identity } from './auth.js';
import { metrics, SnapshotConflictError, type Persistence } from './persistence.js';
import type { AssetStorage } from './assets.js';
import { DiscordDelivery, normalizeWebhook } from './discord.js';
import type { DiscordStatus } from '../shared/protocol.js';

export interface Peer {
  identity: Identity;
  role?: 'gm' | 'player';
  send(message: ServerMessage): void;
  close?(reason: string): void;
}
interface HistoryEntry {
  groupId?: string;
  authorId?: string;
  forward: StateChange[];
  inverse: StateChange[];
  label: string;
}
interface LiveRoom {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  data: DurableRoom;
  peers: Set<Peer>;
  seen: Map<string, boolean>;
  dirty: boolean;
  stopped: boolean;
  saveVersion: number;
  assetPromise?: Promise<void>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  generation: number;
  persistedRevision: number;
  lastSaved: number;
  savePromise?: Promise<void>;
  configPromise?: Promise<void>;
  joinPromise?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
}
export class RoomManager {
  private rooms = new Map<string, LiveRoom>();
  private hydration = new Map<string, Promise<LiveRoom>>();
  private creating = 0;
  private closing = false;
  private assets?: AssetStorage;
  constructor(
    readonly storage: Persistence,
    readonly interval = 90000,
    readonly debounce = 5000,
    readonly discordDelivery = new DiscordDelivery(),
  ) {}
  get activeRoomCount() {
    return this.rooms.size;
  }
  async create(identity: Identity, name: string) {
    this.checkCapacity();
    this.creating++;
    try {
      const id = randomBytes(8).toString('hex'),
        inviteCode = randomBytes(18).toString('base64url');
      const data = newRoom(id, identity.id, identity.name, name, inviteCode);
      data.state.savedAt = new Date().toISOString();
      data.saveVersion = await this.storage.save(data, 0);
      const room = this.live(data);
      this.rooms.set(id, room);
      this.scheduleIdle(room);
      return { id, inviteCode };
    } finally {
      this.creating--;
    }
  }
  private checkCapacity() {
    if (this.closing) throw new Error('The table server is shutting down. Try again shortly.');
    if (this.rooms.size + this.hydration.size + this.creating >= 100)
      throw new Error('The table server is full. Try again later.');
  }
  private live(data: DurableRoom): LiveRoom {
    return {
      data,
      undo: [],
      redo: [],
      peers: new Set(),
      seen: new Map(),
      dirty: false,
      stopped: false,
      saveVersion: data.saveVersion || 0,
      generation: 0,
      persistedRevision: data.state.revision,
      lastSaved: Date.now(),
    };
  }
  private assertActive(room: LiveRoom) {
    if (room.stopped) throw new SnapshotConflictError();
  }
  private stopConflictedRoom(room: LiveRoom) {
    room.stopped = true;
    room.dirty = false;
    if (room.timer) clearTimeout(room.timer);
    if (room.idleTimer) clearTimeout(room.idleTimer);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    this.discordDelivery.cancelRoom(room.data.state.id);
    if (this.rooms.get(room.data.state.id) === room) this.rooms.delete(room.data.state.id);
    for (const peer of room.peers) {
      peer.send({ v: 2, type: 'ERROR', message: new SnapshotConflictError().message });
      peer.close?.('Saved table changed; reconnect');
    }
    room.peers.clear();
  }
  private async load(id: string): Promise<LiveRoom> {
    const loaded = this.rooms.get(id);
    if (loaded) return loaded;
    let pending = this.hydration.get(id);
    if (!pending) {
      pending = (async () => {
        this.checkCapacity();
        const data = await this.storage.load(id);
        if (!data || data.state.version !== 1)
          throw new Error('Campaign not found. Check your invitation link.');
        const room = this.live(data);
        this.rooms.set(id, room);
        this.scheduleIdle(room);
        this.scheduleCleanup(room);
        return room;
      })();
      this.hydration.set(id, pending);
    }
    try {
      return await pending;
    } finally {
      if (this.hydration.get(id) === pending) this.hydration.delete(id);
    }
  }
  async join(peer: Peer, id: string, inviteCode?: string): Promise<void> {
    const room = await this.load(id);
    // A second connection must not observe an unpersisted provisional membership.
    const pending = (room.joinPromise || Promise.resolve())
      .catch(() => {})
      .then(() => this.acceptJoin(room, peer, inviteCode));
    room.joinPromise = pending;
    try {
      await pending;
    } finally {
      if (room.joinPromise === pending) room.joinPromise = undefined;
    }
  }
  private async acceptJoin(room: LiveRoom, peer: Peer, inviteCode?: string) {
    this.assertActive(room);
    if (this.closing) throw new Error('The table server is shutting down. Try again shortly.');
    if (room.data.revokedMembers?.includes(peer.identity.id))
      throw new Error('Your membership was removed. Ask the campaign owner for access.');
    if (room.peers.size >= 20) throw new Error('Too many open connections at this table.');
    if (!room.data.members[peer.identity.id]) {
      if (!inviteCode || inviteCode !== room.data.inviteCode)
        throw new Error('An invitation is required to join this campaign.');
      if (Object.keys(room.data.members).length >= 10)
        throw new Error('This table already has ten members.');
      const member = { name: peer.identity.name, role: 'player' as const };
      room.data.members[peer.identity.id] = member;
      room.dirty = true;
      room.generation++;
      // Membership is durable on acceptance; gameplay still batches writes.
      try {
        await this.flush(room);
      } catch (error) {
        this.assertActive(room);
        if (room.data.members[peer.identity.id] === member)
          delete room.data.members[peer.identity.id];
        room.generation++;
        room.dirty = true;
        this.retry(room);
        throw error;
      }
      if (
        !room.data.members[peer.identity.id] ||
        room.data.revokedMembers?.includes(peer.identity.id)
      )
        throw new Error('Your membership was removed. Ask the campaign owner for access.');
      room.undo = [];
      room.redo = [];
      for (const p of room.peers) this.history(room, p);
    }
    if (room.idleTimer) clearTimeout(room.idleTimer);
    room.idleTimer = undefined;
    room.peers.add(peer);
    this.snapshot(room, peer);
    this.broadcastPresence(room);
    for (const p of room.peers) this.memberList(room, p);
  }
  async list(userId: string) {
    return this.storage.list?.(userId) || [];
  }
  async authorize(roomId: string, userId: string, gm = false) {
    const room = await this.load(roomId);
    this.assertActive(room);
    const member = room.data.members[userId];
    if (!member || room.data.revokedMembers?.includes(userId))
      throw new Error('Campaign access denied.');
    if (gm && member.role !== 'gm')
      throw new Error('Only the game master can upload or manage images.');
    return room.data;
  }
  async discordStatus(roomId: string, userId: string): Promise<DiscordStatus> {
    const data = await this.authorize(roomId, userId);
    return {
      configured: !!data.discord,
      enabled: data.discord?.enabled || false,
      mode: data.discord?.mode || 'automatic',
      canManage: data.ownerId === userId,
    };
  }
  async configureDiscord(
    roomId: string,
    userId: string,
    settings: { url?: string; enabled: boolean; mode: 'automatic' | 'manual' } | null,
  ) {
    const data = await this.authorize(roomId, userId);
    if (data.ownerId !== userId) throw new Error('Only the campaign owner can configure Discord.');
    const room = this.rooms.get(roomId)!;
    const pending = (room.configPromise || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        this.assertActive(room);
        const previous = data.discord;
        if (settings) {
          const url = settings.url?.trim() ? normalizeWebhook(settings.url) : previous?.url;
          if (!url) throw new Error('Enter a Discord webhook URL.');
          data.discord = { url, enabled: settings.enabled, mode: settings.mode };
        } else delete data.discord;
        room.generation++;
        room.dirty = true;
        try {
          await this.flush(room);
        } catch (error) {
          this.assertActive(room);
          data.discord = previous;
          room.generation++;
          room.dirty = true;
          this.retry(room);
          throw error;
        }
        this.discordDelivery.cancelRoom(roomId);
        for (const peer of room.peers) this.discordStatusMessage(room, peer);
      });
    room.configPromise = pending;
    try {
      await pending;
    } finally {
      if (room.configPromise === pending) room.configPromise = undefined;
    }
    return this.discordStatus(roomId, userId);
  }
  async shareDiscord(roomId: string, userId: string, rollId: string) {
    const data = await this.authorize(roomId, userId),
      roll = data.state.rolls.find((r) => r.id === rollId);
    if (!roll || roll.visibility !== 'public')
      throw new Error('Only existing public results can be sent to Discord.');
    if (roll.userId !== userId && data.members[userId].role !== 'gm')
      throw new Error('Send your own results or ask a game master.');
    this.deliverDiscord(this.rooms.get(roomId)!, roll, true);
  }
  private discordStatusMessage(room: LiveRoom, peer: Peer) {
    peer.send({
      v: 2,
      type: 'DISCORD_STATUS',
      discord: {
        configured: !!room.data.discord,
        enabled: room.data.discord?.enabled || false,
        mode: room.data.discord?.mode || 'automatic',
        canManage: room.data.ownerId === peer.identity.id && this.role(room, peer) === 'gm',
      },
    });
  }
  private deliverDiscord(room: LiveRoom, roll: import('../shared/model.js').Roll, manual = false) {
    const config = room.data.discord;
    if (!config?.enabled) {
      if (manual) throw new Error('The campaign Discord webhook is disabled or not configured.');
      return;
    }
    if (roll.visibility !== 'public' || (!manual && config.mode !== 'automatic')) return;
    this.discordDelivery.enqueue(
      room.data.state.id,
      config.url,
      roll,
      room.data.state.name,
      (status, message) => {
        for (const peer of room.peers)
          peer.send({ v: 2, type: 'DISCORD_DELIVERY', rollId: roll.id, status, message });
      },
      manual,
    );
  }
  async assetReadable(roomId: string, id: string, userId: string) {
    const data = await this.authorize(roomId, userId);
    const state = projectRoom(data, userId);
    if (!state.assets || !Object.hasOwn(state.assets, id)) throw new Error('Image access denied.');
    return state.assets[id];
  }
  setAssetStorage(assets: AssetStorage) {
    this.assets = assets;
    for (const room of this.rooms.values()) this.scheduleCleanup(room);
  }
  private async withAssets(room: LiveRoom, action: () => Promise<void>) {
    const pending = (room.assetPromise || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        this.assertActive(room);
        if (this.closing) throw new Error('The table server is shutting down. Try again shortly.');
        await action();
      });
    room.assetPromise = pending;
    try {
      await pending;
    } finally {
      if (room.assetPromise === pending) room.assetPromise = undefined;
    }
  }
  private scheduleCleanup(room: LiveRoom, retry = false) {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = undefined;
    const intents = Object.values(room.data.assetCleanup || {});
    if (!this.assets || this.closing || room.stopped || !intents.length) return;
    const delay = retry
      ? 60000
      : Math.max(0, Math.min(...intents.map((i) => Date.parse(i.after))) - Date.now());
    room.cleanupTimer = setTimeout(() => {
      room.cleanupTimer = undefined;
      void this.withAssets(room, () => this.cleanupRoomAssets(room)).catch(() => {
        this.scheduleCleanup(room, true);
      });
    }, delay);
    room.cleanupTimer.unref();
  }
  private async cleanupRoomAssets(room: LiveRoom) {
    this.assertActive(room);
    const due = Object.entries(room.data.assetCleanup || {}).filter(
      ([id, intent]) =>
        Date.parse(intent.after) <= Date.now() && !Object.hasOwn(room.data.state.assets || {}, id),
    );
    if (!this.assets || !due.length) {
      this.scheduleCleanup(room);
      return;
    }
    // Fence stale processes and uncertain preceding writes BEFORE deleting bytes.
    // This shares the snapshot RPC; no extra read/polling or per-gameplay writes.
    room.generation++;
    room.dirty = true;
    await this.flush(room);
    for (const [id, intent] of due) {
      this.assertActive(room);
      try {
        await this.assets.remove(room.data.state.id, id);
        if (room.data.assetCleanup?.[id] === intent) {
          delete room.data.assetCleanup[id];
          room.generation++;
          room.dirty = true;
        }
      } catch {
        // Keep the durable intent: repeated removes (including absent objects)
        // are safe, and hydration resumes the same work after a restart.
      }
    }
    if (room.dirty) this.schedule(room);
    this.scheduleCleanup(room, true);
  }
  async uploadAsset(roomId: string, userId: string, asset: UploadedAsset, bytes: Buffer) {
    await this.authorize(roomId, userId, true);
    const room = this.rooms.get(roomId)!;
    await this.withAssets(room, async () => {
      await this.authorize(roomId, userId, true);
      if (!this.assets) throw new Error('Image storage is unavailable.');
      if (
        Object.keys(room.data.assetCleanup || {}).length +
          Object.keys(room.data.state.assets || {}).length >=
        64
      )
        throw new Error(
          'Campaign image limit reached, including pending cleanup. Remove unused images or wait for storage recovery.',
        );
      // Save the rollback intent before starting Storage. The grace period is
      // longer than the bounded upload request, allowing a new process to avoid
      // racing an upload still winding down on the previous process.
      const intent = { after: new Date(Date.now() + 15 * 60000).toISOString() };
      room.data.assetCleanup = { ...room.data.assetCleanup, [asset.id]: intent };
      room.generation++;
      room.dirty = true;
      try {
        await this.flush(room);
      } catch (error) {
        this.retry(room);
        this.scheduleCleanup(room, true);
        throw error;
      }
      let uploaded = false;
      try {
        await this.assets.put(roomId, asset.id, bytes, AbortSignal.timeout(30000));
        uploaded = true;
        this.assertActive(room);
        await this.registerAsset(roomId, userId, asset);
      } catch (error) {
        if (!room.stopped) {
          // A successful put has finished. A failed/aborted put may be uncertain,
          // so retain its grace period rather than deleting too early.
          room.data.assetCleanup = {
            ...room.data.assetCleanup,
            [asset.id]: uploaded ? { after: new Date().toISOString() } : intent,
          };
          room.generation++;
          room.dirty = true;
          try {
            await this.flush(room);
            if (uploaded) await this.cleanupRoomAssets(room);
          } catch {
            this.retry(room);
          }
          this.scheduleCleanup(room, true);
        }
        throw error;
      }
      this.scheduleCleanup(room);
    });
  }
  async registerAsset(roomId: string, userId: string, asset: UploadedAsset) {
    await this.authorize(roomId, userId, true);
    const room = this.rooms.get(roomId)!;
    if (
      Object.hasOwn(room.data.state.assets || {}, asset.id) ||
      Object.keys(room.data.state.assets || {}).length >= 64 ||
      Object.values(room.data.state.assets || {}).reduce((n, a) => n + a.bytes, 0) + asset.bytes >
        64 * 1024 * 1024
    )
      throw new Error(
        'Campaign image limit reached (64 images / 64 MiB). Remove unused images first.',
      );
    const cleanup = room.data.assetCleanup?.[asset.id];
    const assets = { ...room.data.state.assets, [asset.id]: asset };
    room.data.state = { ...room.data.state, assets };
    if (room.data.assetCleanup) delete room.data.assetCleanup[asset.id];
    room.generation++;
    room.dirty = true;
    try {
      await this.flush(room);
    } catch (error) {
      this.assertActive(room);
      const remaining = { ...room.data.state.assets };
      delete remaining[asset.id];
      room.data.state = { ...room.data.state, assets: remaining };
      if (cleanup) room.data.assetCleanup = { ...room.data.assetCleanup, [asset.id]: cleanup };
      room.generation++;
      room.dirty = true;
      this.retry(room);
      throw error;
    }
    for (const p of room.peers) this.snapshot(room, p);
  }
  async removeAsset(roomId: string, id: string, userId: string) {
    await this.authorize(roomId, userId, true);
    const room = this.rooms.get(roomId)!;
    await this.withAssets(room, async () => {
      await this.authorize(roomId, userId, true);
      const state = room.data.state;
      const referenced = (a: { kind: string; url: string }) =>
        a.kind === 'uploaded' && a.url === id;
      for (const scene of Object.values(state.scenes))
        if (
          referenced(scene.map) ||
          Object.values(scene.tokens).some((token) => referenced(token.image))
        )
          throw new Error(
            'This image is still used in a scene. Replace or remove its objects first.',
          );
      if (Object.values(state.tokenLibrary || {}).some((token) => referenced(token.image)))
        throw new Error('This image is still used in your saved token library.');
      const asset = state.assets?.[id];
      if (asset && Object.hasOwn(state.assets!, id)) {
        const assets = { ...state.assets };
        delete assets[id];
        room.data.state = { ...state, assets };
        room.data.assetCleanup = {
          ...room.data.assetCleanup,
          [id]: { after: new Date().toISOString() },
        };
        room.undo = [];
        room.redo = [];
        room.generation++;
        room.dirty = true;
        try {
          await this.flush(room);
        } catch (error) {
          this.assertActive(room);
          room.data.state = {
            ...room.data.state,
            assets: { ...room.data.state.assets, [id]: asset },
          };
          delete room.data.assetCleanup[id];
          room.generation++;
          room.dirty = true;
          this.retry(room);
          throw error;
        }
        for (const peer of room.peers) this.snapshot(room, peer);
      }
      // Repeated DELETEs resume cleanup even if the manifest is already absent.
      try {
        await this.cleanupRoomAssets(room);
      } catch (error) {
        this.scheduleCleanup(room, true);
        throw error;
      }
    });
  }
  private presence(room: LiveRoom): Presence[] {
    const map = new Map<string, Presence>();
    for (const peer of room.peers) map.set(peer.identity.id, this.self(room, peer));
    return [...map.values()];
  }
  private role(room: LiveRoom, peer: Peer) {
    return room.data.members[peer.identity.id]?.role === 'gm' && peer.role !== 'player'
      ? 'gm'
      : 'player';
  }
  private self(room: LiveRoom, peer: Peer): Presence {
    return {
      id: peer.identity.id,
      name: peer.identity.name,
      role: this.role(room, peer),
      color: peer.identity.id === room.data.ownerId ? '#d8b46c' : '#89b8c9',
    };
  }
  private snapshot(room: LiveRoom, peer: Peer) {
    peer.send({
      v: 2,
      type: 'ROOM_SNAPSHOT',
      state: projectRoom(room.data, peer.identity.id, this.role(room, peer)),
      canGM: room.data.members[peer.identity.id]?.role === 'gm',
      self: this.self(room, peer),
      presence: this.presence(room),
      ...(peer.identity.id === room.data.ownerId && this.role(room, peer) === 'gm'
        ? { inviteCode: room.data.inviteCode }
        : {}),
    });
    this.history(room, peer);
    this.memberList(room, peer);
    this.discordStatusMessage(room, peer);
  }
  private history(room: LiveRoom, peer: Peer) {
    if (this.role(room, peer) === 'gm')
      peer.send({
        v: 2,
        type: 'HISTORY_STATUS',
        history: {
          canUndo: !!room.undo.length,
          canRedo: !!room.redo.length,
          undoLabel: room.undo.at(-1)?.label || '',
          redoLabel: room.redo.at(-1)?.label || '',
        },
      });
  }
  private memberList(room: LiveRoom, peer: Peer) {
    if (this.role(room, peer) === 'gm')
      peer.send({
        v: 2,
        type: 'MEMBERS_UPDATE',
        ownerId: room.data.ownerId,
        removedMembers:
          peer.identity.id === room.data.ownerId
            ? (room.data.revokedMembers || []).map((id) => ({
                id,
                name: room.data.revokedMemberNames?.[id] || id,
              }))
            : [],
        members: Object.entries(room.data.members).map(([id, m]) => ({
          id,
          ...m,
          color: id === room.data.ownerId ? '#d8b46c' : '#89b8c9',
        })),
      });
  }
  private broadcastPresence(room: LiveRoom) {
    for (const p of room.peers)
      p.send({ v: 2, type: 'PRESENCE_UPDATE', presence: this.presence(room) });
  }
  async leave(peer: Peer, id: string) {
    const room = this.rooms.get(id);
    if (!room) return;
    if (!room.peers.delete(peer)) return;
    this.broadcastPresence(room);
    if (!room.peers.size && !this.closing) {
      if (room.timer) clearTimeout(room.timer);
      room.timer = setTimeout(() => {
        room.timer = undefined;
        void this.flush(room).catch(() => this.retry(room));
      }, this.debounce);
      this.scheduleIdle(room);
    }
  }
  private scheduleIdle(room: LiveRoom) {
    if (room.idleTimer) clearTimeout(room.idleTimer);
    if (this.closing || room.stopped || room.peers.size) return;
    room.idleTimer = setTimeout(async () => {
      room.idleTimer = undefined;
      try {
        await this.flush(room);
        if (
          !room.peers.size &&
          !room.dirty &&
          !room.joinPromise &&
          !room.assetPromise &&
          !Object.keys(room.data.assetCleanup || {}).length
        ) {
          if (room.timer) clearTimeout(room.timer);
          if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
          if (this.rooms.get(room.data.state.id) === room) this.rooms.delete(room.data.state.id);
        } else this.scheduleIdle(room);
      } catch {
        this.retry(room);
        this.scheduleIdle(room);
      }
    }, 15 * 60000);
    room.idleTimer.unref();
  }
  handle(peer: Peer, id: string, message: ClientMessage) {
    if (this.closing) throw new Error('The table server is shutting down. Try again shortly.');
    const room = this.rooms.get(id);
    if (!room || !room.peers.has(peer)) throw new Error('Join a campaign first.');
    const data = room.data,
      role = this.role(room, peer);
    if (message.type === 'JOIN_ROOM') throw new Error('Already connected to a campaign.');
    if (message.type === 'SESSION_ROLE') {
      if (message.role === 'gm' && data.members[peer.identity.id]?.role !== 'gm')
        throw new Error('Only a campaign GM can enter GM mode.');
      peer.role = message.role;
      this.snapshot(room, peer);
      this.broadcastPresence(room);
      return;
    }
    if (message.type === 'STATE_RESYNC') {
      this.snapshot(room, peer);
      return;
    }
    const key = `${peer.identity.id}:${message.actionId}`;
    if (
      room.seen.has(key) ||
      (['DICE_ROLL_REQUEST', 'MACRO_ROLL_REQUEST'].includes(message.type) &&
        data.state.rolls.some(
          (r) => r.actionId === message.actionId && r.userId === peer.identity.id,
        ))
    ) {
      this.snapshot(room, peer);
      return;
    }
    if (!data.members[peer.identity.id])
      throw new Error('You are no longer a member of this campaign.');
    if (message.type === 'PING') {
      for (const p of room.peers)
        p.send({ v: 2, type: 'PING', position: message.position, userId: peer.identity.id });
      return;
    }
    if (message.type === 'TOKEN_MOVE_PREVIEW' || message.type === 'TOKEN_MOVE_PREVIEW_BATCH') {
      const s = data.state.scenes[message.sceneId];
      if (!s) throw new Error('Scene not found.');
      const positions =
        message.type === 'TOKEN_MOVE_PREVIEW'
          ? [{ tokenId: message.tokenId, position: message.position }]
          : message.positions;
      const validated = positions.map((p) => {
        const t = s.tokens[p.tokenId];
        if (!t || !canControl(t, peer.identity.id, role) || !tokenVisible(t, s, role))
          throw new Error('You do not control that token.');
        return { ...p, position: clampPoint(p.position, s.width, s.height, t.size) };
      });
      for (const p of room.peers) {
        if (p === peer) continue;
        const pRole = this.role(room, p);
        const visible = validated.filter(
          (x) => pRole === 'gm' || (s.tokens[x.tokenId].visibility === 'public' && !s.fog.enabled),
        );
        if (!visible.length) continue;
        if (message.type === 'TOKEN_MOVE_PREVIEW')
          p.send({
            v: 2,
            type: 'TOKEN_MOVE_PREVIEW',
            sceneId: s.id,
            tokenId: visible[0].tokenId,
            position: visible[0].position,
            userId: peer.identity.id,
          });
        else
          p.send({
            v: 2,
            type: 'TOKEN_MOVE_PREVIEW_BATCH',
            sceneId: s.id,
            positions: visible,
            userId: peer.identity.id,
          });
      }
      return;
    }
    if (
      message.type === 'MEMBER_UPDATE' ||
      message.type === 'MEMBER_RESTORE' ||
      message.type === 'INVITE_ROTATE'
    ) {
      if (peer.identity.id !== data.ownerId || role !== 'gm')
        throw new Error('Only the campaign owner manages membership and invitations.');
      if (message.type === 'INVITE_ROTATE') data.inviteCode = randomBytes(18).toString('base64url');
      else if (message.type === 'MEMBER_RESTORE') {
        if (!data.revokedMembers?.includes(message.userId))
          throw new Error('Removed member not found.');
        if (Object.keys(data.members).length >= 10)
          throw new Error('This table already has ten members.');
        data.members[message.userId] = {
          name: data.revokedMemberNames?.[message.userId] || message.userId,
          role: 'player',
        };
        data.revokedMembers = data.revokedMembers.filter((id) => id !== message.userId);
        if (data.revokedMemberNames) delete data.revokedMemberNames[message.userId];
      } else {
        if (message.userId === data.ownerId)
          throw new Error('The campaign owner cannot be removed or demoted.');
        const member = data.members[message.userId];
        if (!member) throw new Error('Member not found.');
        if (message.role === 'remove') {
          data.revokedMemberNames = { ...data.revokedMemberNames, [message.userId]: member.name };
          delete data.members[message.userId];
          data.revokedMembers = [...new Set([...(data.revokedMembers || []), message.userId])];
          for (const p of room.peers)
            if (p.identity.id === message.userId) {
              room.peers.delete(p);
              p.send({ v: 2, type: 'REVOKED', message: 'You were removed from this campaign.' });
              p.close?.('Membership revoked');
            }
        } else data.members[message.userId] = { ...member, role: message.role };
      }
      room.generation++;
      room.dirty = true;
      room.undo = [];
      room.redo = [];
      for (const p of room.peers) this.snapshot(room, p);
      this.broadcastPresence(room);
      void this.flush(room).catch(() => this.retry(room));
      return;
    }
    const before = data.state;
    let changes: StateChange[];
    if (message.type === 'UNDO' || message.type === 'REDO') {
      if (role !== 'gm') throw new Error('Only the game master can change this.');
      const source = message.type === 'UNDO' ? room.undo : room.redo,
        target = message.type === 'UNDO' ? room.redo : room.undo;
      const entry = source.pop();
      if (!entry) throw new Error('Nothing to ' + message.type.toLowerCase() + '.');
      changes = message.type === 'UNDO' ? entry.inverse : entry.forward;
      target.push(entry);
    } else {
      changes = prepareAction(data, peer.identity, message, role);
      if (
        changes.length &&
        !['DICE_ROLL_REQUEST', 'MACRO_ROLL_REQUEST', 'CHAT_SEND'].includes(message.type)
      ) {
        const inverse = inverseChanges(before, changes);
        const groupId = message.type === 'FOG_APPEND' ? message.groupId : undefined,
          last = room.undo.at(-1);
        if (groupId && last?.groupId === groupId && last.authorId === peer.identity.id)
          last.forward.push(...changes);
        else
          room.undo.push({
            forward: changes,
            inverse,
            label: message.type.toLowerCase().replaceAll('_', ' '),
            groupId,
            authorId: peer.identity.id,
          });
        room.redo = [];
        while (room.undo.length > 50 || JSON.stringify(room.undo).length > 1024 * 1024)
          room.undo.shift();
      }
    }
    data.state = { ...applyChanges(before, changes), revision: before.revision + 1 };
    room.dirty = true;
    room.generation++;
    room.seen.set(key, true);
    if (room.seen.size > 2000) room.seen.delete(room.seen.keys().next().value!);
    for (const p of room.peers) {
      const projected = projectChanges(
        changes,
        before,
        data.state,
        this.role(room, p),
        p.identity.id,
      );
      p.send({
        v: 2,
        type: 'STATE_PATCH',
        actionId: message.actionId,
        revision: data.state.revision,
        changes: projected,
      });
      for (const c of projected)
        if (c.kind === 'roll') p.send({ v: 2, type: 'DICE_ROLL_RESULT', roll: c.roll });
      this.history(room, p);
    }
    this.schedule(room);
    for (const change of changes)
      if (change.kind === 'roll') {
        try {
          this.deliverDiscord(room, change.roll);
        } catch {
          for (const peer of room.peers)
            peer.send({
              v: 2,
              type: 'DISCORD_DELIVERY',
              rollId: change.roll.id,
              status: 'failed',
              message: 'Discord queue unavailable. Your roll remains in table history.',
            });
        }
      }
    if (message.type === 'SCENE_CHANGE') void this.flush(room).catch(() => this.retry(room));
  }
  private schedule(room: LiveRoom) {
    if (!this.closing && !room.stopped && !room.timer)
      room.timer = setTimeout(
        () => {
          room.timer = undefined;
          void this.flush(room).catch(() => this.retry(room));
        },
        Math.max(this.debounce, room.lastSaved + this.interval - Date.now()),
      );
  }
  private retry(room: LiveRoom) {
    if (room.stopped) return;
    console.error('Snapshot failed; retaining dirty room and retrying.');
    for (const p of room.peers)
      p.send({
        v: 2,
        type: 'ERROR',
        message: 'Snapshot storage is unavailable. Your table is still live; saving will retry.',
      });
    if (room.timer) clearTimeout(room.timer);
    if (this.closing) return;
    room.timer = setTimeout(() => {
      room.timer = undefined;
      void this.flush(room).catch(() => this.retry(room));
    }, 10000);
  }
  private async flush(room: LiveRoom): Promise<void> {
    this.assertActive(room);
    if (room.savePromise) {
      await room.savePromise;
      if (room.dirty) return this.flush(room);
      return;
    }
    if (!room.dirty) return;
    const snapshot = structuredClone(room.data),
      generation = room.generation;
    const savedAt = new Date().toISOString();
    snapshot.state.savedAt = savedAt;
    room.savePromise = (async () => {
      try {
        room.saveVersion = await this.storage.save(snapshot, room.saveVersion);
      } catch (error) {
        if (error instanceof SnapshotConflictError) this.stopConflictedRoom(room);
        throw error;
      }
      room.data.saveVersion = room.saveVersion;
      room.persistedRevision = snapshot.state.revision;
      room.lastSaved = Date.now();
      room.data.state.savedAt = savedAt;
      room.dirty = room.generation !== generation;
      for (const p of room.peers)
        p.send({ v: 2, type: 'SAVED', savedAt, revision: snapshot.state.revision });
    })();
    try {
      await room.savePromise;
    } finally {
      room.savePromise = undefined;
    }
    if (room.dirty) this.schedule(room);
  }
  async flushAll() {
    const results = await Promise.allSettled([...this.rooms.values()].map((r) => this.flush(r)));
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length === 1) throw failures[0].reason;
    if (failures.length)
      throw new AggregateError(
        failures.map((r) => r.reason),
        'Snapshot saves failed.',
      );
  }
  async close() {
    this.closing = true;
    this.discordDelivery.close();
    for (const r of this.rooms.values()) {
      if (r.timer) clearTimeout(r.timer);
      if (r.idleTimer) clearTimeout(r.idleTimer);
      if (r.cleanupTimer) clearTimeout(r.cleanupTimer);
    }
    // Do not put a slow image in one campaign ahead of every other campaign's save.
    // Retry initial failures in the final pass, while retaining each room's dirty state.
    const initial = Promise.allSettled([...this.rooms.values()].map((r) => this.flush(r)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.rooms.values()].map((r) => r.assetPromise)),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    await initial;
    // Includes manifests and rollback intents changed by uploads during the grace period.
    await this.flushAll();
  }
  get stats() {
    return {
      ...metrics,
      activeRooms: this.rooms.size,
      connections: [...this.rooms.values()].reduce((a, r) => a + r.peers.size, 0),
    };
  }
}
