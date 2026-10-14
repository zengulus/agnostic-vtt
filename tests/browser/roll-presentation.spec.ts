import { expect, test } from '@playwright/test';

test('minimal totals advance queued rolls only after their full display interval', async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() =>
    localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a demo table' }).click();
  await expect(page.getByText('Demo', { exact: true })).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const expression = page.getByRole('textbox', { name: 'DICE EXPRESSION' });
  await expression.fill('1d20');
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  await expect(page.getByTestId('roll-total')).toBeVisible();
  await expression.fill('1d4+100');
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  await expect(page.locator('.history-card')).toHaveCount(2);
  await expect(page.locator('.roll-topline strong')).toContainText('rolls 1d20');
  await page.clock.runFor(2799);
  await expect(page.locator('.roll-topline strong')).toContainText('rolls 1d20');
  await page.clock.runFor(1);
  await expect(page.locator('.roll-topline strong')).toContainText('rolls 1d4+100');
  await expect(page.getByTestId('roll-total').locator('strong')).toHaveText(/^10[1-4]$/);
  await page.clock.runFor(2799);
  await expect(page.getByTestId('roll-total')).toBeVisible();
  await page.clock.runFor(1);
  await expect(page.locator('.roll-overlay')).toHaveCount(0);
  await expect(page.locator('.history-card')).toHaveCount(2);
});
