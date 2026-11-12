import { expect, test } from '@playwright/test';
import type { Action } from '../../shared/protocol.js';
import type { RoomState } from '../../shared/model.js';
const state = async (page: import('@playwright/test').Page): Promise<RoomState> =>
  page.evaluate(async () => (await import('/src/store.ts' as string)).useTable.getState().room);
const act = async (page: import('@playwright/test').Page, action: Action) =>
  page.evaluate(async (a) => (await import('/src/connection.ts' as string)).sendAndWait(a), action);

test('phone library exposes GM controls and light placement leaves a usable map', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Toggle library', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.lighting-controls summary')).toBeVisible();
  await expect(dialog.locator('.pin-list > summary')).toBeVisible();
  await expect(dialog.locator('.scene-presentation-settings summary')).toBeVisible();
  await dialog.locator('.lighting-controls summary').click();
  await dialog.getByRole('button', { name: 'Place a light on the map' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.light-settings > summary')).toBeVisible();
  const panel = (await page.locator('.tool-options').boundingBox())!;
  expect(panel.height).toBeLessThan(260);
  await page.locator('.light-settings > summary').click();
  await page.getByLabel('New light preset').selectOption('sconce');
  await expect(page.getByLabel('New light beam width')).toBeVisible();
});

test('remote lighting updates never silently overwrite an unsaved GM draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Toggle library', exact: true }).click();
  const controls = page.locator('.lighting-controls');
  await controls.locator('summary').click();
  await act(page, {
    type: 'LIGHTING_SET',
    sceneId: 'hollow',
    lighting: { vision: true, darkness: 0.7 },
  });
  await expect(controls.getByLabel('Enable shared player vision')).toBeChecked();
  await expect(controls.getByLabel('Scene darkness')).toHaveValue('0.7');
  await controls.getByLabel('Scene darkness').fill('0.5');
  await act(page, {
    type: 'LIGHTING_SET',
    sceneId: 'hollow',
    lighting: { vision: false, darkness: 0.8 },
  });
  await expect(controls.getByRole('alert')).toContainText('draft is preserved');
  await controls.getByRole('button', { name: 'Apply vision and darkness' }).click();
  expect((await state(page)).scenes.hollow.lighting).toEqual({ vision: false, darkness: 0.8 });
  await expect(controls.getByLabel('Scene darkness')).toHaveValue('0.5');
  await controls.getByRole('button', { name: 'Reload latest lighting' }).click();
  await expect(controls.getByLabel('Scene darkness')).toHaveValue('0.8');
});
