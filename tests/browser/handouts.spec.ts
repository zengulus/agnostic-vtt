import { expect, test } from '@playwright/test';
import { openLibrary } from './helpers/workspace.js';

test('handout drafts stay local and shared handouts appear in player view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await openLibrary(page);
  const library = page.locator('.handout-library').first();
  await library.locator('summary').first().click();
  const revision = await page.evaluate(
    async () => (await import('/src/store.ts' as string)).useTable.getState().room.revision,
  );
  const feedback = await library.evaluate(
    (node) =>
      new Promise<number>((resolve) => {
        const button = Array.from(node.querySelectorAll('button')).find(
          (item) => item.textContent === 'New handout',
        )!;
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (node.querySelector('form')) {
            observer.disconnect();
            resolve(performance.now() - start);
          }
        });
        observer.observe(node, { childList: true, subtree: true });
        button.click();
      }),
  );
  expect(feedback).toBeLessThan(400);
  await library.getByLabel('Title').fill('A letter');
  await library.getByLabel('Text', { exact: true }).fill('Meet at dusk');
  await library.getByLabel('GM-only note').fill('A secret');
  expect(
    await page.evaluate(
      async () => (await import('/src/store.ts' as string)).useTable.getState().room.revision,
    ),
  ).toBe(revision);
  await library.getByLabel('Share with players').check();
  await library.getByRole('button', { name: 'Save handout' }).click();
  await expect(library.getByText('A letter')).toBeVisible();
  expect(
    await page.evaluate(
      async () => (await import('/src/store.ts' as string)).useTable.getState().room.revision,
    ),
  ).toBe(revision + 1);
  await page.getByRole('button', { name: 'Play as player', exact: true }).click();
  await openLibrary(page);
  const playerLibrary = page.locator('.handout-library').first();
  if (!(await playerLibrary.evaluate((node) => (node as HTMLDetailsElement).open)))
    await playerLibrary.locator('summary').first().click();
  await playerLibrary.getByText('A letter').click();
  await expect(playerLibrary.getByText('Meet at dusk')).toBeVisible();
  await expect(playerLibrary.getByText('A secret')).toHaveCount(0);
});

test('quests and recaps are shared through the library with editable status', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await openLibrary(page);
  const library = page.locator('.handout-library').first();
  await library.locator('summary').first().click();
  await library.getByRole('button', { name: 'New quest' }).click();
  await library.getByLabel('Title').fill('Find the key');
  await library.getByLabel('Text', { exact: true }).fill('Search the tower.');
  await library.getByLabel('Status').selectOption('completed');
  await library.getByLabel('Share with players').check();
  await library.getByRole('button', { name: 'Save handout' }).click();
  await expect(library.getByText('Find the key · completed')).toBeVisible();
  await library.getByRole('button', { name: 'New recap' }).click();
  await library.getByLabel('Title').fill('Last session');
  await library.getByLabel('Text', { exact: true }).fill('The party arrived.');
  await library.getByLabel('Share with players').check();
  await library.getByRole('button', { name: 'Save handout' }).click();
  await library.getByLabel('Handout category').selectOption('quest');
  await expect(library.getByText('Last session')).toHaveCount(0);
  await expect(library.getByText('Find the key · completed')).toBeVisible();
});
