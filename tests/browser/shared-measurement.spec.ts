import { expect, test } from '@playwright/test';

test('completed shared measurements leave campaign revision unchanged', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  const revision = await page.evaluate(async () => {
    const table = (await import('/src/store.ts' as string)).useTable;
    table.getState().set({ tool: 'measure' });
    return table.getState().room.revision;
  });
  await page.getByLabel('Share completed measurements').check();
  const canvas = page.locator('.tabletop canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 250);
  await page.mouse.up();
  expect(
    await page.evaluate(
      async () => (await import('/src/store.ts' as string)).useTable.getState().room.revision,
    ),
  ).toBe(revision);
});
