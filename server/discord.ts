import type { Roll } from '../shared/model.js';
import { formatMacroGroup } from '../shared/macros.js';
export type DeliveryStatus = 'queued' | 'sent' | 'failed';
export type DeliveryReport = (status: DeliveryStatus, message: string) => void;

/** A webhook is a credential. Only Discord's HTTPS execution endpoints are accepted. */
export function normalizeWebhook(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a Discord webhook URL.');
  }
  if (
    url.protocol !== 'https:' ||
    !['discord.com', 'discordapp.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !/^\/api\/(?:v10\/)?webhooks\/\d{17,20}\/[A-Za-z0-9_-]{20,200}$/.test(url.pathname) ||
    [...url.searchParams].some(([key, value]) => key !== 'thread_id' || !/^\d{17,20}$/.test(value))
  )
    throw new Error('Use a Discord HTTPS webhook URL, optionally with a thread_id.');
  url.hostname = 'discord.com';
  url.pathname = url.pathname.replace(/^\/api\/(?:v10\/)?/, '/api/v10/');
  return url.toString();
}
const escapeMarkdown = (text: string) =>
  text.replace(/[\\*_`~|<>]/g, '\\$&').replace(/@/g, '@\u200b');
export function discordPayload(roll: Roll, campaign: string) {
  if (roll.visibility !== 'public') throw new Error('Private rolls cannot be sent to Discord.');
  const groups = roll.macro?.groups || [
      { name: 'Roll', total: roll.total, contributions: [], terms: roll.terms },
    ],
    names = groups.map((group) => escapeMarkdown(group.name).slice(0, 128)),
    budget = Math.min(
      1000,
      Math.floor((5500 - names.reduce((sum, name) => sum + name.length, 0)) / groups.length),
    );
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: escapeMarkdown(roll.macro?.name || 'Dice roll').slice(0, 128),
        description: `${escapeMarkdown(roll.userName)} · ${escapeMarkdown(campaign)}`.slice(0, 256),
        color: 0xd8b46c,
        timestamp: roll.createdAt,
        fields: groups.map((group, index) => {
          const value = roll.macro
              ? formatMacroGroup(group)
              : `${roll.expression}\n${roll.terms.map((t) => `${t.sign < 0 ? '−' : '+'}${t.values.join(' + ')}`).join(' ')} = ${roll.total}`,
            safe = escapeMarkdown(value);
          return {
            name: names[index],
            value: safe.length <= budget ? safe : `${safe.slice(0, budget - 40)}… = ${group.total}`,
            inline: false,
          };
        }),
      },
    ],
  };
}
interface Job {
  key: string;
  roomId: string;
  endpoint: string;
  payload: ReturnType<typeof discordPayload>;
  report: DeliveryReport;
  cancelled?: boolean;
  controller?: AbortController;
}
export class DiscordDelivery {
  private queues = new Map<string, Job[]>();
  private states = new Map<string, DeliveryStatus>();
  private workers = new Set<Promise<void>>();
  private controllers = new Set<AbortController>();
  private cooldowns = new Map<string, number>();
  private pending = 0;
  private closed = false;
  constructor(
    private transport: typeof fetch = fetch,
    private delay = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref();
      }),
    private now = Date.now,
  ) {}
  enqueue(
    roomId: string,
    endpoint: string,
    roll: Roll,
    campaign: string,
    report: DeliveryReport,
    retry = false,
  ) {
    const url = normalizeWebhook(endpoint),
      key = `${roomId}/${roll.id}`,
      previous = this.states.get(key);
    for (const [endpoint, until] of this.cooldowns)
      if (until <= this.now()) this.cooldowns.delete(endpoint);
    if (previous && !(previous === 'failed' && retry)) {
      report(
        previous,
        previous === 'sent'
          ? 'Sent to Discord.'
          : previous === 'failed'
            ? 'Delivery failed. You can retry.'
            : 'Queued for Discord.',
      );
      return;
    }
    if (this.closed || this.pending >= 200 || (this.queues.get(url)?.length || 0) >= 50)
      throw new Error('Discord delivery queue is full. Try again shortly.');
    const job: Job = {
      key,
      roomId,
      endpoint: url,
      payload: discordPayload(roll, campaign),
      report: (status, message) => {
        try {
          report(status, message);
        } catch {
          /* Disconnected peers do not affect delivery. */
        }
      },
    };
    this.states.set(key, 'queued');
    this.pending++;
    job.report('queued', 'Queued for Discord.');
    const queue = this.queues.get(url);
    if (queue) queue.push(job);
    else {
      const jobs = [job];
      this.queues.set(url, jobs);
      const worker = this.run(url, jobs);
      this.workers.add(worker);
      void worker.finally(() => this.workers.delete(worker));
    }
    while (this.states.size > 1000) {
      const oldest = [...this.states].find(([, status]) => status !== 'queued');
      if (!oldest) break;
      this.states.delete(oldest[0]);
    }
  }
  private async run(endpoint: string, jobs: Job[]) {
    try {
      while (jobs.length && !this.closed) {
        const until = this.cooldowns.get(endpoint) || 0;
        if (until > this.now()) await this.delay(until - this.now());
        this.cooldowns.delete(endpoint);
        if (!jobs.length || this.closed) break;
        const job = jobs[0];
        let sent = false,
          pause = 1000,
          message = 'Discord delivery could not be confirmed. Retrying may duplicate a message.';
        for (let attempt = 0; attempt < 3 && !this.closed && !job.cancelled; attempt++) {
          const controller = new AbortController(),
            timer = setTimeout(() => controller.abort(), 8000);
          timer.unref();
          this.controllers.add(controller);
          job.controller = controller;
          try {
            const url = new URL(job.endpoint);
            url.searchParams.set('wait', 'true');
            const response = await this.transport(url.toString(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(job.payload),
              redirect: 'error',
              signal: controller.signal,
            });
            if (response.status === 429) {
              const data = (await response.json()) as { retry_after?: number },
                seconds = Number(data.retry_after ?? response.headers.get('retry-after'));
              message = 'Discord is rate limiting this webhook. Try again later.';
              if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) break;
              pause = Math.max(100, seconds * 1000);
              if (attempt === 2) break;
              await this.delay(pause);
              continue;
            }
            await response.body?.cancel();
            if (!response.ok) {
              message = `Discord rejected delivery (HTTP ${response.status}). Check the webhook settings.`;
              break;
            }
            sent = true;
            const reset = Number(response.headers.get('x-ratelimit-reset-after'));
            if (
              response.headers.get('x-ratelimit-remaining') === '0' &&
              Number.isFinite(reset) &&
              reset > 0
            )
              pause = Math.max(pause, reset * 1000);
            break;
          } catch {
            break;
          } finally {
            clearTimeout(timer);
            this.controllers.delete(controller);
            delete job.controller;
          }
        }
        this.states.set(job.key, sent ? 'sent' : 'failed');
        job.report(
          sent ? 'sent' : 'failed',
          sent
            ? 'Sent to Discord.'
            : job.cancelled
              ? 'Discord delivery cancelled; you can retry.'
              : message,
        );
        jobs.shift();
        this.pending--;
        this.cooldowns.set(endpoint, this.now() + pause);
        while (this.cooldowns.size > 1000)
          this.cooldowns.delete(this.cooldowns.keys().next().value!);
      }
    } finally {
      this.pending -= jobs.length;
      for (const job of jobs) {
        this.states.set(job.key, 'failed');
        job.report('failed', 'Discord delivery stopped; you can retry.');
      }
      jobs.length = 0;
      this.queues.delete(endpoint);
    }
  }
  async idle() {
    await Promise.all(this.workers);
  }
  cancelRoom(roomId: string) {
    for (const jobs of this.queues.values())
      for (let index = jobs.length - 1; index >= 0; index--) {
        const job = jobs[index];
        if (job.roomId === roomId) {
          job.cancelled = true;
          if (job.controller) job.controller.abort();
          else {
            jobs.splice(index, 1);
            this.pending--;
            this.states.set(job.key, 'failed');
            job.report('failed', 'Discord delivery cancelled; you can retry.');
          }
        }
      }
  }
  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
  }
}
