import { expect, type Page } from '@playwright/test';

export async function openDice(page: Page) {
  if (await page.getByLabel('Dice expression', { exact: true }).isVisible()) return;
  if (
    (page.viewportSize()?.width || 1440) <= 1000 &&
    (await page.locator('.chronicle').isVisible())
  )
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await page.getByRole('button', { name: 'Dice & macros', exact: true }).click();
  await expect(page.getByLabel('Dice expression', { exact: true })).toBeVisible();
}
export async function openLibrary(page: Page) {
  if (
    (page.viewportSize()?.width || 1440) <= 1000 &&
    (await page.locator('.chronicle').isVisible())
  )
    await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  if (!(await page.locator('.library').isVisible()))
    await page.getByRole('button', { name: 'Toggle library', exact: true }).click();
}
/** Existing editing scenarios opt into the expanded workspace explicitly. */
export async function desktopWorkspace(page: Page) {
  if ((page.viewportSize()?.width || 1440) <= 1000) return;
  await openLibrary(page);
  await openDice(page);
  await page.getByRole('button', { name: 'Fit map to screen', exact: true }).click();
}
