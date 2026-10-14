import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { Action } from '../../shared/protocol.js';
import type { RoomState } from '../../shared/model.js';

async function create(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  const creation = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() === 'POST' &&
      (path === '/api/campaigns' || (path === '/api/guest' && !response.ok()))
    );
  });
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
  const response = await creation,
    body = await response.text();
  await test.info().attach('campaign-create-response.json', {
    body: JSON.stringify({ status: response.status(), body }),
    contentType: 'application/json',
  });
  expect(response.status(), `${response.url()}: ${body}`).toBe(201);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
}
async function roomState(page: Page): Promise<RoomState> {
  return page.evaluate(async () => {
    const path = '/src/store.ts';
    return (await import(path)).useTable.getState().room;
  });
}
async function action(page: Page, value: Action) {
  await page.evaluate(async (value) => {
    const path = '/src/connection.ts';
    await (await import(path)).sendAndWait(value);
  }, value);
}
async function invitation(page: Page) {
  await page.getByRole('button', { name: 'Invite party', exact: true }).click();
  const url = await page.getByLabel('Party invitation', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return url;
}
async function join(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Join your party', exact: true }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
}
async function editToken(page: Page) {
  await page.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
  await page.getByRole('button', { name: 'Edit token', exact: true }).click();
}

test('saving an open token form preserves an independent player move', async ({ browser }) => {
  const owner = await browser.newContext(),
    player = await browser.newContext();
  try {
    const gm = await owner.newPage(),
      pc = await player.newPage();
    await create(gm);
    await join(pc, await invitation(gm));
    await editToken(gm);
    await gm.getByLabel('Name', { exact: true }).fill('Renamed ranger');
    await action(pc, {
      type: 'TOKEN_MOVE_COMMIT',
      sceneId: 'hollow',
      tokenId: 'ranger',
      position: { x: 920, y: 760 },
    });
    await expect.poll(async () => (await roomState(gm)).scenes.hollow.tokens.ranger.x).toBe(920);
    await gm.getByRole('button', { name: 'Save token', exact: true }).click();
    await expect(gm.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(async () => (await roomState(pc)).scenes.hollow.tokens.ranger.name)
      .toBe('Renamed ranger');
    expect((await roomState(pc)).scenes.hollow.tokens.ranger).toMatchObject({ x: 920, y: 760 });
  } finally {
    await owner.close();
    await player.close();
  }
});

test('same-field conflict retains the draft until the user reloads latest token values', async ({
  page,
}) => {
  await create(page);
  const other = await page.context().newPage();
  try {
    await join(other, await invitation(page));
    await editToken(page);
    await page.getByLabel('Name', { exact: true }).fill('My draft');
    const token = (await roomState(other)).scenes.hollow.tokens.ranger;
    await action(other, {
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...token, name: 'Other GM edit' },
    });
    await page.getByRole('button', { name: 'Save token', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      'name changed while you were editing',
    );
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('My draft');
    expect((await roomState(other)).scenes.hollow.tokens.ranger.name).toBe('Other GM edit');
    await page.getByRole('button', { name: 'Reload latest token values', exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Other GM edit');
    await page.getByLabel('GM note', { exact: true }).fill('Reconciled note');
    await page.getByRole('button', { name: 'Save token', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(async () => (await roomState(other)).scenes.hollow.tokens.ranger.note)
      .toBe('Reconciled note');
  } finally {
    await other.close();
  }
});

test('remote scene switches close map, grid and token forms without changing the destination scene', async ({
  page,
}) => {
  await create(page);
  const other = await page.context().newPage();
  try {
    await join(other, await invitation(page));
    const original = (await roomState(page)).scenes.sanctuary;
    for (const kind of ['map', 'grid', 'token'] as const) {
      if (kind === 'token') {
        await editToken(page);
        await page.getByLabel('Name', { exact: true }).fill('Stale token draft');
      } else {
        await page
          .getByRole('button', {
            name: kind === 'map' ? 'Map settings' : 'Grid settings',
            exact: true,
          })
          .click();
        await page
          .getByLabel(kind === 'map' ? 'Scene name' : 'Units', { exact: true })
          .fill('Stale draft');
      }
      await action(other, { type: 'SCENE_CHANGE', sceneId: 'sanctuary' });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(async () => (await roomState(page)).activeSceneId).toBe('sanctuary');
      expect((await roomState(page)).scenes.sanctuary).toEqual(original);
      await action(other, { type: 'SCENE_CHANGE', sceneId: 'hollow' });
      await expect.poll(async () => (await roomState(page)).activeSceneId).toBe('hollow');
    }
  } finally {
    await other.close();
  }
});

test('a synchronous scene change cannot submit a stale form before React closes it', async ({
  page,
}) => {
  const sent: string[] = [];
  page.on('websocket', (ws) =>
    ws.on('framesent', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type) sent.push(message.type);
      } catch {
        /* Vite hot reload. */
      }
    }),
  );
  await create(page);
  for (const kind of ['map', 'grid', 'token'] as const) {
    if (kind === 'token') await editToken(page);
    else
      await page
        .getByRole('button', {
          name: kind === 'map' ? 'Map settings' : 'Grid settings',
          exact: true,
        })
        .click();
    const before = await roomState(page);
    sent.length = 0;
    await page.evaluate(async () => {
      const path = '/src/store.ts',
        store = (await import(path)).useTable;
      const form = document.querySelector<HTMLFormElement>('.modal form')!;
      const s = store.getState();
      s.set({ room: { ...s.room, activeSceneId: 'sanctuary' } });
      form.requestSubmit();
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await roomState(page)).revision).toBe(before.revision);
    expect((await roomState(page)).scenes).toEqual(before.scenes);
    expect(sent).toEqual([]);
    await page.evaluate(async () => {
      const path = '/src/store.ts',
        s = (await import(path)).useTable.getState();
      s.set({ room: { ...s.room, activeSceneId: 'hollow' } });
    });
  }
});

test('an upload completing after another form edit preserves both the edit and image', async ({
  page,
}, info) => {
  await create(page);
  const png = await sharp({
    create: { width: 96, height: 96, channels: 4, background: '#57927680' },
  })
    .png()
    .toBuffer();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/assets\/[^/]+$/, async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  const uploaded = page.waitForResponse(
    (response) =>
      /\/api\/assets\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'POST',
  );
  const downloaded = page.waitForResponse(
    (response) =>
      /\/api\/assets\/[^/]+\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'GET',
  );
  // An upload failure is reported below; do not add an unrelated unhandled GET timeout.
  void downloaded.catch(() => {});
  await page
    .getByLabel('Upload image', { exact: true })
    .setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('Name', { exact: true }).fill('Edited while uploading');
  await expect(page.getByRole('button', { name: 'Add to the table', exact: true })).toBeDisabled();
  release();
  const uploadResponse = await uploaded;
  const uploadBody = await uploadResponse.text();
  await info.attach('upload-response.json', {
    body: JSON.stringify({ status: uploadResponse.status(), body: uploadBody }),
    contentType: 'application/json',
  });
  expect(uploadResponse.status(), uploadBody).toBe(201);
  expect(JSON.parse(uploadBody).asset.kind).toBe('uploaded');
  const imageResponse = await downloaded;
  const imageBody = await imageResponse.body();
  await info.attach('asset-download.json', {
    body: JSON.stringify({
      status: imageResponse.status(),
      contentType: imageResponse.headers()['content-type'],
      bytes: imageBody.length,
      ...(imageResponse.ok()
        ? {
            decoded: await sharp(imageBody)
              .metadata()
              .catch((error) => ({ error: String(error) })),
          }
        : { body: imageBody.toString() }),
    }),
    contentType: 'application/json',
  });
  expect(imageResponse.status()).toBe(200);
  await expect(page.getByAltText('Image preview')).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() =>
      page
        .getByAltText('Image preview')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Edited while uploading');
  await page.getByRole('button', { name: 'Add to the table', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const token = Object.values((await roomState(page)).scenes.hollow.tokens).find(
    (t) => t.name === 'Edited while uploading',
  );
  expect(token?.image.kind).toBe('uploaded');
});
