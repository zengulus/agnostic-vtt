import { expect, test, type Page } from '@playwright/test';
import { openDice, openLibrary } from './helpers/workspace.js';

async function demo(page: Page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() =>
    localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
}
const zoom = (page: Page) =>
  page.evaluate(
    async () => (await import('/src/store.ts' as string)).useTable.getState().camera.zoom,
  );

test('phone scenes frame tokens while full-map and token framing remain explicit choices', async ({
  page,
}) => {
  await demo(page);
  expect((await zoom(page)) * 72).toBeGreaterThan(36);
  const guide = page.getByLabel('Getting started', { exact: true });
  expect((await guide.boundingBox())!.height).toBeLessThan(45);
  await page.getByRole('button', { name: 'Fit map to screen', exact: true }).click();
  expect(await zoom(page)).toBeLessThan(0.3);
  await page.getByRole('button', { name: 'Focus scene tokens', exact: true }).click();
  expect((await zoom(page)) * 72).toBeGreaterThan(36);
  expect(
    await page.getByRole('button', { name: 'Dice & macros', exact: true }).innerText(),
  ).toContain('Dice');
  await page.evaluate(async () => {
    const s = (await import('/src/store.ts' as string)).useTable.getState();
    const scene = s.room.scenes[s.room.activeSceneId];
    s.set({
      room: { ...s.room, scenes: { ...s.room.scenes, [scene.id]: { ...scene, tokens: {} } } },
    });
  });
  await expect(
    page.getByRole('button', { name: 'Focus scene tokens', exact: true }),
  ).toBeDisabled();
});

test('tablet panels coordinate their space without discarding dice inputs', async ({ page }) => {
  await demo(page, 1024, 768);
  await openLibrary(page);
  await expect(page.locator('.library')).toBeVisible();
  await openDice(page);
  await expect(page.locator('.library')).toHaveCount(0);
  expect((await page.locator('.tabletop > canvas').boundingBox())!.width).toBeGreaterThan(580);
  await page.getByLabel('Dice expression', { exact: true }).fill('3d8 + 2');
  await openLibrary(page);
  await expect(page.locator('.chronicle')).toBeHidden();
  await openDice(page);
  await expect(page.getByLabel('Dice expression', { exact: true })).toHaveValue('3d8 + 2');
});

test('compact drawers focus their workspace, isolate the map and restore their trigger', async ({
  page,
}) => {
  await demo(page);
  const trigger = page.getByRole('button', { name: 'Dice & macros', exact: true });
  await openDice(page);
  await expect(page.getByRole('button', { name: 'Dice & history', exact: true })).toBeFocused();
  await expect(page.locator('.table-area')).toHaveJSProperty('inert', true);
  const close = page.getByRole('button', { name: 'Back to map', exact: true });
  await expect(close).toContainText('Back to map');
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.chronicle'))).toBe(true);
  await page.getByRole('button', { name: 'Dice presentation settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.modal'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.table-area')).toHaveJSProperty('inert', true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.table-area')).toHaveJSProperty('inert', false);
  await expect(trigger).toBeFocused();
});

test('phone sheets expose their first action and jump between abilities and resources', async ({
  page,
}) => {
  await demo(page);
  await page.getByRole('button', { name: 'Character sheets', exact: true }).click();
  await page.getByRole('button', { name: 'Import character text', exact: true }).click();
  await page.getByRole('button', { name: 'Use example character', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Import character', exact: true })
    .click();
  const use = page.getByRole('button', { name: 'Use Sweeping Strike', exact: true });
  await expect(use).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Jump to abilities', exact: true }).click();
  await expect(page.getByLabel('Character abilities', { exact: true })).toBeFocused();
  await use.click();
  await expect(page.locator('.sheet-last-action')).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Jump to resources', exact: true }).click();
  await expect(page.getByLabel('Character resources', { exact: true })).toBeFocused();
});

for (const [width, height] of [
  [1440, 960],
  [390, 844],
]) {
  test(`token identity and saving stay reachable while the form scrolls at ${width}px`, async ({
    page,
  }) => {
    await demo(page, width, height);
    await openLibrary(page);
    await page.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
    if (width <= 1000)
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    if (width <= 620)
      await page.getByRole('button', { name: 'Character controls', exact: true }).click();
    await page.getByRole('button', { name: 'Edit token', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Token', exact: true })).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toBeInViewport({ ratio: 1 });
    const save = page.getByRole('button', { name: 'Save token', exact: true });
    await expect(save).toBeInViewport({ ratio: 1 });
    await page.getByLabel('Name', { exact: true }).fill('Reviewed token');
    await page.locator('.token-form-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(save).toBeInViewport({ ratio: 1 });
    await save.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.selected-token-status')).toContainText('Reviewed token');
  });
}
