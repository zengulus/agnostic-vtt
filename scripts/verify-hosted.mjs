import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { sampleScene } from '../shared/sample.ts';

// Exercise the compiled Pages frontend against mocked service boundaries.
// No cloud credentials or running game server are needed.
const output = await mkdtemp(join(tmpdir(), 'aether-hosted-'));
const address = 'http://127.0.0.1:4174/agnostic-vtt/';
const service = 'https://render.example.test';
const auth = 'https://supabase.example.test';
const screenshots = resolve('test-results/hosted-entry');
let preview, browser;
try {
  const build = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'build', '--outDir', output, '--emptyOutDir'],
    {
      env: {
        ...process.env,
        VITE_BASE_PATH: '/agnostic-vtt/',
        VITE_SERVER_URL: service,
        VITE_SUPABASE_URL: auth,
        VITE_SUPABASE_ANON_KEY: 'test-public-key',
      },
      stdio: 'inherit',
    },
  );
  await new Promise((resolve, reject) => {
    build.on('error', reject);
    build.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Hosted test build failed.')),
    );
  });
  preview = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--outDir',
      output,
      '--host',
      '127.0.0.1',
      '--port',
      '4174',
      '--strictPort',
    ],
    { env: { ...process.env, VITE_BASE_PATH: '/agnostic-vtt/' }, stdio: 'ignore' },
  );
  let ready = false;
  for (let n = 0; n < 80; n++) {
    try {
      ready = (await fetch(address)).ok;
    } catch {}
    if (ready) break;
    if (preview.exitCode !== null) throw new Error('Hosted preview failed to start.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Hosted preview did not become ready.');
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ['--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const requests = [],
    joins = [],
    errors = [];
  let listFails = false;
  const user = {
    id: 'test-account',
    email: 'player@example.test',
    user_metadata: { name: 'Rowan' },
    app_metadata: { provider: 'email' },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
  const campaigns = [
    { id: 'owned-campaign', name: 'The Silver Wood', role: 'gm' },
    { id: 'joined-campaign', name: 'The Lantern Road', role: 'player' },
  ];
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin === new URL(address).origin) return route.continue();
    requests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body: request.postDataJSON(),
    });
    if (url.origin === auth) {
      if (url.pathname === '/auth/v1/token') {
        if (request.postDataJSON()?.password === 'wrong-password')
          return route.fulfill({
            status: 400,
            json: { error: 'invalid_grant', error_description: 'Invalid login credentials' },
          });
        return route.fulfill({
          json: {
            access_token: token,
            refresh_token: 'test-refresh-token',
            expires_in: 3600,
            token_type: 'bearer',
            user,
          },
        });
      }
      if (url.pathname === '/auth/v1/signup') {
        expect(url.searchParams.get('redirect_to')).toBe(
          `${address}?room=invited-campaign&invite=secret-invite`,
        );
        return route.fulfill({ json: { user, session: null } });
      }
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
    }
    if (url.origin === service && url.pathname === '/api/campaigns') {
      expect(request.headers().authorization).toBe(`Bearer ${token}`);
      if (request.method() === 'GET')
        return route.fulfill({
          status: listFails ? 503 : 200,
          json: listFails ? { error: 'Campaign list is unavailable.' } : campaigns,
        });
      if (request.method() === 'POST')
        return route.fulfill({
          status: 201,
          json: { id: 'new-campaign', inviteCode: 'new-invite' },
        });
    }
    errors.push(`Unexpected request ${request.method()} ${request.url()}`);
    return route.abort();
  });
  await page.routeWebSocket('wss://render.example.test/ws', (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type !== 'JOIN_ROOM') return;
      expect(message.token).toBe(token);
      joins.push(message);
      const campaign = campaigns.find((c) => c.id === message.roomId);
      const canGM = campaign?.role === 'gm' || message.roomId === 'new-campaign';
      const self = {
        id: user.id,
        name: 'Rowan',
        role: canGM && message.role !== 'player' ? 'gm' : 'player',
        color: '#bca16b',
      };
      socket.send(
        JSON.stringify({
          v: 2,
          type: 'ROOM_SNAPSHOT',
          state: {
            version: 1,
            id: message.roomId,
            name: campaign?.name || 'A new campaign',
            revision: 0,
            activeSceneId: 'hollow',
            scenes: { hollow: sampleScene() },
            rolls: [],
            chat: [],
            savedAt: null,
          },
          self,
          canGM,
          presence: [self],
          inviteCode: canGM ? 'party-invite' : undefined,
        }),
      );
    });
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await mkdir(screenshots, { recursive: true });
  await page.goto(address, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeEnabled();
  await page.screenshot({ path: join(screenshots, 'welcome.png') });
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Open a demo table' }).click();
  await expect(page.getByText('Demo', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  expect(joins).toHaveLength(0);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(user.email);
  await dialog.getByLabel('Password', { exact: true }).fill('wrong-password');
  await dialog.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Invalid login credentials');
  await page.screenshot({ path: join(screenshots, 'login.png') });
  await dialog.getByLabel('Password', { exact: true }).fill('correct-password');
  listFails = true;
  await dialog.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Campaign list is unavailable');
  listFails = false;
  await dialog.getByRole('button', { name: 'Retry campaigns' }).click();
  await expect(dialog.getByRole('button', { name: /The Silver Wood/ })).toBeVisible();
  expect(
    requests.filter((r) => r.url === `${service}/api/campaigns` && r.method === 'POST'),
  ).toHaveLength(0);
  await page.screenshot({ path: join(screenshots, 'campaigns.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(screenshots, 'mobile-campaigns.png') });
  await page.setViewportSize({ width: 1440, height: 960 });
  await dialog.getByLabel('Enter table as').selectOption('player');
  await dialog.getByRole('button', { name: /The Silver Wood/ }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  expect(joins.at(-1)).toMatchObject({ roomId: 'owned-campaign', role: 'player' });
  await expect(page.getByRole('button', { name: 'Return to GM' })).toBeVisible();
  await page.getByRole('button', { name: 'Open another campaign' }).click();
  await dialog.getByRole('button', { name: /The Lantern Road/ }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  expect(joins.at(-1)).toMatchObject({ roomId: 'joined-campaign', role: 'player' });
  await expect(page.getByRole('button', { name: 'Return to GM' })).toHaveCount(0);
  await page.reload();
  await expect(dialog.getByRole('button', { name: /The Lantern Road/ })).toBeVisible();
  await expect(dialog.getByLabel('Password')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Join your party', exact: true }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open another campaign' }).click();
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(dialog.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to GM' })).toHaveCount(0);
  await page.goto(`${address}?room=invited-campaign&invite=secret-invite`);
  await dialog.getByRole('button', { name: 'Create an account', exact: true }).click();
  await dialog.getByLabel('Email', { exact: true }).fill(user.email);
  await dialog.getByLabel('Password', { exact: true }).fill('correct-password');
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Check your email');
  await dialog
    .getByRole('button', { name: 'Already have an account? Log in', exact: true })
    .click();
  await dialog.getByLabel('Email', { exact: true }).fill(user.email);
  await dialog.getByLabel('Password', { exact: true }).fill('correct-password');
  await dialog.getByRole('button', { name: 'Log in', exact: true }).click();
  await dialog.getByRole('button', { name: 'Join your party', exact: true }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  expect(joins.at(-1)).toMatchObject({ roomId: 'invited-campaign', inviteCode: 'secret-invite' });
  await page.getByRole('button', { name: 'Open another campaign' }).click();
  await dialog.getByRole('button', { name: 'Create a campaign', exact: true }).click();
  await dialog.getByLabel('Campaign name').fill('A new campaign');
  await dialog.getByRole('button', { name: 'Create campaign', exact: true }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  expect(
    requests.filter((r) => r.url === `${service}/api/campaigns` && r.method === 'POST'),
  ).toHaveLength(1);
  await expect.poll(() => joins.at(-1)?.roomId).toBe('new-campaign');
  await expect(page.locator('.campaign-title')).toContainText('A new campaign');
  expect(errors).toEqual([]);
  console.log(
    'Hosted Pages entry passed: independent demo, login errors, campaign listing/retry, GM as player, player access, restored login, sign out and explicit campaign creation. Services were mocked.',
  );
} finally {
  if (browser) await browser.close();
  preview?.kill('SIGTERM');
  await rm(output, { recursive: true, force: true });
}
