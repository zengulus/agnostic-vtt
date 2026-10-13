import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { ServerMessage } from '../../shared/protocol.js';
import type { RoomState } from '../../shared/model.js';

function observe(page: Page) {
  const messages: ServerMessage[] = [];
  page.on('websocket', (ws) =>
    ws.on('framereceived', (event) => {
      try {
        messages.push(JSON.parse(String(event.payload)));
      } catch {
        /* Vite hot reload. */
      }
    }),
  );
  return messages;
}
async function create(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table' }).click();
  await page.getByRole('button', { name: 'Begin your adventure' }).click();
  await expect(page.getByText('LIVE SESSION', { exact: true })).toBeVisible();
}
async function roomState(page: Page): Promise<RoomState> {
  return page.evaluate(async () => {
    const path = '/src/store.ts';
    return (await import(path)).useTable.getState().room;
  });
}
async function point(page: Page, x: number, y: number) {
  const camera = await page.evaluate(async () => {
    const path = '/src/store.ts';
    return (await import(path)).useTable.getState().camera;
  });
  const box = (await page.locator('.tabletop > canvas').boundingBox())!;
  return { x: box.x + camera.x + x * camera.zoom, y: box.y + camera.y + y * camera.zoom };
}
async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  const a = await point(page, x, y),
    b = await point(page, dx, dy);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

test('local uploads, statuses, independent template placement, group edits and undo work through the UI', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const messages = observe(page);
  await create(page);
  const png = await sharp({
    create: { width: 96, height: 96, channels: 4, background: '#57927680' },
  })
    .png()
    .toBuffer();
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await page
    .getByLabel('Upload image', { exact: true })
    .setInputFiles({ name: 'warden.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('Image preview')).toHaveAttribute('src', /^blob:/);
  await page.getByLabel('Name', { exact: true }).fill('Forest warden');
  await page.getByLabel('Status label').fill('Inspired');
  await page.getByRole('button', { name: 'Add status', exact: true }).click();
  await page.getByLabel('Also save a reusable token template').check();
  await page.getByRole('button', { name: 'Add to the table', exact: true }).click();
  await expect
    .poll(async () => Object.values((await roomState(page)).tokenLibrary || {}).length)
    .toBe(1);
  let state = await roomState(page);
  const token = Object.values(state.scenes.hollow.tokens).find((t) => t.name === 'Forest warden')!;
  expect(token.image.kind).toBe('uploaded');
  expect(token.statuses?.[0].label).toBe('Inspired');
  expect(JSON.stringify(messages)).not.toContain('data:image');
  await page.getByRole('button', { name: 'Saved token library', exact: true }).click();
  await page.getByRole('button', { name: 'Place Forest warden', exact: true }).click();
  await expect
    .poll(
      async () =>
        Object.values((await roomState(page)).scenes.hollow.tokens).filter(
          (t) => t.name === 'Forest warden',
        ).length,
    )
    .toBe(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(
      async () =>
        Object.values((await roomState(page)).scenes.hollow.tokens).filter(
          (t) => t.name === 'Forest warden',
        ).length,
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect
    .poll(
      async () =>
        Object.values((await roomState(page)).scenes.hollow.tokens).filter(
          (t) => t.name === 'Forest warden',
        ).length,
    )
    .toBe(2);
  // Multiselect two original tokens, group them and move the group in one commit.
  await page.getByRole('button', { name: 'Select & move', exact: true }).click();
  await page.keyboard.press('Escape');
  const ranger = await point(page, 600, 680),
    mage = await point(page, 740, 600);
  await page.keyboard.down('Control');
  await page.mouse.click(ranger.x, ranger.y);
  await page.mouse.click(mage.x, mage.y);
  await page.keyboard.up('Control');
  await page.getByRole('button', { name: 'Group selected tokens', exact: true }).click();
  await expect
    .poll(async () => (await roomState(page)).scenes.hollow.tokens.ranger.groupId)
    .toBeTruthy();
  await drag(page, 600, 680, 680, 760);
  await expect.poll(async () => (await roomState(page)).scenes.hollow.tokens.ranger.x).toBe(680);
  state = await roomState(page);
  expect(state.scenes.hollow.tokens.mage.x).toBe(840);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await roomState(page)).scenes.hollow.tokens.ranger.x).toBe(600);
  await page.getByRole('button', { name: 'Manage images', exact: true }).click();
  await expect(page.getByAltText('warden.png')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Map settings', exact: true }).click();
  await page
    .getByLabel('Upload image', { exact: true })
    .setInputFiles({ name: 'moss-map.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('Image preview')).toHaveAttribute('src', /^blob:/);
  await page.getByLabel('Scene name').fill('Moss archive');
  await page.getByLabel('Save as a new scene').check();
  await page.getByRole('button', { name: 'Add scene', exact: true }).click();
  await page.getByRole('button', { name: 'Moss archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Moss archive', exact: true })).toBeVisible();
  state = await roomState(page);
  expect(state.scenes[state.activeSceneId].map.kind).toBe('uploaded');
  expect(state.scenes[state.activeSceneId].tokens).toEqual({});
  await page.screenshot({ path: 'test-results/workshop-table.png' });
  expect(errors).toEqual([]);
});

test('geometry, drawing layers, hidden turns, hex settings and scene changes synchronize independent browsers', async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    gm = await a.newPage(),
    pc = await b.newPage();
  const errors: string[] = [];
  gm.on('pageerror', (e) => errors.push(e.message));
  pc.on('pageerror', (e) => errors.push(e.message));
  await create(gm);
  await gm.getByRole('button', { name: 'Invite party' }).click();
  const invite = await gm.getByRole('textbox', { name: 'Party invitation' }).inputValue();
  await gm.getByRole('button', { name: 'Close dialog' }).click();
  await pc.goto(invite);
  await pc.getByLabel('Your name').fill('Observer');
  await pc.getByRole('button', { name: 'Join your party', exact: true }).click();
  await expect(pc.getByText('LIVE SESSION', { exact: true })).toBeVisible();
  await gm.getByRole('button', { name: 'Text annotation', exact: true }).click();
  await gm.getByLabel('Annotation text').fill('Private route');
  await gm.getByRole('combobox', { name: 'Layer', exact: true }).selectOption('gm');
  let p = await point(gm, 400, 400);
  await gm.mouse.click(p.x, p.y);
  await expect
    .poll(async () => Object.values((await roomState(gm)).scenes.hollow.annotations || {}).length)
    .toBe(1);
  expect(Object.values((await roomState(pc)).scenes.hollow.annotations || {})).toHaveLength(0);
  await gm.getByRole('combobox', { name: 'Layer', exact: true }).selectOption('public');
  await gm.getByLabel('Annotation text').fill('Party camp');
  p = await point(gm, 1000, 400);
  await gm.mouse.click(p.x, p.y);
  await expect
    .poll(async () =>
      Object.values((await roomState(pc)).scenes.hollow.annotations || {}).map((v) => v.text),
    )
    .toEqual(['Party camp']);
  await gm.getByRole('button', { name: 'Freehand drawing', exact: true }).click();
  await drag(gm, 300, 800, 550, 900);
  await expect
    .poll(async () => Object.values((await roomState(pc)).scenes.hollow.annotations || {}).length)
    .toBe(2);
  await gm.getByRole('button', { name: 'Mark an area', exact: true }).click();
  await gm.getByLabel('Zone shape').selectOption('polygon');
  for (const [x, y] of [
    [900, 800],
    [1100, 800],
    [1100, 1000],
  ]) {
    p = await point(gm, x, y);
    await gm.mouse.click(p.x, p.y);
  }
  await gm.keyboard.press('Enter');
  await expect
    .poll(async () =>
      Object.values((await roomState(pc)).scenes.hollow.zones).some((z) => z.shape === 'polygon'),
    )
    .toBe(true);
  await gm.getByRole('button', { name: 'Cover scene with fog', exact: true }).click();
  await expect
    .poll(async () => Object.keys((await roomState(pc)).scenes.hollow.tokens).length)
    .toBe(0);
  await gm.getByRole('button', { name: 'Fog reveal / conceal', exact: true }).click();
  await gm.getByLabel('Fog shape').selectOption('rectangle');
  await drag(gm, 480, 560, 700, 800);
  await expect.poll(async () => !!(await roomState(pc)).scenes.hollow.tokens.ranger).toBe(true);
  await gm.getByLabel('Fog action').selectOption('conceal');
  await drag(gm, 550, 630, 650, 730);
  await expect.poll(async () => !!(await roomState(pc)).scenes.hollow.tokens.ranger).toBe(false);
  await gm.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => !!(await roomState(pc)).scenes.hollow.tokens.ranger).toBe(true);
  await gm.getByRole('button', { name: 'Grid settings', exact: true }).click();
  await gm.getByLabel('Grid type').selectOption('hex');
  await gm.getByLabel('Measurement convention').selectOption('grid');
  await gm.getByRole('button', { name: 'Save grid', exact: true }).click();
  await expect.poll(async () => (await roomState(pc)).scenes.hollow.grid.type).toBe('hex');
  await gm.getByRole('button', { name: 'Turns', exact: true }).click();
  await pc.getByRole('button', { name: 'Turns', exact: true }).click();
  await gm.getByLabel('Participant name').fill('Hidden guide');
  await gm.getByLabel('Hidden', { exact: true }).check();
  await gm.getByRole('button', { name: 'Add participant', exact: true }).click();
  await gm.getByLabel('Participant name').fill('Party member');
  await gm.getByRole('button', { name: 'Add participant', exact: true }).click();
  await expect(pc.getByText('Party member', { exact: true })).toBeVisible();
  await expect(pc.getByText('Hidden guide', { exact: true })).toHaveCount(0);
  await gm.getByRole('button', { name: 'Next turn', exact: true }).click();
  await expect(pc.getByText('Current participant', { exact: true })).toBeVisible();
  await gm.getByRole('button', { name: 'The Astral Sanctuary', exact: true }).click();
  await expect(
    pc.getByRole('heading', { name: 'The Astral Sanctuary', exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await roomState(pc)).activeSceneId).toBe('sanctuary');
  await expect
    .poll(() => gm.locator('.scene-transition').evaluate((el) => getComputedStyle(el).opacity))
    .toBe('0');
  await gm.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
  await expect(gm.getByRole('button', { name: 'Edit token', exact: true })).toBeVisible();
  await gm.screenshot({ path: 'test-results/workshop-tracker.png' });
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});

test('dice themes persist, minimal arithmetic remains authoritative, and tablet tools stay accessible', async ({
  page,
}) => {
  const messages = observe(page);
  await create(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'moon', exact: true }).click();
  await page.getByRole('combobox', { name: 'Material', exact: true }).selectOption('gemstone');
  await page.getByLabel('Throw style').selectOption('orbit');
  await page.getByLabel('Tray appearance').selectOption('astral');
  await page.getByLabel('Performance preset').selectOption('low');
  await page.getByLabel('Arithmetic theme').selectOption('minimal');
  await page.getByRole('button', { name: 'Back to the story', exact: true }).click();
  await page.getByRole('textbox', { name: 'DICE EXPRESSION' }).fill('2d6+5-2');
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  await expect(page.getByTestId('roll-total')).toBeVisible();
  expect(await page.locator('.physical-dice').count()).toBe(0);
  const result = messages.find((m) => m.type === 'DICE_ROLL_RESULT');
  expect(result?.type).toBe('DICE_ROLL_RESULT');
  if (result?.type === 'DICE_ROLL_RESULT')
    await expect(page.getByTestId('roll-total').locator('strong')).toHaveText(
      String(result.roll.total),
    );
  await page.getByRole('button', { name: 'Dismiss roll', exact: true }).click();
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Material', exact: true })).toHaveValue(
    'gemstone',
  );
  await expect(page.getByLabel('Throw style')).toHaveValue('orbit');
  await expect(page.getByLabel('Arithmetic theme')).toHaveValue('minimal');
  await page.getByRole('button', { name: 'Back to the story', exact: true }).click();
  await create(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByRole('button', { name: 'Toggle library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scene settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage images', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Grid settings', exact: true }).click();
  await expect(page.getByLabel('Grid type')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/workshop-tablet.png' });
});

test('custom tosses, slower/faster physics and transparent gemstone d4s retain forced faces', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const path = '/src/diceEngine.ts',
      themes = '/shared/diceThemes.ts';
    const { createDiceEngine } = await import(path),
      { dicePreferencesSchema } = await import(themes);
    const element = document.createElement('div');
    element.id = 'custom-physics';
    Object.assign(element.style, {
      position: 'fixed',
      width: '700px',
      height: '450px',
      top: '0',
      left: '0',
    });
    document.body.appendChild(element);
    const results = [];
    for (const [toss, speed] of [
      ['cascade', 0.5],
      ['orbit', 2],
    ]) {
      const appearance = dicePreferencesSchema.parse({
        toss,
        speed,
        opacity: 0.55,
        material: 'gemstone',
        performance: toss === 'orbit' ? 'cinematic' : 'low',
      });
      const box = createDiceEngine(
        '#custom-physics',
        {
          baseScale: 65,
          iterationLimit: 600,
          shadows: toss === 'orbit',
          sounds: false,
          theme_customColorset: {
            name: 'gemstone',
            foreground: '#ffffff',
            background: '#506ea8',
            texture: 'none',
            material: 'glass',
          },
        },
        appearance,
      );
      await box.initialize();
      const roll = await box.roll('1d4+1d6+1d20@4,6,20');
      results.push({
        values: roll.sets.flatMap((s: { rolls: Array<{ value: number }> }) =>
          s.rolls.map((r) => r.value),
        ),
        opacity: box.diceList[0].material[0].opacity,
        shadowResolution: box.light.shadow.map?.width || 0,
      });
      box.running = false;
      box.renderer.dispose();
      box.renderer.forceContextLoss();
      element.replaceChildren();
    }
    element.remove();
    return results;
  });
  expect(results).toEqual([
    { values: [4, 6, 20], opacity: 0.55, shadowResolution: 0 },
    { values: [4, 6, 20], opacity: 0.55, shadowResolution: 2048 },
  ]);
});

test('large hex maps render only the visible grid with one hundred tokens', async ({
  page,
}, info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/rendering.ts',
      samplePath = '/shared/sample.ts';
    const { SceneRenderer } = await import(rendererPath),
      { sampleScene } = await import(samplePath);
    const scene = sampleScene();
    scene.width = scene.height = 10000;
    scene.grid = { ...scene.grid, type: 'hex', size: 16, enabled: true };
    const source = scene.tokens.ranger;
    scene.tokens = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [
        `load-${i}`,
        {
          ...source,
          id: `load-${i}`,
          size: 36,
          x: 80 + (i % 10) * 65,
          y: 60 + Math.floor(i / 10) * 52,
        },
      ]),
    );
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 650;
    const ctx = canvas.getContext('2d')!,
      lineTo = ctx.lineTo.bind(ctx);
    let segments = 0;
    ctx.lineTo = (...args) => {
      segments++;
      lineTo(...args);
    };
    const renderer = new SceneRenderer(),
      options = {
        scene,
        roomId: 'preview',
        camera: { x: 0, y: 0, zoom: 1 },
        width: 900,
        height: 650,
        dpr: 1,
        gm: true,
        selected: [],
        previews: {},
        localDragging: new Set<string>(),
        reducedMotion: true,
        pings: [],
        draft: null,
        tool: 'select',
        zoneShape: 'rectangle',
        fogShape: 'circle',
        fogMode: 'reveal',
        brushSize: 100,
        drawColor: '#ffffff',
        drawWidth: 3,
        measurementShape: 'distance',
        redraw: () => {},
      };
    renderer.draw(ctx, options);
    await new Promise((r) => setTimeout(r, 300));
    segments = 0;
    const start = performance.now();
    for (let i = 0; i < 20; i++) renderer.draw(ctx, options);
    return {
      segmentsPerFrame: segments / 20,
      millisecondsPerFrame: (performance.now() - start) / 20,
    };
  });
  expect(result.segmentsPerFrame).toBeLessThan(25000);
  await info.attach('large-map-render.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
});
