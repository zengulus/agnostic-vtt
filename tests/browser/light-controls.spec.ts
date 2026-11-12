import { expect, test } from '@playwright/test';
import type { Action } from '../../shared/protocol.js';
import type { RoomState } from '../../shared/model.js';
import { openLibrary } from './helpers/workspace.js';

test('GM places preset lights and edits them without losing concurrent changes', async ({
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
  await page.getByRole('button', { name: 'Place a light', exact: true }).click();
  await page.getByLabel('New light preset').selectOption('arcane');
  await page.getByLabel('New light name').fill('Moon lamp');
  await page.getByLabel('New light radius').fill('320');
  const canvas = page.locator('canvas').first(),
    box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await expect
    .poll(async () =>
      Object.values((await state()).scenes.hollow.tokens).some((t) => t.name === 'Moon lamp'),
    )
    .toBe(true);
  const placed = Object.values((await state()).scenes.hollow.tokens).find(
    (t) => t.name === 'Moon lamp',
  )!;
  expect(placed).toMatchObject({ hideLabel: true, light: { radius: 320, color: '#8ecfff' } });
  expect(placed.light?.angle ?? 360).toBe(360);
  await page.getByLabel('New light preset').selectOption('sconce');
  await expect(page.getByLabel('New light beam width')).toHaveValue('100');
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3);
  await page.mouse.up();
  await expect
    .poll(async () =>
      Object.values((await state()).scenes.hollow.tokens).some((t) => t.name === 'Sconce'),
    )
    .toBe(true);
  const sconce = Object.values((await state()).scenes.hollow.tokens).find(
    (t) => t.name === 'Sconce',
  )!;
  expect(sconce.light?.angle).toBe(100);
  expect(sconce.light?.direction).toBeCloseTo(-90, 0);
  await openLibrary(page);
  await page.locator('.lighting-controls summary').click();
  await page.getByRole('button', { name: 'Edit Moon lamp' }).click();
  await page.getByLabel('Edit light radius').fill('500');
  expect((await state()).scenes.hollow.tokens[placed.id].light!.radius).toBe(320);
  const current = (await state()).scenes.hollow.tokens[placed.id];
  await act({ type: 'TOKEN_UPDATE', sceneId: 'hollow', token: { ...current, x: current.x + 30 } });
  await page.getByRole('button', { name: 'Save light', exact: true }).click();
  expect((await state()).scenes.hollow.tokens[placed.id]).toMatchObject({
    x: current.x + 30,
    light: { radius: 500 },
  });
  await page.getByRole('button', { name: 'Edit Moon lamp' }).click();
  await page.getByLabel('Edit light radius').fill('700');
  const latest = (await state()).scenes.hollow.tokens[placed.id];
  await act({
    type: 'TOKEN_UPDATE',
    sceneId: 'hollow',
    token: { ...latest, light: { ...latest.light!, radius: 600 } },
  });
  await page.getByRole('button', { name: 'Save light', exact: true }).click();
  await expect(page.locator('.light-editor [role="alert"]')).toContainText('changed');
  await expect(page.getByLabel('Edit light radius')).toHaveValue('700');
  expect((await state()).scenes.hollow.tokens[placed.id].light!.radius).toBe(600);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(async () =>
    (await import('/src/store.ts' as string)).useTable
      .getState()
      .set({ selected: 'ranger', selectedIds: ['ranger'] }),
  );
  await page.getByRole('button', { name: 'Add light to Kael · Wanderer' }).click();
  expect((await state()).scenes.hollow.tokens.ranger).toMatchObject({
    name: 'Kael · Wanderer',
    light: { angle: 100 },
  });
});

test('directional and radial lights illuminate different areas', async ({ page }) => {
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
  const token = (await state()).scenes.hollow.tokens.ranger;
  await act({
    type: 'TOKEN_UPDATE',
    sceneId: 'hollow',
    token: {
      ...token,
      x: 800,
      y: 600,
      rotation: 0,
      light: { radius: 350, color: '#ffbb66', intensity: 1, angle: 90, direction: 0 },
    },
  });
  await act({ type: 'LIGHTING_SET', sceneId: 'hollow', lighting: { vision: false, darkness: 1 } });
  const pixel = async (worldX: number) =>
    page.evaluate(async (x) => {
      const s = (await import('/src/store.ts' as string)).useTable.getState();
      const c = document.querySelector('canvas')!,
        ratio = c.width / c.getBoundingClientRect().width;
      const values = c
        .getContext('2d')!
        .getImageData(
          Math.round((x * s.camera.zoom + s.camera.x) * ratio),
          Math.round((600 * s.camera.zoom + s.camera.y) * ratio),
          1,
          1,
        ).data;
      return values[0] + values[1] + values[2];
    }, worldX);
  await expect.poll(() => pixel(900)).toBeGreaterThan(20);
  await expect.poll(() => pixel(700)).toBeLessThan(10);
  const current = (await state()).scenes.hollow.tokens.ranger;
  await act({
    type: 'TOKEN_UPDATE',
    sceneId: 'hollow',
    token: { ...current, light: { ...current.light!, angle: 360 } },
  });
  await expect.poll(() => pixel(700)).toBeGreaterThan(20);
});

test('animated light settings are saved once and run locally', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Place a light', exact: true }).click();
  await page.locator('.light-effects > summary').click();
  await page.getByLabel('New light hue shifting').check();
  await page.getByLabel('New light on-off flicker').check();
  await page.getByLabel('New light dimming flicker').check();
  await page.getByLabel('New light minimum brightness').fill('0.5');
  await page.getByLabel('New light flicker frequency jitter (Hz)').fill('0.08');
  await page.getByLabel('New light on/off frequency (Hz)').fill('0.5');
  await page.locator('.light-effects > summary').click();
  const canvas = page.locator('canvas').first(),
    box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  const read = (): Promise<RoomState> =>
    page.evaluate(async () => (await import('/src/store.ts' as string)).useTable.getState().room);
  await expect
    .poll(async () =>
      Object.values((await read()).scenes.hollow.tokens).some((t) => t.light?.effects?.dimming),
    )
    .toBe(true);
  const saved = await read();
  const light = Object.values(saved.scenes.hollow.tokens).find(
    (t) => t.light?.effects?.dimming,
  )!.light!;
  expect(light.effects).toMatchObject({
    hueShift: true,
    onOff: true,
    dimming: true,
    minBrightness: 0.5,
    jitterHz: 0.08,
    onOffHz: 0.5,
  });
  await page.waitForTimeout(500);
  expect(await read()).toEqual(saved);
});

test('light follows a token preview for GM and player views', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  const act = async (action: Action) =>
    page.evaluate(
      async (a) => (await import('/src/connection.ts' as string)).sendAndWait(a),
      action,
    );
  const token = await page.evaluate(
    async () =>
      (await import('/src/store.ts' as string)).useTable.getState().room.scenes.hollow.tokens
        .ranger,
  );
  await act({
    type: 'TOKEN_UPDATE',
    sceneId: 'hollow',
    token: { ...token, x: 600, y: 600, light: { radius: 180, color: '#ffaa66', intensity: 1 } },
  });
  await act({ type: 'LIGHTING_SET', sceneId: 'hollow', lighting: { vision: false, darkness: 1 } });
  const setPreview = async (x: number) =>
    page.evaluate(async (x) => {
      const s = (await import('/src/store.ts' as string)).useTable.getState();
      s.set({ reducedMotion: true, previews: { ranger: { x, y: 600 } } });
    }, x);
  const pixel = async (x: number) =>
    page.evaluate(async (x) => {
      const s = (await import('/src/store.ts' as string)).useTable.getState(),
        c = document.querySelector('canvas')!,
        ratio = c.width / c.getBoundingClientRect().width;
      const data = c
        .getContext('2d')!
        .getImageData(
          Math.round((x * s.camera.zoom + s.camera.x) * ratio),
          Math.round((600 * s.camera.zoom + s.camera.y) * ratio),
          1,
          1,
        ).data;
      return data[0] + data[1] + data[2];
    }, x);
  for (const role of ['gm', 'player']) {
    if (role === 'player') await page.getByRole('button', { name: 'Play as player' }).click();
    await setPreview(600);
    await expect.poll(() => pixel(600)).toBeGreaterThan(20);
    await setPreview(1000);
    await expect.poll(() => pixel(1000)).toBeGreaterThan(20);
    await expect.poll(() => pixel(600)).toBeLessThan(10);
  }
});

test('a light can be removed even when its unsaved draft is invalid', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  const token = await page.evaluate(
    async () =>
      (await import('/src/store.ts' as string)).useTable.getState().room.scenes.hollow.tokens
        .ranger,
  );
  await page.evaluate(
    async (token) =>
      (await import('/src/connection.ts' as string)).sendAndWait({
        type: 'TOKEN_UPDATE',
        sceneId: 'hollow',
        token: { ...token, light: { radius: 250, color: '#ffaa66', intensity: 1 } },
      }),
    token,
  );
  await openLibrary(page);
  await page.locator('.lighting-controls > summary').click();
  await page.getByRole('button', { name: 'Edit Kael · Wanderer' }).click();
  await page.getByLabel('Edit light name').fill('');
  await page.getByRole('button', { name: 'Remove light from token' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await import('/src/store.ts' as string)).useTable.getState().room.scenes.hollow.tokens
            .ranger.light,
      ),
    )
    .toBeUndefined();
});
