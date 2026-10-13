import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';

// Smoke-check a built static site under the same subpath contract as GitHub Pages.
const base = process.env.VITE_BASE_PATH || '/agnostic-vtt/';
const preview = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
  ],
  { env: { ...process.env, VITE_BASE_PATH: base }, stdio: 'ignore' },
);
let browser;
try {
  const address = `http://127.0.0.1:4173${base}`;
  let ready = false;
  for (let n = 0; n < 80; n++) {
    try {
      ready = (await fetch(address)).ok;
    } catch {
      // The preview process is still starting.
    }
    if (ready) break;
    if (preview.exitCode !== null) throw new Error('Preview could not start. Is port 4173 in use?');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Built site did not become ready.');
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  await page.addInitScript(() =>
    localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(address).origin || url.pathname.startsWith('/api/')) {
      errors.push(`Unexpected demo network request: ${url.origin}${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  page.on('websocket', () => errors.push('Demo opened a WebSocket'));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(address) && response.status() >= 400) {
      errors.push(`Local asset HTTP ${response.status()}`);
    }
  });
  await page.goto(address, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'The next chapter.' }).waitFor();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.scene-thumb img')];
    return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
  const urls = await page
    .locator('.scene-thumb img')
    .evaluateAll((images) =>
      images.map((image) => ({ url: image.src, loaded: image.complete && image.naturalWidth > 0 })),
    );
  if (!urls.every((image) => image.loaded && image.url.startsWith(`${address}assets/`))) {
    throw new Error('Built sample assets did not load from the repository subpath.');
  }
  await page.screenshot({ path: '/tmp/aether-demo-welcome.png' });
  await page.getByRole('button', { name: 'Open a demo table' }).click();
  await expect(page.getByText('Demo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cover scene with fog', exact: true }).click();
  await page.getByRole('button', { name: 'Play as player', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fog reveal / conceal', exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('.scene-meta')).toContainText('0 tokens');
  await page.getByRole('button', { name: 'Return to GM', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Cover scene with fog', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Roll the dice' }).click();
  await expect(page.getByTestId('roll-total')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss roll', exact: true }).click();
  await page.getByRole('button', { name: 'Party chat', exact: true }).click();
  await page.getByLabel('Message your party').fill('No cloud needed.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.chat-messages')).toContainText('No cloud needed.');
  await page.getByRole('button', { name: 'Macros · import .txt' }).click();
  const example = await page
    .getByRole('link', { name: 'Download example macro.txt ↗' })
    .getAttribute('href');
  if (example !== `${base}examples/macro.txt`)
    throw new Error('Macro example link does not use the repository subpath.');
  const exampleResponse = await fetch(new URL(example, address));
  if (!exampleResponse.ok || !(await exampleResponse.text()).includes('[Restoration]'))
    throw new Error('Built macro.txt example is missing.');
  await page
    .getByLabel('Macro definitions', { exact: true })
    .fill('[Offline check]([Check(1d20 + 5)])');
  await page.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare Offline check', exact: true }).click();
  await page.getByRole('button', { name: 'Roll macro', exact: true }).click();
  await expect(page.locator('.roll-overlay .macro-results')).toContainText('Check:');
  await page.getByRole('button', { name: 'Dismiss roll', exact: true }).click();
  await page.screenshot({ path: '/tmp/aether-offline-demo.png' });
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.getByRole('button', { name: 'Chronicle', exact: true }).click();
  await expect(page.locator('.history-card')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Try the player demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Return to GM', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fog reveal / conceal', exact: true })).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/aether-demo-mobile.png' });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('Demo overflows the mobile viewport.');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    `Static production smoke check passed at ${base}; demo roles, fog, undo, dice, chat, macros, reset and subpath assets work without cloud requests.`,
  );
} finally {
  if (browser) await browser.close();
  preview.kill('SIGTERM');
}
