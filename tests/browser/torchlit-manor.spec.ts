import { expect, test } from '@playwright/test';
import type { RoomState } from '../../shared/model.js';
import { openLibrary } from './helpers/workspace.js';

test('the offline manor demonstrates torchlight and opening a sight-blocking door', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  const state = async (): Promise<RoomState> =>
    page.evaluate(async () => (await import('/src/store.ts' as string)).useTable.getState().room);
  await openLibrary(page);
  await page.getByRole('button', { name: 'The Lantern House', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The Lantern House', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close library' }).click();
  await page.getByRole('button', { name: 'Play as player' }).click();
  expect((await state()).scenes.manor.tokens.sentinel).toBeUndefined();
  await page.getByRole('button', { name: 'Return to GM' }).click();
  await openLibrary(page);
  await page.locator('.lighting-controls summary').click();
  await page
    .getByRole('button', { name: /Open door/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Close library' }).click();
  await page.getByRole('button', { name: 'Play as player' }).click();
  expect((await state()).scenes.manor.tokens.sentinel).toBeDefined();
});
