import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DurableRoom } from '../shared/model.js';
export interface Metrics {
  reads: number;
  writes: number;
  snapshotBytes: number;
  messagesIn: number;
  messagesOut: number;
}
export const metrics: Metrics = {
  reads: 0,
  writes: 0,
  snapshotBytes: 0,
  messagesIn: 0,
  messagesOut: 0,
};
export interface Persistence {
  load(id: string): Promise<DurableRoom | null>;
  save(room: DurableRoom, expectedSaveVersion: number): Promise<number>;
  list?(userId: string): Promise<Array<{ id: string; name: string; role: 'gm' | 'player' }>>;
}
export class SnapshotConflictError extends Error {
  constructor() {
    super('This table changed on another server. Reconnect to load the saved table.');
    this.name = 'SnapshotConflictError';
  }
}
// Local development is single-process. Share the lock across adapter instances so
// overlapping RoomManagers cannot pass the read/compare/write check together.
const fileSaves = new Map<string, Promise<number>>();
export class FilePersistence implements Persistence {
  constructor(private dir: string) {}
  async list(userId: string) {
    await mkdir(this.dir, { recursive: true });
    const result: Array<{ id: string; name: string; role: 'gm' | 'player' }> = [];
    for (const file of await readdir(this.dir)) {
      if (!/^[a-zA-Z0-9_-]{6,64}\.json$/.test(file)) continue;
      const room = await this.load(file.slice(0, -5));
      const member = room?.members[userId];
      if (room && member)
        result.push({ id: room.state.id, name: room.state.name, role: member.role });
    }
    return result.slice(0, 100);
  }
  async load(id: string) {
    metrics.reads++;
    try {
      return JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as DurableRoom;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async save(room: DurableRoom, expectedSaveVersion = room.saveVersion || 0) {
    const path = resolve(this.dir, `${room.state.id}.json`);
    const pending = (fileSaves.get(path) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        let previous: DurableRoom | null = null;
        try {
          previous = JSON.parse(await readFile(path, 'utf8')) as DurableRoom;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if ((previous?.saveVersion || 0) !== expectedSaveVersion) throw new SnapshotConflictError();
        const saveVersion = expectedSaveVersion + 1;
        const data = JSON.stringify({ ...room, saveVersion });
        await writeFile(`${path}.tmp`, data, { mode: 0o600 });
        await rename(`${path}.tmp`, path);
        metrics.writes++;
        metrics.snapshotBytes = Buffer.byteLength(data);
        return saveVersion;
      });
    fileSaves.set(path, pending);
    try {
      return await pending;
    } finally {
      if (fileSaves.get(path) === pending) fileSaves.delete(path);
    }
  }
}
export class SupabasePersistence implements Persistence {
  readonly client: SupabaseClient;
  async list(userId: string) {
    metrics.reads++;
    const { data, error } = await this.client
      .from('campaign_members')
      .select('role,campaigns(id,name)')
      .eq('user_id', userId)
      .limit(100);
    if (error) throw new Error('Campaign list is unavailable.');
    return (data || []).map((row) => {
      const campaign = row.campaigns as unknown as { id: string; name: string };
      return { ...campaign, role: row.role as 'gm' | 'player' };
    });
  }
  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      // storage-js upload does not expose a per-request signal; bound the shared
      // transport, including upload requests, before retrying durable cleanup.
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)])
              : AbortSignal.timeout(30000),
          }),
      },
    });
  }
  async load(id: string) {
    metrics.reads++;
    const { data, error } = await this.client
      .from('room_snapshots')
      .select('snapshot,save_version')
      .eq('campaign_id', id)
      .maybeSingle();
    if (error) throw new Error(`Snapshot read failed: ${error.code}`);
    return data
      ? { ...(data.snapshot as DurableRoom), saveVersion: Number(data.save_version) }
      : null;
  }
  async save(room: DurableRoom, expectedSaveVersion = room.saveVersion || 0) {
    const { data, error } = await this.client.rpc('save_room_snapshot', {
      p_id: room.state.id,
      p_owner: room.ownerId,
      p_name: room.state.name,
      p_revision: room.state.revision,
      p_snapshot: room,
      p_expected_save_version: expectedSaveVersion,
    });
    if (error?.code === 'PT409') throw new SnapshotConflictError();
    if (error) throw new Error(`Snapshot write failed: ${error.code}`);
    if (!Number.isSafeInteger(data) || data !== expectedSaveVersion + 1)
      throw new Error('Snapshot write returned an invalid save version.');
    metrics.writes++;
    metrics.snapshotBytes = Buffer.byteLength(JSON.stringify(room));
    return data as number;
  }
}
