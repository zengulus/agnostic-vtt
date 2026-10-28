import { expect, test, type Page } from '@playwright/test';
import { openDice, openLibrary } from './helpers/workspace.js';

async function demo(page: Page, width = 1440, height = 960) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() =>
    localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
}
for (const [width, height] of [
  [1440, 960],
  [1024, 768],
  [820, 1180],
  [390, 844],
]) {
  test(`map uses the available workspace and tools open on demand at ${width}px`, async ({
    page,
  }) => {
    await demo(page, width, height);
    await expect(page.locator('.library')).toHaveCount(0);
    await expect(page.locator('.chronicle')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Party chat', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Message your party')).toHaveCount(0);
    await expect(page.getByLabel('Turn awareness')).toHaveCount(0);
    const canvas = page.locator('.tabletop > canvas');
    const before = (await canvas.boundingBox())!;
    expect(before.width).toBeCloseTo(width - (width <= 620 ? 44 : 56));
    expect(before.height).toBeGreaterThan(height * 0.8);
    await openDice(page);
    await expect(page.getByRole('button', { name: 'Roll the dice', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
    await expect(page.locator('.chronicle')).toBeHidden();
    await page.getByRole('button', { name: 'Turn tracker', exact: true }).click();
    await expect(page.locator('.tracker-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.chronicle')).toBeHidden();
    const restored = (await canvas.boundingBox())!;
    expect(restored.width).toBeCloseTo(before.width);
    expect(restored.height).toBeCloseTo(before.height);
    await openLibrary(page);
    if (width <= 1000) {
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      await expect(page.locator('.library')).toBeVisible();
      await page.getByRole('button', { name: 'Close library', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Focus tabletop', exact: true }).click();
    expect(await canvas.boundingBox()).toEqual({ x: 0, y: 0, width, height });
    await page.getByRole('button', { name: 'Exit focus mode', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('focus mode fills the viewport while retaining the camera and exits with Escape', async ({
  page,
}) => {
  await demo(page);
  await openLibrary(page);
  await openDice(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const before = await page.evaluate(async () => {
    const s = (await import('/src/store.ts' as string)).useTable.getState();
    const r = document.querySelector('.tabletop > canvas')!.getBoundingClientRect();
    return {
      zoom: s.camera.zoom,
      x: (r.width / 2 - s.camera.x) / s.camera.zoom,
      y: (r.height / 2 - s.camera.y) / s.camera.zoom,
    };
  });
  await page.getByRole('button', { name: 'Focus tabletop', exact: true }).click();
  await expect(page.locator('.app-header')).toBeHidden();
  await expect(page.locator('.tool-rail')).toBeHidden();
  await expect(page.locator('.chronicle')).toBeHidden();
  const bounds = (await page.locator('.tabletop > canvas').boundingBox())!;
  expect(bounds).toEqual({ x: 0, y: 0, width: 1440, height: 960 });
  const after = await page.evaluate(async () => {
    const s = (await import('/src/store.ts' as string)).useTable.getState();
    const r = document.querySelector('.tabletop > canvas')!.getBoundingClientRect();
    return {
      zoom: s.camera.zoom,
      x: (r.width / 2 - s.camera.x) / s.camera.zoom,
      y: (r.height / 2 - s.camera.y) / s.camera.zoom,
    };
  });
  expect(after.zoom).toBeCloseTo(before.zoom);
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
  await page.getByRole('button', { name: 'Map settings', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Exit focus mode', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.locator('.library')).toBeVisible();
  await expect(page.locator('.chronicle')).toBeVisible();
});

test('dice validates inline, selects the exact die size and shows its result on phones', async ({
  page,
}) => {
  await demo(page, 390, 844);
  await openDice(page);
  const expression = page.getByRole('textbox', { name: 'Dice expression', exact: true });
  await expression.fill('1d100');
  await expect(page.getByRole('button', { name: 'Select d100', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Select d10', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expression.fill('2d20kh3');
  await expect(expression).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#dice-expression-error')).toContainText('Keep/drop');
  await expect(page.getByRole('button', { name: 'Roll the dice' })).toBeDisabled();
  await expression.fill('2d20kh1 + 4');
  await expect(expression).toHaveAttribute('aria-invalid', 'false');
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  await expect(page.locator('.chronicle')).toBeHidden();
  await expect(page.getByTestId('roll-total')).toBeInViewport();
  await page.getByRole('button', { name: 'Dismiss roll', exact: true }).click();
  await openDice(page);
  await expect(expression).toHaveValue('2d20kh1 + 4');
  await expect(page.locator('.history-card')).toHaveCount(1);
});

test('presets remain usable when browser storage is unavailable', async ({ page }) => {
  await demo(page);
  await openDice(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Unavailable', 'SecurityError');
    };
  });
  await page.getByLabel('Dice expression', { exact: true }).fill('3d8 + 2');
  await page.getByRole('button', { name: 'Save roll preset', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('saved for this visit');
  await page.getByTitle('Use 3d8 + 2', { exact: true }).click();
  await expect(page.getByLabel('Dice expression', { exact: true })).toHaveValue('3d8 + 2');
});

test('activity keyboard navigation and modal isolation remain available', async ({ page }) => {
  await demo(page);
  await openDice(page);
  await page.getByRole('button', { name: 'Dice & history', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Turns', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Turns', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Home');
  await expect(page.getByRole('button', { name: 'Character', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.app-header')).toHaveJSProperty('inert', true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-header')).toHaveJSProperty('inert', false);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Play as player', exact: true }).click();
  await page.locator('.tabletop > canvas').focus();
  await page.keyboard.press('f');
  expect(
    await page.evaluate(
      async () => (await import('/src/store.ts' as string)).useTable.getState().tool,
    ),
  ).toBe('select');
});

test('live dice wait for acknowledgement before allowing another request', async ({ page }) => {
  let release: (() => void) | undefined;
  await page.routeWebSocket('**/ws', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const action = JSON.parse(String(message));
      if (action.type === 'DICE_ROLL_REQUEST') release = () => server.send(message);
      else server.send(message);
    });
  });
  await page.addInitScript(() =>
    localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await openDice(page);
  const roll = page.getByRole('button', { name: 'Roll the dice', exact: true });
  await roll.click();
  await expect.poll(() => !!release).toBe(true);
  await page.clock.install();
  await page.clock.runFor(1200);
  await expect(roll).toBeDisabled();
  release!();
  await expect(roll).toBeEnabled();
  await expect(page.getByTestId('roll-total')).toBeVisible();
});
