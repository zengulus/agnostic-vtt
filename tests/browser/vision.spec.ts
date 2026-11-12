import { expect, test } from '@playwright/test';
import type { Action } from '../../shared/protocol.js';
import type { RoomState } from '../../shared/model.js';
import { openLibrary } from './helpers/workspace.js';

test('draw walls and doors, configure darkness and token sight, and open a door', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  const state = async (): Promise<RoomState> =>
    page.evaluate(async () => (await import('/src/store.ts' as string)).useTable.getState().room);
  const act = async (action: Action) =>
    page.evaluate(
      async (a) => (await import('/src/connection.ts' as string)).sendAndWait(a),
      action,
    );
  await page.getByRole('button', { name: 'Draw walls' }).click();
  await page.getByLabel('Wall type').selectOption('door');
  const canvas = page.locator('canvas').first(),
    box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60);
  await page.mouse.up();
  await expect
    .poll(async () => Object.keys((await state()).scenes.hollow.walls || {}).length)
    .toBe(1);
  await openLibrary(page);
  await page.locator('.lighting-controls summary').click();
  await page.getByLabel('Enable shared player vision').check();
  await page.getByLabel('Scene darkness').fill('0.7');
  await page.getByRole('button', { name: 'Apply vision and darkness' }).click();
  expect((await state()).scenes.hollow.lighting).toEqual({ vision: true, darkness: 0.7 });
  await page.getByRole('button', { name: 'Open door 1' }).click();
  expect(Object.values((await state()).scenes.hollow.walls!)[0].open).toBe(true);
  await page.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
  await page.getByRole('button', { name: 'Edit token', exact: true }).click();
  await page.getByText('Sight & light').click();
  await page.getByLabel('Configure NPC vision cone').check();
  await page.getByLabel('Vision angle (degrees)').fill('90');
  await page.getByLabel('Emit light').check();
  await page.getByLabel('Light radius (map pixels)').fill('200');
  await page.getByRole('button', { name: 'Save token', exact: true }).click();
  expect((await state()).scenes.hollow.tokens.ranger.sight?.angle).toBe(90);
  expect((await state()).scenes.hollow.tokens.ranger.light?.radius).toBe(200);
  await act({ type: 'SESSION_ROLE', role: 'player' });
  await expect(page.getByRole('button', { name: 'Draw walls' })).toHaveCount(0);
});

test('vision mask blocks the map behind a closed wall and reveals it when the door opens', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  const act = async (action: Action) =>
    page.evaluate(
      async (a) => (await import('/src/connection.ts' as string)).sendAndWait(a),
      action,
    );
  const state = async (): Promise<RoomState> =>
    page.evaluate(async () => (await import('/src/store.ts' as string)).useTable.getState().room);
  const scene = (await state()).scenes.hollow;
  for (const token of Object.values(scene.tokens))
    await act({
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: {
        ...token,
        owners: token.id === 'ranger' ? ['*'] : [],
        ...(token.id === 'ranger' ? { x: 600, y: 600 } : {}),
      },
    });
  await act({
    type: 'WALL_SET',
    sceneId: 'hollow',
    wall: { id: 'barrier', a: { x: 800, y: 0 }, b: { x: 800, y: 1200 }, kind: 'door', open: false },
  });
  await act({ type: 'LIGHTING_SET', sceneId: 'hollow', lighting: { vision: true, darkness: 0 } });
  await act({ type: 'SESSION_ROLE', role: 'player' });
  const pixel = async () =>
    page.evaluate(async () => {
      const s = (await import('/src/store.ts' as string)).useTable.getState(),
        c = document.querySelector('canvas')!,
        context = c.getContext('2d')!,
        ratio = c.width / c.getBoundingClientRect().width;
      const x = Math.round((900 * s.camera.zoom + s.camera.x) * ratio),
        y = Math.round((600 * s.camera.zoom + s.camera.y) * ratio);
      return Array.from(context.getImageData(x, y, 1, 1).data)
        .slice(0, 3)
        .reduce((a, b) => a + b, 0);
    });
  await expect.poll(pixel).toBeLessThan(10);
  await act({ type: 'SESSION_ROLE', role: 'gm' });
  await act({
    type: 'WALL_SET',
    sceneId: 'hollow',
    wall: { id: 'barrier', a: { x: 800, y: 0 }, b: { x: 800, y: 1200 }, kind: 'door', open: true },
  });
  await act({ type: 'SESSION_ROLE', role: 'player' });
  await expect.poll(pixel).toBeGreaterThan(10);
});

test('dense visibility work yields and retains the scene geometry', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { SceneRenderer } = await import('/src/rendering.ts' as string);
    const renderer = new SceneRenderer() as any;
    const walls = Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [
        `wall-${i}`,
        {
          id: `wall-${i}`,
          kind: 'wall',
          a: { x: (i % 8) * 50, y: Math.floor(i / 8) * 50 },
          b: { x: (i % 8) * 50 + 35, y: Math.floor(i / 8) * 50 + 25 },
        },
      ]),
    );
    const positions = Array.from({ length: 300 }, (_, i) => ({ x: 400 + i, y: 400 }));
    for (const p of positions) renderer.polygon(p, 1200, 360, 0, walls);
    const immediate = renderer.polygons.size;
    let heartbeat = 0;
    const timer = setInterval(() => heartbeat++, 1);
    const deadline = performance.now() + 20000;
    while (renderer.polygons.size < positions.length && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    clearInterval(timer);
    const count = renderer.polygons.size;
    for (const p of positions) renderer.polygon(p, 1200, 360, 0, walls);
    return { immediate, heartbeat, count, queued: renderer.polygonQueue.length };
  });
  expect(result.immediate).toBe(0);
  expect(result.heartbeat).toBeGreaterThan(0);
  expect(result.count).toBe(300);
  expect(result.queued).toBe(0);
});
