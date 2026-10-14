import { expect, test } from '@playwright/test';

type PendingRequest = {
  pending: boolean;
  finish: (reject: boolean) => void;
};

for (const stage of ['guest', 'campaigns']) {
  for (const cancellation of ['Close dialog', 'Escape', 'Demo', 'Back']) {
    for (const reject of [false, true]) {
      test(`${stage} completion after ${cancellation} ${reject ? 'failure' : 'success'} leaves screen and history unchanged`, async ({
        page,
      }) => {
        await page.addInitScript((stage) => {
          const original = window.fetch;
          const pending: PendingRequest = { pending: false, finish: () => {} };
          Object.assign(window, { pendingLaunchRequest: pending });
          window.fetch = (input, init) => {
            const path =
              typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
            if (stage === 'campaigns' && path.endsWith('/api/guest') && init?.method === 'POST') {
              return Promise.resolve(
                new Response(
                  JSON.stringify({
                    id: 'test-user',
                    name: 'Tester',
                    token: 'test-token',
                  }),
                ),
              );
            }
            if (path.endsWith(`/api/${stage}`) && init?.method === 'POST') {
              pending.pending = true;
              // Deliberately ignore AbortSignal to exercise a late underlying completion.
              return new Promise<Response>((resolve, fail) => {
                pending.finish = (reject) => {
                  if (reject) fail(new Error('Late network failure'));
                  else
                    resolve(
                      new Response(
                        JSON.stringify(
                          stage === 'guest'
                            ? { id: 'stale-user', name: 'Stale', token: 'stale-token' }
                            : { id: 'stale-campaign', inviteCode: 'stale-invite' },
                        ),
                      ),
                    );
                };
              });
            }
            return original(input, init);
          };
        }, stage);
        const sockets: string[] = [];
        const errors: string[] = [];
        page.on('websocket', (socket) => {
          if (socket.url().endsWith('/ws')) sockets.push(socket.url());
        });
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto('/');
        await page.getByRole('button', { name: 'Log in', exact: true }).click();
        await page.getByRole('button', { name: 'Demo', exact: true }).click();
        await page.getByRole('button', { name: 'Log in', exact: true }).click();
        if (cancellation === 'Back') {
          await page.evaluate(() => history.pushState({}, '', '?launch=pending'));
        }
        await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as unknown as { pendingLaunchRequest: PendingRequest }).pendingLaunchRequest
                  .pending,
            ),
          )
          .toBe(true);
        if (cancellation === 'Escape') await page.keyboard.press('Escape');
        else if (cancellation === 'Back') {
          await page.goBack();
          await expect(page).toHaveURL('http://localhost:5173/');
        } else await page.getByRole('button', { name: cancellation, exact: true }).click();
        if (cancellation !== 'Back') await expect(page.getByRole('dialog')).toHaveCount(0);
        const before = await page.evaluate(() => ({
          url: location.href,
          length: history.length,
          screen: document.querySelector('.app')!.textContent,
          guest: localStorage.getItem('aether-guest'),
        }));
        await page.evaluate(async (reject) => {
          (
            window as unknown as { pendingLaunchRequest: PendingRequest }
          ).pendingLaunchRequest.finish(reject);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        }, reject);
        const after = await page.evaluate(() => ({
          url: location.href,
          length: history.length,
          screen: document.querySelector('.app')!.textContent,
          guest: localStorage.getItem('aether-guest'),
        }));
        // The still-open Back dialog can finish its local busy state, but not navigate or reconnect.
        if (cancellation === 'Back') {
          expect(after.url).toBe(before.url);
          expect(after.length).toBe(before.length);
          expect(after.guest).toBe(before.guest);
          await expect(page.getByRole('dialog')).toBeVisible();
          await expect(page.getByRole('alert')).toHaveCount(0);
        } else expect(after).toEqual(before);
        expect(sockets).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  }
}
