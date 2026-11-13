import { expect, test } from '@playwright/test';
import { openLibrary } from './helpers/workspace.js';

test('creates a clock and weighted table and shows immediate feedback', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await openLibrary(page);
  const tools = page.locator('.table-tools');
  await tools.locator('summary').click();
  await tools.getByLabel('Table tool name').fill('Guards');
  await tools.getByRole('button', { name: 'Create' }).click();
  await expect(tools.getByLabel('0 of 4 segments')).toBeVisible();
  const feedback = await tools.evaluate(
    (node) =>
      new Promise<number>((resolve) => {
        const button = node.querySelector<HTMLButtonElement>('[aria-label="Increase Guards"]')!;
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (
            node.querySelector('[aria-label="1 of 4 segments"]') ||
            node.querySelector('[role="status"]')
          ) {
            observer.disconnect();
            resolve(performance.now() - start);
          }
        });
        observer.observe(node, { childList: true, subtree: true, attributes: true });
        button.click();
      }),
  );
  expect(feedback).toBeLessThan(400);
  await expect(tools.getByLabel('1 of 4 segments')).toBeVisible();
  await tools.getByLabel('New table tool').selectOption('table');
  await tools.getByLabel('Table tool name').fill('Rumours');
  await tools.getByLabel('Entries, one per line').fill('3 | Dragon nearby');
  await tools.getByRole('button', { name: 'Create' }).click();
  await tools.getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Table result' })).toContainText('Dragon nearby');
});

test('mobile library exposes table tools and shows table results over the library', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Toggle library' }).click();
  const library = page.getByRole('dialog', { name: 'Character library' });
  const tools = library.locator('.table-tools');
  await tools.locator('summary').click();
  await expect(library.locator('.handout-library').locator('summary').first()).toBeVisible();
  await tools.getByLabel('New table tool').selectOption('table');
  await tools.getByLabel('Table tool name').fill('Weather');
  await tools.getByLabel('Entries, one per line').fill('Rain');
  await tools.getByRole('button', { name: 'Create' }).click();
  await tools.getByRole('button', { name: 'Roll', exact: true }).click();
  const result = page.getByRole('dialog', { name: 'Table result' });
  await expect(result).toContainText('Rain');
  await result.getByRole('button', { name: 'Dismiss' }).click();
  await tools.getByRole('button', { name: 'Edit Weather' }).click();
  await tools.getByLabel('Entries, one per line').fill('Clear skies');
  await tools.getByRole('button', { name: 'Save changes' }).click();
  await tools.getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(result).toContainText('Clear skies');
});

test('queues presentations in arrival order and ignores stale attention', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.evaluate(async () => {
    const store = await import('/src/store.ts' as string);
    store.enqueueTablePresentation({ kind: 'table', name: 'First', result: 'One' });
    store.enqueueTablePresentation({
      kind: 'handout',
      handout: { id: 'h', title: 'Second', text: 'Two', imageUrl: '', gmNote: '', shared: true },
    });
    store.useTable
      .getState()
      .set({ attention: { sceneId: 'missing-scene', position: { x: 100, y: 100 }, name: 'GM' } });
  });
  const result = page.getByRole('dialog', { name: 'Table result' });
  await expect(result).toContainText('One');
  await result.getByRole('button', { name: 'Dismiss' }).click();
  const handout = page.getByRole('dialog', { name: 'Presented handout' });
  await expect(handout).toContainText('Two');
  await handout.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Go there' }).click();
  await expect(page.getByRole('button', { name: 'Go there' })).toHaveCount(0);
  await expect(page.locator('.tabletop')).toBeVisible();
});
