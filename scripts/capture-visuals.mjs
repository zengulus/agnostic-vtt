import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.env.VITE_BASE_PATH || '/agnostic-vtt/';
const output = resolve(process.env.SCREENSHOT_DIR || 'test-results/visual-review');
const address = `http://127.0.0.1:4175${base}`;
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4175',
    '--strictPort',
  ],
  { env: { ...process.env, VITE_BASE_PATH: base }, stdio: 'ignore' },
);
const sizes = [
  ['desktop', 1440, 960],
  ['laptop', 1280, 800],
  ['tablet', 1024, 768],
  ['tablet-portrait', 768, 1024],
  ['mobile', 390, 844],
  ['compact', 360, 740],
];
const report = { screenshots: [], errors: [] };
let browser;
try {
  await mkdir(output, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      ready = (await fetch(address)).ok;
    } catch {}
    if (ready) break;
    if (server.exitCode !== null) throw new Error('Static preview failed to start on port 4175.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Static preview did not start.');
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ['--enable-unsafe-swiftshader'],
  });
  for (const [name, width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => report.errors.push({ size: name, error: error.message }));
    page.on('websocket', () => report.errors.push({ size: name, error: 'Unexpected WebSocket' }));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(address).origin || url.pathname.startsWith('/api/')) {
        report.errors.push({
          size: name,
          error: `Unexpected request: ${url.origin}${url.pathname}`,
        });
        return route.abort();
      }
      return route.continue();
    });
    await page.addInitScript(() =>
      localStorage.setItem('aether-settings', JSON.stringify({ reducedMotion: true })),
    );
    await page.goto(address, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    async function capture(state) {
      await page.mouse.move(0, 0);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const file = `${name}-${state}.png`;
      await page.screenshot({ path: resolve(output, file), animations: 'disabled' });
      const layout = await page.evaluate(() => {
        const selectors = [
          '.app-header',
          '.brand',
          '.campaign-title',
          '.header-actions',
          '.table-welcome',
          '.modal',
          '.dice-workbench',
          '.tool-rail',
        ];
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          emptyMessageClipped: (() => {
            const text = document.querySelector('.empty-chronicle p');
            const panel = document.querySelector('.activity-panel');
            if (!text?.getClientRects().length || !panel?.getClientRects().length) return false;
            return text.getBoundingClientRect().bottom > panel.getBoundingClientRect().bottom + 1;
          })(),
          boxes: selectors.flatMap((selector) => {
            const el = document.querySelector(selector);
            if (!el || !el.getClientRects().length) return [];
            const r = el.getBoundingClientRect();
            return [
              {
                selector,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                clipped:
                  r.x < -1 || r.right > innerWidth + 1 || r.y < -1 || r.bottom > innerHeight + 1,
              },
            ];
          }),
        };
      });
      report.screenshots.push({ file, size: name, state, width, height, ...layout });
      await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
      console.log(
        `${file}: ${
          layout.boxes
            .filter((box) => box.clipped)
            .map((box) => box.selector)
            .join(', ') || 'fits viewport'
        }`,
      );
    }
    await capture('welcome');
    await page.getByRole('button', { name: 'Open a demo table' }).click();
    await capture('gm');
    if (['desktop', 'tablet', 'mobile'].includes(name)) {
      await page.getByRole('button', { name: 'Macros · import .txt' }).click();
      await capture('macros');
      if (name === 'desktop') {
        await page
          .getByLabel('Macro definitions')
          .fill('[Longsword]([Attack(1d20 + 4)],[Damage(1d8 + 2)])');
        await page.getByRole('button', { name: 'Import 1 macro', exact: true }).click();
        await page.getByRole('button', { name: 'Prepare Longsword', exact: true }).click();
        await capture('macro-ready');
        await page.getByRole('button', { name: 'Roll macro', exact: true }).click();
        await expect(page.locator('.roll-overlay .macro-results')).toBeVisible();
        await capture('macro-roll');
        await page.getByRole('button', { name: 'Dismiss roll' }).click();
        await capture('macro-history');
        await page.getByRole('button', { name: 'Macros · import .txt' }).click();
      }
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await capture('settings');
      await page.getByRole('button', { name: 'Done' }).scrollIntoViewIfNeeded();
      await capture('settings-bottom');
      await page.getByRole('dialog').evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await page.getByRole('button', { name: 'Roll the dice' }).click();
      await expect(page.getByTestId('roll-total')).toBeVisible();
      await capture('roll');
      await page.getByRole('button', { name: 'Dismiss roll' }).click();
    }
    if (name === 'desktop') {
      for (const [state, label] of [
        ['scene', 'Map settings'],
        ['character', 'Add token'],
        ['library', 'Saved token library'],
        ['images', 'Images'],
        ['guide', 'Tabletop guide'],
      ]) {
        await page.getByRole('button', { name: label, exact: true }).click();
        await capture(state);
        await page.getByRole('button', { name: 'Close dialog' }).click();
      }
      for (const label of ['Party chat', 'Turns']) {
        await page.getByRole('button', { name: label, exact: true }).click();
        await capture(label === 'Turns' ? 'turns' : 'chat');
      }
      await page.getByRole('button', { name: 'Chronicle', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Character sheets', exact: true }).click();
    await capture('character-empty');
    await page.getByRole('button', { name: 'Import character text', exact: true }).click();
    await page.getByRole('button', { name: 'Use example character', exact: true }).click();
    await expect(page.locator('.character-import-preview')).toContainText('3 abilities');
    await capture('character-import');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Import character', exact: true })
      .click();
    await page.locator('.activity-panel').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.locator('.library').evaluateAll((els) =>
      els.forEach((el) => {
        el.scrollTop = 0;
      }),
    );
    await capture('character-sheet');
    await page.getByRole('button', { name: 'Use Sweeping Strike', exact: true }).click();
    await expect(page.locator('.sheet-last-action')).toContainText('Attack Roll');
    if (width > 620) await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('.sheet-last-action').scrollIntoViewIfNeeded();
    await capture('character-action');
    await page.getByRole('button', { name: 'Play as player' }).click();
    await capture('player');
    await context.close();
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  const sections = sizes
    .map(
      ([name, width, height]) =>
        `<section id="${name}"><h2>${name} <small>${width} × ${height}</small></h2><div class="shots">${report.screenshots
          .filter((shot) => shot.size === name)
          .map(
            (shot) =>
              `<a href="${shot.file}"><img src="${shot.file}" alt="${name} ${shot.state}" loading="lazy"><span>${shot.state.replaceAll('-', ' ')}</span></a>`,
          )
          .join('')}</div></section>`,
    )
    .join('');
  await writeFile(
    resolve(output, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aether Table · Visual review</title><style>
    *{box-sizing:border-box}body{margin:0;padding:40px;background:#28231c;color:#e1dccb;font:15px/1.6 system-ui,sans-serif}h1{font:42px Georgia,serif;margin:0 0 12px}p{color:#b5a88c}nav{display:flex;gap:16px;flex-wrap:wrap;margin:26px 0}a{color:#dfc78f;text-decoration:none}h2{text-transform:capitalize;font-size:22px;font-weight:500}small{font-size:14px;color:#a8b69f;margin-left:12px}.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}.shots a{display:flex;flex-direction:column;border:1px solid #695941;background:#342c23;border-radius:8px;overflow:hidden}.shots img{width:100%;height:270px;object-fit:contain;background:#221c16}.shots span{padding:12px 16px;text-transform:capitalize}section{margin-bottom:48px}@media(max-width:600px){body{padding:20px}h1{font-size:30px}}
    </style></head><body><h1>Aether Table · Visual review</h1><p>${report.screenshots.length} screenshots from headless Chromium, across six viewport sizes. Click an image for full resolution.</p><nav>${sizes.map(([name]) => `<a href="#${name}">${name}</a>`).join('')}<a href="report.json">Layout report</a></nav>${sections}</body></html>`,
  );
  console.log(
    `Saved ${report.screenshots.length} screenshots to ${output}; ${report.errors.length} browser/network errors.`,
  );
  if (report.errors.length) throw new Error('Browser review reported errors; see report.json.');
  if (
    report.screenshots.some(
      (shot) =>
        shot.emptyMessageClipped ||
        shot.documentWidth > shot.viewportWidth ||
        shot.boxes.some((box) => box.clipped),
    )
  )
    throw new Error('Some reviewed panels extend beyond the viewport; see report.json.');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
