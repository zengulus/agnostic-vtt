import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

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
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(address) && response.status() >= 400) {
      errors.push(`Local asset HTTP ${response.status()}`);
    }
  });
  await page.goto(address, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'A place for extraordinary stories.' }).waitFor();
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
  await page.getByRole('button', { name: 'Macros · import .txt' }).click();
  const example = await page
    .getByRole('link', { name: 'Download example macro.txt ↗' })
    .getAttribute('href');
  if (example !== `${base}examples/macro.txt`)
    throw new Error('Macro example link does not use the repository subpath.');
  const exampleResponse = await fetch(new URL(example, address));
  if (!exampleResponse.ok || !(await exampleResponse.text()).includes('[Restoration]'))
    throw new Error('Built macro.txt example is missing.');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    `Static production smoke check passed at ${base}; map assets, macro.txt example and UI loaded.`,
  );
} finally {
  if (browser) await browser.close();
  preview.kill('SIGTERM');
}
