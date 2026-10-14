import { expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { RoomManager, type Peer } from '../server/rooms.js';
import { createApp } from '../server/app.js';
import { LocalAuth } from '../server/auth.js';
import type { DurableRoom } from '../shared/model.js';

it('closes HTTP without waiting 30 seconds for an upload and saves another campaign first', async () => {
  const snapshots = new Map<string, DurableRoom>(),
    auth = new LocalAuth('shutdown-test');
  const manager = new RoomManager({
    async load(id) {
      return structuredClone(snapshots.get(id) || null);
    },
    async save(room, version = 0) {
      snapshots.set(room.state.id, structuredClone({ ...room, saveVersion: version + 1 }));
      return version + 1;
    },
  });
  let started!: () => void, release!: () => void;
  const startedUpload = new Promise<void>((resolve) => {
    started = resolve;
  });
  const uploadGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = createApp(manager, auth, new Set(), {
    async put() {
      started();
      await uploadGate;
      throw new Error('Upload interrupted');
    },
    async get() {
      return Buffer.from('');
    },
    async remove() {},
  });
  const owner = auth.issue('Owner'),
    first = await manager.create(owner, 'Uploading'),
    second = await manager.create(owner, 'Moving');
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#112233' } })
    .png()
    .toBuffer();
  const upload = fetch(
    `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/assets/${first.id}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'image/png' },
      body: new Uint8Array(png),
    },
  ).then(
    (response) => response.status,
    () => 'closed',
  );
  try {
    await startedUpload;
    const peer: Peer = { identity: owner, send() {} };
    await manager.join(peer, second.id);
    manager.handle(peer, second.id, {
      v: 2,
      actionId: 'move',
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 520, y: 760 },
    });
    const startedClosing = Date.now(),
      closing = app.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(snapshots.get(second.id)?.state.scenes.hollow.tokens.ranger.x).toBe(520);
    await closing;
    expect(Date.now() - startedClosing).toBeLessThan(5000);
    expect(await upload).toBe('closed');
    expect(Object.keys(snapshots.get(first.id)?.assetCleanup || {})).toHaveLength(1);
  } finally {
    release();
    await app.close();
  }
});
