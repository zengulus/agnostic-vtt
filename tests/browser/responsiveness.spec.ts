import { expect, test, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Action } from '../../shared/protocol.js';
import { desktopWorkspace, openLibrary } from './helpers/workspace.js';

async function action(page: Page, value: Action) {
  await page.evaluate(
    async (a) => (await import('/src/connection.ts' as string)).sendAndWait(a),
    value,
  );
}
async function clickAndMeasure(button: Locator, text: string) {
  const elapsed = await button.evaluate(
    (element, expected) =>
      new Promise<number>((resolve, reject) => {
        const started = performance.now();
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`No feedback for ${expected}`));
        }, 2000);
        const observer = new MutationObserver(() => {
          if (
            [...document.querySelectorAll('[role="status"]')].some((node) =>
              node.textContent?.includes(expected),
            )
          ) {
            clearTimeout(timer);
            observer.disconnect();
            resolve(performance.now() - started);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        (element as HTMLButtonElement).click();
      }),
    text,
  );
  expect(elapsed).toBeLessThan(400);
}
test('delayed actions show feedback and preserve failed drafts', async ({ page }) => {
  let blockedType = '';
  let held:
    { message: string; id: string; socket: WebSocketRoute; server: WebSocketRoute } | undefined;
  await page.routeWebSocket('**/ws', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const data = JSON.parse(message.toString());
      if (data.type === blockedType)
        held = { message: message.toString(), id: data.actionId, socket, server };
      else server.send(message);
    });
  });
  const finish = (accept: boolean) => {
    if (!held) throw new Error('Expected a pending action');
    if (accept) held.server.send(held.message);
    else
      held.socket.send(
        JSON.stringify({ v: 7, type: 'ERROR', actionId: held.id, message: 'Rejected for test.' }),
      );
    held = undefined;
    blockedType = '';
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await desktopWorkspace(page);
  const guide = page.getByRole('button', { name: 'Dismiss getting started' });
  if (await guide.count()) await guide.click();
  await action(page, {
    type: 'TRACKER_UPDATE',
    tracker: {
      entries: [{ id: 'one', name: 'One', value: 1, hidden: false }],
      activeId: 'one',
      round: 1,
      order: 'manual',
    },
  });
  await action(page, {
    type: 'ZONE_UPDATE',
    sceneId: 'hollow',
    zone: {
      id: 'area',
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      label: 'Area',
      color: '#ffffff',
    },
  });
  await action(page, {
    type: 'CHARACTER_IMPORT',
    id: 'kael',
    text: readFileSync(new URL('../../public/examples/character.txt', import.meta.url), 'utf8'),
    visibility: 'public',
  });
  await page.getByRole('button', { name: 'Turns', exact: true }).click();
  blockedType = 'TRACKER_ADVANCE';
  await clickAndMeasure(page.getByRole('button', { name: 'Next turn' }), 'Changing turn');
  await expect(page.getByRole('button', { name: 'Next turn' })).toBeDisabled();
  await expect.poll(() => !!held).toBe(true);
  finish(false);
  await expect(page.locator('.tracker-panel [role="alert"]')).toContainText('Rejected for test');
  await page.getByLabel('Participant name').fill('Draft');
  blockedType = 'TRACKER_UPDATE';
  await clickAndMeasure(page.getByRole('button', { name: 'Add participant' }), 'Updating turns');
  await expect.poll(() => !!held).toBe(true);
  finish(false);
  await expect(page.getByLabel('Participant name')).toHaveValue('Draft');
  blockedType = 'TRACKER_UPDATE';
  await clickAndMeasure(page.getByRole('button', { name: 'Add participant' }), 'Updating turns');
  await expect(page.getByRole('button', { name: 'Add participant' })).toBeDisabled();
  await expect.poll(() => !!held).toBe(true);
  finish(true);
  await expect(page.getByLabel('Participant name')).toHaveValue('');
  await page.evaluate(async () =>
    (await import('/src/store.ts' as string)).useTable
      .getState()
      .set({ selected: 'ranger', selectedIds: ['ranger', 'mage'] }),
  );
  const batch = page.locator('.batch-actions');
  await batch.locator('summary').click();
  await batch.getByLabel('Batch condition name').fill('Marked');
  blockedType = 'TOKEN_BATCH_ACTION';
  await clickAndMeasure(
    batch.getByRole('button', { name: 'Add condition to selected' }),
    'Adding conditions',
  );
  await expect.poll(() => !!held).toBe(true);
  finish(false);
  await expect(batch.getByRole('alert')).toContainText('Rejected for test');
  await openLibrary(page);
  await page.getByRole('button', { name: 'Saved token library' }).click();
  await page.getByRole('button', { name: 'Regions & annotations' }).click();
  await page.getByRole('button', { name: /Area/ }).click();
  await page.getByLabel('Region label').fill('Draft area');
  blockedType = 'ZONE_UPDATE';
  await clickAndMeasure(page.getByRole('button', { name: 'Save object' }), 'Saving region');
  await expect.poll(() => !!held).toBe(true);
  finish(false);
  await expect(page.getByLabel('Region label')).toHaveValue('Draft area');
  blockedType = 'ZONE_UPDATE';
  await clickAndMeasure(page.getByRole('button', { name: 'Save object' }), 'Saving region');
  await expect.poll(() => !!held).toBe(true);
  finish(true);
  await expect(page.getByRole('button', { name: /Draft area/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Character sheets', exact: true }).click();
  blockedType = 'CHARACTER_ABILITY_USE';
  await clickAndMeasure(
    page.getByRole('button', { name: 'Use Sweeping Strike' }),
    'Using Sweeping Strike',
  );
  await expect.poll(() => !!held).toBe(true);
  finish(false);
  await expect(page.locator('.character-workspace [role="alert"]')).toContainText(
    'Rejected for test',
  );
  await page.getByLabel('Adjust Focus').click();
  blockedType = 'CHARACTER_RESOURCE_ADJUST';
  await clickAndMeasure(
    page.getByRole('button', { name: '− Spend', exact: true }),
    'Updating Focus',
  );
  await expect.poll(() => !!held).toBe(true);
  finish(true);
  await expect(page.getByLabel('Focus remaining')).toHaveAttribute('value', '2');
  await page.getByRole('button', { name: 'Dice & macros', exact: true }).click();
  blockedType = 'DICE_ROLL_REQUEST';
  const roll = page.getByRole('button', { name: 'Roll the dice' });
  const start = Date.now();
  await roll.click();
  await expect(roll).toHaveText('Rolling…', { timeout: 400 });
  expect(Date.now() - start).toBeLessThan(400);
  await expect.poll(() => !!held).toBe(true);
  finish(false);
  await expect(roll).toBeEnabled();
});

test('large character previews remain responsive and discard stale results', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Character sheets', exact: true }).click();
  await page.getByRole('button', { name: 'Import character text', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Character text' });
  const example = readFileSync(
    new URL('../../public/examples/character.txt', import.meta.url),
    'utf8',
  );
  await input.fill(`${'# padding\n'.repeat(3000)}${example.replace('name = Kael', 'name = Old')}`);
  await input.fill(example.replace('name = Kael', 'name = Latest'));
  await expect(page.locator('.character-import-preview')).toContainText('Latest');
  await expect(page.locator('.character-import-preview')).not.toContainText('Old');
  await expect(page.getByRole('button', { name: 'Import character', exact: true })).toBeEnabled();
});
