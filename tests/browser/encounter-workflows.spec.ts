import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Action } from '../../shared/protocol.js';
import type { RoomState } from '../../shared/model.js';
import { openLibrary } from './helpers/workspace.js';

test('encounters, batch effects, stat rolls, ability editing and applying results', async ({
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
  const select = async (ids: string[]) =>
    page.evaluate(
      async (values) =>
        (await import('/src/store.ts' as string)).useTable
          .getState()
          .set({ selected: values.at(-1), selectedIds: values }),
      ids,
    );
  await act({
    type: 'CHARACTER_IMPORT',
    id: 'kael',
    text: readFileSync(new URL('../../public/examples/character.txt', import.meta.url), 'utf8'),
    visibility: 'public',
  });
  let token = (await state()).scenes.hollow.tokens.ranger;
  await act({ type: 'TOKEN_UPDATE', sceneId: 'hollow', token: { ...token, characterId: 'kael' } });
  await select(['ranger', 'mage']);
  const batch = page.locator('.batch-actions');
  await batch.locator('summary').click();
  await batch.getByLabel('Batch condition name').fill('Blessed');
  await batch.getByRole('button', { name: 'Add condition to selected' }).click();
  expect((await state()).scenes.hollow.tokens.mage.statuses![0].label).toBe('Blessed');
  await batch.getByRole('button', { name: 'Spend selected resources' }).click();
  expect((await state()).scenes.hollow.tokens.ranger.resource!.value).toBe(7);
  await openLibrary(page);
  await page.getByRole('button', { name: 'Saved token library' }).click();
  await page.locator('.encounter-library summary').click();
  await page.getByLabel('Encounter name').fill('Ambush');
  await page.getByRole('button', { name: 'Save selected as encounter' }).click();
  await expect(page.getByRole('button', { name: 'Place Ambush' })).toBeVisible();
  await page.getByRole('button', { name: 'Place Ambush' }).click();
  expect(Object.keys((await state()).scenes.hollow.tokens)).toHaveLength(5);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await select(['ranger']);
  const quick = page.locator('.quick-abilities');
  await quick.locator('summary').click();
  await quick.getByLabel('Search quick actions').fill('Sweeping');
  await quick.getByRole('button', { name: 'Pin Sweeping Strike' }).click();
  await expect(
    page.locator('.quick-ability-shortcuts > button', { hasText: 'Sweeping Strike' }),
  ).toBeVisible();
  await quick.getByLabel('Favorites only').check();
  await expect(quick.getByRole('button', { name: 'Sweeping Strike', exact: true })).toBeVisible();
  const stat = page.locator('.selection-controls .stat-roll');
  await stat.locator('summary').click();
  await stat.getByLabel('Roll stat', { exact: true }).selectOption('ATTACK');
  await stat.getByRole('button', { name: 'Roll ATTACK' }).click();
  await expect.poll(async () => (await state()).rolls.length).toBe(1);
  await page.getByRole('button', { name: 'Dismiss roll' }).click();
  await page.getByRole('button', { name: 'Dice & macros', exact: true }).click();
  const apply = page.locator('.history-card').first().locator('.apply-roll');
  await apply.locator('summary').click();
  await apply.getByLabel('Apply roll target').selectOption('ranger');
  await apply.getByLabel('Apply roll amount').fill('2');
  await apply.getByRole('button', { name: 'Confirm spend' }).click();
  expect((await state()).scenes.hollow.tokens.ranger.resource!.value).toBe(5);
  await page.getByRole('button', { name: 'Character sheets', exact: true }).click();
  await page.getByRole('button', { name: 'Add ability', exact: true }).click();
  await page.getByLabel('Ability name').fill('Quick Step');
  await page.getByLabel('Ability description').fill('Move carefully.');
  await page.getByRole('button', { name: 'Save ability', exact: true }).click();
  await expect
    .poll(async () =>
      (await state()).characters!.kael.abilities.some((a) => a.name === 'Quick Step'),
    )
    .toBe(true);
  token = (await state()).scenes.hollow.tokens.ranger;
  expect(token.resource!.value).toBe(5);
});
