import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { pausePresentationClock } from './browser/helpers/clock.js';

describe('presentation clock setup', () => {
  it('cannot race past its pause target even when browser commands take several seconds', async () => {
    let wallTime = 10000,
      fixed = false,
      paused = false;
    const calls: string[] = [];
    const commandDelay = () => {
      if (!fixed && !paused) wallTime += 5000;
    };
    const page = {
      evaluate: async () => {
        const result = wallTime;
        commandDelay();
        return result;
      },
      clock: {
        setFixedTime: async (time: number) => {
          commandDelay();
          wallTime = time;
          fixed = true;
          calls.push('fixed');
        },
        pauseAt: async (time: number) => {
          commandDelay();
          if (time < wallTime) throw new Error('Cannot fast-forward to the past');
          wallTime = time;
          paused = true;
          calls.push('paused');
        },
        setSystemTime: async (time: number) => {
          commandDelay();
          wallTime = time;
          fixed = false;
          calls.push('system');
        },
      },
    } as unknown as Page;
    await pausePresentationClock(page);
    expect(calls).toEqual(['fixed', 'paused', 'system']);
    expect(paused).toBe(true);
    expect(fixed).toBe(false);
    expect(wallTime).toBe(10000);
    // A resumed clock can subsequently be paused again through the same helper.
    paused = false;
    wallTime += 900;
    await pausePresentationClock(page);
    expect(paused).toBe(true);
    expect(fixed).toBe(false);
    expect(wallTime).toBe(10900);
  });
});
