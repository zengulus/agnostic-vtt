import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  save(room: DurableRoom): Promise<void>;
  list?(userId: string): Promise<Array<{ id: string; name: string; role: 'gm' | 'player' }>>;
}
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
  async save(room: DurableRoom) {
    await mkdir(this.dir, { recursive: true });
    const data = JSON.stringify(room);
    const path = join(this.dir, `${room.state.id}.json`);
    await writeFile(`${path}.tmp`, data, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    metrics.writes++;
    metrics.snapshotBytes = Buffer.byteLength(data);
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
    });
  }
  async load(id: string) {
    metrics.reads++;
    const { data, error } = await this.client
      .from('room_snapshots')
      .select('snapshot')
      .eq('campaign_id', id)
      .maybeSingle();
    if (error) throw new Error(`Snapshot read failed: ${error.code}`);
    return data?.snapshot as DurableRoom | null;
  }
  async save(room: DurableRoom) {
    const { error } = await this.client.rpc('save_room_snapshot', {
      p_id: room.state.id,
      p_owner: room.ownerId,
      p_name: room.state.name,
      p_revision: room.state.revision,
      p_snapshot: room,
    });
    if (error) throw new Error(`Snapshot write failed: ${error.code}`);
    metrics.writes++;
    metrics.snapshotBytes = Buffer.byteLength(JSON.stringify(room));
  }
}
