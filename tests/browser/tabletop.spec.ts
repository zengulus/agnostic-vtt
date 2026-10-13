import { expect, test, type Page } from '@playwright/test';
import type { ServerMessage } from '../../shared/protocol.js';
function observe(page: Page) {
  const messages: ServerMessage[] = [];
  page.on('websocket', (ws) =>
    ws.on('framereceived', (event) => {
      try {
        messages.push(JSON.parse(String(event.payload)));
      } catch {
        /* Vite's unrelated websocket. */
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
test('independent browser clients move tokens, share dice/chat, and reconnect', async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const gm = await a.newPage(),
    pc = await b.newPage();
  const gmMessages = observe(gm),
    pcMessages = observe(pc),
    errors: string[] = [];
  gm.on('pageerror', (e) => errors.push(e.message));
  pc.on('pageerror', (e) => errors.push(e.message));
  await create(gm);
  await gm.getByRole('button', { name: 'Invite party' }).click();
  const invite = await gm.getByRole('textbox', { name: 'Party invitation' }).inputValue();
  await gm.getByRole('button', { name: 'Close dialog' }).click();
  await pc.goto(invite);
  await pc.getByLabel('Your name').fill('Second player');
  await pc.getByRole('button', { name: 'Join your party', exact: true }).click();
  await expect(pc.getByText('LIVE SESSION', { exact: true })).toBeVisible();
  const box = (await gm.locator('canvas').first().boundingBox())!;
  const zoom = Math.min((box.width - 70) / 1600, (box.height - 70) / 1200),
    cx = (box.width - 1600 * zoom) / 2,
    cy = (box.height - 1200 * zoom) / 2;
  const pos = (x: number, y: number) => ({ x: box.x + cx + x * zoom, y: box.y + cy + y * zoom });
  const start = pos(600, 680),
    end = pos(520, 760);
  await gm.mouse.move(start.x, start.y);
  await gm.mouse.down();
  await gm.mouse.move(end.x, end.y, { steps: 12 });
  await gm.mouse.up();
  await expect
    .poll(() =>
      pcMessages.find(
        (m) =>
          m.type === 'STATE_PATCH' &&
          m.changes.some(
            (c) =>
              c.kind === 'token' &&
              c.token.id === 'ranger' &&
              c.token.x === 520 &&
              c.token.y === 760,
          ),
      ),
    )
    .toBeTruthy();
  await gm.getByRole('textbox', { name: 'DICE EXPRESSION' }).fill('1d20 + 5 - 2');
  await gm.getByRole('button', { name: 'Roll the dice' }).click();
  await expect.poll(() => gmMessages.find((m) => m.type === 'DICE_ROLL_RESULT')).toBeTruthy();
  await expect.poll(() => pcMessages.find((m) => m.type === 'DICE_ROLL_RESULT')).toBeTruthy();
  const gmRoll = gmMessages.find((m) => m.type === 'DICE_ROLL_RESULT')!,
    pcRoll = pcMessages.find((m) => m.type === 'DICE_ROLL_RESULT')!;
  expect(gmRoll).toEqual(pcRoll);
  if (gmRoll.type === 'DICE_ROLL_RESULT') {
    await expect(gm.getByTestId('roll-total')).toContainText(String(gmRoll.roll.total), {
      timeout: 16000,
    });
    await expect(pc.getByTestId('roll-total')).toContainText(String(gmRoll.roll.total), {
      timeout: 16000,
    });
  }
  await gm.getByRole('button', { name: 'Dismiss roll' }).click();
  await pc.getByRole('button', { name: 'Dismiss roll' }).click();
  await pc.getByRole('button', { name: 'Party chat', exact: true }).click();
  await pc.getByRole('textbox', { name: 'Message your party' }).fill('The crossing looks safe.');
  await pc.getByRole('button', { name: 'Send message' }).click();
  await gm.getByRole('button', { name: 'Party chat', exact: true }).click();
  await expect(gm.getByText('The crossing looks safe.', { exact: true })).toBeVisible();
  await b.setOffline(true);
  await expect(pc.getByText('RECONNECTING', { exact: true })).toBeVisible({ timeout: 15000 });
  await b.setOffline(false);
  await expect(pc.getByText('LIVE SESSION', { exact: true })).toBeVisible({ timeout: 20000 });
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
test('map/token URL preview, errors, resizing, and accessible preferences work', async ({
  page,
}) => {
  // Intercept a public external host to make remote-asset acceptance deterministic.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await page.route('https://maps.example.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  );
  await page.route('https://broken.example.com/**', (route) =>
    route.fulfill({ status: 404, body: 'missing' }),
  );
  await create(page);
  await page.getByRole('button', { name: 'Map settings', exact: true }).click();
  await page.getByLabel('External image URL').fill('https://broken.example.com/missing.png');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not load as an image');
  await page.getByLabel('External image URL').fill('https://maps.example.com/battle.png');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('200');
  await page.getByLabel('Width', { exact: true }).fill('1600');
  await page.getByLabel('Height', { exact: true }).fill('1200');
  await page.getByLabel('Scene name').fill('The External Map');
  await page.getByRole('button', { name: 'Save scene', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The External Map', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add token', exact: true }).click();
  await page.getByLabel('External image URL').fill('https://maps.example.com/portrait.png');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByAltText('Image preview')).toHaveAttribute(
    'src',
    'https://maps.example.com/portrait.png',
  );
  await page.getByLabel('Name', { exact: true }).fill('External wanderer');
  await page.getByLabel('Size (scene pixels)').fill('100');
  await page.getByRole('button', { name: 'Add to the table', exact: true }).click();
  await expect(page.getByRole('button', { name: /External wanderer/ })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Reduced motion').check();
  await page.getByRole('button', { name: 'Back to the story', exact: true }).click();
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  await expect(page.getByTestId('roll-total')).toBeVisible();
  await expect(page.locator('.physical-dice')).toHaveCount(0);
});
test('physical dice show predetermined d20, mixed polyhedra, and percentile faces', async ({
  page,
}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const element = document.createElement('div');
    element.id = 'physics-test';
    Object.assign(element.style, {
      position: 'fixed',
      width: '800px',
      height: '550px',
      top: '0',
      left: '0',
      zIndex: '100',
    });
    document.body.appendChild(element);
    // Test the actual renderer installed by the app, rather than a mocked animation.
    const modulePath = '/src/diceEngine.ts';
    const { createDiceEngine } = await import(modulePath);
    const box = createDiceEngine('#physics-test', {
      baseScale: 65,
      iterationLimit: 400,
      theme_customColorset: {
        name: 'test',
        foreground: '#fff1d1',
        background: '#52694d',
        texture: 'none',
        material: 'metal',
      },
    });
    await box.initialize();
    const results = [];
    for (const notation of [
      '1d20@14',
      '1d4+1d6+1d8+1d10+1d12+1d20@3,5,7,8,11,19',
      '4d4@1,2,3,4',
      '1d100+1d10@60,7',
      '1d100+1d10@100,10',
    ]) {
      const rolled = await box.roll(notation);
      results.push(
        rolled.sets.flatMap((s: { rolls: Array<{ value: number }> }) =>
          s.rolls.map((r) => r.value),
        ),
      );
    }
    box.running = false;
    box.renderer.dispose();
    box.renderer.forceContextLoss();
    element.remove();
    return results;
  });
  expect(results).toEqual([[14], [3, 5, 7, 8, 11, 19], [1, 2, 3, 4], [60, 7], [100, 10]]);
});
test('desktop and tablet render without errors or overflowing the viewport', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A place for extraordinary stories.' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/tabletop-desktop.png' });
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.getByRole('button', { name: 'Open a demo table' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open a demo table' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/tabletop-mobile.png' });
  expect(errors).toEqual([]);
});
