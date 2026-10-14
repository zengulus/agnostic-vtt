import { expect, test } from '@playwright/test';
import { pausePresentationClock } from './helpers/clock.js';

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
  await pausePresentationClock(page);
  const expression = page.getByRole('textbox', { name: 'DICE EXPRESSION' });
  await expression.fill('1d20');
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  await expect(page.getByTestId('roll-total')).toBeVisible();
  // The roll button has a separate 900ms repeat-click guard. Release it without
  // consuming the first presentation's complete 2800ms display interval.
  await page.clock.runFor(900);
  await expect(page.getByRole('button', { name: 'Roll the dice' })).toBeEnabled();
  await expression.fill('1d4+100');
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  await expect(page.locator('.history-card')).toHaveCount(2);
  await expect(page.locator('.roll-topline strong')).toContainText('rolls 1d20');
  await page.clock.runFor(1899);
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
