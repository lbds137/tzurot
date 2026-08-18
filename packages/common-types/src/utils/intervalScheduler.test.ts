/**
 * Tests for the interval-scheduler factory — the shared skeleton behind the
 * services' periodic background work: bot-client's checks and api-gateway's
 * model-catalog refresh.
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

  describe('in-flight overlap guard', () => {
    it('skips a tick — with a warn — while the previous run is still in flight', async () => {
      // A run cycle outlasting intervalMs: a promise that never resolves.
      const run = vi.fn().mockImplementation(() => new Promise<void>(() => {}));
      const { scheduler, logger } = make(run);

      scheduler.start();
      await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
      expect(run).toHaveBeenCalledTimes(1); // startup run, still unresolved

      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
      // Two ticks fired while the startup run was in flight — both skipped.
      expect(run).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith('Previous run still in flight — skipping this tick');
    });

    it('resumes running on the next tick after the long run completes', async () => {
      let finishRun!: () => void;
      const run = vi.fn().mockImplementation(
        () =>
          new Promise<void>(resolve => {
            finishRun = resolve;
          })
      );
      const { scheduler } = make(run);

      scheduler.start();
      await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS + INTERVAL_MS);
      expect(run).toHaveBeenCalledTimes(1); // interval tick skipped, run 1 in flight

      finishRun();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      // Flag cleared on completion — the cadence resumes, nothing stacked.
      expect(run).toHaveBeenCalledTimes(2);
    });

    it('does not skip when runs complete within the interval (the normal case)', async () => {
      const { scheduler, run, logger } = make();

      scheduler.start();
      await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS + INTERVAL_MS * 2);

      expect(run).toHaveBeenCalledTimes(3);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('keeps guarding across stop-then-restart while a run is still executing', async () => {
      // The flag deliberately survives stop(): the guard protects the RUN,
      // not the scheduler generation. Resetting it on stop() would let a
      // restart overlap the still-executing old run — the exact bug guarded.
      let finishRun!: () => void;
      const run = vi.fn().mockImplementation(
        () =>
          new Promise<void>(resolve => {
            finishRun = resolve;
          })
      );
      const { scheduler } = make(run);

      scheduler.start();
      await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
      expect(run).toHaveBeenCalledTimes(1); // in flight, unresolved

      scheduler.stop();
      scheduler.start();
      await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS + INTERVAL_MS);
      // Old run still executing — the new generation's ticks keep skipping.
      expect(run).toHaveBeenCalledTimes(1);

      finishRun();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      // Old run resolved — the restarted scheduler's next tick runs normally.
      expect(run).toHaveBeenCalledTimes(2);
    });
  });
});
