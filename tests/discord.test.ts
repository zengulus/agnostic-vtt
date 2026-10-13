import { describe, expect, it, vi } from 'vitest';
import { DiscordDelivery, discordPayload, normalizeWebhook } from '../server/discord.js';
import { evaluateMacro, parseMacro } from '../shared/macros.js';
import type { Roll } from '../shared/model.js';
const endpoint =
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_123456';
const roll = (id = 'roll-one'): Roll => ({
  id,
  actionId: 'action',
  userId: 'user',
  userName: '@everyone **Mage**',
  expression: '1d20 + 5',
  terms: [
    { kind: 'dice', sign: 1, sides: 20, values: [14], subtotal: 14, label: '1d20' },
    { kind: 'modifier', sign: 1, values: [5], subtotal: 5, label: '+5' },
  ],
  total: 19,
  visibility: 'public',
  createdAt: '2026-10-14T00:00:00.000Z',
});
const success = () => new Response(JSON.stringify({ id: 'message' }), { status: 200 });
describe('Discord webhook delivery', () => {
  it('normalizes Discord endpoints and preserves forum thread IDs', () => {
    expect(normalizeWebhook(endpoint.replace('discord.com', 'discordapp.com'))).toBe(
      endpoint.replace('/api/', '/api/v10/'),
    );
    expect(normalizeWebhook(`${endpoint}?thread_id=123456789012345678`)).toContain('thread_id=');
  });
  it.each([
    'http://127.0.0.1/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',
    endpoint.replace('discord.com', 'discord.com.evil.test'),
    endpoint.replace('discord.com', 'localhost'),
    endpoint.replace('https://', 'http://'),
    endpoint.replace('discord.com', 'user:pass@discord.com'),
    `${endpoint}?url=http://localhost`,
    `${endpoint}#secret`,
    endpoint.replace('/webhooks/', '/users/'),
    endpoint.replace('discord.com', 'discord.com:8080'),
  ])('rejects unsafe execution URL %s', (url) => {
    try {
      normalizeWebhook(url);
      throw new Error('Accepted invalid URL');
    } catch (error) {
      expect((error as Error).message).not.toContain('abcdefghijklmnopqrstuvwxyz');
      expect((error as Error).message).toMatch(/Discord/);
    }
  });
  it('sends one embed with named macro results, prevents mentions, and refuses private rolls', () => {
    const result = evaluateMacro(
      parseMacro('[Attack]([Attack Roll(d20 + X)],[Damage Roll(d6 + [Fire(d6)] + [Akashic(12)])])'),
      { X: 5 },
      () => 4,
    );
    const payload = discordPayload({ ...roll(), macro: result }, 'A @here story');
    expect(payload.allowed_mentions.parse).toEqual([]);
    expect(payload.embeds[0].fields).toEqual([
      { name: 'Attack Roll', value: '9', inline: false },
      { name: 'Damage Roll', value: '4 + 4 Fire damage + 12 Akashic damage = 20', inline: false },
    ]);
    expect(payload.embeds[0].description).not.toContain('@everyone');
    expect(() => discordPayload({ ...roll(), visibility: 'private' }, 'Room')).toThrow('Private');
    expect(discordPayload(roll(), 'Room').embeds[0].fields[0].value).toContain('= 19');
  });
  it('bounds individual and combined embed fields without dropping final totals', () => {
    const macro = evaluateMacro(
      parseMacro(
        `[${'*'.repeat(64)}](${Array.from({ length: 8 }, () => `[${'*'.repeat(64)}([${'*'.repeat(64)}(1)])]`).join(',')})`,
      ),
      {},
      () => 1,
    );
    macro.groups.forEach((group) => {
      group.contributions = Array.from({ length: 40 }, () => ({
        label: '*'.repeat(64),
        terms: [],
        total: 10000,
      }));
      group.total = 400000;
    });
    const embed = discordPayload({ ...roll(), macro }, '*'.repeat(60)).embeds[0];
    expect(
      embed.fields.every((field) => field.value.length <= 1024 && field.value.endsWith('= 400000')),
    ).toBe(true);
    expect(
      embed.title.length +
        embed.description.length +
        embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0),
    ).toBeLessThanOrEqual(6000);
  });
  it('confirms delivery, deduplicates, preserves order, and respects reset headers', async () => {
    const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response('{}', {
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '75' },
          }),
        )
        .mockImplementation(async () => success()),
      delay = vi.fn(async (_ms: number) => {}),
      reports = vi.fn();
    const delivery = new DiscordDelivery(transport, delay, () => 0);
    delivery.enqueue('room', endpoint, roll(), 'Room', reports);
    delivery.enqueue('room', endpoint, roll('roll-two'), 'Room', reports);
    delivery.enqueue('room', endpoint, roll(), 'Room', reports);
    await delivery.idle();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(75000);
    expect(transport.mock.calls[0][0]).toContain('wait=true');
    expect(transport.mock.calls[0][1]?.redirect).toBe('error');
    expect(reports).toHaveBeenCalledWith('sent', 'Sent to Discord.');
    delivery.enqueue('room', endpoint, roll(), 'Room', reports, true);
    await delivery.idle();
    expect(transport).toHaveBeenCalledTimes(2);
    delivery.close();
  });
  it('retains a webhook cooldown when its queue empties between rolls', async () => {
    let now = 0;
    const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response('{}', {
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '75' },
          }),
        )
        .mockImplementation(async () => success()),
      delay = vi.fn(async (ms: number) => {
        now += ms;
      }),
      delivery = new DiscordDelivery(transport, delay, () => now),
      reports = vi.fn();
    delivery.enqueue('room', endpoint, roll(), 'Room', reports);
    await delivery.idle();
    expect(delay).not.toHaveBeenCalled();
    now = 5000;
    delivery.enqueue('room', endpoint, roll('later'), 'Room', reports);
    await delivery.idle();
    expect(delay).toHaveBeenCalledWith(70000);
    expect(transport).toHaveBeenCalledTimes(2);
    delivery.close();
  });
  it('retries rate limits, but does not automatically retry uncertain network failures', async () => {
    const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('{"retry_after":0.2}', { status: 429 }))
        .mockResolvedValueOnce(success())
        .mockRejectedValueOnce(new Error(`Fetch failed: ${endpoint}`))
        .mockResolvedValueOnce(success()),
      delay = vi.fn(async (_ms: number) => {}),
      reports = vi.fn(),
      delivery = new DiscordDelivery(transport, delay);
    delivery.enqueue('room', endpoint, roll(), 'Room', reports);
    await delivery.idle();
    expect(delay).toHaveBeenCalledWith(200);
    delivery.enqueue('room', endpoint, roll('uncertain'), 'Room', reports);
    await delivery.idle();
    expect(transport).toHaveBeenCalledTimes(3);
    expect(reports.mock.calls.at(-1)?.[0]).toBe('failed');
    expect(JSON.stringify(reports.mock.calls)).not.toContain(endpoint);
    delivery.enqueue('room', endpoint, roll('uncertain'), 'Room', reports, true);
    await delivery.idle();
    expect(transport).toHaveBeenCalledTimes(4);
    delivery.close();
  });
  it('bounds queues, stops pending messages on removal, and reports delivery failures', async () => {
    let release!: (response: Response) => void;
    const transport = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(
          async () =>
            new Promise<Response>((resolve) => {
              release = resolve;
            }),
        )
        .mockImplementation(async () => success()),
      reports = vi.fn(),
      delivery = new DiscordDelivery(transport, async () => {});
    for (let i = 0; i < 50; i++)
      delivery.enqueue('room', endpoint, roll(`roll-${i}`), 'Room', reports);
    expect(() => delivery.enqueue('room', endpoint, roll('overflow'), 'Room', reports)).toThrow(
      'full',
    );
    delivery.cancelRoom('room');
    release(success());
    await delivery.idle();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(reports.mock.calls.filter(([status]) => status === 'failed')).toHaveLength(49);
    delivery.close();
  });
  it('limits repeated 429s and rejects a revoked webhook without losing its result', async () => {
    const transport = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response('{"retry_after":0.1}', { status: 429 })),
      reports = vi.fn(),
      delivery = new DiscordDelivery(transport, async () => {});
    delivery.enqueue('room', endpoint, roll(), 'Room', reports);
    await delivery.idle();
    expect(transport).toHaveBeenCalledTimes(3);
    expect(reports.mock.calls.at(-1)?.[0]).toBe('failed');
    transport.mockImplementation(
      async () => new Response('token must not be disclosed', { status: 404 }),
    );
    delivery.enqueue('room', endpoint, roll('revoked'), 'Room', reports);
    await delivery.idle();
    expect(reports.mock.calls.at(-1)?.[1]).toContain('HTTP 404');
    delivery.close();
  });
});
