import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { pausePresentationClock } from './helpers/clock.js';
import { macroText } from '../../shared/macros.js';
import type { RoomState } from '../../shared/model.js';

const example = String.raw`[Attack Name]\([Attack Roll(1d20 + X)],[Damage Roll(1d6 + [Fire(1d6)] + [Akashic(12)])`;

test('formatted table picks appear identically in party presentations and history', async ({
  browser,
}) => {
  await withParty(browser, async (gm, pc) => {
    await gm.getByRole('button', { name: 'Macros · import .txt' }).click();
    await gm
      .getByLabel('Macro definitions')
      .fill(
        '[Grant Maneuvers](Select(3){"**Lunge**, then *retreat*", "Guard: `1 AP`", "<img src=x onerror=alert(1)>\\nNext line"})',
      );
    await gm.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
    await expect(gm.getByRole('button', { name: 'Prepare Grant Maneuvers' })).toBeVisible();
    await gm.getByRole('button', { name: 'Close dialog' }).click();
    await expect.poll(async () => Object.keys((await roomState(pc)).macros || {}).length).toBe(1);
    await pc.getByRole('button', { name: 'Macros · import .txt' }).click();
    await pc.getByRole('button', { name: 'Prepare Grant Maneuvers' }).click();
    await expect(pc.locator('.macro-inputs input')).toHaveCount(0);
    for (const page of [gm, pc]) await pausePresentationClock(page);
    await pc.getByRole('button', { name: 'Roll macro', exact: true }).click();
    for (const page of [gm, pc]) {
      const results = page.locator('.roll-overlay .macro-table-selections');
      await expect(results.locator('li')).toHaveCount(3);
      await expect(results.locator('strong')).toHaveText('Lunge');
      await expect(results.locator('em')).toHaveText('retreat');
      await expect(results.locator('code')).toHaveText('1 AP');
      await expect(results).toContainText('<img src=x onerror=alert(1)>\nNext line');
      await expect(results.locator('img')).toHaveCount(0);
      await expect(page.locator('.roll-overlay .macro-result-terms')).toHaveCount(0);
    }
    expect((await roomState(pc)).rolls[0]).toEqual((await roomState(gm)).rolls[0]);
    for (const page of [gm, pc]) {
      await page.getByRole('button', { name: 'Dismiss roll' }).click();
      await expect(page.locator('.history-card .macro-table-selections li')).toHaveCount(3);
      await expect(page.locator('.history-card .macro-table-selections strong')).toHaveText(
        'Lunge',
      );
    }
  });
});

async function create(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
}

test('keep, drop and reroll results appear in party dice, macro displays and history', async ({
  browser,
}) => {
  await withParty(browser, async (gm, pc) => {
    for (const page of [gm, pc]) await pausePresentationClock(page);
    for (const expression of ['2d20kh1', '4d6dl1', '5d6r<2']) {
      await pc.getByLabel('Dice expression', { exact: true }).fill(expression);
      await pc.getByRole('button', { name: 'Roll the dice', exact: true }).click();
      for (const page of [gm, pc])
        await expect(page.locator('.roll-overlay')).toContainText(expression);
      const result = (await roomState(pc)).rolls.at(-1)!;
      expect(result).toEqual((await roomState(gm)).rolls.at(-1));
      expect(result.total).toBe(result.terms[0].subtotal);
      for (const page of [gm, pc]) {
        if (expression !== '5d6r<2')
          await expect(page.locator('.roll-overlay .arith-term.dropped')).toHaveCount(1);
        else expect(result.terms[0].values.every((value) => value >= 2)).toBe(true);
        await page.getByRole('button', { name: 'Dismiss roll' }).click();
        if (expression !== '5d6r<2')
          await expect(page.locator('.history-card').first()).toContainText('(dropped)');
      }
      await pc.clock.runFor(950);
    }
    await pc.getByRole('button', { name: 'Macros · import .txt' }).click();
    await pc.getByLabel('Macro definitions').fill('[Advantage]([Attack Roll(2d20kh1 + X)])');
    await pc.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
    await pc.getByRole('button', { name: 'Prepare Advantage' }).click();
    await pc.getByLabel('Numeric input X').fill('5');
    await pc.getByRole('button', { name: 'Roll macro', exact: true }).click();
    for (const page of [gm, pc]) {
      await expect(page.locator('.roll-overlay .macro-result-terms')).toContainText('(dropped)');
      await page.getByRole('button', { name: 'Dismiss roll' }).click();
      await expect(
        page.locator('.history-card').first().locator('.macro-result-terms'),
      ).toContainText('(dropped)');
    }
  });
});
async function roomState(page: Page): Promise<RoomState> {
  return page.evaluate(async () => {
    const path = '/src/store.ts';
    return (await import(path)).useTable.getState().room;
  });
}
async function withParty(browser: Browser, run: (gm: Page, pc: Page) => Promise<void>) {
  const contexts: BrowserContext[] = [],
    pages: Page[] = [],
    errors: string[] = [];
  try {
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext();
      contexts.push(context);
      await context.addInitScript(() =>
        localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
      );
      const page = await context.newPage();
      pages.push(page);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.install();
    }
    const [gm, pc] = pages;
    await create(gm);
    await gm.getByRole('button', { name: 'Invite party' }).click();
    const invite = await gm.getByRole('textbox', { name: 'Party invitation' }).inputValue();
    await gm.getByRole('button', { name: 'Close dialog' }).click();
    await pc.goto(invite);
    await pc.getByLabel('Your name').fill('Macro player');
    await pc.getByRole('button', { name: 'Join your party', exact: true }).click();
    await expect(pc.getByText('Live', { exact: true })).toBeVisible();
    await run(gm, pc);
    expect(errors).toEqual([]);
  } finally {
    // Dispose independent clients on assertion failures as well as success.
    await Promise.all(contexts.map((context) => context.close()));
  }
}

test('newline file import, numeric inputs and generic results synchronize independent players', async ({
  browser,
}) => {
  await withParty(browser, async (gm, pc) => {
    await gm.getByRole('button', { name: 'Macros · import .txt' }).click();
    await gm.getByLabel('Import macro.txt', { exact: true }).setInputFiles({
      name: 'macro.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        `\uFEFF# Campaign macros\r\n${example}\r\n[Restoration]([Healing Roll(2d6 + [Divine(4)])])\r\n`,
      ),
    });
    await expect(gm.getByText('Final closing delimiters added.', { exact: false })).toBeVisible();
    await gm.getByRole('button', { name: 'Import 2 macros', exact: true }).click();
    await expect(
      gm.getByRole('button', { name: 'Prepare Attack Name', exact: true }),
    ).toBeVisible();
    await expect.poll(async () => Object.keys((await roomState(pc)).macros || {}).length).toBe(2);
    await gm.getByRole('button', { name: 'Close dialog' }).click();
    await pc.getByRole('button', { name: 'Macros · import .txt' }).click();
    await pc.getByRole('button', { name: 'Prepare Attack Name', exact: true }).click();
    await pc.getByLabel('Numeric input X').fill('5');
    // Inspect both authoritative results without consuming the review window.
    for (const page of [gm, pc]) await pausePresentationClock(page);
    await pc.getByRole('button', { name: 'Roll macro', exact: true }).click();
    await expect(pc.locator('.roll-overlay .macro-results')).toBeVisible();
    await expect(gm.locator('.roll-overlay .macro-results')).toBeVisible();
    const result = (await roomState(pc)).rolls[0].macro!;
    expect((await roomState(gm)).rolls[0].macro).toEqual(result);
    expect(macroText(result)).toContain('Fire damage + 12 Akashic damage');
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
  });
});

test('private macro definitions and results stay private after another player reloads', async ({
  browser,
}) => {
  await withParty(browser, async (gm, pc) => {
    await gm.getByRole('button', { name: 'Macros · import .txt' }).click();
    await gm.getByLabel('Macro definitions').fill('[Party check]([Check(3)])');
    await gm.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
    await expect(
      gm.getByRole('button', { name: 'Prepare Party check', exact: true }),
    ).toBeVisible();
    await expect.poll(async () => Object.keys((await roomState(pc)).macros || {}).length).toBe(1);
    await gm.getByLabel('Macro definitions').fill('[Secret ritual]([Focus Roll(4)])');
    await gm.getByLabel('Imported macro visibility').selectOption('private');
    await gm.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
    await expect(
      gm.getByRole('button', { name: 'Prepare Secret ritual', exact: true }),
    ).toBeVisible();
    expect(
      Object.values((await roomState(pc)).macros!).some((m) => m.name === 'Secret ritual'),
    ).toBe(false);
    const publicRolls = (await roomState(pc)).rolls;
    await gm.getByRole('button', { name: 'Prepare Secret ritual', exact: true }).click();
    await expect(gm.getByLabel('Private result · you & GM')).toBeChecked();
    await pausePresentationClock(gm);
    await gm.getByRole('button', { name: 'Roll macro', exact: true }).click();
    await expect(gm.locator('.roll-overlay .macro-results')).toContainText('Focus Roll:4');
    expect((await roomState(pc)).rolls).toEqual(publicRolls);
    await expect(pc.locator('.roll-overlay')).toHaveCount(0);
    await gm.getByRole('button', { name: 'Dismiss roll' }).click();
    await gm.clock.resume();
    await pc.reload();
    await pc.getByRole('button', { name: 'Join your party', exact: true }).click();
    await expect(pc.getByText('Live', { exact: true })).toBeVisible();
    await pc.getByRole('button', { name: 'Macros · import .txt' }).click();
    await expect(
      pc.getByRole('button', { name: 'Prepare Party check', exact: true }),
    ).toBeVisible();
    await expect(
      pc.getByRole('button', { name: 'Prepare Secret ritual', exact: true }),
    ).toHaveCount(0);
    expect((await roomState(pc)).rolls).toEqual(publicRolls);
  });
});

test('invalid imports and named numeric inputs remain usable in the mobile player view', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(() =>
    localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the player demo', exact: true }).click();
  await expect(page.getByText('Demo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Macros · import .txt' }).click();
  await page.getByLabel('Macro definitions').fill('[Good]([Check(1)])\n[Bad]([Check(d7)])');
  await expect(page.getByText('Line 2:', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 1 macro', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByLabel('Macro definitions')
    .fill(
      `[Many Rolls](${Array.from({ length: 8 }, (_, i) => `[Result${i + 1}(${i === 0 ? 'constructor' : i + 1})]`).join(',')})`,
    );
  await page.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare Many Rolls', exact: true }).click();
  await expect(page.getByLabel('Numeric input constructor')).toHaveValue('');
  await page.getByLabel('Numeric input constructor').fill('5');
  await pausePresentationClock(page);
  await page.getByRole('button', { name: 'Roll macro', exact: true }).click();
  await page.locator('.roll-overlay .macro-results dt').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.roll-overlay .macro-results dt').last()).toHaveText('Result8:');
  await expect(page.locator('.roll-overlay .macro-results dd').last()).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  expect(errors).toEqual([]);
});
test('owner webhook settings keep credentials out of browser storage and expose delivery controls', async ({
  page,
}) => {
  await page.clock.install();
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
  await pausePresentationClock(page);
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  await page.getByRole('button', { name: 'Dismiss roll' }).click();
  await page.getByRole('button', { name: 'Send to Discord ↗', exact: true }).click();
  expect(clicks).toBe(1);
  // Only the frontend API is intercepted; no live Discord endpoint is configured or contacted.
});
