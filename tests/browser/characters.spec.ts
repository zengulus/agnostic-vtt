import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { RoomState } from '../../shared/model.js';
import type { Action } from '../../shared/protocol.js';

const text = readFileSync(new URL('../../public/examples/character.txt', import.meta.url), 'utf8');
async function room(page: Page): Promise<RoomState> {
  return page.evaluate(
    async () => (await import('/src/store.ts' as string)).useTable.getState().room,
  );
}
async function action(page: Page, value: Action) {
  return page.evaluate(
    async (value) => (await import('/src/connection.ts' as string)).sendAndWait(value),
    value,
  );
}
async function demo(page: Page, player = false) {
  await page.addInitScript(() =>
    localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
  );
  await page.goto('/');
  await page
    .getByRole('button', {
      name: player ? 'Try the player demo' : 'Open a demo table',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Dismiss getting started', exact: true }).click();
  await page.getByRole('button', { name: 'Character sheets', exact: true }).click();
  await page.getByRole('button', { name: 'Import character text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Character text', exact: true }).fill(text);
  await page.getByLabel('Character sheet visibility').selectOption('public');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Import character', exact: true })
    .click();
  await expect(page.getByLabel('Character sheet', { exact: true })).toBeVisible();
}
const ability = (page: Page, name: string) =>
  page
    .locator('.sheet-ability')
    .filter({ has: page.locator('.ability-heading > strong', { hasText: name }) });
for (const width of [1440, 390]) {
  test(`${width}px: import, spend, recover, prepare, text-only announcements and rest`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await demo(page, true);
    const id = Object.keys((await room(page)).characters!)[0];
    await expect(page.getByLabel('Focus remaining')).toHaveAttribute('value', '3');
    await page.getByLabel('Adjust Focus', { exact: true }).click();
    const focus = page
      .locator('.sheet-resource')
      .filter({ has: page.getByLabel('Focus remaining') });
    await focus.getByRole('button', { name: '− Spend', exact: true }).click();
    await expect(page.getByLabel('Focus remaining')).toHaveAttribute('value', '2');
    await focus.getByRole('button', { name: '+ Restore', exact: true }).click();
    await expect(page.getByLabel('Focus remaining')).toHaveAttribute('value', '3');
    await page.getByLabel('Adjust Focus', { exact: true }).click();
    await page.getByRole('button', { name: 'Use Sweeping Strike', exact: true }).click();
    await expect(ability(page, 'Sweeping Strike')).toContainText('Expended');
    await expect(page.getByLabel('Focus remaining')).toHaveAttribute('value', '2');
    await expect(page.locator('.sheet-last-action .macro-results')).toContainText('Attack Roll');
    if (width > 620) await page.getByRole('button', { name: 'Continue', exact: true }).click();
    else await expect(page.locator('.roll-overlay')).toHaveCount(0);
    await page.getByLabel('Ability availability').selectOption('ready');
    await expect(
      page.getByRole('button', { name: 'Use Sweeping Strike', exact: true }),
    ).toHaveCount(0);
    await page
      .locator('.sheet-recovery')
      .getByRole('button', { name: 'Recover', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Use Sweeping Strike', exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel('Focus remaining')).toHaveAttribute('value', '2');
    await page.getByRole('button', { name: 'Unprepare Sweeping Strike', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Use Sweeping Strike', exact: true }),
    ).toHaveCount(0);
    await page.getByLabel('Ability availability').selectOption('all');
    await page.getByRole('button', { name: 'Prepare Sweeping Strike', exact: true }).click();
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Use Prepared Ward', exact: true }).click();
      await expect(page.locator('.sheet-last-action .macro-results')).toContainText(
        'protective ward',
      );
      if (width > 620) await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await expect(
      page.getByRole('button', { name: 'Use Prepared Ward', exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel('Spell slots remaining')).toHaveAttribute('value', '0');
    await page
      .locator('.sheet-recovery')
      .getByRole('button', { name: 'Rest', exact: true })
      .click();
    await expect(page.getByLabel('Spell slots remaining')).toHaveAttribute('value', '2');
    await expect(
      page.getByRole('button', { name: 'Use Prepared Ward', exact: true }),
    ).toBeEnabled();
    expect((await room(page)).characters![id].resources[0].current).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 390) {
      await page.getByRole('button', { name: 'Close table activity', exact: true }).click();
      await page.getByRole('button', { name: 'Dice & macros', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Roll the dice', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Character sheets', exact: true }).click();
      await expect(page.getByLabel('Character sheet', { exact: true })).toBeVisible();
    }
  });
}
test('example import previews, stale text edits retain drafts, and token links open persistent campaign sheets', async ({
  page,
}) => {
  await demo(page);
  const id = Object.keys((await room(page)).characters!)[0];
  await page.getByText('Character settings & text', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit character text', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Character text', exact: true })
    .fill(text.replace('name = Kael', 'name = My draft'));
  await action(page, { type: 'CHARACTER_RESOURCE_ADJUST', id, resourceId: 'focus', delta: -1 });
  await expect(
    page.getByRole('button', { name: 'Replace character from text', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Character text', exact: true })).toHaveValue(
    /name = My draft/,
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Kael Wanderer', exact: true }).click();
  await page.getByRole('button', { name: 'Edit token', exact: true }).click();
  await page.getByLabel('Linked character sheet').selectOption(id);
  await page.getByRole('button', { name: 'Save token', exact: true }).click();
  await page.getByRole('button', { name: 'Open selected character sheet', exact: true }).click();
  await expect(page.getByLabel('Focus remaining')).toHaveAttribute('value', '2');
  await action(page, { type: 'SCENE_CHANGE', sceneId: 'sanctuary' });
  await expect(page.getByLabel('Focus remaining')).toHaveAttribute('value', '2');
  await page.getByRole('button', { name: 'Import another character', exact: true }).click();
  await page.getByRole('button', { name: 'Use example character', exact: true }).click();
  await expect(page.locator('.character-import-preview')).toContainText(
    '2 resource pools · 3 abilities',
  );
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Import character', exact: true }),
  ).toBeEnabled();
});
test('unbound macro inputs prompt before spending, and read-only party sheets cannot use abilities', async ({
  page,
}) => {
  await demo(page);
  const id = Object.keys((await room(page)).characters!)[0];
  await action(page, {
    type: 'CHARACTER_IMPORT',
    id: 'prompt',
    text: text
      .replace('name = Kael', 'name = Input adept')
      .replace('1d20 + ATTACK', '1d20 + EXTRA'),
    visibility: 'public',
  });
  await page.getByLabel('Active character sheet').selectOption('prompt');
  await page.getByRole('button', { name: 'Use Sweeping Strike', exact: true }).click();
  await expect(page.getByLabel('Focus remaining')).toHaveAttribute('value', '3');
  await page.getByLabel('Ability input EXTRA').fill('5');
  await page.getByRole('button', { name: 'Use ability', exact: true }).click();
  await expect(page.getByLabel('Focus remaining')).toHaveAttribute('value', '2');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.evaluate(async (id) => {
    const s = (await import('/src/store.ts' as string)).useTable;
    s.getState().set({
      self: { id: 'viewer', name: 'Viewer', role: 'player', color: '#123456' },
      characterId: id,
    });
  }, id);
  await expect(page.getByLabel('Character sheet', { exact: true })).toContainText('View only');
  await expect(page.getByRole('button', { name: 'Use Prepared Ward', exact: true })).toHaveCount(0);
});
