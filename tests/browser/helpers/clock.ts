import type { Page } from '@playwright/test';

/** Pause an installed clock after setup, before triggering a timed presentation. */
export async function pausePresentationClock(page: Page) {
  const time = await page.evaluate(() => Date.now());
  // Freeze wall time first: a target computed in another browser round trip can
  // already be in the past by the time pauseAt arrives on a busy CI runner.
  await page.clock.setFixedTime(time);
  await page.clock.pauseAt(time);
  // Keep Date and timer progression aligned when runFor/resume is used later.
  // setSystemTime changes wall time without firing timers or resuming the clock.
  await page.clock.setSystemTime(time);
}
