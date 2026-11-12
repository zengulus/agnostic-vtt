import { expect, test } from '@playwright/test';
import type { Action } from '../../shared/protocol.js';
import type { RoomState } from '../../shared/model.js';
import { openLibrary } from './helpers/workspace.js';

test('the GM stages scenes, places an interactive pin and presents its destination', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  const act = async (action: Action) =>
    page.evaluate(
      async (a) => (await import('/src/connection.ts' as string)).sendAndWait(a),
      action,
    );
  const state = async (): Promise<RoomState> =>
    page.evaluate(async () => (await import('/src/store.ts' as string)).useTable.getState().room);
  await act({ type: 'SCENE_VISIBILITY', sceneId: 'sanctuary', visibility: 'gm' });
  await openLibrary(page);
  await page.locator('.scene-presentation-settings summary').click();
  await page.getByRole('button', { name: 'Prepare The Astral Sanctuary' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Preparing The Astral Sanctuary' }),
  ).toBeVisible();
  await act({
    type: 'TOKEN_MOVE_COMMIT',
    sceneId: 'sanctuary',
    tokenId: 'ranger',
    position: { x: 450, y: 450 },
  });
  expect((await state()).activeSceneId).toBe('hollow');
  expect((await state()).scenes.sanctuary.tokens.ranger.x).toBe(440);
  await page.getByRole('button', { name: 'Return to table' }).click();
  await page.getByRole('button', { name: 'Place a map pin' }).click();
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.getByRole('region', { name: 'Map pin details' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Label', { exact: true }).fill('The Door');
  await panel.getByLabel('Description').fill('A heavy door');
  await panel.getByLabel('GM note').fill('An ambush waits');
  await panel.getByLabel('Visibility').selectOption('public');
  await panel.getByLabel('Destination').selectOption('sanctuary');
  await panel.getByText('Proximity cue').click();
  await panel.getByLabel('Notify when a token crosses the boundary').check();
  await panel.getByLabel('Optional message to players').fill('The door creaks.');
  await panel.getByRole('button', { name: 'Save pin' }).click();
  await expect
    .poll(async () => Object.keys((await state()).scenes.hollow.pins || {}).length)
    .toBe(1);
  await page.locator('.pin-list > summary').click();
  await page.getByRole('button', { name: 'The Door', exact: true }).click();
  await expect(panel).toContainText('An ambush waits');
  await page.getByRole('combobox', { name: 'Effect' }).selectOption('curtain');
  await page.getByLabel('Title', { exact: true }).fill('Into the Vault');
  await page.getByLabel('Subtitle', { exact: true }).fill('A new danger');
  await panel.getByRole('button', { name: 'Open destination' }).click();
  await expect.poll(async () => (await state()).activeSceneId).toBe('sanctuary');
  await expect(page.locator('.scene-transition')).toContainText('Into the Vault');
  await expect(page.locator('.scene-transition')).toHaveClass(/transition-curtain/);
  expect((await state()).scenes.sanctuary.visibility).toBe('public');
});
