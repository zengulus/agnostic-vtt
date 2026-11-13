import { expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { RoomManager } from '../server/rooms.js';
import { createApp } from '../server/app.js';
import { LocalAuth } from '../server/auth.js';
import type { DurableRoom } from '../shared/model.js';

it('rejects image upload requests without storing data or saving snapshots', async () => {
  const snapshots = new Map<string, DurableRoom>();
  let writes = 0,
    puts = 0;
  const auth = new LocalAuth('upload-disabled-test');
  const manager = new RoomManager({
    async load(id) {
      return structuredClone(snapshots.get(id) || null);
    },
    async save(room, version = 0) {
      writes++;
      snapshots.set(room.state.id, structuredClone({ ...room, saveVersion: version + 1 }));
      return version + 1;
    },
  });
  const app = createApp(manager, auth, new Set(), {
    async put() {
      puts++;
    },
    async get() {
      return Buffer.from('');
    },
    async remove() {},
  });
  const owner = auth.issue('Owner'),
    room = await manager.create(owner, 'Table');
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  try {
    const before = writes;
    const response = await fetch(
      `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/assets/${room.id}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'image/png' },
        body: new Uint8Array([1, 2, 3]),
      },
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('URL') });
    expect(puts).toBe(0);
    expect(writes).toBe(before);
  } finally {
    await app.close();
  }
});
