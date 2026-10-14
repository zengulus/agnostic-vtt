import { expect, test, type Page } from '@playwright/test';
import type { Action } from '../../shared/protocol.js';
import type { RoomState } from '../../shared/model.js';

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
async function state(page: Page): Promise<RoomState> {
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

test('Scenes plus opens a blank creation form and leaves the active scene intact', async ({
  page,
}) => {
  await demo(page);
  const original = (await state(page)).scenes.hollow;
  await page.getByRole('button', { name: 'New scene', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New Scene', exact: true })).toBeVisible();
  await expect(page.getByLabel('Scene name')).toHaveValue('');
  await expect(page.getByAltText('Image preview')).toHaveAttribute('src', /blank.svg$/);
  await page.getByLabel('Scene name').fill('New adventure');
  await page.getByRole('button', { name: 'Add scene', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const room = await state(page),
    added = Object.values(room.scenes).find((scene) => scene.name === 'New adventure')!;
  expect(added.tokens).toEqual({});
  expect(added.map.url).toBe('blank.svg');
  expect(room.scenes.hollow).toEqual(original);
});

test('disconnected map and grid saves retain their forms and entered values for retry', async ({
  page,
}) => {
  await demo(page);
  for (const kind of ['map', 'grid'] as const) {
    await page
      .getByRole('button', { name: kind === 'map' ? 'Map settings' : 'Grid settings', exact: true })
      .click();
    const label = kind === 'map' ? 'Scene name' : 'Units';
    await page.getByLabel(label, { exact: true }).fill('Draft');
    await page.evaluate(async () => {
      const path = '/src/store.ts';
      (await import(path)).useTable.getState().set({ status: 'reconnecting' });
    });
    await page
      .getByRole('button', { name: kind === 'map' ? 'Save scene' : 'Save grid', exact: true })
      .click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('Draft');
    await page.evaluate(async () => {
      const path = '/src/store.ts';
      (await import(path)).useTable.getState().set({ status: 'demo' });
    });
    await page
      .getByRole('button', { name: kind === 'map' ? 'Save scene' : 'Save grid', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('rejected scene creation retains the draft', async ({ page }) => {
  await demo(page);
  for (let i = 0; i < 8; i++)
    await action(page, {
      type: 'SCENE_CONFIG',
      create: true,
      sceneId: `extra${i}`,
      name: `Extra ${i}`,
      map: { kind: 'builtin', url: 'blank.svg' },
      width: 1600,
      height: 1200,
    });
  await page.getByRole('button', { name: 'New scene', exact: true }).click();
  await page.getByLabel('Scene name').fill('Keep my work');
  await page.getByRole('button', { name: 'Add scene', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('ten scenes');
  await expect(page.getByLabel('Scene name')).toHaveValue('Keep my work');
  expect(Object.keys((await state(page)).scenes)).toHaveLength(10);
});

test('a controller can read and spend or restore resources from token selection', async ({
  page,
}) => {
  await demo(page, true);
  await page.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
  await expect(page.locator('.token-resource')).toContainText('Resolve: 8 / 10');
  await page.getByLabel('Resource adjustment amount').fill('3');
  await page.getByRole('button', { name: 'Damage or spend resource' }).click();
  await expect(page.locator('.token-resource')).toContainText('5 / 10');
  await page.getByRole('button', { name: 'Heal or restore resource' }).click();
  await expect(page.locator('.token-resource')).toContainText('8 / 10');
  await expect(page.getByRole('button', { name: 'Edit token', exact: true })).toHaveCount(0);
});

test('phone drawer gives players chat, turns and roll history', async ({ page }) => {
  await demo(page, true);
  await action(page, { type: 'CHAT_SEND', text: 'Ready on my phone' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Chat, turns & history' }).click();
  await expect(page.getByRole('button', { name: 'Close table activity' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: 'Party chat', exact: true }).click();
  await expect(page.getByText('Ready on my phone', { exact: true })).toBeVisible();
  await page.getByLabel('Message your party').fill('Still here');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Still here', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Turns', exact: true }).click();
  await expect(page.locator('.tracker-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Chronicle', exact: true }).click();
  await expect(page.getByText('The tale is yet unwritten.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/aether-phone-activity-open.png' });
  await page.getByRole('button', { name: 'Close table activity' }).click();
  await expect(page.getByRole('button', { name: 'Chat, turns & history' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByLabel('Dice expression', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Roll the dice', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: '/tmp/aether-phone-activity-closed.png' });
});

test('revised macro imports require reviewed replacements and preserve favorites and remembered inputs', async ({
  page,
}) => {
  await demo(page);
  const source = '[Attack]([Hit(d20 + X)])',
    revised = '[Attack]([Hit(d20 + X + 2)])';
  await page.getByRole('button', { name: 'Macros · import .txt' }).click();
  await page.getByLabel('Macro definitions').fill(source);
  await page.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
  const originalId = Object.keys((await state(page)).macros!)[0];
  await page.getByLabel('Macro definitions').fill(source);
  await expect(page.getByText('Unchanged · skip', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 0 macros', exact: true })).toBeDisabled();
  await page.getByLabel('Macro definitions').fill(revised);
  await expect(page.getByText('Changed · review replacement', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 0 macros', exact: true })).toBeDisabled();
  await page.getByLabel('Replace Attack', { exact: true }).selectOption(originalId);
  await page.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
  expect(Object.keys((await state(page)).macros!)).toEqual([originalId]);
  expect((await state(page)).macros![originalId].source).toBe(revised);
  await page.getByRole('button', { name: 'Favorite Attack', exact: true }).click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare Attack', exact: true }).click();
  await page.getByLabel('Numeric input X').fill('5');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Macros · import .txt' }).click();
  await expect(page.getByRole('button', { name: 'Favorite Attack', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Prepare Attack', exact: true }).click();
  await expect(page.getByLabel('Numeric input X')).toHaveValue('5');
  await page.getByRole('button', { name: 'Roll macro', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Macros · import .txt' }).click();
  await page.getByRole('button', { name: 'Recent rolls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Prepare Attack', exact: true })).toBeVisible();
});

test('offline owners remain assignable and removal requires a warning before access can be restored', async ({
  browser,
}) => {
  const gmContext = await browser.newContext(),
    playerContext = await browser.newContext();
  try {
    const gm = await gmContext.newPage(),
      pc = await playerContext.newPage();
    await gm.goto('/');
    await gm.getByRole('button', { name: 'Log in', exact: true }).click();
    await gm.getByRole('button', { name: 'Create campaign', exact: true }).click();
    await expect(gm.getByText('Live', { exact: true })).toBeVisible();
    await gm.getByRole('button', { name: 'Invite party', exact: true }).click();
    const invitation = await gm.getByLabel('Party invitation', { exact: true }).inputValue();
    await gm.getByRole('button', { name: 'Close dialog' }).click();
    await pc.goto(invitation);
    await pc.getByLabel('Your name', { exact: true }).fill('Offline friend');
    await pc.getByRole('button', { name: 'Join your party', exact: true }).click();
    await expect(pc.getByText('Live', { exact: true })).toBeVisible();
    await pc.close();
    await gm.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
    await gm.getByRole('button', { name: 'Edit token', exact: true }).click();
    const ownership = gm.getByLabel('Who can move it?');
    await expect(
      ownership.locator('option').filter({ hasText: 'Offline friend (offline)' }),
    ).toHaveCount(1);
    const memberId = await ownership
      .locator('option')
      .filter({ hasText: 'Offline friend' })
      .getAttribute('value');
    await ownership.selectOption(memberId!);
    await gm.getByRole('button', { name: 'Save token', exact: true }).click();
    await expect(gm.getByRole('dialog')).toHaveCount(0);
    expect((await state(gm)).scenes.hollow.tokens.ranger.owners).toEqual([memberId]);
    await gm.getByRole('button', { name: 'Invite party', exact: true }).click();
    await gm.getByRole('button', { name: 'Remove Offline friend', exact: true }).click();
    await expect(gm.getByRole('alert')).toContainText(
      'including invitation links, until you restore access',
    );
    await expect(gm.getByRole('button', { name: 'Restore access for Offline friend' })).toHaveCount(
      0,
    );
    await gm.getByRole('button', { name: 'Cancel removal', exact: true }).click();
    await expect(
      gm.getByRole('button', { name: 'Remove Offline friend', exact: true }),
    ).toBeVisible();
    await gm.getByRole('button', { name: 'Remove Offline friend', exact: true }).click();
    await gm.getByRole('button', { name: 'Remove and block access', exact: true }).click();
    await expect(
      gm.getByRole('button', { name: 'Restore access for Offline friend' }),
    ).toBeVisible();
    await gm.getByRole('button', { name: 'Restore access for Offline friend' }).click();
    await expect(
      gm.getByRole('button', { name: 'Remove Offline friend', exact: true }),
    ).toBeVisible();
    const resumed = await playerContext.newPage();
    await resumed.goto(invitation);
    await resumed.getByRole('button', { name: 'Join your party', exact: true }).click();
    await expect(resumed.getByText('Live', { exact: true })).toBeVisible();
    await resumed.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
    await resumed.getByRole('button', { name: 'Damage or spend resource' }).click();
    await expect
      .poll(async () => (await state(gm)).scenes.hollow.tokens.ranger.resource?.value)
      .toBe(7);
  } finally {
    await gmContext.close();
    await playerContext.close();
  }
});
