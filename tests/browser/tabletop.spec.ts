import { expect, test, type Page } from '@playwright/test';
import { pausePresentationClock } from './helpers/clock.js';
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
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
}
test('independent browser clients move tokens, share dice/chat, and reconnect', async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  for (const context of [a, b])
    await context.addInitScript(() =>
      localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
    );
  const gm = await a.newPage(),
    pc = await b.newPage();
  await Promise.all([gm.clock.install(), pc.clock.install()]);
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
  await expect(pc.getByText('Live', { exact: true })).toBeVisible();
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
  // This checks shared authoritative results; the physical-face scenario below
  // exercises the real renderer. Hold auto-dismiss while inspecting both clients.
  for (const page of [gm, pc]) await pausePresentationClock(page);
  await gm.getByRole('textbox', { name: 'DICE EXPRESSION' }).fill('1d20 + 5 - 2');
  await gm.getByRole('button', { name: 'Roll the dice' }).click();
  await expect.poll(() => gmMessages.find((m) => m.type === 'DICE_ROLL_RESULT')).toBeTruthy();
  await expect.poll(() => pcMessages.find((m) => m.type === 'DICE_ROLL_RESULT')).toBeTruthy();
  const gmRoll = gmMessages.find((m) => m.type === 'DICE_ROLL_RESULT')!,
    pcRoll = pcMessages.find((m) => m.type === 'DICE_ROLL_RESULT')!;
  expect(gmRoll).toEqual(pcRoll);
  if (gmRoll.type === 'DICE_ROLL_RESULT') {
    await expect(gm.getByTestId('roll-total')).toContainText(String(gmRoll.roll.total));
    await expect(pc.getByTestId('roll-total')).toContainText(String(gmRoll.roll.total));
  }
  await gm.getByRole('button', { name: 'Dismiss roll' }).click();
  await pc.getByRole('button', { name: 'Dismiss roll' }).click();
  await Promise.all([gm.clock.resume(), pc.clock.resume()]);
  await pc.getByRole('button', { name: 'Party chat', exact: true }).click();
  await pc.getByRole('textbox', { name: 'Message your party' }).fill('The crossing looks safe.');
  await pc.getByRole('button', { name: 'Send message' }).click();
  await gm.getByRole('button', { name: 'Party chat', exact: true }).click();
  await expect(gm.getByText('The crossing looks safe.', { exact: true })).toBeVisible();
  await b.setOffline(true);
  await expect(pc.getByText('Reconnecting', { exact: true })).toBeVisible({ timeout: 15000 });
  const draft = pc.getByRole('textbox', { name: 'Message your party' });
  await draft.fill('Keep this draft until we reconnect.');
  await pc.getByRole('button', { name: 'Send message' }).click();
  await expect(draft).toHaveValue('Keep this draft until we reconnect.');
  await b.setOffline(false);
  await expect(pc.getByText('Live', { exact: true })).toBeVisible({ timeout: 20000 });
  await pc.getByRole('button', { name: 'Send message' }).click();
  await expect(draft).toHaveValue('');
  await expect(gm.getByText('Keep this draft until we reconnect.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
test('keyboard activation works alongside tabletop shortcuts', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() =>
    localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
  );
  await page.goto('/');
  const launch = page.getByRole('button', { name: 'Log in' });
  await launch.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(launch).toBeFocused();
  await page.keyboard.press('Enter');
  // Keyboard behavior does not depend on live campaign creation or socket readiness.
  await page.getByRole('dialog').getByRole('button', { name: 'Demo', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Demo', { exact: true })).toBeVisible();
  // Test keyboard dismissal without racing the minimal result's 2.8s auto-dismiss.
  await pausePresentationClock(page);
  await page.getByRole('button', { name: 'Roll the dice' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('roll-total')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss roll' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('roll-total')).toHaveCount(0);
  await page.clock.resume();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Measure', exact: true })).toHaveClass(/active/);
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('button', { name: 'Measure', exact: true })).toHaveClass(/active/);
});
for (const [name, settings, presets, rolls] of [
  ['null settings and object presets', null, { invalid: true }, ['1d20 + 5', '2d6', '1d100']],
  ['array settings and null presets', [], null, ['1d20 + 5', '2d6', '1d100']],
  [
    'invalid fields and mixed presets',
    { sound: 'false', reducedMotion: 'false', dice: { speed: 0 } },
    ['d20', null, 'bad', 'd20', '1d6'],
    ['d20', '1d6'],
  ],
] as const) {
  test(`startup recovers from ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(
      ({ settings, presets }) => {
        localStorage.setItem('aether-settings', JSON.stringify(settings));
        localStorage.setItem('aether-presets', JSON.stringify(presets));
      },
      { settings, presets },
    );
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    await expect(page.locator('.presets button')).toHaveText([...rolls]);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Reduced motion')).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Roll sound/ })).not.toBeChecked();
    expect(errors).toEqual([]);
  });
}
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
  await page.getByRole('button', { name: 'Done', exact: true }).click();
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
  await expect(page.getByRole('heading', { name: 'The next chapter.' })).toBeVisible();
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('a campaign owner can sign in as a player and keep that role on reconnect', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByLabel('Enter table as').selectOption('player');
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to GM', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fog reveal / conceal', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Return to GM', exact: true }).click();
  await page.getByRole('button', { name: 'Cover scene with fog', exact: true }).click();
  await page.getByRole('button', { name: 'Play as player', exact: true }).click();
  await expect(page.locator('.scene-meta')).toContainText('0 tokens');
  await context.setOffline(true);
  await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Return to GM', exact: true })).toBeVisible();
  await expect(page.locator('.scene-meta')).toContainText('0 tokens');
  await page.getByRole('button', { name: 'Return to GM', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear all fog', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite party', exact: true })).toBeVisible();
});
