import { expect, test, type Page } from '@playwright/test';
import type { Action } from '../../shared/protocol.js';
import type { RoomState } from '../../shared/model.js';
import { macroDigest } from '../../shared/macroDigest.js';

async function state(page: Page): Promise<RoomState> {
  return page.evaluate(
    async () => (await import('/src/store.ts' as string)).useTable.getState().room,
  );
}
async function action(page: Page, value: Action) {
  await page.evaluate(
    async (value) => (await import('/src/connection.ts' as string)).sendAndWait(value),
    value,
  );
}
async function demo(page: Page, player = false) {
  await page.addInitScript(() =>
    localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
  );
  await page.goto('/');
  await page
    .getByRole('button', {
      name: player ? 'Try the player demo' : 'Open a demo table',
      exact: true,
    })
    .click();
}
async function create(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
}
async function dismissGuide(page: Page) {
  const button = page.getByRole('button', { name: 'Dismiss getting started' });
  if (await button.count()) await button.click();
}
async function character(page: Page) {
  if ((await page.getByRole('button', { name: 'Kael Wanderer', exact: true }).count()) === 0)
    await page.getByRole('button', { name: 'Toggle library', exact: true }).click();
  await page.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
  if (await page.getByRole('dialog').count())
    await page.getByRole('button', { name: 'Close dialog' }).click();
}

for (const player of [false, true])
  for (const narrow of [false, true]) {
    test(`${player ? 'player' : 'GM'} ${narrow ? 'phone' : 'desktop'}: named actions, remembered prompts, keyboard and discovery`, async ({
      page,
    }) => {
      if (narrow) await page.setViewportSize({ width: 390, height: 844 });
      await demo(page, player);
      await expect(page.getByLabel('Getting started', { exact: true })).toBeVisible();
      await dismissGuide(page);
      await character(page);
      if (narrow) {
        await page.getByRole('button', { name: 'Character controls', exact: true }).click();
        await page.getByRole('button', { name: 'Damage or spend resource' }).click();
        await expect(page.locator('.token-resource')).toContainText('7 / 10');
        await page.getByRole('button', { name: 'Heal or restore resource' }).click();
        await expect(page.locator('.token-resource')).toContainText('8 / 10');
        await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
      }
      await expect(page.getByLabel('Turn awareness')).toBeVisible();
      await expect(page.locator('.selected-token-status')).toContainText('arrow keys');
      const before = (await state(page)).scenes.hollow.tokens.ranger;
      await page.locator('.tabletop canvas').focus();
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(async () => (await state(page)).scenes.hollow.tokens.ranger.x)
        .toBeGreaterThan(before.x);
      const moved = (await state(page)).scenes.hollow.tokens.ranger.x;
      await page.getByLabel('Dice expression', { exact: true }).focus();
      await page.keyboard.press('ArrowLeft');
      expect((await state(page)).scenes.hollow.tokens.ranger.x).toBe(moved);
      await page.getByRole('button', { name: 'Macros · import .txt' }).click();
      await page.getByRole('dialog').focus();
      await page.keyboard.press('ArrowRight');
      expect((await state(page)).scenes.hollow.tokens.ranger.x).toBe(moved);
      await page
        .getByLabel('Macro definitions')
        .fill('[Strike]([Roll(d6 + X)])\n[Ready]([Roll(1)])');
      await page.getByRole('button', { name: 'Import 2 macros', exact: true }).click();
      for (const name of ['Strike', 'Ready'])
        await page.getByRole('button', { name: `Favorite ${name}`, exact: true }).click();
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await page.getByRole('button', { name: 'Roll Strike', exact: true }).click();
      await page.getByLabel('Action input X').fill('7');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Roll Strike', exact: true }).click();
      await expect(page.getByLabel('Action input X')).toHaveValue('7');
      await page.getByRole('button', { name: 'Roll action', exact: true }).click();
      await expect.poll(async () => (await state(page)).rolls.length).toBe(1);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('button', { name: 'Roll Ready', exact: true }).click();
      await expect.poll(async () => (await state(page)).rolls.length).toBe(2);
      await expect(page.getByLabel('Action input X')).toHaveCount(0);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Save roll preset', exact: true }),
      ).toBeVisible();
      await page.getByText('Dice preferences', { exact: true }).click();
      await page.getByLabel('Presentation', { exact: true }).selectOption('minimal');
      await page.getByText('Dice preferences', { exact: true }).click();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.screenshot({
        path: `/tmp/aether-${player ? 'player' : 'gm'}-${narrow ? 'phone' : 'desktop'}-after.jpg`,
        type: 'jpeg',
        quality: 85,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.reload();
      await page
        .getByRole('button', {
          name: player ? 'Try the player demo' : 'Open a demo table',
          exact: true,
        })
        .click();
      await expect(page.getByLabel('Getting started', { exact: true })).toHaveCount(0);
      // Local favorites survive reload; missing definitions simply disappear.
      await expect(page.getByRole('button', { name: 'Roll Strike', exact: true })).toHaveCount(0);
      const preferences = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('aether-macros:offline-demo:demo-gm') || '{}'),
      );
      expect(preferences.favorites).toHaveLength(2);
      expect(preferences.recent).toHaveLength(2);
    });
  }

test('edited and deleted favorites invalidate prepared inputs without losing other preferences', async ({
  page,
}) => {
  await demo(page);
  await action(page, {
    type: 'MACRO_IMPORT',
    text: '[Strike]([Roll(d6 + X)])',
    visibility: 'private',
  });
  await page.getByRole('button', { name: 'Macros · import .txt' }).click();
  await page.getByRole('button', { name: 'Favorite Strike', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Roll Strike', exact: true }).click();
  const macro = Object.values((await state(page)).macros!)[0];
  await action(page, {
    type: 'MACRO_IMPORT',
    text: '[Strike]([Roll(d6 + Y)])',
    visibility: 'public',
    replacements: [{ line: 1, id: macro.id, digest: macroDigest(macro) }],
  });
  await expect(page.getByLabel('Action input X')).toHaveCount(0);
  await expect(
    page.getByText('That action changed or was removed.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Roll Strike', exact: true }).click();
  await page.getByLabel('Action input Y').fill('3');
  await page.evaluate(async () =>
    (await import('/src/store.ts' as string)).useTable.getState().set({ status: 'reconnecting' }),
  );
  await page.getByRole('button', { name: 'Roll action', exact: true }).click();
  await expect(page.locator('.favorite-actions').getByRole('alert')).toContainText('reconnecting');
  await expect(page.getByLabel('Action input Y')).toHaveValue('3');
  await page.evaluate(async () =>
    (await import('/src/store.ts' as string)).useTable.getState().set({ status: 'demo' }),
  );
  await page.getByRole('button', { name: 'Roll action', exact: true }).click();
  expect((await state(page)).rolls[0].visibility).toBe('private');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await action(page, { type: 'MACRO_DELETE', id: macro.id });
  await expect(page.getByRole('button', { name: 'Roll Strike', exact: true })).toHaveCount(0);
});

test('grid calibration is local, cancels cleanly and sends one update per save including rejected retry', async ({
  page,
}) => {
  const updates: Action[] = [];
  let reject = true;
  await page.routeWebSocket('**/ws', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const value = JSON.parse(message.toString());
      if (value.type === 'GRID_UPDATE') {
        updates.push(value);
        if (reject) {
          ws.send(
            JSON.stringify({
              v: 2,
              type: 'ERROR',
              actionId: value.actionId,
              message: 'Grid rejected for test.',
            }),
          );
          return;
        }
      }
      server.send(message);
    });
  });
  await create(page);
  await dismissGuide(page);
  const original = (await state(page)).scenes.hollow.grid;
  await page.getByRole('button', { name: 'Grid settings', exact: true }).click();
  await page.getByLabel('Cell size (pixels)', { exact: true }).fill('64');
  const preview = page.getByLabel('Local grid calibration preview'),
    box = (await preview.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 35);
  await page.mouse.up();
  await expect(page.getByLabel('X alignment', { exact: true })).not.toHaveValue(
    String(original.offsetX),
  );
  await page.getByRole('button', { name: 'Two-click cell size', exact: true }).click();
  await preview.click({ position: { x: 20, y: 20 } });
  await preview.click({ position: { x: 40, y: 20 } });
  const calibrated = await page.getByLabel('X alignment', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Pan preview', exact: true }).click();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 50);
  await page.mouse.up();
  await expect(page.getByLabel('X alignment', { exact: true })).toHaveValue(calibrated);
  expect(updates).toHaveLength(0);
  expect((await state(page)).scenes.hollow.grid).toEqual(original);
  await page
    .getByRole('dialog')
    .screenshot({ path: '/tmp/aether-grid-preview-after.jpg', type: 'jpeg', quality: 85 });
  await page.getByRole('button', { name: 'Cancel grid changes', exact: true }).click();
  expect((await state(page)).scenes.hollow.grid).toEqual(original);
  await page.getByRole('button', { name: 'Grid settings', exact: true }).click();
  await expect(page.getByLabel('Cell size (pixels)', { exact: true })).toHaveValue(
    String(original.size),
  );
  await page.getByLabel('Grid type', { exact: true }).selectOption('hex');
  await expect(page.getByText('Pointy-top hex: cell size', { exact: false })).toBeVisible();
  await page.getByLabel('Cell size (pixels)', { exact: true }).fill('72');
  await page.getByRole('button', { name: 'Save grid', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Grid rejected');
  expect(updates).toHaveLength(1);
  expect((await state(page)).scenes.hollow.grid).toEqual(original);
  reject = false;
  await page.getByRole('button', { name: 'Save grid', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(updates).toHaveLength(2);
  expect((await state(page)).scenes.hollow.grid.size).toBe(72);
});

test('whole-scene fog requires confirmation and undo restores exploration', async ({ page }) => {
  await demo(page);
  await dismissGuide(page);
  const original = (await state(page)).scenes.hollow.fog;
  await page.locator('.scene-options').getByText('Scene fog', { exact: true }).click();
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('Reveal entire scene');
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Reveal entire scene', exact: true }).click();
  expect((await state(page)).scenes.hollow.fog).toEqual(original);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Reveal entire scene', exact: true }).click();
  await expect.poll(async () => (await state(page)).scenes.hollow.fog.enabled).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await state(page)).scenes.hollow.fog).toEqual(original);
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('resets all exploration');
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Cover entire scene', exact: true }).click();
  expect((await state(page)).scenes.hollow.fog).toEqual({
    enabled: true,
    revealed: [],
    operations: [],
  });
});

test('selected tracker links are preserved, quick-add previews hidden enemies, and focus stays available outside Turns', async ({
  page,
}) => {
  await demo(page);
  await dismissGuide(page);
  await character(page);
  await page.getByRole('button', { name: 'Turns', exact: true }).click();
  await page.getByRole('button', { name: 'Use selected token', exact: true }).click();
  await page.getByRole('button', { name: 'Add participant', exact: true }).click();
  expect((await state(page)).tracker?.entries[0].tokenId).toBe('ranger');
  await expect(page.getByLabel('Turn awareness')).toContainText('Your turn');
  await page.getByRole('button', { name: 'Chronicle', exact: true }).click();
  await page.getByRole('button', { name: 'Focus character', exact: true }).click();
  await expect(page.locator('.selected-token-status')).toContainText('Kael');
  await page.getByRole('button', { name: 'Turns', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Kael', exact: true }).click();
  await page.getByLabel('Participant value', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Save participant', exact: true }).click();
  expect((await state(page)).tracker?.entries[0].tokenId).toBe('ranger');
  const sentinel = (await state(page)).scenes.hollow.tokens.sentinel;
  await action(page, {
    type: 'TOKEN_UPDATE',
    sceneId: 'hollow',
    token: { ...sentinel, visibility: 'gm' },
  });
  await page.evaluate(async () =>
    (await import('/src/store.ts' as string)).useTable
      .getState()
      .set({ selected: 'sentinel', selectedIds: ['sentinel'] }),
  );
  await page.getByText('Add selected characters to turns', { exact: true }).click();
  await expect(page.locator('.tracker-add-selected')).toContainText('GM only');
  await page.getByRole('button', { name: 'Add selected to tracker', exact: true }).click();
  expect((await state(page)).tracker?.entries[1]).toMatchObject({
    tokenId: 'sentinel',
    hidden: true,
  });
});

test('separate GM/player contexts protect linked enemies, private art and macros across reconnect and reject unauthorized changes', async ({
  browser,
}) => {
  const gmContext = await browser.newContext(),
    pcContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const gm = await gmContext.newPage(),
      pc = await pcContext.newPage();
    let socket: import('@playwright/test').WebSocketRoute | undefined;
    const delivered: string[] = [];
    await pc.routeWebSocket('**/ws', (ws) => {
      socket = ws;
      const server = ws.connectToServer();
      server.onMessage((message) => {
        delivered.push(message.toString());
        ws.send(message);
      });
    });
    await create(gm);
    await dismissGuide(gm);
    await action(gm, {
      type: 'FOG_UPDATE',
      sceneId: 'hollow',
      fog: { enabled: false, revealed: [] },
    });
    const sharp = (await import('sharp')).default;
    const png = await sharp({
      create: { width: 64, height: 64, channels: 4, background: '#649580' },
    })
      .png()
      .toBuffer();
    const upload = async (name: string) =>
      gm.evaluate(
        async ({ name, bytes }) => {
          const connection = await import('/src/connection.ts' as string);
          return connection.uploadImage(
            new File([new Uint8Array(bytes)], name, { type: 'image/png' }),
            'token',
          );
        },
        { name, bytes: [...png] },
      );
    const secret = await upload('Secret altar.png'),
      portrait = await upload('Party portrait.png');
    let room = await state(gm);
    await action(gm, {
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: {
        ...room.scenes.hollow.tokens.sentinel,
        name: 'Unseen adversary',
        visibility: 'gm',
        image: secret.asset,
      },
    });
    await action(gm, {
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...room.scenes.hollow.tokens.ranger, image: portrait.asset },
    });
    await action(gm, {
      type: 'MACRO_IMPORT',
      text: '[Private ritual]([Secret formula(d6)])',
      visibility: 'private',
    });
    await action(gm, {
      type: 'TRACKER_UPDATE',
      tracker: {
        round: 1,
        order: 'manual',
        activeId: 'hero-turn',
        entries: [
          { id: 'hero-turn', name: 'Hero', value: 0, hidden: false, tokenId: 'ranger' },
          {
            id: 'enemy-turn',
            name: 'Unseen adversary',
            value: 0,
            hidden: false,
            tokenId: 'sentinel',
          },
          { id: 'mage-turn', name: 'Mage', value: 0, hidden: false, tokenId: 'mage' },
        ],
      },
    });
    await gm.getByRole('button', { name: 'Invite party', exact: true }).click();
    const invitation = await gm.getByLabel('Party invitation', { exact: true }).inputValue();
    await gm.getByRole('button', { name: 'Close dialog' }).click();
    await pc.goto(invitation);
    await pc.getByLabel('Your name', { exact: true }).fill('Scout');
    await pc.getByRole('button', { name: 'Join your party', exact: true }).click();
    await expect(pc.getByText('Live', { exact: true })).toBeVisible();
    await dismissGuide(pc);
    await expect(pc.getByLabel('Turn awareness')).toContainText('Your turn');
    expect((await state(pc)).tracker?.entries.map((e) => e.name)).toEqual(['Hero', 'Mage']);
    expect((await state(pc)).tracker?.nextId).toBeNull();
    expect(delivered.join('\n')).not.toMatch(
      /Unseen adversary|enemy-turn|Secret altar|Private ritual|Secret formula/,
    );
    expect(delivered.join('\n')).not.toContain(secret.id);
    await expect(pc.getByRole('button', { name: 'Map settings', exact: true })).toHaveCount(0);
    await pc.getByRole('button', { name: 'Scene details', exact: true }).click();
    await pc.getByRole('button', { name: 'Campaign images', exact: true }).click();
    await expect(
      pc.getByRole('button', { name: 'Choose image Party portrait.png', exact: true }),
    ).toBeVisible();
    await expect(
      pc.getByRole('button', { name: 'Choose image Secret altar.png', exact: true }),
    ).toHaveCount(0);
    await pc.getByRole('button', { name: 'Close dialog' }).click();
    expect(
      await pc.evaluate(async (id) => {
        try {
          await (
            await import('/src/connection.ts' as string)
          ).authorizedFetch(
            `/api/assets/${(await import('/src/store.ts' as string)).useTable.getState().room.id}/${id}`,
          );
          return true;
        } catch {
          return false;
        }
      }, secret.id),
    ).toBe(false);
    // Reuse chooses the existing reference; it does not upload again.
    let uploads = 0;
    gm.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/assets/')) uploads++;
    });
    await gm.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
    await gm.getByRole('button', { name: 'Edit token', exact: true }).click();
    await gm.getByRole('button', { name: 'Campaign images', exact: true }).click();
    await gm.getByRole('button', { name: 'Choose image Party portrait.png', exact: true }).click();
    await gm.getByRole('button', { name: 'Save token', exact: true }).click();
    await expect(gm.getByRole('dialog')).toHaveCount(0);
    expect(uploads).toBe(0);
    expect((await state(gm)).scenes.hollow.tokens.ranger.image).toEqual(portrait.asset);
    await expect(
      action(pc, {
        type: 'GRID_UPDATE',
        sceneId: 'hollow',
        grid: (await state(pc)).scenes.hollow.grid,
      }),
    ).rejects.toThrow('game master');
    const before = (await state(pc)).scenes.hollow.tokens.ranger;
    room = await state(gm);
    await action(gm, {
      type: 'TOKEN_UPDATE',
      sceneId: 'hollow',
      token: { ...room.scenes.hollow.tokens.ranger, owners: [] },
    });
    await expect(pc.getByLabel('Turn awareness')).not.toContainText('Your turn');
    await pc.getByRole('button', { name: 'Focus character', exact: true }).click();
    await pc.locator('.tabletop canvas').focus();
    await pc.keyboard.press('ArrowRight');
    expect((await state(pc)).scenes.hollow.tokens.ranger.x).toBe(before.x);
    await pc.getByRole('button', { name: 'Toggle library', exact: true }).click();
    // Remove the other shared assignments too, to exercise the empty ownership message.
    for (const token of Object.values((await state(gm)).scenes.hollow.tokens))
      if (token.owners.length)
        await action(gm, {
          type: 'TOKEN_UPDATE',
          sceneId: 'hollow',
          token: { ...token, owners: [] },
        });
    await expect(pc.getByRole('dialog')).toContainText('No character is assigned to you');
    await pc.getByRole('button', { name: 'Close dialog' }).click();
    await socket!.close();
    await expect(pc.getByText('Reconnecting', { exact: true })).toBeVisible();
    await expect(pc.getByText('Live', { exact: true })).toBeVisible();
    expect(delivered.join('\n')).not.toMatch(
      /Unseen adversary|enemy-turn|Secret altar|Private ritual/,
    );
    await expect(pc.getByLabel('Turn awareness')).toBeVisible();
    await pc.screenshot({ path: '/tmp/aether-player-phone-live-after.png' });
  } finally {
    await gmContext.close();
    await pcContext.close();
  }
});

test('durable-save time follows SAVED revisions independently of acknowledgements and reconnects', async ({
  page,
}) => {
  let proxy: import('@playwright/test').WebSocketRoute;
  let heldSave: string | undefined;
  await page.routeWebSocket('**/ws', (ws) => {
    proxy = ws;
    const server = ws.connectToServer();
    server.onMessage((message) => {
      const value = JSON.parse(message.toString());
      if (value.type === 'SAVED') heldSave = message.toString();
      else ws.send(message);
    });
  });
  await create(page);
  await dismissGuide(page);
  await expect(page.locator('.save-status')).toContainText('Last saved');
  await expect(page.locator('.save-status')).toContainText('Saved to storage');
  await action(page, { type: 'CHAT_SEND', text: 'First unsaved edit' });
  await expect(page.locator('.save-status')).toContainText('Newer changes awaiting save');
  const room = await state(page),
    earlier = { v: 2, type: 'SAVED', revision: room.revision, savedAt: '2099-01-01T00:00:00.000Z' };
  proxy!.send(JSON.stringify(earlier));
  await expect(page.locator('.save-status')).toContainText('Saved to storage');
  proxy!.send(JSON.stringify({ ...earlier, pending: true }));
  await expect(page.locator('.save-status')).toContainText('Newer changes awaiting save');
  proxy!.send(JSON.stringify({ ...earlier, pending: false }));
  await expect(page.locator('.save-status')).toContainText('Saved to storage');
  await action(page, { type: 'CHAT_SEND', text: 'Newer edit' });
  proxy!.send(JSON.stringify(earlier));
  await expect(page.locator('.save-status')).toContainText('Newer changes awaiting save');
  // Reconnect replaces the synthetic timestamp with authoritative snapshot status.
  await proxy!.close();
  await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible();
  await expect(page.locator('.save-status')).toContainText('Save status unconfirmed');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.locator('.save-status')).toContainText('Last saved');
  void heldSave;
});
