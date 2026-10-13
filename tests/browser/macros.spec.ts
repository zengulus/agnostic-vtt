import { expect, test, type Page } from '@playwright/test';
import { macroText } from '../../shared/macros.js';
import type { RoomState } from '../../shared/model.js';

const example = String.raw`[Attack Name]\([Attack Roll(1d20 + X)],[Damage Roll(1d6 + [Fire(1d6)] + [Akashic(12)])`;
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
test('newline file import, generic results, numeric inputs, privacy and recovery work for independent players', async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  for (const context of [a, b])
    await context.addInitScript(() =>
      localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
    );
  const gm = await a.newPage(),
    pc = await b.newPage(),
    errors: string[] = [];
  gm.on('pageerror', (e) => errors.push(e.message));
  pc.on('pageerror', (e) => errors.push(e.message));
  await create(gm);
  await gm.getByRole('button', { name: 'Invite party' }).click();
  const invite = await gm.getByRole('textbox', { name: 'Party invitation' }).inputValue();
  await gm.getByRole('button', { name: 'Close dialog' }).click();
  await pc.goto(invite);
  await pc.getByLabel('Your name').fill('Macro player');
  await pc.getByRole('button', { name: 'Join your party', exact: true }).click();
  await expect(pc.getByText('LIVE SESSION', { exact: true })).toBeVisible();
  await gm.getByRole('button', { name: 'Macros · import .txt' }).click();
  await gm.getByLabel('Import macro.txt', { exact: true }).setInputFiles({
    name: 'macro.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      `\uFEFF# Campaign macros\r\n${example}\r\n[Restoration]([Healing Roll(2d6 + [Divine(4)])])\r\n`,
    ),
  });
  await expect(gm.getByText('Final closing delimiters added.', { exact: false })).toBeVisible();
  await gm.screenshot({ path: '/tmp/aether-macro-import.png' });
  await gm.getByRole('button', { name: 'Import 2 macros', exact: true }).click();
  await expect(gm.getByRole('button', { name: 'Prepare Attack Name', exact: true })).toBeVisible();
  await expect.poll(async () => Object.keys((await roomState(pc)).macros || {}).length).toBe(2);
  await gm.getByRole('button', { name: 'Close dialog' }).click();
  await pc.getByRole('button', { name: 'Macros · import .txt' }).click();
  await pc.getByRole('button', { name: 'Prepare Attack Name', exact: true }).click();
  await pc.getByLabel('Numeric input X').fill('5');
  await pc.getByRole('button', { name: 'Roll macro', exact: true }).click();
  await expect(pc.locator('.roll-overlay .macro-results')).toBeVisible();
  await expect(gm.locator('.roll-overlay .macro-results')).toBeVisible();
  const result = (await roomState(pc)).rolls[0].macro!;
  expect((await roomState(gm)).rolls[0].macro).toEqual(result);
  const text = macroText(result);
  expect(text).toContain('Fire damage + 12 Akashic damage');
  await pc.screenshot({ path: '/tmp/aether-macro-result.png' });
  for (const page of [gm, pc]) {
    await expect(page.locator('.roll-overlay .macro-results')).toContainText(
      `Attack Roll:${result.groups[0].total}`,
    );
    await expect(page.locator('.roll-overlay .macro-results')).toContainText('Akashic damage');
    await page.getByRole('button', { name: 'Dismiss roll' }).click();
    await expect(page.locator('.history-card .macro-results')).toContainText('Fire damage');
  }
  await pc.getByRole('button', { name: 'Macros · import .txt' }).click();
  await pc.getByRole('button', { name: 'Prepare Restoration', exact: true }).click();
  await pc.getByRole('button', { name: 'Roll macro', exact: true }).click();
  await expect(pc.locator('.roll-overlay .macro-results')).toContainText('Divine healing');
  await pc.getByRole('button', { name: 'Dismiss roll' }).click();
  await gm.getByRole('button', { name: 'Dismiss roll' }).click();
  await gm.getByRole('button', { name: 'Macros · import .txt' }).click();
  await gm.getByLabel('Macro definitions').fill('[Secret ritual]([Focus Roll(4)])');
  await gm.getByLabel('Imported macro visibility').selectOption('private');
  await gm.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
  await expect(
    gm.getByRole('button', { name: 'Prepare Secret ritual', exact: true }),
  ).toBeVisible();
  expect(Object.values((await roomState(pc)).macros!).some((m) => m.name === 'Secret ritual')).toBe(
    false,
  );
  await gm.getByRole('button', { name: 'Prepare Secret ritual', exact: true }).click();
  await expect(gm.getByLabel('Private result · you & GM')).toBeChecked();
  await gm.getByRole('button', { name: 'Roll macro', exact: true }).click();
  await expect(gm.locator('.roll-overlay .macro-results')).toContainText('Focus Roll:4');
  expect((await roomState(pc)).rolls).toHaveLength(2);
  await gm.getByRole('button', { name: 'Dismiss roll' }).click();
  await pc.reload();
  await pc.getByRole('button', { name: 'Join your party', exact: true }).click();
  await expect(pc.getByText('LIVE SESSION', { exact: true })).toBeVisible();
  await pc.getByRole('button', { name: 'Macros · import .txt' }).click();
  await expect(pc.getByRole('button', { name: 'Prepare Attack Name', exact: true })).toBeVisible();
  await expect(pc.getByRole('button', { name: 'Prepare Secret ritual', exact: true })).toHaveCount(
    0,
  );
  await pc.getByLabel('Macro definitions').fill('[Good]([Check(1)])\n[Bad]([Check(d7)])');
  await expect(pc.getByText('Line 2:', { exact: false })).toBeVisible();
  await expect(pc.getByRole('button', { name: 'Import 1 macro', exact: true })).toBeDisabled();
  await pc.setViewportSize({ width: 390, height: 844 });
  expect(await pc.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pc
    .getByLabel('Macro definitions')
    .fill(
      `[Many Rolls](${Array.from({ length: 8 }, (_, i) => `[Result${i + 1}(${i === 0 ? 'constructor' : i + 1})]`).join(',')})`,
    );
  await pc.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
  await pc.getByRole('button', { name: 'Prepare Many Rolls', exact: true }).click();
  await expect(pc.getByLabel('Numeric input constructor')).toHaveValue('');
  await pc.getByLabel('Numeric input constructor').fill('5');
  await pc.getByRole('button', { name: 'Roll macro', exact: true }).click();
  await pc.locator('.roll-overlay .macro-results dt').last().scrollIntoViewIfNeeded();
  await expect(pc.locator('.roll-overlay .macro-results dt').last()).toHaveText('Result8:');
  await expect(pc.locator('.roll-overlay .macro-results dd').last()).toBeVisible();
  await pc.screenshot({ path: '/tmp/aether-macro-mobile.png' });
  await pc.getByRole('button', { name: 'Return to the story' }).click();
  await gm.screenshot({ path: 'test-results/macro-history.png' });
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
test('owner webhook settings keep credentials out of browser storage and expose delivery controls', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
  );
  await create(page);
  const configured: string[] = [];
  await page.route(/\/api\/campaigns\/[^/]+\/discord$/, async (route) => {
    configured.push(route.request().postData()!);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, enabled: true, mode: 'automatic', canManage: true }),
    });
  });
  await page.getByRole('button', { name: 'Discord webhook ↗' }).click();
  await expect(page.getByLabel('Discord delivery', { exact: true })).toHaveValue('automatic');
  await expect(page.getByLabel('Enable Discord delivery')).toBeChecked();
  const fake =
    'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_123456';
  await page.getByLabel('Discord webhook URL').fill(fake);
  await expect(page.getByLabel('Discord webhook URL')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Save Discord settings', exact: true }).click();
  await expect(page.getByText('Discord settings saved.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Discord webhook URL')).toHaveValue('');
  expect(JSON.parse(configured[0])).toEqual({ url: fake, enabled: true, mode: 'automatic' });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'abcdefghijklmnopqrstuvwxyz',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  let clicks = 0;
  await page.route(/\/api\/campaigns\/[^/]+\/discord\/rolls\/[^/]+$/, async (route) => {
    clicks++;
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"queued":true}' });
  });
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  await page.getByRole('button', { name: 'Dismiss roll' }).click();
  await page.getByRole('button', { name: 'Send to Discord ↗', exact: true }).click();
  expect(clicks).toBe(1);
  // Only the frontend API is intercepted; no live Discord endpoint is configured or contacted.
});
