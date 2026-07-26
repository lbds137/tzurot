/**
 * Tests for the interval-scheduler factory — the shared skeleton behind
 * bot-client's periodic background checks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIntervalScheduler } from './intervalScheduler.js';

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Parameters<typeof createIntervalScheduler>[0]['logger'];
}

const INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30_000;

describe('createIntervalScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function make(run = vi.fn().mockResolvedValue(undefined)) {
    const logger = makeLogger();
    const scheduler = createIntervalScheduler({
      intervalMs: INTERVAL_MS,
      startupDelayMs: STARTUP_DELAY_MS,
      logger,
      run,
    });
    return { scheduler, run, logger };
  }

  it('runs once after the startup delay, then on every interval tick', async () => {
    const { scheduler, run } = make();

    scheduler.start();
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('forwards start-time args to every run (the client/redis binding seam)', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const scheduler = createIntervalScheduler<[string, number]>({
      intervalMs: INTERVAL_MS,
      startupDelayMs: STARTUP_DELAY_MS,
      logger,
      run,
    });

    scheduler.start('ctx', 7);
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS + INTERVAL_MS);

    expect(run).toHaveBeenNthCalledWith(1, 'ctx', 7);
    expect(run).toHaveBeenNthCalledWith(2, 'ctx', 7);
  });

  it('refuses a second start while running', () => {
    const { scheduler, logger } = make();

    scheduler.start();
    scheduler.start();

    expect(logger.warn).toHaveBeenCalledWith('Scheduler already running');
  });

  it('stop clears the recurring interval', async () => {
    const { scheduler, run } = make();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS + INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stop inside the startup-delay window cancels the pending startup run', async () => {
    // The stray-timer case the factory exists to close: a shutdown 10s after
    // boot must not leave a one-shot check firing at the 60s mark.
    const { scheduler, run } = make();

    scheduler.start();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS * 2);

    expect(run).not.toHaveBeenCalled();
  });

  it('is safe to stop when never started, and can restart after stop', async () => {
    const { scheduler, run } = make();

    scheduler.stop();

    scheduler.start();
    scheduler.stop();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);

    expect(run).toHaveBeenCalledTimes(1);
  });
});
