import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Action } from '../../shared/protocol.js';
import type { RoomState } from '../../shared/model.js';
import { openLibrary } from './helpers/workspace.js';

test('conditions, timing, linked counters and regions work in play', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  const act = async (action: Action) =>
    page.evaluate(
      async (value) => (await import('/src/connection.ts' as string)).sendAndWait(value),
      action,
    );
  const state = async (): Promise<RoomState> =>
    page.evaluate(async () => (await import('/src/store.ts' as string)).useTable.getState().room);
  await act({
    type: 'CHARACTER_IMPORT',
    id: 'kael',
    text: readFileSync(new URL('../../public/examples/character.txt', import.meta.url), 'utf8'),
    visibility: 'public',
  });
  await act({
    type: 'TRACKER_UPDATE',
    tracker: {
      entries: [
        { id: 'a', name: 'A', value: 1, hidden: false },
        { id: 'b', name: 'B', value: 0, hidden: false },
      ],
      activeId: 'a',
      round: 1,
      order: 'manual',
    },
  });
  await openLibrary(page);
  await page.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
  await page.getByRole('button', { name: 'Edit token', exact: true }).click();
  await page.getByLabel('Linked character sheet').selectOption('kael');
  await page.getByLabel('Token bar source').selectOption('focus');
  await page.getByRole('button', { name: 'Save token', exact: true }).click();
  await expect(page.locator('.selection-controls .token-resource')).toContainText('Focus: 3 / 3');
  await page
    .locator('.selection-controls')
    .getByRole('button', { name: 'Damage or spend resource' })
    .click();
  await expect(page.locator('.selection-controls .token-resource')).toContainText('Focus: 2 / 3');
  expect((await state()).characters!.kael.resources.find((r) => r.id === 'focus')?.current).toBe(2);
  const chips = page.locator(
    '.selection-controls .token-statuses:not(.quick-abilities):not(.stat-roll):not(.batch-actions)',
  );
  await chips.locator('summary').click();
  await chips.getByRole('button', { name: 'Add condition' }).click();
  await chips.getByLabel('Condition name').fill('Marked');
  await chips.getByLabel('Condition expires on').selectOption('b');
  await chips.getByRole('button', { name: 'Save as campaign preset' }).click();
  await expect.poll(async () => Object.keys((await state()).statusPresets || {}).length).toBe(1);
  const conditionFeedback = await chips
    .getByRole('button', { name: 'Save condition', exact: true })
    .evaluate(
      (button) =>
        new Promise<number>((resolve, reject) => {
          const start = performance.now();
          const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Condition feedback did not appear'));
          }, 2000);
          const observer = new MutationObserver(() => {
            if (document.querySelector('[aria-label="Remove Marked"]')) {
              clearTimeout(timer);
              observer.disconnect();
              resolve(performance.now() - start);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          (button as HTMLButtonElement).click();
        }),
    );
  expect(conditionFeedback).toBeLessThan(400);
  await expect(chips).toContainText('Marked');
  await act({ type: 'TRACKER_ADVANCE', direction: 1 });
  await expect(chips.getByRole('button', { name: 'Remove Marked' })).toHaveCount(0);
  await chips.getByRole('button', { name: '+ Marked' }).click();
  await expect(chips.getByRole('button', { name: 'Remove Marked' })).toBeVisible();
  await act({
    type: 'ZONE_UPDATE',
    sceneId: 'hollow',
    zone: {
      id: 'area',
      shape: 'rectangle',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      color: '#ff0000',
      label: 'Area',
    },
  });
  await page.getByRole('button', { name: 'Saved token library' }).click();
  await page.getByRole('button', { name: 'Regions & annotations' }).click();
  await page.getByRole('button', { name: /Area/ }).click();
  await page.getByLabel('Region follows token').selectOption('ranger');
  await page.getByLabel('Region x').fill('100');
  await page.getByRole('button', { name: 'Save object' }).click();
  expect((await state()).scenes.hollow.zones.area.anchorTokenId).toBe('ranger');
  await act({
    type: 'TOKEN_MOVE_COMMIT',
    sceneId: 'hollow',
    tokenId: 'ranger',
    position: { x: 680, y: 760 },
  });
  expect((await state()).scenes.hollow.zones.area.x).toBe(180);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const quick = page.locator('.quick-abilities');
  await quick.locator('summary').click();
  await quick.getByRole('button', { name: 'Sweeping Strike', exact: true }).click();
  await expect
    .poll(
      async () => (await state()).characters!.kael.resources.find((r) => r.id === 'focus')?.current,
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Dismiss roll' }).click();
  await act({ type: 'DICE_ROLL_REQUEST', expression: '21d6', visibility: 'public' });
  await expect(page.locator('.roll-overlay')).toHaveClass(/minimal/);
  await expect(page.locator('.physical-dice')).toHaveCount(0);
});
